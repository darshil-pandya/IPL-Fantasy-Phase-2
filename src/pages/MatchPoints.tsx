import { useMemo, useState } from "react";
import { IplTeamPill } from "../components/IplTeamPill";
import { OwnerBadge } from "../components/OwnerBadge";
import { SquadCompositionCards } from "../components/SquadCompositionCards";
import { useLeague } from "../context/LeagueContext";
import { useLeagueStandings } from "../context/WaiverContext";
import type { FranchiseScoringMode } from "../lib/franchiseAttributedScoring";
import { pointsInMatch, type MatchColumn } from "../lib/matchColumns";
import { abbreviateMatchLabel, formatMatchDate } from "../lib/matchLabel";
import { natBadgeClass, roleBadgeClass } from "../lib/playerBadges";
import type { FranchiseStanding, Player } from "../types";

function OwnerSummaryTable({
  columns,
  perOwnerPerMatch,
  standings,
}: {
  columns: MatchColumn[];
  perOwnerPerMatch: Record<string, number[]>;
  standings: FranchiseStanding[];
}) {
  const owners = useMemo(
    () => [...standings].sort((a, b) => a.owner.localeCompare(b.owner)).map((s) => s.owner),
    [standings],
  );

  const ownerTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of owners) {
      m[o] = (perOwnerPerMatch[o] ?? []).reduce((a, b) => a + b, 0);
    }
    return m;
  }, [owners, perOwnerPerMatch]);

  if (columns.length === 0 || owners.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Owner Points by Match
      </h3>
      <div className="app-table">
        <table className="w-full min-w-[480px] border-collapse text-left text-xs md:text-sm">
          <thead>
            <tr className="border-b border-cyan-500/25 bg-slate-950/95">
              <th className="sticky left-0 z-[1] bg-slate-950 px-3 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Match
              </th>
              {owners.map((o) => (
                <th
                  key={o}
                  className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                >
                  {o}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((c, j) => {
              const vals = owners.map((o) => (perOwnerPerMatch[o] ?? [])[j] ?? 0);
              const maxVal = Math.max(...vals);
              return (
                <tr key={c.id} className="app-table-row border-cyan-500/25">
                  <td className="sticky left-0 z-[1] bg-slate-900 px-3 py-2.5 font-medium text-white shadow-[2px_0_12px_-2px_rgba(0,0,0,0.5)]">
                    <span className="block text-slate-300">
                      {abbreviateMatchLabel(c.label, c.teams)}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {formatMatchDate(c.date)}
                    </span>
                  </td>
                  {owners.map((o, i) => {
                    const v = vals[i];
                    const isBest = v > 0 && v === maxVal;
                    return (
                      <td
                        key={o}
                        className={`px-3 py-2.5 text-right tabular-nums ${
                          isBest
                            ? "font-bold text-amber-400"
                            : "text-slate-300"
                        }`}
                      >
                        {Math.round(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-cyan-500/30 bg-slate-950/80">
              <td className="sticky left-0 z-[1] bg-slate-950 px-3 py-3 text-[10px] font-bold uppercase tracking-wide text-amber-400">
                Total
              </td>
              {owners.map((o) => {
                const t = ownerTotals[o] ?? 0;
                const maxTotal = Math.max(...Object.values(ownerTotals));
                const isBest = t > 0 && t === maxTotal;
                return (
                  <td
                    key={o}
                    className={`px-3 py-3 text-right tabular-nums ${
                      isBest
                        ? "font-bold text-amber-400"
                        : "font-semibold text-white"
                    }`}
                  >
                    {Math.round(t)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function FranchiseMatchTable({
  standing,
  columns,
  scoringMode,
  perOwnerRounds,
  rostersAtStartOfMatch,
  formerPlayers,
}: {
  standing: FranchiseStanding;
  columns: MatchColumn[];
  scoringMode: FranchiseScoringMode;
  perOwnerRounds: number[];
  rostersAtStartOfMatch: Record<string, string[]>[] | null;
  formerPlayers: { player: Player; attributedPoints: number }[];
}) {
  const franchiseMatchTotal = useMemo(() => {
    return perOwnerRounds.reduce((a, b) => a + b, 0);
  }, [perOwnerRounds]);

  if (columns.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No match rows yet. Add <code className="app-code-inline">byMatch</code> entries in{" "}
        <code className="app-code-inline">players.json</code> after each IPL game.
      </p>
    );
  }

  const owner = standing.owner;

  return (
    <div className="app-table">
      <table className="w-full min-w-[640px] border-collapse text-left text-xs md:text-sm">
        <thead>
          <tr className="border-b border-cyan-500/25 bg-slate-950/95">
            <th
              scope="col"
              className="sticky left-0 z-[1] bg-slate-950 px-3 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400 md:px-4"
            >
              Player
            </th>
            <th
              scope="col"
              className="px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              Role
            </th>
            <th
              scope="col"
              className="px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              IPL
            </th>
            <th
              scope="col"
              className="px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              Type
            </th>
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className="min-w-[5.5rem] px-2 py-3 text-right text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500"
              >
                <span className="block text-slate-300">{abbreviateMatchLabel(c.label, c.teams)}</span>
                <span className="font-normal normal-case text-slate-500">
                  {formatMatchDate(c.date)}
                </span>
              </th>
            ))}
            <th
              scope="col"
              className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wide text-amber-400"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {standing.playersResolved.map((p) => (
            <PlayerRow
              key={p.id}
              player={p}
              columns={columns}
              owner={owner}
              scoringMode={scoringMode}
              rostersAtStartOfMatch={rostersAtStartOfMatch}
            />
          ))}
          <tr className="border-b border-cyan-500/20 bg-slate-950/80 font-semibold">
            <td
              colSpan={4}
              className="sticky left-0 bg-slate-950 px-3 py-3 text-white md:px-4"
            >
              Franchise match total
            </td>
            {columns.map((c, j) => (
              <td key={c.id} className="px-2 py-3 text-right tabular-nums text-slate-300">
                {Math.round(perOwnerRounds[j] ?? 0)}
              </td>
            ))}
            <td className="px-3 py-3 text-right tabular-nums text-amber-400">
              {Math.round(franchiseMatchTotal)}
            </td>
          </tr>
        </tbody>
        {formerPlayers.length > 0 && (
          <tbody className="opacity-50">
            <tr>
              <td
                colSpan={4 + columns.length + 1}
                className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
              >
                Former Players
              </td>
            </tr>
            {formerPlayers.map((f) => (
              <FormerPlayerRow
                key={f.player.id}
                player={f.player}
                columns={columns}
                attributedPoints={f.attributedPoints}
              />
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

function PlayerRow({
  player,
  columns,
  owner,
  scoringMode,
  rostersAtStartOfMatch,
}: {
  player: Player;
  columns: MatchColumn[];
  owner: string;
  scoringMode: FranchiseScoringMode;
  rostersAtStartOfMatch: Record<string, string[]>[] | null;
}) {
  const rowMatchTotal = useMemo(() => {
    let t = 0;
    columns.forEach((c, j) => {
      const onRoster =
        scoringMode === "current" ||
        (rostersAtStartOfMatch != null &&
          (rostersAtStartOfMatch[j]?.[owner]?.includes(player.id) ?? false));
      if (!onRoster) return;
      const pts = pointsInMatch(player, c.id);
      if (pts != null) t += pts;
    });
    return t;
  }, [player, columns, owner, scoringMode, rostersAtStartOfMatch]);

  return (
    <tr className="app-table-row border-brand-cyan/25">
      <td className="sticky left-0 z-[1] bg-slate-900 px-3 py-2.5 font-medium text-white shadow-[2px_0_12px_-2px_rgba(0,0,0,0.5)] md:px-4">
        {player.name}
      </td>
      <td className="px-2 py-2.5">
        <span className={roleBadgeClass(player.role)}>{player.role}</span>
      </td>
      <td className="px-2 py-2.5">
        <IplTeamPill code={player.iplTeam} />
      </td>
      <td className="px-2 py-2.5">
        <span className={natBadgeClass(player.nationality)}>
          {player.nationality ?? "—"}
        </span>
      </td>
      {columns.map((c, j) => {
        const onRoster =
          scoringMode === "current" ||
          (rostersAtStartOfMatch != null &&
            (rostersAtStartOfMatch[j]?.[owner]?.includes(player.id) ?? false));
        const pts = pointsInMatch(player, c.id);
        const show = onRoster && pts != null;
        return (
          <td
            key={c.id}
            className={`px-2 py-2.5 text-right tabular-nums ${
              onRoster ? "text-slate-300" : "text-slate-600"
            }`}
          >
            {show ? Math.round(pts) : "—"}
          </td>
        );
      })}
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-amber-400">
        {Math.round(rowMatchTotal)}
      </td>
    </tr>
  );
}

function FormerPlayerRow({
  player,
  columns,
  attributedPoints,
}: {
  player: Player;
  columns: MatchColumn[];
  attributedPoints: number;
}) {
  return (
    <tr className="app-table-row border-brand-cyan/25">
      <td className="sticky left-0 z-[1] bg-slate-900 px-3 py-2.5 font-medium text-slate-500 shadow-[2px_0_12px_-2px_rgba(0,0,0,0.5)] md:px-4">
        {player.name}
      </td>
      <td className="px-2 py-2.5">
        <span className={roleBadgeClass(player.role)}>{player.role}</span>
      </td>
      <td className="px-2 py-2.5">
        <IplTeamPill code={player.iplTeam} />
      </td>
      <td className="px-2 py-2.5">
        <span className={natBadgeClass(player.nationality)}>
          {player.nationality ?? "—"}
        </span>
      </td>
      {columns.map((c) => {
        const pts = pointsInMatch(player, c.id);
        return (
          <td
            key={c.id}
            className="px-2 py-2.5 text-right tabular-nums text-slate-600"
          >
            {pts != null ? Math.round(pts) : "—"}
          </td>
        );
      })}
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-500">
        {Math.round(attributedPoints)}
      </td>
    </tr>
  );
}

export function MatchPoints() {
  const { bundle } = useLeague();
  const displaySummary = useLeagueStandings();
  const [franchise, setFranchise] = useState<string>("all");

  const standings = useMemo(() => {
    return displaySummary?.standings ?? [];
  }, [displaySummary]);

  const columns: MatchColumn[] = displaySummary?.columns ?? [];

  const filteredStandings = useMemo(() => {
    if (franchise === "all") return standings;
    return standings.filter((s) => s.owner === franchise);
  }, [standings, franchise]);

  if (!bundle || !displaySummary) return null;

  const scoringMode = displaySummary.mode;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-3xl tracking-wide text-white">Match Center</h2>
          <p className="mt-1 text-sm text-slate-400">
            Match-by-match fantasy matrix. Scroll horizontally on mobile.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm text-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Owner
          </span>
          <select
            value={franchise}
            onChange={(e) => setFranchise(e.target.value)}
            className="app-input min-w-[12rem] py-2.5"
          >
            <option value="all">All owners</option>
            {bundle.franchises.map((f) => (
              <option key={f.owner} value={f.owner}>
                {f.owner}
              </option>
            ))}
          </select>
        </label>
      </div>

      <OwnerSummaryTable
        columns={columns}
        perOwnerPerMatch={displaySummary.perOwnerPerMatch}
        standings={standings}
      />

      {filteredStandings.map((s) => {
        return (
          <section key={s.owner} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-white">{s.owner}</h3>
                <OwnerBadge owner={s.owner} />
              </div>
              <span className="rounded-full border border-cyan-500/30 bg-slate-900/80 px-3 py-1 text-xs text-cyan-200">
                Fantasy total (leaderboard): {Math.round(s.totalPoints)} pts
              </span>
            </div>
            <SquadCompositionCards players={s.playersResolved} />
            <FranchiseMatchTable
              standing={s}
              columns={columns}
              scoringMode={scoringMode}
              perOwnerRounds={displaySummary.perOwnerPerMatch[s.owner] ?? []}
              rostersAtStartOfMatch={displaySummary.rostersAtStartOfMatch}
              formerPlayers={displaySummary.formerPlayersPerOwner[s.owner] ?? []}
            />
          </section>
        );
      })}

      <p className="text-xs leading-relaxed text-slate-500">
        Cells count toward a franchise only for matches while that player was on the roster
        (same engine as Home). <code className="app-code-inline">—</code> means no points for
        that franchise that match. Row totals are the sum of attributed cells only.
      </p>
    </div>
  );
}
