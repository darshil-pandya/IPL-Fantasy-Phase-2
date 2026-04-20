import { useCallback, useEffect, useMemo, useState } from "react";
import { IplTeamPill } from "../components/IplTeamPill";
import { OwnerBadge } from "../components/OwnerBadge";
import { WaiverBidField } from "../components/WaiverBidField";
import { WaiverPlayerPicker } from "../components/WaiverPlayerPicker";
import { useLeague } from "../context/LeagueContext";
import {
  useWaiver,
  type SubmitBidResult,
} from "../context/WaiverContext";
import type { BidUpsertAction, WaiverEngineAction } from "../lib/waiver/engine";
import {
  WAIVER_BID_INCREMENT,
  WAIVER_BUDGET_START,
} from "../lib/waiver/constants";
import { WAIVER_LOGIN_ROWS } from "../lib/waiver/auth";
import type { Franchise, LeagueBundle, Player } from "../types";
import type { CompletedTransfer, WaiverBid, WaiverNomination, WaiverSession } from "../lib/waiver/types";
import { isFirebaseConfigured, leagueDataSourceMode } from "../lib/firebase/client";
import {
  callAdminDeleteWaiverBid,
  callAdminDeleteWaiverNomination,
  callMigrateToCollections,
  callResetLeagueToAuctionBaseline,
} from "../lib/firebase/waiverApi";
import { seedLeagueFromStaticToFirestore } from "../lib/firebase/leagueRemote";
import { commitMidSeasonAuctionToFirestore } from "../lib/firebase/midSeasonAuctionCommit";
import { loadCompletedTransfers } from "../lib/firebase/waiverRemote";
import { validateMidSeasonAuctionCsv } from "../lib/csv/midSeasonAuctionCsv";
import { applyMidSeasonAuctionToState } from "../lib/waiver/midSeasonAuctionApply";
import { abbreviateMatchLabel, formatMatchDate } from "../lib/matchLabel";
import type { MatchColumn } from "../lib/matchColumns";
import { ownerCardClass, ownerCardMutedClass } from "../lib/ownerTheme";

function money(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Firebase callable / HttpsError often expose `code` + `message`; surface both in the UI. */
function formatCallableError(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown };
    const code = typeof o.code === "string" ? o.code : "";
    const msg = typeof o.message === "string" ? o.message : "";
    if (code && msg) return `${code}: ${msg}`;
    if (msg) return msg;
    if (code) return code;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

function BidToast({
  toast,
}: {
  toast: { variant: "success" | "error"; message: string } | null;
}) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "fixed left-1/2 z-[100] max-w-[min(100vw-2rem,28rem)] -translate-x-1/2 rounded-xl border px-4 py-3 text-center text-sm shadow-lg",
        "bottom-[max(1rem,env(safe-area-inset-bottom))]",
        toast.variant === "success"
          ? "border-emerald-500/40 bg-emerald-950/95 text-emerald-100"
          : "border-red-500/40 bg-red-950/95 text-red-100",
      ].join(" ")}
    >
      {toast.message}
    </div>
  );
}

