/**
 * IPL 2026 fantasy — automated subset (see rules.json). Some edge cases may need manual review.
 * Milestone first tier is 30 runs (+4); re-syncing an old match overwrites stored points with current rules.
 */

export type Role = "BAT" | "BOWL" | "AR" | "WK";

export type PlayerMatchStat = {
  runsBat?: number;
  ballsBat?: number;
  fours?: number;
  sixes?: number;
  isOut?: boolean;
  dismissalText?: string;
  ballsBowled?: number;
  maidens?: number;
  conceded?: number;
  wickets?: number;
  dots?: number;
};

/** Mirrors client `PlayerSeasonFantasyPoints` keys we auto-fill (Firestore → Players table). */
export type ComputedMatchFantasyPoints = Partial<{
  battingRuns: number;
  boundaryFours: number;
  boundarySixes: number;
  battingMilestones: number;
  ducks: number;
  dotBalls: number;
  wickets: number;
  lbwOrBowled: number;
  threeWicketHauls: number;
  fourWicketHauls: number;
  fiveWicketHauls: number;
  maidens: number;
  economy: number;
  strikeRate: number;
  catches: number;
  threeCatchBonus: number;
  stumpings: number;
  runOutDirect: number;
  runOutAssist: number;
  namedInXi: number;
  impactOrConcussion: number;
}>;

/** 30/50/75/100 bonuses; century uses only the +16 tier (rules.json). */
function milestonePoints(runs: number): number {
  if (runs >= 100) return 16;
  if (runs >= 75) return 12;
  if (runs >= 50) return 8;
  if (runs >= 30) return 4;
  return 0;
}

function strikeRatePoints(sr: number): number {
  if (sr > 170) return 6;
  if (sr > 150) return 4;
  if (sr >= 130) return 2;
  if (sr <= 70 && sr >= 60) return -2;
  if (sr < 60 && sr >= 50) return -4;
  if (sr < 50) return -6;
  return 0;
}

function economyPoints(eco: number, ballsBowled: number): number {
  if (ballsBowled < 12) return 0;
  if (eco < 5) return 6;
  if (eco < 6) return 4;
  if (eco < 7) return 2;
  if (eco >= 7 && eco < 10) return 0;
  if (eco <= 11) return -2;
  if (eco <= 12) return -4;
  return -6;
}

function haulSlice(wickets: number): Pick<
  ComputedMatchFantasyPoints,
  "threeWicketHauls" | "fourWicketHauls" | "fiveWicketHauls"
> {
  if (wickets >= 5) return { fiveWicketHauls: 16 };
  if (wickets === 4) return { fourWicketHauls: 8 };
  if (wickets === 3) return { threeWicketHauls: 4 };
  return {};
}

function isDuckEligible(role: Role): boolean {
  return role === "BAT" || role === "WK" || role === "AR";
}

function lbwBowledBonusForBowler(
  allBatters: { dismissal: string }[],
  bowlerNorm: string,
): number {
  const bn = bowlerNorm.toLowerCase();
  let n = 0;
  for (const { dismissal } of allBatters) {
    const d = dismissal.toLowerCase();
    if (!d.includes("lbw") && !d.includes("bowled")) continue;
    if (d.includes("run out")) continue;
    const m = d.match(/\bb\s+([^,]+)/);
    const bowlerPart = (m?.[1] ?? "").toLowerCase();
    if (bowlerPart.includes(bn) || bn.includes(bowlerPart.trim())) n += 1;
  }
  return n * 8;
}

function batterIsOut(s: PlayerMatchStat): boolean {
  if (s.isOut === true) return true;
  if (s.isOut === false) return false;
  const d = (s.dismissalText ?? "").toLowerCase();
  if (!d.trim()) return false;
  if (d.includes("not out")) return false;
  if (d.includes("did not bat") || d.includes("dnb")) return false;
  return true;
}

export function fantasyBreakdownForPlayer(
  role: Role,
  s: PlayerMatchStat,
  ctx?: { allDismissals?: { dismissal: string }[]; playerNorm: string },
): ComputedMatchFantasyPoints {
  const b: ComputedMatchFantasyPoints = {};
  const runs = s.runsBat ?? 0;
  const balls = s.ballsBat ?? 0;
  const fours = s.fours ?? 0;
  const sixes = s.sixes ?? 0;

  if (balls > 0 || runs > 0) {
    b.battingRuns = runs;
    b.boundaryFours = fours * 2;
    b.boundarySixes = sixes * 4;
    b.battingMilestones = milestonePoints(runs);
    if (runs === 0 && balls > 0 && isDuckEligible(role) && batterIsOut(s)) {
      b.ducks = -2;
    }
  }

  if (role !== "BOWL" && balls >= 10) {
    const sr = (runs / balls) * 100;
    b.strikeRate = strikeRatePoints(sr);
  }

  const bb = s.ballsBowled ?? 0;
  const wk = s.wickets ?? 0;
  const conc = s.conceded ?? 0;
  const dots = s.dots ?? 0;
  const maid = s.maidens ?? 0;

  if (bb > 0 || wk > 0) {
    b.wickets = wk * 25;
    b.maidens = maid * 12;
    b.dotBalls = dots;
    Object.assign(b, haulSlice(wk));
    const overs = bb / 6;
    const eco = overs > 0 ? conc / overs : 0;
    b.economy = economyPoints(eco, bb);
    if (ctx?.allDismissals) {
      const lbw = lbwBowledBonusForBowler(ctx.allDismissals, ctx.playerNorm);
      if (lbw !== 0) b.lbwOrBowled = lbw;
    }
  }

  return b;
}

export function sumComputedFantasyBreakdown(b: ComputedMatchFantasyPoints): number {
  let t = 0;
  for (const v of Object.values(b)) {
    if (typeof v === "number" && !Number.isNaN(v)) t += v;
  }
  return t;
}

export function fantasyPointsForPlayer(
  role: Role,
  s: PlayerMatchStat,
  ctx?: { allDismissals?: { dismissal: string }[]; playerNorm: string },
): number {
  const b = fantasyBreakdownForPlayer(role, s, ctx);
  return Math.round(sumComputedFantasyBreakdown(b) * 100) / 100;
}

/** Firestore JSON: omit zero fields to keep documents small. */
export function compactFantasyBreakdownForFirestore(
  b: ComputedMatchFantasyPoints,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) out[k] = v;
  }
  return out;
}
