export type WaiverPhase = "idle" | "active";

/** Per waiver round: nomination window ends at `nominationDeadline`. */
export type WaiverRoundMeta = {
  startedAt: string;
  nominationDeadline: string;
};

export interface WaiverNomination {
  id: string;
  roundId: number;
  nominatorOwner: string;
  playerInId: string;
  playerOutId: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WaiverBid {
  id: string;
  nominationId: string;
  bidderOwner: string;
  playerOutId: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WaiverLogEntry {
  at: string;
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
}

/**
 * One successful waiver swap. Points count for the winner only from matches **after**
 * `effectiveAfterColumnId` (see franchiseAttributedScoring).
 */
export interface RosterChangeEvent {
  at: string;
  roundId: number;
  /** Order within the same reveal (multiple nominations per round). */
  orderInRound: number;
  winner: string;
  playerOutId: string;
  playerInId: string;
  /**
   * After this match column, the swap applies. `null`/unknown ids are inferred at
   * scoring time from `at` and known match columns (see normalizeRosterHistoryForColumns).
   */
  effectiveAfterColumnId: string | null;
}

export interface WaiverPersistentState {
  version: 2;
  roundId: number;
  phase: WaiverPhase;
  /** Set when entering `active` from `idle`; omitted for legacy payloads. */
  waiverRound?: WaiverRoundMeta;
  /** Prevents duplicate `NOMINATION_WINDOW_CLOSED` log per `roundId`. */
  nominationWindowClosedLoggedForRoundId?: number;
  /** Full squad per owner (live roster). */
  rosters: Record<string, string[]>;
  budgets: Record<string, number>;
  /** @deprecated Retained for migration; not added on new reveals. Attribution uses rosterHistory. */
  pointCarryover: Record<string, number>;
  /** @deprecated Unused; retained for older persisted state. */
  joinSnapshot: Record<string, number>;
  /** Append-only waiver swaps (single source of truth for roster timelines). */
  rosterHistory: RosterChangeEvent[];
  nominations: WaiverNomination[];
  bids: WaiverBid[];
  log: WaiverLogEntry[];
}

export interface CompletedBid {
  owner: string;
  amount: number;
  playerOutId: string;
  placedAt: string;
  result: "WON" | "LOST";
}

export interface CompletedTransfer {
  id: string;
  roundId: number;
  revealedAt: string;
  playerInId: string;
  nominatorOwner: string;
  bids: CompletedBid[];
  /** When set, used when reconstructing rosterHistory (same format as RosterChangeEvent). */
  effectiveAfterColumnId?: string | null;
}

export type WaiverSession =
  | { role: "admin"; label: string }
  | { role: "owner"; label: string; owner: string };
