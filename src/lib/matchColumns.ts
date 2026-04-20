import type { MatchPoints, Player } from "../types";

const SEP = "\u001f";

export function matchColumnId(m: Pick<MatchPoints, "matchDate" | "matchLabel">): string {
  return `${m.matchDate}${SEP}${m.matchLabel}`;
}

export function parseMatchColumnId(id: string): { date: string; label: string } {
  const i = id.indexOf(SEP);
  if (i === -1) return { date: id, label: "" };
  return { date: id.slice(0, i), label: id.slice(i + SEP.length) };
}

export interface MatchColumn {
  id: string;
  date: string;
  label: string;
  /** IPL team codes derived from players who scored in this match (e.g. ["CSK", "RCB"]). */
  teams: string[];
}

export function matchColumnsFromPlayers(players: Player[]): MatchColumn[] {
  const map = new Map<string, MatchColumn>();
  const teamSets = new Map<string, Set<string>>();
  for (const p of players) {
    for (const m of p.byMatch) {
      const id = matchColumnId(m);
      if (!map.has(id)) {
        map.set(id, { id, date: m.matchDate, label: m.matchLabel, teams: [] });
        teamSets.set(id, new Set());
      }
      if (p.iplTeam) teamSets.get(id)!.add(p.iplTeam.toUpperCase());
    }
  }
  for (const [id, col] of map) {
    col.teams = [...(teamSets.get(id) ?? [])].sort();
  }
  return [...map.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label),
  );
}

/**
 * Last match column whose `date` is on/before `eventAt` (ISO). If `eventAt` is before
 * the first match, returns the last column (transfer after all known synced matches).
 */
export function inferEffectiveAfterColumnIdFromRevealTime(
  eventAt: string,
  columns: MatchColumn[],
): string | null {
  if (columns.length === 0) return null;
  let effCol: string | null = null;
  for (const c of columns) {
    if (c.date <= eventAt) effCol = c.id;
    else break;
  }
  return effCol ?? columns[columns.length - 1]!.id;
}

export function pointsInMatch(p: Player, columnId: string): number | null {
  const { date, label } = parseMatchColumnId(columnId);
  const row = p.byMatch.find((x) => x.matchDate === date && x.matchLabel === label);
  return row ? row.points : null;
}
