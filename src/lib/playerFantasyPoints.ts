import type { Player, PlayerSeasonFantasyPoints } from "../types";

/** Keys included in the sum that should reconcile to `seasonTotal`. */
export const SEASON_FANTASY_POINT_KEYS = [
  "battingRuns",
  "boundaryFours",
  "boundarySixes",
  "battingMilestones",
  "ducks",
  "dotBalls",
  "wickets",
  "lbwOrBowled",
  "threeWicketHauls",
  "fourWicketHauls",
  "fiveWicketHauls",
  "maidens",
  "economy",
  "strikeRate",
  "catches",
  "threeCatchBonus",
  "stumpings",
  "runOutDirect",
  "runOutAssist",
  "namedInXi",
  "impactOrConcussion",
  "other",
] as const satisfies readonly (keyof PlayerSeasonFantasyPoints)[];

export type SeasonFantasyPointKey = (typeof SEASON_FANTASY_POINT_KEYS)[number];

export function sumSeasonFantasyPoints(
  fp: PlayerSeasonFantasyPoints | undefined,
): number {
  if (!fp) return 0;
  let s = 0;
  for (const k of SEASON_FANTASY_POINT_KEYS) {
    const v = fp[k];
    if (typeof v === "number" && !Number.isNaN(v)) s += v;
  }
  return s;
}

/** True if commissioner entered any breakdown value. */
export function hasFantasyBreakdown(fp: PlayerSeasonFantasyPoints | undefined): boolean {
  if (!fp) return false;
  return SEASON_FANTASY_POINT_KEYS.some((k) => {
    const v = fp[k];
    return typeof v === "number" && !Number.isNaN(v);
  });
}

export function breakdownMatchesSeasonTotal(
  p: Player,
  epsilon = 0.15,
): { checked: boolean; sum: number; delta: number; inSync: boolean } {
  const fp = p.seasonFantasyPoints;
  if (!hasFantasyBreakdown(fp)) {
    return { checked: false, sum: 0, delta: 0, inSync: true };
  }
  const sum = sumSeasonFantasyPoints(fp);
  const delta = p.seasonTotal - sum;
  return {
    checked: true,
    sum,
    delta,
    inSync: Math.abs(delta) <= epsilon,
  };
}

export function isBreakdownOutOfSync(p: Player, epsilon = 0.15): boolean {
  const r = breakdownMatchesSeasonTotal(p, epsilon);
  if (!r.checked) return false;
  return !r.inSync;
}

export function countPlayersWithBreakdownIssues(
  players: Player[],
  epsilon = 0.15,
): number {
  let n = 0;
  for (const p of players) {
    if (isBreakdownOutOfSync(p, epsilon)) n += 1;
  }
  return n;
}
