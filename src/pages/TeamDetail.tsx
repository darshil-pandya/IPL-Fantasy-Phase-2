import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { IplTeamPill } from "../components/IplTeamPill";
import { OwnerBadge } from "../components/OwnerBadge";
import { SquadCompositionCards } from "../components/SquadCompositionCards";
import { useLeagueStandings } from "../context/WaiverContext";
import { abbreviateMatchLabel, formatMatchDate } from "../lib/matchLabel";
import { franchiseBySlug, ownerSlug } from "../lib/slug";
import type { Player } from "../types";

function MatchBreakdown({ player }: { player: Player }) {
  const [open, setOpen] = useState(false);
  if (player.byMatch.length === 0) {
    return <p className="text-xs text-slate-500">No match rows yet</p>;
  }
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-cyan-400 hover:text-white"
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} match breakdown ({player.byMatch.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-1 rounded-xl border border-cyan-500/25 bg-slate-950/60 p-3 text-xs">
          {player.byMatch.map((m) => (
            <li
              key={`${m.matchDate}-${m.matchLabel}`}
              className="flex justify-between gap-2 border-b border-cyan-500/15 py-1 last:border-0"
            >
              <span className="text-slate-400">
                <span className="text-slate-500">{formatMatchDate(m.matchDate)}</span>{" "}
                — {abbreviateMatchLabel(m.matchLabel)}
              </span>
              <span className="shrink-0 tabular-nums font-semibold text-cyan-400">
                +{m.points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TeamDetail() {
  const { ownerSlug: slug } = useParams<{ ownerSlug: string }>();
  const summary = useLeagueStandings();

  const row = useMemo(() => {
    if (!summary || !slug) return null;
    const f = franchiseBySlug(summary.standings, slug);
    if (!f) return null;
    return f;
  }, [summary, slug]);

  if (!summary) return null;

  if (!slug || !row) {
    return (
      <div className="app-card p-6 text-center text-slate-400">
        <p>Team not found.</p>
        <Link to="/teams" className="mt-3 inline-block font-medium text-cyan-400 hover:underline">
          Back to teams
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/teams?owner=${encodeURIComponent(row.owner)}`}
          className="text-sm font-medium text-cyan-400 hover:text-white"
        >
          ← Back to roster table
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-white">{row.owner}</h2>
        <div className="mt-2">
          <OwnerBadge owner={row.owner} />
        </div>
        <p className="mt-3 text-3xl font-bold tabular-nums text-cyan-400">
          {Math.round(row.totalPoints)}{" "}
          <span className="text-lg font-normal text-slate-500">season pts</span>
        </p>
        <div className="mt-4">
          <SquadCompositionCards players={row.playersResolved} />
        </div>
      </div>

      {row.missingPlayerIds.length > 0 && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-950/40 p-4 text-sm text-amber-100">
          <p className="font-medium">Missing player IDs in players.json</p>
          <p className="mt-1 text-xs text-amber-200/90">
            {row.missingPlayerIds.join(", ")}
          </p>
        </div>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Squad
        </h3>
        {row.playersResolved.length === 0 ? (
          <p className="text-sm text-slate-400">
            No players linked yet. Add <code className="app-code-inline">playerIds</code> in{" "}
            <code className="app-code-inline">franchises.json</code> and matching entries in{" "}
            <code className="app-code-inline">players.json</code>.
          </p>
        ) : (
          <ul className="space-y-3">
            {row.playersResolved.map((p) => (
              <li key={p.id} className="app-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{p.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <IplTeamPill code={p.iplTeam} />
                      <span>{p.role}</span>
                    </p>
                  </div>
                  <p className="text-lg font-bold tabular-nums text-cyan-400">
                    {Math.round(p.seasonTotal)}
                  </p>
                </div>
                <MatchBreakdown player={p} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-xs text-slate-500">
        Share this page:{" "}
        <span className="text-slate-400">
          …/teams/{ownerSlug(row.owner)}
        </span>
      </p>
    </div>
  );
}
