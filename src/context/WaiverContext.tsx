import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Franchise, LeagueBundle, Player } from "../types";
import { useLeague } from "./LeagueContext";
import {
  loadSession,
  saveSession,
  verifyLogin,
  type WaiverSession,
} from "../lib/waiver/auth";
import { WAIVER_LS_KEY } from "../lib/waiver/constants";
import {
  alignStateWithFranchises,
  franchisesFromRosters,
  reduceWaiver,
  type BidUpsertAction,
  type WaiverEngineAction,
} from "../lib/waiver/engine";
import { seedWaiverState } from "../lib/waiver/seed";
import type { RosterChangeEvent, WaiverPersistentState } from "../lib/waiver/types";
import {
  inferEffectiveAfterColumnIdFromRevealTime,
  matchColumnsFromPlayers,
  type MatchColumn,
} from "../lib/matchColumns";
import { summarizeDisplayFranchises } from "../lib/waiver/summarize";
import { isPlayerAvailable } from "../lib/waiver/available";
import type { ClientOwnershipPeriod } from "../lib/franchiseAttributedScoring";
import {
  isFirebaseWaiverConfigured,
  pushWaiverRemote,
  subscribeWaiverRemote,
  writeCompletedTransfers,
  loadCompletedTransfers,
  loadOwnerRemainingBudgets,
  lookupOwnerRemainingBudget,
} from "../lib/firebase/waiverRemote";
import { subscribeOwnershipPeriods } from "../lib/firebase/ownershipPeriodsRemote";
import { WAIVER_BUDGET_START } from "../lib/waiver/constants";
import {
  callWaiverNominate,
  callWaiverBid,
  callWaiverSettle,
  callWaiverCommitReveal,
  callSetWaiverPhase,
  type SettleResult,
  type WaiverCommitRevealResult,
} from "../lib/firebase/waiverApi";

function loadParsedState(): WaiverPersistentState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(WAIVER_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WaiverPersistentState;
  } catch {
    return null;
  }
}

function saveState(s: WaiverPersistentState): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(WAIVER_LS_KEY, JSON.stringify(s));
}

function initWaiverState(bundle: LeagueBundle): WaiverPersistentState {
  return alignStateWithFranchises(
    loadParsedState() ?? seedWaiverState(bundle.franchises),
    bundle.franchises,
  );
}

export type SubmitBidResult =
  | { ok: true; wasUpdate: boolean }
  | { ok: false; error: string };

type WaiverCtx = {
  session: WaiverSession | null;
  login: (label: string, password: string) => string | null;
  logout: () => void;
  state: WaiverPersistentState;
  displayFranchises: Franchise[];
  displaySummary: ReturnType<typeof summarizeDisplayFranchises> | null;
  /** @deprecated Use cloud methods below for server-validated mutations. */
  dispatch: (a: WaiverEngineAction) => string | null;
  /**
   * Apply a bid and wait for Firestore `setDoc` when Firebase is configured
   * (avoids optimistic-only state if the write fails).
   */
  submitBidUpsert: (action: BidUpsertAction) => Promise<SubmitBidResult>;
  availableIds: string[];
  remoteConnected: boolean;
  remoteError: string | null;
  /** Match columns from player JSON (for “effective after match” on reveal / settle). */
  matchColumnsForReveal: MatchColumn[];
  /** `null` = use latest match column in data. */
  revealEffectiveColumnIdOverride: string | null;
  setRevealEffectiveColumnIdOverride: (columnId: string | null) => void;
  /** Resolved match column id for reveal/settle (override or latest in data). */
  revealEffectiveAfterColumnId: string | null;
  /** Cloud Function backed mutations (server-validated, atomic writes). */
  cloud: {
    nominate: (params: {
      nominatedPlayerId: string;
      playerToDropId: string;
    }) => Promise<{ nominationId: string }>;
    bid: (params: {
      nominationId: string;
      bidAmount: number;
      playerToDropId?: string;
    }) => Promise<{ bidId: string }>;
    settle: (params: {
      nominationId: string;
      effectiveAfterColumnId?: string | null;
    }) => Promise<SettleResult>;
    setPhase: (
      phase: "idle" | "active",
    ) => Promise<{ phase: string; isWaiverWindowOpen: boolean }>;
    /** When Firebase is configured, prefer this over local `admin_reveal` for consistency. */
    commitReveal: (params?: {
      effectiveAfterColumnId?: string | null;
    }) => Promise<WaiverCommitRevealResult>;
  };
};

