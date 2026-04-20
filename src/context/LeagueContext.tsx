import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FantasyMatchOverlayEntry, LeagueBundle } from "../types";
import { mergeBundleWithFantasyOverlays } from "../lib/fantasy/mergeOverlay";
import {
  isFirebaseConfigured,
  leagueDataSourceMode,
} from "../lib/firebase/client";
import { subscribeFantasyMatchOverlays } from "../lib/firebase/fantasyScoresRemote";
import {
  fetchLeagueBundleOnce,
  subscribeLeagueBundle,
} from "../lib/firebase/leagueRemote";
import { fetchLeagueBundleStatic, summarizeBundle } from "../lib/loadLeague";

/** Where the league roster / bundle JSON last came from (for single-source-of-truth UX). */
export type LeagueBundleOrigin = "firestore" | "static" | "static_fallback";

type LeagueCtx = {
  bundle: LeagueBundle | null;
  error: string | null;
  loading: boolean;
  /** Resolved origin of `rawBundle` before fantasy overlays; null if no bundle yet. */
  leagueBundleOrigin: LeagueBundleOrigin | null;
  /** True when Firebase env is set, league mode is not `static`, and bundle is from Firestore. */
  leagueFirestoreIsCanonical: boolean;
  /** Shown when Firestore is empty but static JSON was used (auto), or static league while Firebase is on. */
  leagueNotice: string | null;
  /** Firestore fantasy overlay listener issue (optional). */
  fantasyOverlayNotice: string | null;
  refresh: () => Promise<void>;
  summary: ReturnType<typeof summarizeBundle> | null;
};

const LeagueContext = createContext<LeagueCtx | null>(null);

const STATIC_FALLBACK_NOTICE =
  "Showing JSON from this site—Firestore league document is empty. Commissioner: Waivers → Publish league to Firestore.";

const STATIC_WHILE_FIREBASE_NOTICE =
  "League rosters and player stats are from static JSON only, but Firebase is enabled (waivers/scores use Firestore). That can disagree after a reset or publish. Use VITE_LEAGUE_SOURCE=firestore or auto and keep iplFantasy/leagueBundle authoritative (Waivers → Publish league to Firestore).";

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [rawBundle, setRawBundle] = useState<LeagueBundle | null>(null);
  const [leagueBundleOrigin, setLeagueBundleOrigin] =
    useState<LeagueBundleOrigin | null>(null);
  const [fantasyOverlays, setFantasyOverlays] = useState<
    FantasyMatchOverlayEntry[]
  >([]);
  const [fantasyOverlayNotice, setFantasyOverlayNotice] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const leagueNotice = useMemo(() => {
    if (leagueBundleOrigin === "static_fallback") return STATIC_FALLBACK_NOTICE;
    if (leagueBundleOrigin === "static" && isFirebaseConfigured()) {
      return STATIC_WHILE_FIREBASE_NOTICE;
    }
    return null;
  }, [leagueBundleOrigin]);

  const leagueFirestoreIsCanonical = useMemo(() => {
    const mode = leagueDataSourceMode();
    return (
      isFirebaseConfigured() &&
      mode !== "static" &&
      leagueBundleOrigin === "firestore"
    );
  }, [leagueBundleOrigin]);

  const bundle = useMemo(
    () =>
      rawBundle
        ? mergeBundleWithFantasyOverlays(rawBundle, fantasyOverlays)
        : null,
    [rawBundle, fantasyOverlays],
  );

  const refresh = useCallback(async () => {
    const mode = leagueDataSourceMode();
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured() || mode === "static") {
        const b = await fetchLeagueBundleStatic();
        setRawBundle(b);
        setLeagueBundleOrigin("static");
        return;
      }
      const b = await fetchLeagueBundleOnce();
      if (b) {
        setRawBundle(b);
        setLeagueBundleOrigin("firestore");
        return;
      }
      if (mode === "firestore") {
        setError(
          "No league data in Firestore (iplFantasy/leagueBundle). Use Commissioner → Publish league to Firestore.",
        );
        setRawBundle(null);
        setLeagueBundleOrigin(null);
        return;
      }
      const sb = await fetchLeagueBundleStatic();
      setRawBundle(sb);
      setLeagueBundleOrigin("static_fallback");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh league data");
      setRawBundle(null);
      setLeagueBundleOrigin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    const mode = leagueDataSourceMode();

    function loadStaticOnly() {
      setLoading(true);
      setError(null);
      void fetchLeagueBundleStatic()
        .then((b) => {
          if (cancelled) return;
          setRawBundle(b);
          setLeagueBundleOrigin("static");
        })
        .catch((e) => {
          if (cancelled) return;
          setError(
            e instanceof Error ? e.message : "Failed to load league data",
          );
          setRawBundle(null);
          setLeagueBundleOrigin(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    if (!isFirebaseConfigured() || mode === "static") {
      loadStaticOnly();
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);

    void (async () => {
      const u = await subscribeLeagueBundle((b, err) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          setRawBundle(null);
          setLeagueBundleOrigin(null);
          setLoading(false);
          return;
        }
        if (b) {
          setRawBundle(b);
          setError(null);
          setLeagueBundleOrigin("firestore");
          setLoading(false);
          return;
        }
        if (mode === "firestore") {
          setError(
            "No league data in Firestore (iplFantasy/leagueBundle). Use Commissioner → Publish league to Firestore.",
          );
          setRawBundle(null);
          setLeagueBundleOrigin(null);
          setLoading(false);
          return;
        }
        void fetchLeagueBundleStatic()
          .then((sb) => {
            if (cancelled) return;
            setRawBundle(sb);
            setError(null);
            setLeagueBundleOrigin("static_fallback");
            setLoading(false);
          })
          .catch((e) => {
            if (cancelled) return;
            setError(
              e instanceof Error ? e.message : "Failed to load static league",
            );
            setRawBundle(null);
            setLeagueBundleOrigin(null);
            setLoading(false);
          });
      });
      if (cancelled) {
        u?.();
        return;
      }
      unsub = u ?? undefined;
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setFantasyOverlays([]);
      setFantasyOverlayNotice(null);
      return;
    }
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void (async () => {
      const u = await subscribeFantasyMatchOverlays(
        (entries) => {
          if (cancelled) return;
          setFantasyOverlays(entries);
          setFantasyOverlayNotice(null);
        },
        (e) => {
          if (cancelled) return;
          setFantasyOverlayNotice(e.message);
        },
      );
      if (cancelled) {
        u?.();
        return;
      }
      unsub = u ?? undefined;
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const summary = useMemo(
    () => (bundle ? summarizeBundle(bundle) : null),
    [bundle],
  );

  const value = useMemo(
    () => ({
      bundle,
      error,
      loading,
      leagueBundleOrigin,
      leagueFirestoreIsCanonical,
      leagueNotice,
      fantasyOverlayNotice,
      refresh,
      summary,
    }),
    [
      bundle,
      error,
      loading,
      leagueBundleOrigin,
      leagueFirestoreIsCanonical,
      leagueNotice,
      fantasyOverlayNotice,
      refresh,
      summary,
    ],
  );

  return (
    <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>
  );
}

export function useLeague(): LeagueCtx {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error("useLeague must be used within LeagueProvider");
  return ctx;
}