function formatNominationsCloseIn(deadlineIso: string, nowMs: number): string {
  const ms = Date.parse(deadlineIso) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} h ${m} m`;
}

function firebaseUi(connected: boolean, err: string | null): React.ReactNode {
  if (!isFirebaseConfigured()) {
    return (
      <p className="mt-2 text-xs text-slate-600">
        Firestore sync off — this build needs all three{" "}
        <code className="text-slate-500">VITE_FIREBASE_*</code> vars at build time (see
        docs/firebase-waiver-setup.md).
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-slate-500">
      Firestore: {connected ? "listening" : "connecting…"}
      {err ? <span className="text-red-400"> — {err}</span> : null}
    </p>
  );
}

export function Waivers() {
  const { bundle } = useLeague();
  const {
    session,
    login,
    logout,
    state,
    dispatch,
    submitBidUpsert,
    displayFranchises,
    availableIds,
    remoteConnected,
    remoteError,
    matchColumnsForReveal,
    revealEffectiveColumnIdOverride,
    setRevealEffectiveColumnIdOverride,
    cloud,
  } = useWaiver();

  const [userLabel, setUserLabel] = useState(WAIVER_LOGIN_ROWS[0]!.label);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [bidToast, setBidToast] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!bidToast) return;
    const t = window.setTimeout(() => setBidToast(null), 3000);
    const dismiss = () => setBidToast(null);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
    };
  }, [bidToast]);

  const submitBidWithToast = useCallback(
    async (action: BidUpsertAction): Promise<SubmitBidResult> => {
      const r = await submitBidUpsert(action);
      if (r.ok) {
        setBidToast({
          variant: "success",
          message: r.wasUpdate
            ? "Bid updated successfully."
            : "Bid placed successfully.",
        });
      } else {
        setBidToast({ variant: "error", message: r.error });
      }
      return r;
    },
    [submitBidUpsert],
  );

  const pmap = useMemo(() => {
    const m = new Map<string, Player>();
    if (!bundle) return m;
    for (const p of bundle.players) m.set(p.id, p);
    for (const p of bundle.waiverPool ?? []) {
      if (!m.has(p.id)) m.set(p.id, p);
    }
    return m;
  }, [bundle]);

  const ownerFranchise = useMemo(() => {
    if (!session || session.role !== "owner") return null;
    return displayFranchises.find((f) => f.owner === session.owner) ?? null;
  }, [session, displayFranchises]);

  const myNominations = useMemo(() => {
    if (!session || session.role !== "owner") return [];
    return state.nominations.filter((n) => n.nominatorOwner === session.owner);
  }, [session, state.nominations]);

  const nominatedInIds = useMemo(
    () => new Set(state.nominations.map((n) => n.playerInId)),
    [state.nominations],
  );

  function runDispatch(a: WaiverEngineAction): string | null {
    setActionErr(null);
    const err = dispatch(a);
    if (err) setActionErr(err);
    return err;
  }

  async function tryRevealRound() {
    setActionErr(null);
    if (isFirebaseConfigured()) {
      try {
        await cloud.commitReveal();
      } catch (e: unknown) {
        const msg = formatCallableError(e);
        setActionErr(msg || "Reveal failed.");
      }
      return;
    }
    const err = dispatch({ type: "admin_reveal" });
    if (err) setActionErr(err);
  }

  async function adminDeleteBid(bidId: string) {
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    if (isFirebaseConfigured()) {
      try {
        await callAdminDeleteWaiverBid({ bidId });
        return;
      } catch {
        /* fall back to local state */
      }
    }
    runDispatch({ type: "admin_delete_bid", bidId });
  }

  async function adminDeleteNomination(nominationId: string) {
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    if (isFirebaseConfigured()) {
      try {
        await callAdminDeleteWaiverNomination({ nominationId });
        return;
      } catch {
        /* fall back to local state */
      }
    }
    runDispatch({ type: "admin_delete_nomination", nominationId });
  }

  function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr(null);
    const err = login(userLabel, password);
    if (err) setLoginErr(err);
    else setPassword("");
  }

  function exportRosters() {
    if (!bundle) return;
    const out = { franchises: displayFranchises };
    const blob = new Blob([JSON.stringify(out, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "franchises-after-waiver.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!bundle) return null;

  return (
    <div className="space-y-8">
      <section className="app-card p-5">
        <h2 className="font-display text-3xl tracking-wide text-white">Waiver center</h2>
        <p className="mt-2 text-sm text-slate-400">
          Other owners&apos; bid amounts stay off this screen until the commissioner reveals
          the round (honor system). Phase:{" "}
          <strong className="text-cyan-400">{state.phase}</strong>
          {state.roundId > 0 ? (
            <span className="text-slate-500"> · Round {state.roundId}</span>
          ) : null}
          . Budget per owner: {money(WAIVER_BUDGET_START)} · Bids in{" "}
          {money(WAIVER_BID_INCREMENT)} steps.
        </p>
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Remaining waiver budget
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            {displayFranchises.map((f) => {
              const remaining = state.budgets[f.owner] ?? WAIVER_BUDGET_START;
              const isYou =
                session?.role === "owner" && session.owner === f.owner;
              return (
                <div
                  key={f.owner}
                  className={[
                    ownerCardClass(f.owner),
                    isYou
                      ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-950"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <p
                    className={`truncate text-xs font-semibold ${ownerCardMutedClass(f.owner)}`}
                    title={f.owner}
                  >
                    {f.owner}
                    {isYou ? (
                      <span className="ml-1 font-normal text-cyan-400">· you</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-base font-bold tabular-nums text-white">
                    {money(remaining)}
                  </p>
                  <p
                    className={`text-[10px] font-medium opacity-75 ${ownerCardMutedClass(f.owner)}`}
                  >
                    left to bid
                  </p>
                </div>
              );
            })}
          </div>
        </div>
        {firebaseUi(remoteConnected, remoteError)}
        {!session ? (
          <form
            onSubmit={doLogin}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
          >
            <label className="flex flex-col gap-1 text-sm text-slate-200">
              <span className="text-xs uppercase text-slate-500">User</span>
              <select
                value={userLabel}
                onChange={(e) => setUserLabel(e.target.value)}
                className="app-input py-2"
              >
                {WAIVER_LOGIN_ROWS.map((r) => (
                  <option key={r.label} value={r.label}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-200">
              <span className="text-xs uppercase text-slate-500">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="app-input min-w-[12rem] py-2"
              />
            </label>
            <button type="submit" className="app-btn-primary self-end sm:self-auto">
              Sign in
            </button>
            {loginErr && (
              <p className="text-sm text-red-400 sm:w-full">{loginErr}</p>
            )}
          </form>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600">
              Signed in as{" "}
              <strong className="text-white">{session.label}</strong> (
              {session.role})
            </span>
            <button type="button" onClick={logout} className="app-btn-secondary py-1.5 text-sm">
              Log out
            </button>
          </div>
        )}
      </section>

      {session?.role === "admin" && (
        <AdminPanel
          dispatch={(a) => {
            runDispatch(a);
          }}
          error={actionErr}
          onExport={exportRosters}
          matchColumnsForReveal={matchColumnsForReveal}
          revealEffectiveColumnIdOverride={revealEffectiveColumnIdOverride}
          setRevealEffectiveColumnIdOverride={setRevealEffectiveColumnIdOverride}
          onRevealRound={tryRevealRound}
        />
      )}

      {session?.role === "owner" && ownerFranchise && (
        <OwnerWaiverPanel
          sessionOwner={session.owner}
          franchise={ownerFranchise}
          phase={state.phase}
          nominationDeadline={state.waiverRound?.nominationDeadline}
          myNominations={myNominations}
          nominatedInIds={nominatedInIds}
          availableIds={availableIds}
          budgetRemaining={state.budgets[session.owner] ?? 0}
          pmap={pmap}
          tryDispatch={runDispatch}
          error={actionErr}
        />
      )}

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Nominations this round
        </h3>
        {state.nominations.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {state.nominations.map((n) => (
              <NominationRow
                key={n.id}
                n={n}
                pmap={pmap}
                bids={state.bids.filter((b) => b.nominationId === n.id)}
                phase={state.phase}
                session={session}
                myRosterIds={
                  session?.role === "owner"
                    ? (displayFranchises.find((f) => f.owner === session.owner)
                        ?.playerIds ?? [])
                    : []
                }
                budgetRemaining={
                  session?.role === "owner"
                    ? (state.budgets[session.owner] ?? 0)
                    : 0
                }
                submitBid={submitBidWithToast}
                onAdminDeleteBid={adminDeleteBid}
                onAdminDeleteNomination={adminDeleteNomination}
              />
            ))}
          </ul>
        )}
      </section>

      {session?.role === "admin" && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Event log
          </h3>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-cyan-500/25 bg-slate-950/60 p-3 font-mono text-xs text-slate-400">
            {[...state.log].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="text-slate-500">{e.at}</span> [{e.kind}]{" "}
                {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SuccessfulTransfers
        pmap={pmap}
        refreshDep={state.rosterHistory.length}
      />

      <section className="app-card p-4">
        <h3 className="text-sm font-semibold text-white">Original auction</h3>
        <p className="mt-1 text-xs text-slate-500">
          Static history from <code className="app-code-inline">auction.json</code>.
        </p>
        <AuctionHistorySnippet bundle={bundle} pmap={pmap} />
      </section>
      <BidToast toast={bidToast} />
    </div>
  );
}

function AdminPanel({
  dispatch,
  error,
  onExport,
  matchColumnsForReveal,
  revealEffectiveColumnIdOverride,
  setRevealEffectiveColumnIdOverride,
  onRevealRound,
}: {
  dispatch: (a: WaiverEngineAction) => void;
  error: string | null;
  onExport: () => void;
  matchColumnsForReveal: MatchColumn[];
  revealEffectiveColumnIdOverride: string | null;
  setRevealEffectiveColumnIdOverride: (columnId: string | null) => void;
  onRevealRound: () => Promise<void>;
}) {
  const { bundle, leagueBundleOrigin, leagueFirestoreIsCanonical, leagueNotice } =
    useLeague();
  const { state } = useWaiver();
  const [pubBusy, setPubBusy] = useState(false);
  const [revealBusy, setRevealBusy] = useState(false);
  const [pubFeedback, setPubFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [debugging, setDebugging] = useState(false);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateFeedback, setMigrateFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [fullResetBusy, setFullResetBusy] = useState(false);
  const [fullResetFeedback, setFullResetFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvErrors, setCsvErrors] = useState<string[] | null>(null);
  const [csvReady, setCsvReady] = useState(false);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [midBusy, setMidBusy] = useState(false);
  const [midFeedback, setMidFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const midSeasonBlockedReason =
    state.phase !== "idle"
      ? "Waiver phase must be idle."
      : state.nominations.length > 0 || state.bids.length > 0
        ? "Clear nominations and bids first."
        : !isFirebaseConfigured()
          ? "Firebase is not configured in this build."
          : null;

  async function onMidSeasonCsvSelected(file: File | null) {
    setCsvErrors(null);
    setCsvReady(false);
    setCsvText(null);
    setMidFeedback(null);
    if (!file || !bundle) {
      setCsvFileName(null);
      return;
    }
    setCsvFileName(file.name);
    const text = await file.text();
    setCsvText(text);
    const v = validateMidSeasonAuctionCsv(text, bundle);
    if (!v.ok) {
      setCsvErrors(v.errors);
      return;
    }
    setCsvReady(true);
  }

  async function applyMidSeasonCsv() {
    if (!bundle || !csvText) return;
    const v = validateMidSeasonAuctionCsv(csvText, bundle);
    if (!v.ok) {
      setCsvErrors(v.errors);
      return;
    }
    setMidBusy(true);
    setMidFeedback(null);
    try {
      const applied = applyMidSeasonAuctionToState(bundle, state, v.rows);
      if (!applied.ok) {
        setMidFeedback({ kind: "err", text: applied.error });
        return;
      }
      await commitMidSeasonAuctionToFirestore(
        applied.leagueBundle,
        applied.waiverState,
      );
      setMidFeedback({
        kind: "ok",
        text: "Mid-season rosters written to Firestore. Other tabs will update automatically.",
      });
      setCsvReady(false);
      setCsvText(null);
      setCsvFileName(null);
    } catch (e) {
      setMidFeedback({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setMidBusy(false);
    }
  }

  async function publishLeagueToFirestore() {
    if (!isFirebaseConfigured()) return;
    setPubFeedback(null);
    setPubBusy(true);
    try {
      await seedLeagueFromStaticToFirestore();
      setPubFeedback({
        kind: "ok",
        text: "League bundle written to Firestore. Other tabs and devices will update automatically.",
      });
    } catch (e) {
      setPubFeedback({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPubBusy(false);
    }
  }

  async function runCloudRosterRepair() {
    if (!isFirebaseConfigured()) return;
    setMigrateFeedback(null);
    setMigrateBusy(true);
    try {
      const r = await callMigrateToCollections();
      const warn =
        r.warnings.length > 0 ? ` Warnings: ${r.warnings.join("; ")}` : "";
      setMigrateFeedback({
        kind: "ok",
        text: `Migrated ${r.playerCount} players, ${r.ownerCount} owners, ${r.periodCount} ownership periods, ${r.matchPointCount} match point rows.${warn}`,
      });
    } catch (e) {
      setMigrateFeedback({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setMigrateBusy(false);
    }
  }

  async function runFullResetToAuction() {
    if (!isFirebaseConfigured()) return;
    setFullResetFeedback(null);
    setFullResetBusy(true);
    try {
      const r = await callResetLeagueToAuctionBaseline();
      const w = r.waiverReset;
      const del = w.deleted;
      setFullResetFeedback({
        kind: "ok",
        text: `Scoring cleared (bundle stats stripped, fantasyMatchScores cleared, ${r.matchPlayerPointsDeleted} matchPlayerPoints rows removed). Waiver: ${del.completedTransfers} transfers, ${del.waiverNominations} noms, ${del.waiverBids} bids, ${del.ownershipPeriods} periods removed. ${w.message}`,
      });
    } catch (e) {
      setFullResetFeedback({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setFullResetBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/90 p-5 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-900">
        Commissioner
      </h3>
      <label className="mt-4 flex max-w-xl flex-col gap-1">
        <span className="text-xs font-semibold text-amber-900">
          Transfers from the next reveal take effect after this match
        </span>
        <select
          value={revealEffectiveColumnIdOverride ?? ""}
          onChange={(e) =>
            setRevealEffectiveColumnIdOverride(e.target.value || null)
          }
          className="rounded-lg border border-amber-300/80 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="">Latest match in player data (default)</option>
          {matchColumnsForReveal.map((c) => (
            <option key={c.id} value={c.id}>
              {abbreviateMatchLabel(c.label, c.teams)} · {formatMatchDate(c.date)}
            </option>
          ))}
        </select>
        <span className="text-[11px] leading-snug text-amber-900/80">
          Use this when backfilling waivers: pick the match that had already finished before the
          transfer should count (e.g. after match 7, choose CSK vs PBKS on 3 Apr).
        </span>
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: "admin_start_nomination" })}
          className="app-btn-primary"
        >
          Start nominations
        </button>
        <button
          type="button"
          disabled={revealBusy}
          onClick={() => {
            void (async () => {
              setRevealBusy(true);
              try {
                await onRevealRound();
              } finally {
                setRevealBusy(false);
              }
            })();
          }}
          className="rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-500 hover:to-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {revealBusy
            ? "Revealing…"
            : isFirebaseConfigured()
              ? "Reveal results (server)"
              : "Reveal results"}
        </button>
        <button type="button" onClick={onExport} className="app-btn-secondary">
          Export rosters JSON
        </button>
        <button
          type="button"
          disabled={pubBusy || !isFirebaseConfigured()}
          title={
            !isFirebaseConfigured()
              ? "Add all three VITE_FIREBASE_* secrets and redeploy so this build can use Firestore."
              : undefined
          }
          onClick={() => void publishLeagueToFirestore()}
          className="rounded-xl border border-amber-400/50 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pubBusy ? "Publishing…" : "Publish league to Firestore"}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {!isFirebaseConfigured() && (
        <p className="mt-3 text-xs leading-relaxed text-amber-200/90">
          <strong className="font-medium text-amber-300">Publish is disabled.</strong> This
          deploy must include all three Firebase env vars at <em>build</em> time. In GitHub:{" "}
          <strong>Settings → Secrets and variables → Actions</strong>, add{" "}
          <code className="app-code-inline text-[0.7rem]">VITE_FIREBASE_API_KEY</code>
          , <code className="app-code-inline text-[0.7rem]">VITE_FIREBASE_AUTH_DOMAIN</code>, and{" "}
          <code className="app-code-inline text-[0.7rem]">VITE_FIREBASE_PROJECT_ID</code> (exact
          names), then push to <code className="text-amber-400">main</code> or re-run{" "}
          <strong>Deploy to GitHub Pages</strong>. If only the API key was set, Waivers could
          misleadingly say “listening” before — that is fixed in this version.
        </p>
      )}
      {pubFeedback && (
        <p
          className={
            pubFeedback.kind === "ok"
              ? "mt-3 text-xs text-emerald-400"
              : "mt-3 text-xs text-red-400"
          }
        >
          {pubFeedback.text}
        </p>
      )}

      <div className="mt-6 rounded-xl border border-cyan-500/35 bg-cyan-950/20 p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-cyan-200">
          Mid-season auction (CSV)
        </h4>
        <p className="mt-2 text-[11px] leading-relaxed text-amber-900/90">
          Upload a CSV with header{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">
            player_id,name,role,ipl_team,nationality,franchise_owner
          </code>
          — exactly <strong className="text-amber-950">105</strong> data rows (7×15). Waiver budgets
          are kept; waiver phase must be idle. See{" "}
          <span className="font-medium text-amber-950">docs/mid-season-auction-csv-import-spec.md</span>.
        </p>
        {midSeasonBlockedReason && (
          <p className="mt-2 text-xs font-medium text-amber-800">
            Import blocked: {midSeasonBlockedReason}
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-cyan-500/40 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-slate-900/60">
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={Boolean(midSeasonBlockedReason) || midBusy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                void onMidSeasonCsvSelected(f);
                e.target.value = "";
              }}
            />
            Choose CSV
          </label>
          {csvFileName ? (
            <span className="text-xs text-slate-600">
              Selected: <strong className="text-slate-800">{csvFileName}</strong>
            </span>
          ) : null}
          <button
            type="button"
            disabled={
              !csvReady ||
              Boolean(midSeasonBlockedReason) ||
              midBusy ||
              !isFirebaseConfigured()
            }
            onClick={() => void applyMidSeasonCsv()}
            className="rounded-xl bg-gradient-to-r from-cyan-700 to-teal-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow disabled:cursor-not-allowed disabled:opacity-50"
          >
            {midBusy ? "Applying…" : "Apply import to Firestore"}
          </button>
        </div>
        {csvReady && !midSeasonBlockedReason && (
          <p className="mt-2 text-xs text-emerald-700">
            CSV is valid: 105 players, 7 franchises. Click <strong>Apply import</strong> to write.
          </p>
        )}
        {csvErrors && csvErrors.length > 0 && (
          <ul className="mt-3 max-h-48 list-inside list-disc overflow-y-auto rounded-lg border border-red-300/50 bg-red-950/30 p-2 text-left text-[11px] text-red-900">
            {csvErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}
        {midFeedback && (
          <p
            className={
              midFeedback.kind === "ok"
                ? "mt-3 text-xs text-emerald-600"
                : "mt-3 text-xs text-red-600"
            }
          >
            {midFeedback.text}
          </p>
        )}
      </div>

      <div className="mt-6 border-t border-amber-300/40 pt-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-amber-950">
          <input
            type="checkbox"
            className="size-4 rounded border-amber-600/50 bg-white"
            checked={debugging}
            onChange={(e) => setDebugging(e.target.checked)}
          />
          Debugging
        </label>
        <p className="mt-1 text-[11px] leading-snug text-amber-900/75">
          When off, cloud roster repair, reset waiver season, and April backfill stay hidden.
        </p>
      </div>

      {debugging ? (
        <div className="mt-4 space-y-6">
      <div className="rounded-xl border border-slate-400/40 bg-slate-900/20 p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-200">
          League data source
        </h4>
        <p className="mt-2 text-[11px] leading-relaxed text-amber-900/90">
          Build mode:{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">
            {leagueDataSourceMode()}
          </code>
          . Live bundle origin:{" "}
          <strong className="text-amber-950">
            {leagueBundleOrigin ?? "—"}
          </strong>
          . Firestore is canonical for the league JSON:{" "}
          <strong className="text-amber-950">
            {leagueFirestoreIsCanonical ? "yes" : "no"}
          </strong>
          .
        </p>
        {leagueNotice ? (
          <p className="mt-2 text-[11px] leading-snug text-amber-950/90">{leagueNotice}</p>
        ) : null}
        <p className="mt-2 text-[11px] leading-relaxed text-amber-900/80">
          After a server reset, avoid <code className="app-code-inline text-[0.65rem]">static</code> league
          mode while Firebase is on, or the site can show old rosters/points from{" "}
          <code className="app-code-inline text-[0.65rem]">public/.../data</code> while waivers and scores
          follow Firestore. Production builds default to{" "}
          <code className="app-code-inline text-[0.65rem]">VITE_LEAGUE_SOURCE=firestore</code> in the GitHub
          Actions workflow (override with repo variable{" "}
          <code className="app-code-inline text-[0.65rem]">VITE_LEAGUE_SOURCE</code> if needed).
        </p>
      </div>
      <div className="rounded-xl border border-violet-400/40 bg-violet-950/25 p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-violet-200">
          Cloud roster repair
        </h4>
        <p className="mt-2 text-xs leading-relaxed text-amber-900/90">
          Runs <strong className="font-medium text-amber-950">Migrate to collections</strong>: rebuilds{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">owners</code>,{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">players</code>,{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">ownershipPeriods</code>, and{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">matchPlayerPoints</code> from{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">leagueBundle</code>,{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">waiverState</code>, and{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">fantasyMatchScores</code>.
        </p>
        <button
          type="button"
          disabled={migrateBusy || !isFirebaseConfigured()}
          onClick={() => {
            if (
              !window.confirm(
                "Run cloud migration / roster repair? This overwrites migrated collections from current bundle + waiver + scores.",
              )
            ) {
              return;
            }
            void runCloudRosterRepair();
          }}
          className="mt-3 rounded-lg border border-violet-500/50 bg-violet-900/40 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-800/50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {migrateBusy ? "Running…" : "Run cloud roster repair"}
        </button>
        {migrateFeedback && (
          <p
            className={
              migrateFeedback.kind === "ok"
                ? "mt-2 text-xs text-emerald-800"
                : "mt-2 text-xs text-red-700"
            }
          >
            {migrateFeedback.text}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-red-500/35 bg-red-950/20 p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-red-200">
          Reset scoring + waivers to auction squads
        </h4>
        <p className="mt-2 text-xs leading-relaxed text-amber-900/90">
          Strips <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">byMatch</code> /{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">seasonTotal</code> on{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">leagueBundle</code>, clears{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">fantasyMatchScores</code> and{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">matchPlayerPoints</code>, then
          resets waiver state and related collections to auction rosters and full budgets (same as waiver-only
          reset). Requires Cloud Functions deploy with{" "}
          <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-900">
            adminResetLeagueToAuctionBaseline
          </code>
          . Keep <code className="app-code-inline text-[0.65rem]">VITE_LEAGUE_SOURCE=firestore</code> (or{" "}
          <code className="app-code-inline text-[0.65rem]">auto</code> with a published bundle) so clients do
          not keep reading stale static JSON.
        </p>
        <button
          type="button"
          disabled={fullResetBusy || !isFirebaseConfigured()}
          onClick={() => {
            if (
              !window.confirm(
                "This permanently clears all fantasy scoring data in Firestore and all waiver / transfer activity, and restores auction squads (leagueBundle player stats, fantasyMatchScores, matchPlayerPoints, transfers, nominations, bids, waiverState, ownershipPeriods if migrated). Continue?",
              )
            ) {
              return;
            }
            void runFullResetToAuction();
          }}
          className="mt-3 rounded-lg border border-red-500/50 bg-red-900/35 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-800/45 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {fullResetBusy ? "Resetting…" : "Reset scoring + waivers to auction"}
        </button>
        {fullResetFeedback && (
          <p
            className={
              fullResetFeedback.kind === "ok"
                ? "mt-2 text-xs text-emerald-800"
                : "mt-2 text-xs text-red-700"
            }
          >
            {fullResetFeedback.text}
          </p>
        )}
      </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-slate-500">
        Flow: idle → active (nominations + bidding) → reveal → idle. With Firestore enabled,
        reveal runs on the server so{" "}
        <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-800">owners</code>,{" "}
        <code className="rounded bg-white/80 px-1 text-[0.65rem] text-slate-800">
          completedTransfers
        </code>
        , and waiver state stay aligned. Without Firebase, reveal stays local-only.
      </p>
    </section>
  );
}

function OwnerWaiverPanel({
  sessionOwner,
  franchise,
  phase,
  nominationDeadline,
  myNominations,
  nominatedInIds,
  availableIds,
  budgetRemaining,
  pmap,
  tryDispatch,
  error,
}: {
  sessionOwner: string;
  franchise: Franchise;
  phase: string;
  nominationDeadline?: string;
  myNominations: WaiverNomination[];
  nominatedInIds: Set<string>;
  availableIds: string[];
  budgetRemaining: number;
  pmap: Map<string, Player>;
  tryDispatch: (a: WaiverEngineAction) => string | null;
  error: string | null;
}) {
  const [nomIn, setNomIn] = useState("");
  const [nomOut, setNomOut] = useState("");
  const [nomAmt, setNomAmt] = useState(String(WAIVER_BID_INCREMENT));
  const [editId, setEditId] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  const nominationWindowOpen =
    phase === "active" &&
    (!nominationDeadline || Date.now() < Date.parse(nominationDeadline));

  useEffect(() => {
    if (phase !== "active" || !nominationDeadline) return;
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [phase, nominationDeadline]);

  const availOptions = availableIds.filter((id) => !nominatedInIds.has(id));

  const countdownLabel =
    phase === "active" &&
    nominationDeadline &&
    tick < Date.parse(nominationDeadline)
      ? formatNominationsCloseIn(nominationDeadline, tick)
      : "";

  return (
    <section className="app-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold text-white">{franchise.owner}</h3>
        <OwnerBadge owner={sessionOwner} />
        <span className="text-sm text-slate-500">
          Budget left:{" "}
          <span className="tabular-nums font-medium text-amber-400">{money(budgetRemaining)}</span>
        </span>
      </div>
      {countdownLabel ? (
        <p className="mt-2 text-sm font-medium text-cyan-400">
          Nominations close in {countdownLabel}
        </p>
      ) : null}
      {nominationWindowOpen && (
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const amount = Number(nomAmt);
            const err = tryDispatch({
              type: "nomination_upsert",
              owner: sessionOwner,
              nominationId: editId,
              playerInId: nomIn,
              playerOutId: nomOut,
              amount,
            });
            if (!err) {
              setEditId(null);
              setNomIn("");
              setNomOut("");
              setNomAmt(String(WAIVER_BID_INCREMENT));
            }
          }}
        >
          <div className="flex flex-col gap-1">
            <WaiverPlayerPicker
              label="Nominee (available)"
              value={nomIn}
              onChange={setNomIn}
              playerIds={availOptions}
              pmap={pmap}
              placeholder="Type player name, then pick from the list…"
              disabled={!!editId}
            />
            {editId ? (
              <p className="text-[11px] text-slate-500">
                Nominee is fixed after submit; you can change player out or bid amount only.
              </p>
            ) : null}
          </div>
          <WaiverPlayerPicker
            label="Your player out"
            value={nomOut}
            onChange={setNomOut}
            playerIds={franchise.playerIds}
            pmap={pmap}
            placeholder="Type player name, then pick from the list…"
          />
          <div className="sm:col-span-2">
            <WaiverBidField
              value={nomAmt}
              onChange={setNomAmt}
              budgetRemaining={budgetRemaining}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={!nomIn || !nomOut}
              className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editId ? "Update nomination" : "Add nomination"}
            </button>
            {editId && (
              <button
                type="button"
                onClick={() => {
                  setEditId(null);
                  setNomIn("");
                  setNomOut("");
                  setNomAmt(String(WAIVER_BID_INCREMENT));
                }}
                className="text-sm text-slate-500 hover:text-white"
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>
      )}
      {myNominations.length > 0 && nominationWindowOpen && (
        <ul className="mt-4 space-y-2 text-sm">
          {myNominations.map((n) => (
            <li
              key={n.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-500/25 bg-slate-900/50 px-3 py-2"
            >
              <span className="text-slate-700">
                {pmap.get(n.playerInId)?.name} in ·{" "}
                {pmap.get(n.playerOutId)?.name} out · {money(n.amount)}
              </span>
              <button
                type="button"
                className="text-sm font-medium text-cyan-400 hover:text-white"
                onClick={() => {
                  setEditId(n.id);
                  setNomIn(n.playerInId);
                  setNomOut(n.playerOutId);
                  setNomAmt(String(n.amount));
                }}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}

function NominationRow({
  n,
  pmap,
  bids,
  phase,
  session,
  myRosterIds,
  budgetRemaining,
  submitBid,
  onAdminDeleteBid,
  onAdminDeleteNomination,
}: {
  n: WaiverNomination;
  pmap: Map<string, Player>;
  bids: WaiverBid[];
  phase: string;
  session: WaiverSession | null;
  myRosterIds: string[];
  budgetRemaining: number;
  submitBid: (action: BidUpsertAction) => Promise<SubmitBidResult>;
  onAdminDeleteBid?: (bidId: string) => void | Promise<void>;
  onAdminDeleteNomination?: (nominationId: string) => void | Promise<void>;
}) {
  const pIn = pmap.get(n.playerInId);
  const isSelfNomination =
    session?.role === "owner" && session.owner === n.nominatorOwner;
  const existing =
    session?.role === "owner"
      ? bids.find(
          (b) => b.bidderOwner === session.owner && b.nominationId === n.id,
        )
      : undefined;
  const [outId, setOutId] = useState(
    existing?.playerOutId ?? (isSelfNomination ? n.playerOutId : ""),
  );
  const [amt, setAmt] = useState(
    String(
      existing?.amount ??
        (isSelfNomination ? n.amount : WAIVER_BID_INCREMENT),
    ),
  );

  useEffect(() => {
    setOutId(
      existing?.playerOutId ?? (isSelfNomination ? n.playerOutId : ""),
    );
    setAmt(
      String(
        existing?.amount ??
          (isSelfNomination ? n.amount : WAIVER_BID_INCREMENT),
      ),
    );
  }, [
    existing?.id,
    existing?.playerOutId,
    existing?.amount,
    isSelfNomination,
    n.id,
    n.playerOutId,
    n.amount,
  ]);

  const [bidSubmitting, setBidSubmitting] = useState(false);

  return (
    <li className="app-panel border-cyan-500/25 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{pIn?.name ?? n.playerInId}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {pIn && <IplTeamPill code={pIn.iplTeam} />}
            {pIn && (
              <span className="text-slate-400">
                {pIn.role}{pIn.nationality ? ` · ${pIn.nationality}` : ""}
              </span>
            )}
            {isSelfNomination && (
              <span>
                In exchange of{" "}
                {pmap.get(n.playerOutId)?.name ?? n.playerOutId}. Bid Amount:{" "}
                {money(n.amount)}
              </span>
            )}
          </p>
          {n.createdAt && (
            <p className="mt-0.5 text-[10px] text-slate-600">
              {new Date(n.createdAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          )}
        </div>
        {session?.role === "admin" &&
        phase === "active" &&
        onAdminDeleteNomination ? (
          <button
            type="button"
            className="shrink-0 text-sm font-medium text-red-400 hover:text-red-300"
            onClick={() => void onAdminDeleteNomination(n.id)}
          >
            Delete nomination
          </button>
        ) : null}
      </div>
      {session?.role === "admin" && phase === "active" && bids.length > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-950/20 p-2 text-xs text-slate-400">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
            Bids placed (amounts hidden until reveal)
          </p>
          <ul className="space-y-1">
          {bids.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span>
                <OwnerBadge owner={b.bidderOwner} />
              </span>
              {onAdminDeleteBid ? (
                <button
                  type="button"
                  className="text-sm font-medium text-red-400 hover:text-red-300"
                  onClick={() => void onAdminDeleteBid(b.id)}
                >
                  Delete bid
                </button>
              ) : null}
            </li>
          ))}
          </ul>
        </div>
      ) : null}
      {phase === "active" && session?.role === "owner" && (
        <form
          className="mt-3 space-y-3 border-t border-cyan-500/20 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (bidSubmitting) return;
            setBidSubmitting(true);
            void submitBid({
              type: "bid_upsert",
              bidderOwner: session.owner,
              nominationId: n.id,
              playerOutId: outId,
              amount: Number(amt),
            }).finally(() => setBidSubmitting(false));
          }}
        >
          <p className="text-xs text-slate-500">
            {isSelfNomination
              ? `Your bid (from your nomination) · change amount or player out until reveal · remaining budget ${money(budgetRemaining)}`
              : `Your bid · remaining budget ${money(budgetRemaining)}`}
          </p>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 lg:max-w-md">
              <WaiverPlayerPicker
                label="Player out"
                value={outId}
                onChange={setOutId}
                playerIds={myRosterIds}
                pmap={pmap}
                placeholder="Type player name, then pick from the list…"
              />
            </div>
            <div className="w-full shrink-0 lg:w-56">
              <WaiverBidField
                value={amt}
                onChange={setAmt}
                budgetRemaining={budgetRemaining}
                label="Bid amount (₹)"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={!outId || bidSubmitting}
                className="app-btn-primary py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bidSubmitting
                  ? "Submitting…"
                  : existing
                    ? "Update bid"
                    : "Place bid"}
              </button>
            </div>
          </div>
        </form>
      )}
      {phase === "active" && session?.role === "owner" && existing ? (
        <div className="mt-3 rounded-lg border border-cyan-500/20 bg-slate-900/50 px-3 py-2.5 text-xs text-slate-300">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Your active bid
          </p>
          <p className="mt-1 leading-relaxed">
            <span className="text-slate-400">Player out:</span>{" "}
            {pmap.get(existing.playerOutId)?.name ?? existing.playerOutId}
            <span className="mx-2 text-slate-600">·</span>
            <span className="text-slate-400">Amount:</span>{" "}
            <span className="tabular-nums font-medium text-amber-400">
              {money(existing.amount)}
            </span>
            <span className="mx-2 text-slate-600">·</span>
            <span className="text-slate-400">Updated:</span>{" "}
            {formatDate(existing.updatedAt)}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function SuccessfulTransfers({
  pmap,
  refreshDep,
}: {
  pmap: Map<string, Player>;
  /** Bumps when a reveal adds roster history so the list refetches from Firestore. */
  refreshDep: number;
}) {
  const [transfers, setTransfers] = useState<CompletedTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCompletedTransfers()
      .then((data) => {
        if (!cancelled) setTransfers(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshDep]);

  if (loading) {
    return (
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Successful transfers
        </h3>
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      </section>
    );
  }

  if (transfers.length === 0) {
    return (
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Successful transfers
        </h3>
        <p className="mt-2 text-sm text-slate-500">No completed transfers yet.</p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Successful transfers
      </h3>
      <ul className="mt-3 space-y-3">
        {transfers.map((t) => {
          const pIn = pmap.get(t.playerInId);
          const winBid = t.bids.find((b) => b.result === "WON");
          const headerOwner = winBid?.owner ?? t.nominatorOwner;
          const isExpanded = expandedId === t.id;
          return (
            <li key={t.id} className="app-panel border-cyan-500/25 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {formatDate(t.revealedAt)}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <OwnerBadge owner={headerOwner} />
                    {winBid && t.nominatorOwner !== winBid.owner ? (
                      <span className="text-[10px] leading-tight text-slate-500">
                        Nominated by {t.nominatorOwner}
                      </span>
                    ) : null}
                  </div>
                  <span className="font-semibold text-white">
                    {pIn?.name ?? t.playerInId}
                  </span>
                  {pIn && <IplTeamPill code={pIn.iplTeam} />}
                  {pIn && (
                    <span className="text-xs text-slate-400">
                      {pIn.role}{pIn.nationality ? ` · ${pIn.nationality}` : ""}
                    </span>
                  )}
                  {winBid && (
                    <>
                      <span className="text-xs text-slate-600">←</span>
                      <span className="text-xs text-slate-400">
                        {pmap.get(winBid.playerOutId)?.name ?? winBid.playerOutId}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {winBid && (
                    <span className="font-bold tabular-nums text-amber-400">
                      {money(winBid.amount)}
                    </span>
                  )}
                  <span className="rounded-full bg-emerald-600/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                    Processed
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    className="text-xs font-medium text-cyan-400 hover:text-white"
                  >
                    {isExpanded ? "Hide bids" : "Show bids"}
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-cyan-500/15 bg-slate-950/50 px-4 py-3">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="pb-2 font-semibold">Franchise</th>
                        <th className="pb-2 font-semibold">Bid Amount</th>
                        <th className="pb-2 font-semibold">Transfer Out</th>
                        <th className="pb-2 font-semibold">Placed At</th>
                        <th className="pb-2 font-semibold">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...t.bids]
                        .sort((a, b) => b.amount - a.amount)
                        .map((bid) => (
                          <tr
                            key={bid.owner}
                            className="border-t border-slate-800/60"
                          >
                            <td className="py-2 text-slate-300">
                              <OwnerBadge owner={bid.owner} />
                            </td>
                            <td className="py-2 font-bold tabular-nums text-amber-400">
                              {money(bid.amount)}
                            </td>
                            <td className="py-2 text-slate-400">
                              {pmap.get(bid.playerOutId)?.name ?? bid.playerOutId}
                            </td>
                            <td className="py-2 text-slate-500">
                              {formatDate(bid.placedAt)}
                            </td>
                            <td className="py-2">
                              {bid.result === "WON" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-400">
                                  Won
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/40 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                                  Lost
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AuctionHistorySnippet({
  bundle,
  pmap,
}: {
  bundle: LeagueBundle;
  pmap: Map<string, { name: string }>;
}) {
  const sales = [...bundle.auction.sales].slice(0, 8);
  if (sales.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">No sales in file.</p>;
  }
  return (
    <ul className="mt-2 space-y-1 text-sm text-slate-400">
      {sales.map((s) => (
        <li key={`${s.playerId}-${s.soldAt}`}>
          {pmap.get(s.playerId)?.name ?? s.playerId} → {s.soldToOwner} · {s.amountCr}{" "}
          Cr
        </li>
      ))}
    </ul>
  );
}
