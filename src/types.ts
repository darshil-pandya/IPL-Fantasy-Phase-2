export type PlayerRole = "BAT" | "BOWL" | "AR" | "WK";

export interface MatchPoints {
  matchLabel: string;
  matchDate: string;
  points: number;
  /** Stable id when merged from Firestore (same match across re-syncs). */
  matchKey?: string;
}

/** One match worth of fantasy points keyed by `Player.id` (Firestore overlay). */
export interface FantasyMatchOverlayEntry {
  matchKey: string;
  matchLabel: string;
  matchDate: string;
  status?: "final" | "abandoned" | "provisional";
  playerPoints: Record<string, number>;
  /** Category points per player for this match (merged into `seasonFantasyPoints` on the Players page). */
  playerBreakdown?: Record<string, PlayerSeasonFantasyPoints>;
}

export type PlayerNationality = "IND" | "OVS";

/**
 * Season counting stats for scoring (optional; edit in players.json / waiver pool).
 * Aligns with `rules.json` fantasy categories: batting, bowling, fielding, other.
 */
export interface PlayerSeasonStats {
  runs?: number;
  ballsFaced?: number;
  /** Per 100 balls; if omitted, UI may derive from runs ÷ ballsFaced. */
  strikeRate?: number;
  fours?: number;
  sixes?: number;
  ducks?: number;
  dotBalls?: number;
  wickets?: number;
  lbwOrBowled?: number;
  threeWHauls?: number;
  fourWHauls?: number;
  fiveWHauls?: number;
  maidens?: number;
  catches?: number;
  stumpings?: number;
  runOutDirect?: number;
  runOutAssist?: number;
  oversBowled?: number;
  runsConceded?: number;
  economy?: number;
  namedInXi?: number;
  impactOrConcussion?: number;
  battingAvg?: number;
  bowlingAvg?: number;
}

/**
 * Cumulative fantasy points by scoring category (season-to-date).
 * Values may be negative (e.g. ducks, economy/SR penalties). If you maintain a full
 * breakdown, the sum of all fields should match `seasonTotal` (see validation on Players).
 */
export interface PlayerSeasonFantasyPoints {
  /** Points from +1 per run scored */
  battingRuns?: number;
  /** Points from +2 per four (boundary bonus) */
  boundaryFours?: number;
  /** Points from +4 per six */
  boundarySixes?: number;
  /** Net milestone bonuses (30/50/75/100) after your stacking rules */
  battingMilestones?: number;
  /** Duck penalties (negative) */
  ducks?: number;
  /** Points from +1 per dot ball */
  dotBalls?: number;
  /** Points from +25 per wicket (excl. run out) */
  wickets?: number;
  /** Points from +8 per LBW or bowled */
  lbwOrBowled?: number;
  threeWicketHauls?: number;
  fourWicketHauls?: number;
  fiveWicketHauls?: number;
  /** Points from +12 per maiden */
  maidens?: number;
  /** Net economy-rate band points (can be negative) */
  economy?: number;
  /** Net strike-rate band points for eligible roles (can be negative) */
  strikeRate?: number;
  /** Points from catches (+8 each) */
  catches?: number;
  /** Points from 3-catch bonus instances (+4 each time it applies) */
  threeCatchBonus?: number;
  stumpings?: number;
  runOutDirect?: number;
  runOutAssist?: number;
  namedInXi?: number;
  impactOrConcussion?: number;
  /** Manual adjustments not covered above */
  other?: number;
}

export interface Player {
  id: string;
  name: string;
  iplTeam: string;
  role: PlayerRole;
  /** Indian vs overseas (optional; used for roster badges). */
  nationality?: PlayerNationality;
  seasonTotal: number;
  byMatch: MatchPoints[];
  /** IPL tournament stats for leaderboards on Home (edit in players.json). */
  seasonStats?: PlayerSeasonStats;
  /** Fantasy points by category; Players page shows these instead of raw stats. */
  seasonFantasyPoints?: PlayerSeasonFantasyPoints;
  /** Whether this player is currently on any owner's roster (populated from Firestore collections). */
  isOwned?: boolean;
  /** Display name of the owner who currently holds this player, or null. */
  currentOwnerId?: string | null;
}

export interface Franchise {
  owner: string;
  teamName: string;
  playerIds: string[];
}

export interface AuctionSale {
  playerId: string;
  soldToOwner: string;
  amountCr: number;
  soldAt: string;
}

export interface AuctionState {
  unsoldPlayerIds: string[];
  sales: AuctionSale[];
}

export interface RulesTeamComposition {
  title: string;
  bullets: string[];
}

export interface RulesScoringRow {
  action: string;
  points: string;
}

export interface RulesScoringSection {
  heading: string;
  rows: RulesScoringRow[];
}

export interface RulesScoring {
  title: string;
  sections: RulesScoringSection[];
  footer: string;
}

export interface LeagueRules {
  teamComposition: RulesTeamComposition;
  scoring: RulesScoring;
}

export interface LeagueMeta {
  seasonLabel: string;
  lastPointsUpdate: string | null;
  pointsUpdateNote: string;
  cricbuzzBaseUrl: string;
}

export interface FranchiseStanding extends Franchise {
  totalPoints: number;
  playersResolved: Player[];
  missingPlayerIds: string[];
}

export interface PredictionActuals {
  winner: string | null;
  runnerUp: string | null;
  orangeCap: string | null;
  purpleCap: string | null;
}

export interface PredictionPick {
  owner: string;
  winner: string;
  runnerUp: string;
  orangeCap: string;
  purpleCap: string;
}

export interface PredictionsState {
  pointsPerCorrect: number;
  actuals: PredictionActuals;
  picks: PredictionPick[];
}

export interface LeagueBundle {
  meta: LeagueMeta;
  franchises: Franchise[];
  players: Player[];
  /** IPL squad players not in `players.json` (e.g. full squad minus fantasy rosters). Used for waiver nominations. */
  waiverPool?: Player[];
  auction: AuctionState;
  rules: LeagueRules;
  predictions: PredictionsState;
}
