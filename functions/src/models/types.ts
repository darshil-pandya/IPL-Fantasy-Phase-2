export type PlayerRole = "BAT" | "BOWL" | "AR" | "WK";
export type PlayerNationality = "IND" | "OVS";
export type WaiverPhase = "idle" | "active";
export type NominationStatus = "OPEN" | "CLOSED" | "CANCELLED";

/** Firestore: players/{id} */
export interface PlayerDoc {
  id: string;
  name: string;
  iplTeam: string;
  role: PlayerRole;
  nationality?: PlayerNationality;
  isOwned: boolean;
  currentOwnerId: string | null;
  seasonTotal: number;
  byMatch: MatchPointEntry[];
}

export interface MatchPointEntry {
  matchLabel: string;
  matchDate: string;
  points: number;
  matchKey?: string;
}

/** Firestore: owners/{owner} — doc ID = owner display name */
export interface OwnerDoc {
  owner: string;
  teamName: string;
  squad: string[];
  remainingBudget: number;
}

/** Firestore: ownershipPeriods/{periodId} */
export interface OwnershipPeriodDoc {
  periodId: string;
  playerId: string;
  ownerId: string;
  acquiredAt: string;
  releasedAt: string | null;
  /**
   * For waiver acquisitions: same match-column id as `RosterChangeEvent.effectiveAfterColumnId`
   * (player counts from the next match after this column). Omitted/null for auction baseline.
   */
  effectiveAfterColumnId?: string | null;
}

/** Firestore: matchPlayerPoints/{recordId} */
export interface MatchPlayerPointDoc {
  recordId: string;
  playerId: string;
  matchId: string;
  matchPlayedAt: string;
  points: number;
}

/** Firestore: waiverNominations/{nominationId} */
export interface WaiverNominationDoc {
  nominationId: string;
  nominatedPlayerId: string;
  nominatedByOwnerId: string;
  playerToDropId: string;
  status: NominationStatus;
  nominatedAt: string;
  closedAt: string | null;
}

/** Firestore: waiverBids/{bidId} */
export interface WaiverBidDoc {
  bidId: string;
  nominationId: string;
  ownerId: string;
  bidAmount: number;
  playerToDropId?: string;
  bidPlacedAt: string;
  isWinningBid: boolean;
}

/** Firestore: appSettings/league */
export interface AppSettingsDoc {
  isWaiverWindowOpen: boolean;
  waiverPhase: WaiverPhase;
}

export const BUDGET_START = 250_000;
export const SQUAD_SIZE = 15;
export const MAX_PER_FRANCHISE = 3;
export const MAX_OVERSEAS = 7;
export const MIN_BAT_WK = 4;
export const MIN_BOWL = 3;
export const MIN_AR = 2;
