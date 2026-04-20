import { useMemo, useState } from "react";

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext";
import { useWaiver } from "../context/WaiverContext";
import {
  callAdminResetFantasyMatchScores,
  callAdminScoreSync,
  type AdminScoreSyncResponse,
} from "../lib/firebase/adminScoreSyncCall";
import { isFirebaseConfigured } from "../lib/firebase/client";
import type { Player } from "../types";

export function AdminScoreSync() {
  const { bundle, refresh } = useLeague();
  const { session } = useWaiver();
  const [matchQuery, setMatchQuery] = useState("");
  const [matchDateYmd, setMatchDateYmd] = useState(todayYmdLocal);
  const [writeToFirestore, setWriteToFirestore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AdminScoreSyncResponse | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [resetOk, setResetOk] = useState<string | null>(null);

  const pmap = useMemo(() => {
    const m = new Map<string, Player>();
    if (!bundle) return m;
    for (const p of bundle.players) m.set(p.id, p);
    for (const p of bundle.waiverPool ?? []) {
      if (!m.has(p.id)) m.set(p.id, p);
    }
    return m;
  }, [bundle]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setResult(null);
    if (!matchQuery.trim()) {
      setErr("Enter a match query (e.g. CSK vs RR).");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDateYmd)) {
      setErr("Pick a valid match date.");
      return;
    }
    setBusy(true);
    try {
      const data = await callAdminScoreSync({
        matchQuery: matchQuery.trim(),
        matchDateYmd,
        writeToFirestore,
      });
      setResult(data);
    } catch (e) {
      const any = e as { message?: string; code?: string; details?: unknown };
      const parts = [any.code, any.message].filter(Boolean);
      setErr(parts.length ? parts.join(": ") : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onResetFirestoreOverlays() {
    setResetErr(null);
    setResetOk(null);
    setResetBusy(true);
    try {
      const data = await callAdminResetFantasyMatchScores();
      setResetOk(data.message ?? "Firestore match overlays cleared.");
      await refresh();
    } catch (e) {
      const any = e as { message?: string; code?: string };
      setResetErr([any.code, any.message].filter(Boolean).join(": ") || String(e));
    } finally {
      setResetBusy(false);
    }
  }

  if (session?.role !== "admin") {
    return (
      <div className="space-y-4">
        <h2 className="font-display text-2xl tracking-wide text-white">Score sync</h2>
        <p className="text-sm text-slate-400">
          This page is only available after you log in as <strong className="text-cyan-200">Admin</strong> on the{" "}
          <Link to="/waivers" className="font-medium text-amber-400 underline decoration-amber-400/50 hover:text-amber-300">
            Waivers
          </Link>{" "}
          page (same session).
        </p>
      </div>
    );
  }

  if (!isFirebaseConfigured()) {
    return (
      <div className="space-y-4">
        <h2 className="font-display text-2xl tracking-wide text-white">Score sync</h2>
        <p className="text-sm text-slate-400">
          Configure all three <code className="app-code-inline">VITE_FIREBASE_*</code> variables at build time. See
          docs for Firebase setup.
        </p>
      </div>
    );
  }

  const pointRows =
    result?.playerPoints &&
    Object.entries(result.playerPoints)
      .map(([id, pts]) => {
        const p = pmap.get(id);
        return { id, pts, name: p?.name ?? id };
      })
      .sort((a, b) => b.pts - a.pts);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl tracking-wide text-white">Admin — score sync</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Looks up the IPL match on <strong className="text-cyan-300">ESPNcricinfo</strong> using your team query and{" "}
          <strong className="text-cyan-300">match date</strong> (calendar day in India, IST), pulls the full scorecard
          JSON, computes fantasy points, and by default writes to{" "}
          <code className="app-code-inline">iplFantasy/fantasyMatchScores</code> when the run is valid. Fixtures use
          ESPN&apos;s IPL 2026 schedule. Points include roster / waiver players who played in this match.
        </p>
      </div>

      <div className="app-panel space-y-3 border-red-500/25 bg-red-950/15 p-5 ring-1 ring-red-500/15">
        <h3 className="text-sm font-semibold text-red-200">Reset backend match points</h3>
        <p className="text-sm text-slate-400">
          Removes every stored match overlay in{" "}
          <code className="app-code-inline">iplFantasy/fantasyMatchScores</code>. The site then uses
          static <code className="app-code-inline">byMatch</code> /{" "}
          <code className="app-code-inline">seasonTotal</code> from JSON (and whatever is in{" "}
          <code className="app-code-inline">leagueBundle</code> in Firestore). After clearing, use{" "}
          <strong className="text-slate-200">Waivers → Publish league to Firestore</strong> if the
          live bundle should match your repo JSON.
        </p>
        <button
          type="button"
          disabled={resetBusy}
          onClick={() => void onResetFirestoreOverlays()}
          className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-900/50 disabled:opacity-50"
        >
          {resetBusy ? "Clearing…" : "Clear Firestore match overlays"}
        </button>
        {resetErr ? (
          <p className="text-sm text-red-300">{resetErr}</p>
        ) : null}
        {resetOk ? (
          <p className="text-sm text-emerald-300">{resetOk}</p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="app-panel space-y-4 border-amber-500/20 p-5 ring-1 ring-amber-500/10"
      >
        <label className="block text-sm font-semibold text-slate-200">
          Match query
          <input
            className="app-input mt-2 w-full"
            placeholder="e.g. CSK vs RR"
            value={matchQuery}
            onChange={(e) => setMatchQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block text-sm font-semibold text-slate-200">
          Match date (IST calendar day)
          <input
            type="date"
            className="app-input mt-2 w-full"
            value={matchDateYmd}
            onChange={(e) => setMatchDateYmd(e.target.value)}
          />
        </label>
        <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-300">
          <input
            type="checkbox"
            className="size-4 rounded border-cyan-500/40 bg-slate-950 text-amber-500 focus:ring-amber-400/50"
            checked={writeToFirestore}
            onChange={(e) => setWriteToFirestore(e.target.checked)}
          />
          Write to Firestore when the scorecard is complete and there are no blocking issues
        </label>
        <button type="submit" disabled={busy} className="app-btn-primary disabled:opacity-50">
          {busy ? "Running…" : "Run sync"}
        </button>
      </form>

      {err ? (
        <p className="rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {err}
        </p>
      ) : null}

      {result?.ok ? (
        <div className="space-y-3 text-sm text-slate-300">
          <p>
            <span className="font-semibold text-white">Match:</span> {result.matchLabel}
          </p>
          <p>
            <a
              href={result.scorecardUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-cyan-400 underline decoration-cyan-500/40 hover:text-cyan-300"
            >
              Open ESPNcricinfo scorecard
            </a>
          </p>
          <p>
            <span className="font-semibold text-white">Roster mapping:</span>{" "}
            {result.validated ? (
              <span className="text-emerald-400">ok for mapped players</span>
            ) : (
              <span className="text-amber-400">issues — see log below</span>
            )}
          </p>
          {typeof result.scorecardUniquePlayerCount === "number" ? (
            <p className="text-slate-400">
              <span className="font-semibold text-slate-200">Scorecard:</span>{" "}
              {result.scorecardUniquePlayerCount} distinct batter/bowler names on ESPN;{" "}
              <span className="font-semibold text-cyan-300">{pointRows?.length ?? 0}</span> matched your Firestore league
              players and received points in this run.
            </p>
          ) : null}
          {result.wroteFirestore ? (
            <p className="font-semibold text-emerald-400">Firestore updated for this match.</p>
          ) : null}
          {result.note ? <p className="text-slate-500">{result.note}</p> : null}

          {result.unmappedScorecardNames && result.unmappedScorecardNames.length > 0 ? (
            <details className="app-panel border-amber-500/15 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-white">
                ESPN names not mapped to your league roster ({result.unmappedScorecardNames.length})
              </summary>
              <p className="mt-2 text-xs text-slate-500">
                These appear on the scorecard but did not match exactly one player in{" "}
                <code className="app-code-inline">iplFantasy/leagueBundle</code>.
              </p>
              <ul className="mt-2 max-h-40 overflow-auto font-mono text-xs text-slate-300">
                {result.unmappedScorecardNames.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {pointRows && pointRows.length > 0 ? (
            <div>
              <p className="mb-2 font-semibold text-white">Player points (league roster)</p>
              <ul className="max-h-64 overflow-auto rounded-xl border border-cyan-500/20 bg-slate-950/50 p-3 text-xs sm:text-sm">
                {pointRows.map(({ id, name, pts }) => (
                  <li
                    key={id}
                    className="flex justify-between gap-2 border-b border-cyan-500/10 py-1.5 last:border-0"
                  >
                    <span className="text-slate-200">{name}</span>
                    <span className="tabular-nums font-semibold text-amber-400">{pts.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {result?.warnings && result.warnings.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-amber-200">Warnings</h3>
          <ul className="list-inside list-disc space-y-1 rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-100/90">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result?.inconsistencies && result.inconsistencies.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-red-300">Inconsistencies / blocking issues</h3>
          <ul className="list-inside list-disc space-y-1 rounded-xl border border-red-500/35 bg-red-950/40 p-4 text-sm text-red-100">
            {result.inconsistencies.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
