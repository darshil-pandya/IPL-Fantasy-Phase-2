import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OwnerBadge } from "../components/OwnerBadge";
import { OwnerPointsLineChart } from "../components/OwnerPointsLineChart";
import { useLeague } from "../context/LeagueContext";
import { useLeagueStandings } from "../context/WaiverContext";
import { buildOwnerCumulativeFromPerMatch } from "../lib/cumulativeOwnerMatchPoints";
import { PREDICTION_ACTUALS_EVENT } from "../lib/predictionEvents";
import {
  loadStoredActuals,
  mergeActuals,
  pickForOwner,
  predictionScore,
} from "../lib/predictions";
import type { Player } from "../types";
import { matchColumnsFromPlayers, pointsInMatch, type MatchColumn } from "../lib/matchColumns";
import { IplTeamPill } from "../components/IplTeamPill";

function bestFantasyPlayerOnSquad(players: Player[]): Player | null {
  if (players.length === 0) return null;
  return [...players].sort(
    (a, b) => b.seasonTotal - a.seasonTotal || a.name.localeCompare(b.name),
  )[0];
}

function buildPlayerOwnerMap(
  standings: { owner: string; playersResolved: Player[] }[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of standings) {
    for (const p of s.playersResolved) {
      m.set(p.id, s.owner);
    }
  }
  return m;
}

function PerformerCard({
  player,
  points,
  ownerName,
  match,
}: {
  player: Player;
  points: number;
  ownerName: string;
  match: MatchColumn;
}) {
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-slate-900/60 p-4 shadow-md shadow-black/20 ring-1 ring-cyan-500/10">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-400/80">
        {match.label}
      </p>
      <p className="mt-2 font-bold text-white">{player.name}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-sm font-semibold tabular-nums text-cyan-300">
          {Math.round(points)} pts
        </p>
        <IplTeamPill code={player.iplTeam} />
      </div>
      <dl className="mt-3 space-y-1 border-t border-cyan-500/15 pt-3 text-xs">
        <div className="flex gap-2">
          <dt className="shrink-0 text-slate-500">Owner</dt>
          <dd className="font-medium text-slate-200">{ownerName}</dd>
        </div>
      </dl>
    </div>
  );
}