const WaiverContext = createContext<WaiverCtx | null>(null);

export function WaiverProvider({ children }: { children: ReactNode }) {
  const { bundle } = useLeague();
  if (!bundle) {
    throw new Error("WaiverProvider must render only when league data is loaded.");
  }
  const [session, setSession] = useState<WaiverSession | null>(() =>
    loadSession(),
  );
  const [state, setState] = useState<WaiverPersistentState>(() =>
    initWaiverState(bundle),
  );
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [ownershipPeriods, setOwnershipPeriods] = useState<ClientOwnershipPeriod[]>(
    [],
  );
  const skipNextPush = useRef(false);
  const localPushInFlight = useRef(false);
  const remoteHydrated = useRef(false);
  const bundleKeyRef = useRef<string>("");
  const budgetRepairDone = useRef(false);

  const allPlayersForScoring = useMemo(() => {
    const list: Player[] = [];
    const seen = new Set<string>();
    for (const p of bundle.players) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        list.push(p);
      }
    }
    for (const p of bundle.waiverPool ?? []) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        list.push(p);
      }
    }
    return list;
  }, [bundle]);

  const matchColumnsForReveal = useMemo(
    () => matchColumnsFromPlayers(allPlayersForScoring),
    [allPlayersForScoring],
  );

  const [revealEffectiveColumnIdOverride, setRevealEffectiveColumnIdOverride] =
    useState<string | null>(null);

  const revealEffectiveAfterColumnId = useMemo(() => {
    const cols = matchColumnsForReveal;
    if (cols.length === 0) return null;
    if (
      revealEffectiveColumnIdOverride &&
      cols.some((c) => c.id === revealEffectiveColumnIdOverride)
    ) {
      return revealEffectiveColumnIdOverride;
    }
    return cols[cols.length - 1]!.id;
  }, [matchColumnsForReveal, revealEffectiveColumnIdOverride]);

  useEffect(() => {
    const key = JSON.stringify(bundle.franchises);
    if (bundleKeyRef.current !== key) {
      bundleKeyRef.current = key;
      setState((prev) => alignStateWithFranchises(prev, bundle.franchises));
    }
  }, [bundle]);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void subscribeWaiverRemote(
      (payload) => {
        // Mark hydration on first snapshot (exists or not).
        remoteHydrated.current = true;
        if (payload == null) return;
        if (localPushInFlight.current) return;
        try {
          skipNextPush.current = true;
          setState(
            alignStateWithFranchises(
              payload as WaiverPersistentState,
              bundle.franchises,
            ),
          );
          setRemoteConnected(true);
        } catch {
          setRemoteError("Invalid remote waiver payload.");
        }
      },
      (e) => setRemoteError(e.message),
    ).then((u) => {
      if (cancelled) {
        u?.();
        return;
      }
      unsub = u ?? undefined;
      if (u) setRemoteConnected(true);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [bundle]);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void subscribeOwnershipPeriods(
      (periods) => {
        if (!cancelled) setOwnershipPeriods(periods);
      },
      () => {
        /* non-fatal; scoring falls back to roster replay / current */
      },
    ).then((u) => {
      if (cancelled) {
        u?.();
        return;
      }
      unsub = u ?? undefined;
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    saveState(state);
    if (!isFirebaseWaiverConfigured()) return;
    // Critical: don't write seeded/local state until we've seen the first snapshot.
    // Otherwise, a cold start can overwrite an existing Firestore waiverState.
    if (!remoteHydrated.current) return;
    if (skipNextPush.current) {
      skipNextPush.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void pushWaiverRemote(state).catch((e: Error) =>
        setRemoteError(e.message),
      );
    }, 400);
    return () => window.clearTimeout(t);
  }, [state, bundle]);

  useEffect(() => {
    if (!remoteConnected || budgetRepairDone.current) return;
    budgetRepairDone.current = true;

    const cols = matchColumnsFromPlayers(allPlayersForScoring);

    void (async () => {
      try {
        const [transfers, cloudBudgets] = await Promise.all([
          loadCompletedTransfers(),
          loadOwnerRemainingBudgets(),
        ]);

        const spent: Record<string, number> = {};
        for (const t of transfers) {
          const won = t.bids.find((b) => b.result === "WON");
          if (won) {
            spent[won.owner] = (spent[won.owner] ?? 0) + won.amount;
          }
        }

        const franchiseOwners = bundle.franchises.map((f) => f.owner);
        const hasAnyOwnerDoc = Object.keys(cloudBudgets).length > 0;

        setState((prev) => {
          let changed = false;

          // --- Budget repair ---
          // Three sources can disagree (legacy / partial failures). Prefer the lowest remaining
          // (most spending applied). `waiverCommitReveal` and `handleSettle` now keep owners,
          // completedTransfers, and waiverState aligned when using Firebase.
          const corrected = { ...prev.budgets };
          for (const owner of franchiseOwners) {
            const prevB = corrected[owner] ?? WAIVER_BUDGET_START;
            const fromCloud = lookupOwnerRemainingBudget(cloudBudgets, owner);
            const amountSpent = spent[owner] ?? 0;
            const fromTransfers = WAIVER_BUDGET_START - amountSpent;
            const candidates = [prevB, fromTransfers];
            if (
              hasAnyOwnerDoc &&
              typeof fromCloud === "number" &&
              Number.isFinite(fromCloud)
            ) {
              candidates.push(fromCloud);
            }
            const next = Math.min(...candidates);
            if (corrected[owner] !== next) {
              corrected[owner] = next;
              changed = true;
            }
          }

          if (transfers.length === 0 && !hasAnyOwnerDoc) return prev;

          // --- RosterHistory repair ---
          const existingKeys = new Set(
            prev.rosterHistory.map(
              (e) => `${e.playerInId}|${e.winner}|${e.roundId}`,
            ),
          );
          const missing: RosterChangeEvent[] = [];
          const roundGroups = new Map<number, typeof transfers>();
          for (const t of transfers) {
            const g = roundGroups.get(t.roundId) ?? [];
            g.push(t);
            roundGroups.set(t.roundId, g);
          }
          for (const [roundId, group] of roundGroups) {
            group.sort((a, b) => a.revealedAt.localeCompare(b.revealedAt));
            group.forEach((t, idx) => {
              const won = t.bids.find((b) => b.result === "WON");
              if (!won) return;
              const key = `${t.playerInId}|${won.owner}|${roundId}`;
              if (existingKeys.has(key)) return;
              let effCol: string | null = t.effectiveAfterColumnId ?? null;
              if (!effCol || !cols.some((c) => c.id === effCol)) {
                effCol = inferEffectiveAfterColumnIdFromRevealTime(t.revealedAt, cols);
              }
              missing.push({
                at: t.revealedAt,
                roundId,
                orderInRound: idx,
                winner: won.owner,
                playerOutId: won.playerOutId,
                playerInId: t.playerInId,
                effectiveAfterColumnId: effCol,
              });
            });
          }

          if (missing.length > 0) changed = true;

          if (!changed) return prev;
          return {
            ...prev,
            budgets: corrected,
            rosterHistory: missing.length > 0
              ? [...prev.rosterHistory, ...missing]
              : prev.rosterHistory,
          };
        });
      } catch {
        // Non-critical — repairs will run on next load
      }
    })();
  }, [remoteConnected, allPlayersForScoring, bundle]);

  const displayFranchises = useMemo(() => {
    if (!bundle || !state) return [];
    return franchisesFromRosters(bundle.franchises, state.rosters);
  }, [bundle, state]);

  const displaySummary = useMemo(() => {
    if (!bundle || !state) return null;
    return summarizeDisplayFranchises(
      bundle,
      displayFranchises,
      state.rosterHistory,
      state.rosters,
      ownershipPeriods.length > 0 ? ownershipPeriods : undefined,
    );
  }, [bundle, state, displayFranchises, ownershipPeriods]);

  const availableIds = useMemo(() => {
    if (!bundle || !state) return [];
    const seen = new Set<string>();
    const list: Player[] = [];
    for (const p of bundle.players) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        list.push(p);
      }
    }
    for (const p of bundle.waiverPool ?? []) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        list.push(p);
      }
    }
    return list
      .filter((p) => isPlayerAvailable(state.rosters, p.id))
      .map((p) => p.id);
  }, [bundle, state]);

  const dispatch = useCallback(
    (action: WaiverEngineAction): string | null => {
      if (!bundle || !state) return "Loading…";
      const result = reduceWaiver(state, action, {
        baseFranchises: bundle.franchises,
        revealEffectiveAfterColumnId,
      });
      if (result.error) {
        if (result.state !== state) setState(result.state);
        return result.error;
      }
      setState(result.state);
      if (isFirebaseWaiverConfigured()) {
        // Avoid writing before initial remote hydration.
        if (remoteHydrated.current) {
          // Push to Firestore immediately to prevent the subscription from
          // overwriting with stale data before the debounced push fires.
          skipNextPush.current = true;
          localPushInFlight.current = true;
          void pushWaiverRemote(result.state)
            .catch((e: Error) => setRemoteError(e.message))
            .finally(() => {
              localPushInFlight.current = false;
            });
          if (result.completedTransfers?.length) {
            void writeCompletedTransfers(result.completedTransfers).catch(
              (e: Error) => setRemoteError(e.message),
            );
          }
        }
      }
      return null;
    },
    [bundle, state, revealEffectiveAfterColumnId],
  );

  const submitBidUpsert = useCallback(
    async (action: BidUpsertAction): Promise<SubmitBidResult> => {
      if (!bundle) return { ok: false, error: "Loading…" };
      const wasUpdate = state.bids.some(
        (b) =>
          b.nominationId === action.nominationId &&
          b.bidderOwner === action.bidderOwner,
      );
      const result = reduceWaiver(state, action, {
        baseFranchises: bundle.franchises,
        revealEffectiveAfterColumnId,
      });
      if (result.error) {
        if (result.state !== state) setState(result.state);
        return { ok: false, error: result.error };
      }
      const nextState = result.state;

      if (isFirebaseWaiverConfigured()) {
        if (!remoteHydrated.current) {
          return {
            ok: false,
            error:
              "Still connecting to Firestore. Please try again in a moment.",
          };
        }
        skipNextPush.current = true;
        localPushInFlight.current = true;
        try {
          await pushWaiverRemote(nextState);
          if (result.completedTransfers?.length) {
            await writeCompletedTransfers(result.completedTransfers);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setRemoteError(msg);
          return {
            ok: false,
            error: "Bid Submission Failed. Please try your bid again.",
          };
        } finally {
          localPushInFlight.current = false;
        }
      }

      setState(nextState);
      return { ok: true, wasUpdate };
    },
    [bundle, state, revealEffectiveAfterColumnId],
  );

  const login = useCallback((label: string, password: string) => {
    const s = verifyLogin(label, password);
    if (!s) return "Invalid user or password.";
    setSession(s);
    saveSession(s);
    return null;
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    saveSession(null);
  }, []);

  const cloud = useMemo(() => {
    const ownerName = session?.role === "owner" ? session.owner : "";
    const ownerPassword = "";

    return {
      nominate: async (params: {
        nominatedPlayerId: string;
        playerToDropId: string;
      }) => {
        return callWaiverNominate({
          ownerName,
          ownerPassword,
          ...params,
        });
      },
      bid: async (params: {
        nominationId: string;
        bidAmount: number;
        playerToDropId?: string;
      }) => {
        return callWaiverBid({
          ownerName,
          ownerPassword,
          ...params,
        });
      },
      settle: async (params: {
        nominationId: string;
        effectiveAfterColumnId?: string | null;
      }) => {
        return callWaiverSettle(params);
      },
      setPhase: async (phase: "idle" | "active") => {
        return callSetWaiverPhase({ targetPhase: phase });
      },
      commitReveal: async (params?: { effectiveAfterColumnId?: string | null }) => {
        return callWaiverCommitReveal({
          effectiveAfterColumnId:
            params?.effectiveAfterColumnId ?? revealEffectiveAfterColumnId,
        });
      },
    };
  }, [session, revealEffectiveAfterColumnId]);

  return (
    <WaiverContext.Provider
      value={{
        session,
        login,
        logout,
        state,
        displayFranchises,
        displaySummary,
        dispatch,
        submitBidUpsert,
        availableIds,
        remoteConnected,
        remoteError,
        matchColumnsForReveal,
        revealEffectiveColumnIdOverride,
        setRevealEffectiveColumnIdOverride,
        revealEffectiveAfterColumnId,
        cloud,
      }}
    >
      {children}
    </WaiverContext.Provider>
  );
}

export function useWaiver(): WaiverCtx {
  const ctx = useContext(WaiverContext);
  if (!ctx) throw new Error("useWaiver must be used within WaiverProvider");
  return ctx;
}

export function useLeagueStandings() {
  const { bundle, loading, error } = useLeague();
  const w = useWaiver();
  return useMemo(() => {
    if (loading || error || !bundle) return null;
    return w.displaySummary;
  }, [bundle, loading, error, w.displaySummary]);
}
