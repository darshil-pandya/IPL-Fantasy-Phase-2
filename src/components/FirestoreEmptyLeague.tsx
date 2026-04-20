import { useState } from "react";
import { seedLeagueFromStaticToFirestore } from "../lib/firebase/leagueRemote";

/**
 * First-time bootstrap when `VITE_LEAGUE_SOURCE=firestore` but `iplFantasy/leagueBundle`
 * does not exist yet. Publishes static JSON from this deploy to Firestore (same as
 * Waivers → Commissioner → Publish league to Firestore).
 */
export function FirestoreEmptyLeague({
  onRetry,
}: {
  onRetry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  async function publish() {
    setFeedback(null);
    setBusy(true);
    try {
      await seedLeagueFromStaticToFirestore();
      setFeedback({
        kind: "ok",
        text: "Published. Loading league from Firestore…",
      });
      await onRetry();
    } catch (e) {
      setFeedback({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-16">
      <div className="rounded-2xl border border-amber-500/35 bg-amber-950/30 p-6 text-center shadow-lg shadow-amber-900/20">
        <p className="text-sm text-amber-100/95">
          Firestore does not have your league document yet (
          <code className="rounded bg-black/30 px-1 text-[0.7rem]">iplFantasy/leagueBundle</code>
          ). This is normal on a new project.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          Click below to copy the league JSON bundled with this site into Firestore. After that,
          the app loads from Firestore (same as{" "}
          <strong className="text-slate-300">Waivers → Commissioner → Publish league to Firestore</strong>
          ).
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void publish()}
          className="app-btn-primary mt-5 w-full max-w-sm"
        >
          {busy ? "Publishing…" : "Publish league to Firestore now"}
        </button>
        {feedback && (
          <p
            className={
              feedback.kind === "ok"
                ? "mt-4 text-sm text-emerald-400"
                : "mt-4 text-sm text-red-400"
            }
          >
            {feedback.text}
          </p>
        )}
        <button
          type="button"
          onClick={() => void onRetry()}
          className="mt-4 text-sm font-medium text-cyan-400/90 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
        >
          Try again (after publishing or fixing rules)
        </button>
      </div>
    </div>
  );
}