export function Home() {
  const { bundle, leagueNotice, fantasyOverlayNotice } = useLeague();
  const summary = useLeagueStandings();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(PREDICTION_ACTUALS_EVENT, on);
    return () => window.removeEventListener(PREDICTION_ACTUALS_EVENT, on);
  }, []);

  const leaderboardRows = useMemo(() => {
    if (!bundle || !summary) return [];
    const pred = bundle.predictions;
    const actuals = mergeActuals(pred.actuals, loadStoredActuals());
    return summary.sorted.map((s) => {
      const pick = pickForOwner(pred, s.owner);
      const predPts = predictionScore(pick, actuals, pred.pointsPerCorrect);
      const fantasy = s.totalPoints;
      const best = bestFantasyPlayerOnSquad(s.playersResolved);
      return {
        owner: s.owner,
        fantasy,
        predPts,
        total: fantasy + predPts,
        bestPlayer: best,
      };
    });
  }, [bundle, summary, tick]);

  const sortedLeaderboard = useMemo(() => {
    return [...leaderboardRows]
      .sort((a, b) => b.total - a.total)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [leaderboardRows]);

  const ownerPointsChart = useMemo(() => {
    if (!summary) return null;
    const order = sortedLeaderboard.map((r) => r.owner);
    return buildOwnerCumulativeFromPerMatch(
      summary.perOwnerPerMatch,
      summary.columns,
      order,
      summary.standings.map((s) => s.owner),
    );
  }, [summary, sortedLeaderboard]);

  const playerOwnerMap = useMemo(() => {
    if (!summary) return new Map<string, string>();
    return buildPlayerOwnerMap(summary.standings);
  }, [summary]);

  const lastMatchTopPerformers = useMemo(() => {
    if (!bundle) return null;
    const all: Player[] = [];
    const seen = new Set<string>();
    for (const p of bundle.players) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        all.push(p);
      }
    }
    for (const p of bundle.waiverPool ?? []) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        all.push(p);
      }
    }

    const cols = matchColumnsFromPlayers(all);
    const lastCol = cols.length > 0 ? cols[cols.length - 1]! : null;
    if (!lastCol) return { match: null as MatchColumn | null, top: [] as { player: Player; points: number }[] };

    const rows = all
      .map((p) => ({ player: p, points: pointsInMatch(p, lastCol.id) }))
      .filter((r): r is { player: Player; points: number } => typeof r.points === "number" && !Number.isNaN(r.points))
      .filter((r) => r.points !== 0)
      .sort((a, b) => b.points - a.points || a.player.name.localeCompare(b.player.name))
      .slice(0, 6);

    return { match: lastCol, top: rows };
  }, [bundle]);

  if (!bundle || !summary) return null;

  const pred = bundle.predictions;

  function ownerForPlayer(p: Player): string {
    return playerOwnerMap.get(p.id) ?? "Free agent";
  }

  return (
    <div className="space-y-8">
      {leagueNotice ? (
        <div className="rounded-xl border border-amber-500/35 bg-amber-950/35 px-4 py-3 text-sm text-amber-100">
          {leagueNotice}
        </div>
      ) : null}
      {fantasyOverlayNotice ? (
        <div className="rounded-xl border border-red-500/35 bg-red-950/40 px-4 py-3 text-sm text-red-100">
          Firestore fantasy scores: {fantasyOverlayNotice}
        </div>
      ) : null}
      <section>
        <h2 className="font-display mb-2 text-2xl tracking-wide text-white">Leaderboard</h2>
        <p className="mb-3 text-sm text-slate-400">
          Sorted by rank (fantasy points plus prediction bonus: {pred.pointsPerCorrect}{" "}
          pts per correct when results are set). Fantasy uses match-by-match points only
          while each player was on that franchise (same as Match Center).
        </p>
        <div className="app-table">
          <table className="w-full min-w-[320px] text-left text-sm">
            <thead className="app-table-head">
              <tr>
                <th className="px-3 py-3 font-medium">Rank</th>
                <th className="px-3 py-3 font-medium">Owner</th>
                <th className="px-3 py-3 font-medium">Best player</th>
                <th className="px-3 py-3 text-right font-medium text-amber-400">
                  Total pts
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedLeaderboard.map((r) => (
                <tr key={r.owner} className="app-table-row">
                  <td className="px-3 py-3 font-semibold tabular-nums text-slate-500">
                    {r.rank}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      to={`/teams?owner=${encodeURIComponent(r.owner)}`}
                      className="font-semibold text-white hover:text-cyan-300"
                    >
                      {r.owner}
                    </Link>
                    <div className="mt-1">
                      <OwnerBadge owner={r.owner} />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-300">
                    {r.bestPlayer ? (
                      <>
                        <span className="font-medium text-slate-100">
                          {r.bestPlayer.name}
                        </span>
                        <span className="ml-2 tabular-nums text-slate-500">
                          ({Math.round(r.bestPlayer.seasonTotal)} pts)
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-base font-bold tabular-nums text-amber-400">
                    {Math.round(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-display mb-2 text-2xl tracking-wide text-white">
          {lastMatchTopPerformers?.match
            ? `Top Performs in ${lastMatchTopPerformers.match.label}`
            : "Top Performs"}
        </h2>
        {lastMatchTopPerformers?.match && lastMatchTopPerformers.top.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lastMatchTopPerformers.top.map((r) => (
              <PerformerCard
                key={r.player.id}
                player={r.player}
                points={r.points}
                ownerName={ownerForPlayer(r.player)}
                match={lastMatchTopPerformers.match!}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
            No match points yet. When player scorecards include{" "}
            <code className="app-code-inline">byMatch</code> entries, this section will show the
            top performers from the latest match.
          </p>
        )}
      </section>

      <section aria-label="Owner fantasy points by match">
        <h2 className="font-display mb-2 text-2xl tracking-wide text-white">
          Points through the season
        </h2>
        <p className="mb-3 text-sm text-slate-400">
          Cumulative points from the same per-match totals as the leaderboard (only
          matches while each player was on that franchise). Prediction bonus is not
          included.
        </p>
        {ownerPointsChart && ownerPointsChart.data.length > 1 ? (
          <div className="app-card overflow-hidden p-4 sm:p-5">
            <OwnerPointsLineChart
              data={ownerPointsChart.data}
              owners={ownerPointsChart.owners}
            />
          </div>
        ) : (
          <p className="rounded-xl border border-slate-700/60 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
            No match-by-match fantasy data yet. When player scorecards include{" "}
            <code className="app-code-inline">byMatch</code> entries, this chart will
            track each owner&apos;s running total after every match.
          </p>
        )}
      </section>
    </div>
  );
}
