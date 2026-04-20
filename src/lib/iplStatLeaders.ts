import type {
  LeagueBundle,
  Player,
  PlayerNationality,
  PlayerRole,
  PlayerSeasonFantasyPoints,
  PlayerSeasonStats,
} from "../types";

function stats(p: Player): PlayerSeasonStats | undefined {
  return p.seasonStats;
}

function fp(p: Player): PlayerSeasonFantasyPoints | undefined {
  return p.seasonFantasyPoints;
}

export type StatLeader = {
  player: Player;
  /** Fantasy points (or ≈estimate) shown as the main number */
  display: string;
  /** Shown under the value when using a rough estimate from counting stats */
  caption?: string;
  /** IPL counting stat context, e.g. tournament batting/bowling average */
  secondaryStat?: string;
} | null;

/** Roster + waiver pool, de-duplicated by `id`, for season highlight leaderboards. */
export function playersForSeasonHighlights(bundle: LeagueBundle): Player[] {
  const seen = new Set<string>();
  const out: Player[] = [];
  for (const p of bundle.players) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  for (const p of bundle.waiverPool ?? []) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

function formatRound(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function sumFpKeys(
  slice: PlayerSeasonFantasyPoints | undefined,
  keys: (keyof PlayerSeasonFantasyPoints)[],
): number | null {
  if (!slice) return null;
  let s = 0;
  let hit = false;
  for (const k of keys) {
    const v = slice[k];
    if (typeof v === "number" && !Number.isNaN(v)) {
      s += v;
      hit = true;
    }
  }
  if (!hit) return null;
  return Math.round(s * 100) / 100;
}

/** Batting categories that define “batting fantasy” for the best-batting-avg card. */
const BATTING_FANTASY_KEYS: (keyof PlayerSeasonFantasyPoints)[] = [
  "battingRuns",
  "boundaryFours",
  "boundarySixes",
  "battingMilestones",
  "ducks",
  "dotBalls",
  "strikeRate",
];

/** Bowling categories for the best-bowling-avg card. */
const BOWLING_FANTASY_KEYS: (keyof PlayerSeasonFantasyPoints)[] = [
  "wickets",
  "lbwOrBowled",
  "threeWicketHauls",
  "fourWicketHauls",
  "fiveWicketHauls",
  "maidens",
  "economy",
  "dotBalls",
];

const ESTIMATE_CAPTION =
  "Approx. from runs/wickets/sixes (add seasonFantasyPoints for exact category pts)";

function numFromFp(
  p: Player,
  key: keyof PlayerSeasonFantasyPoints,
): number | null {
  const v = fp(p)?.[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/** Highest fantasy points (`seasonTotal`) in the league player pool. */
export function leaderMostFantasyPoints(players: Player[]): StatLeader {
  if (players.length === 0) return null;
  let best = players[0];
  let max = best.seasonTotal;
  for (const p of players) {
    if (p.seasonTotal > max) {
      max = p.seasonTotal;
      best = p;
    }
  }
  return { player: best, display: String(Math.round(max)) };
}

/** Leader by IPL runs; shows fantasy points from the run category (+1/run). */
export function leaderTopRuns(players: Player[]): StatLeader {
  let best: Player | null = null;
  let maxRuns = -Infinity;
  for (const p of players) {
    const r = stats(p)?.runs;
    if (r == null || Number.isNaN(r)) continue;
    if (r > maxRuns) {
      maxRuns = r;
      best = p;
    }
  }
  if (!best) return null;
  const fromFp = numFromFp(best, "battingRuns");
  if (fromFp != null) return { player: best, display: formatRound(fromFp) };
  const est = stats(best)?.runs;
  if (est == null) return null;
  return {
    player: best,
    display: `≈${formatRound(est)}`,
    caption: ESTIMATE_CAPTION,
  };
}

/** Leader by wickets; shows fantasy points from wicket awards (+25 etc. in `wickets` slice). */
export function leaderTopWickets(players: Player[]): StatLeader {
  let best: Player | null = null;
  let maxW = -Infinity;
  for (const p of players) {
    const w = stats(p)?.wickets;
    if (w == null || Number.isNaN(w)) continue;
    if (w > maxW) {
      maxW = w;
      best = p;
    }
  }
  if (!best) return null;
  const fromFp = numFromFp(best, "wickets");
  if (fromFp != null) return { player: best, display: formatRound(fromFp) };
  const w = stats(best)?.wickets;
  if (w == null) return null;
  return {
    player: best,
    display: `≈${formatRound(w * 25)}`,
    caption: ESTIMATE_CAPTION,
  };
}

/** Best batting average (IPL); shows sum of batting fantasy categories for that player. */
export function leaderBestBattingAvg(players: Player[]): StatLeader {
  let best: Player | null = null;
  let maxA = -Infinity;
  for (const p of players) {
    const a = stats(p)?.battingAvg;
    if (a == null || Number.isNaN(a)) continue;
    if (a > maxA) {
      maxA = a;
      best = p;
    }
  }
  if (!best) return null;
  const avg = stats(best)?.battingAvg;
  const sec =
    avg != null && !Number.isNaN(avg) ? `Tournament batting avg ${avg.toFixed(2)}` : undefined;
  const fromFp = sumFpKeys(fp(best), BATTING_FANTASY_KEYS);
  if (fromFp != null) {
    return { player: best, display: formatRound(fromFp), secondaryStat: sec };
  }
  const st = stats(best);
  if (!st) return null;
  let s = 0;
  let any = false;
  if (st.runs != null) {
    s += st.runs;
    any = true;
  }
  if (st.fours != null) {
    s += st.fours * 2;
    any = true;
  }
  if (st.sixes != null) {
    s += st.sixes * 4;
    any = true;
  }
  if (st.ducks != null) {
    s += st.ducks * -2;
    any = true;
  }
  if (!any) return null;
  return {
    player: best,
    display: `≈${formatRound(s)}`,
    caption: ESTIMATE_CAPTION,
    secondaryStat: sec,
  };
}

/** Best bowling average; shows sum of bowling fantasy categories for that player. */
export function leaderBestBowlingAvg(players: Player[]): StatLeader {
  let best: Player | null = null;
  let min = Infinity;
  for (const p of players) {
    const st = stats(p);
    if (st?.bowlingAvg == null || Number.isNaN(st.bowlingAvg)) continue;
    if ((st.wickets ?? 0) < 1) continue;
    if (st.bowlingAvg < min) {
      min = st.bowlingAvg;
      best = p;
    }
  }
  if (!best) return null;
  const bAvg = stats(best)?.bowlingAvg;
  const sec =
    bAvg != null && !Number.isNaN(bAvg)
      ? `Tournament bowling avg ${bAvg.toFixed(2)}`
      : undefined;
  const fromFp = sumFpKeys(fp(best), BOWLING_FANTASY_KEYS);
  if (fromFp != null) {
    return { player: best, display: formatRound(fromFp), secondaryStat: sec };
  }
  const st = stats(best);
  if (!st) return null;
  let s = 0;
  let any = false;
  if (st.wickets != null) {
    s += st.wickets * 25;
    any = true;
  }
  if (st.dotBalls != null) {
    s += st.dotBalls * 1;
    any = true;
  }
  if (st.maidens != null) {
    s += st.maidens * 12;
    any = true;
  }
  if (!any) return null;
  return {
    player: best,
    display: `≈${formatRound(s)}`,
    caption: ESTIMATE_CAPTION,
    secondaryStat: sec,
  };
}

/** Most sixes (IPL); shows fantasy points from six bonus (+4/six). */
export function leaderMostSixes(players: Player[]): StatLeader {
  let best: Player | null = null;
  let max = -Infinity;
  for (const p of players) {
    const x = stats(p)?.sixes;
    if (x == null || Number.isNaN(x)) continue;
    if (x > max) {
      max = x;
      best = p;
    }
  }
  if (!best) return null;
  const fromFp = numFromFp(best, "boundarySixes");
  if (fromFp != null) return { player: best, display: formatRound(fromFp) };
  const six = stats(best)?.sixes;
  if (six == null) return null;
  return {
    player: best,
    display: `≈${formatRound(six * 4)}`,
    caption: ESTIMATE_CAPTION,
  };
}

/** Most fours; shows fantasy points from four bonus (+2/four). */
export function leaderMostFours(players: Player[]): StatLeader {
  let best: Player | null = null;
  let max = -Infinity;
  for (const p of players) {
    const x = stats(p)?.fours;
    if (x == null || Number.isNaN(x)) continue;
    if (x > max) {
      max = x;
      best = p;
    }
  }
  if (!best) return null;
  const fromFp = numFromFp(best, "boundaryFours");
  if (fromFp != null) return { player: best, display: formatRound(fromFp) };
  const f = stats(best)?.fours;
  if (f == null) return null;
  return {
    player: best,
    display: `≈${formatRound(f * 2)}`,
    caption: ESTIMATE_CAPTION,
  };
}

function catchFantasyPoints(p: Player): number | null {
  const slice = fp(p);
  if (!slice) return null;
  let s = 0;
  let hit = false;
  const c = slice.catches;
  const b = slice.threeCatchBonus;
  if (typeof c === "number" && !Number.isNaN(c)) {
    s += c;
    hit = true;
  }
  if (typeof b === "number" && !Number.isNaN(b)) {
    s += b;
    hit = true;
  }
  return hit ? Math.round(s * 100) / 100 : null;
}

/** Most catches (IPL); shows fantasy points from catch awards (+8/catch, +4 three-catch bonus). */
export function leaderMostCatches(players: Player[]): StatLeader {
  let best: Player | null = null;
  let max = -Infinity;
  for (const p of players) {
    const c = stats(p)?.catches;
    if (c == null || Number.isNaN(c)) continue;
    if (c > max) {
      max = c;
      best = p;
    }
  }
  if (!best) return null;
  const fromFp = catchFantasyPoints(best);
  if (fromFp != null) return { player: best, display: formatRound(fromFp) };
  const catches = stats(best)?.catches;
  if (catches == null) return null;
  return {
    player: best,
    display: `≈${formatRound(catches * 8)}`,
    caption: ESTIMATE_CAPTION,
  };
}

export function roleLabel(role: PlayerRole): string {
  switch (role) {
    case "BAT":
      return "Batter";
    case "BOWL":
      return "Bowler";
    case "AR":
      return "All-rounder";
    case "WK":
      return "Wicket-keeper";
    default:
      return role;
  }
}

export function countryLabel(nationality: PlayerNationality | undefined): string {
  if (nationality === "IND") return "India";
  if (nationality === "OVS") return "Overseas";
  return "—";
}
