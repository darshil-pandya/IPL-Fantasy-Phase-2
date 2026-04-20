/**
 * Client-side callable wrappers for all new Cloud Functions.
 * Follows the same pattern as adminScoreSyncCall.ts.
 */

import { getFirebaseApp, isFirebaseConfigured } from "./client";
import { ADMIN_SCORE_SYNC_SECRET } from "./adminScoreSyncCall";

function functionsRegion(): string {
  return import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || "asia-south1";
}

async function callable(name: string) {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env).");
  }
  const { getFunctions, httpsCallable } = await import("firebase/functions");
  const app = await getFirebaseApp();
  const fns = getFunctions(app, functionsRegion());
  return httpsCallable(fns, name);
}

// ─── Migration ───

export interface MigrateResult {
  ok: boolean;
  playerCount: number;
  ownerCount: number;
  periodCount: number;
  matchPointCount: number;
  warnings: string[];
}

export async function callMigrateToCollections(): Promise<MigrateResult> {
  const fn = await callable("adminMigrateToCollections");
  const res = await fn({ adminSecret: ADMIN_SCORE_SYNC_SECRET });
  return res.data as MigrateResult;
}

export interface ResetLeagueToAuctionBaselineResult {
  ok: boolean;
  leagueBundleFantasyStripped: boolean;
  matchPlayerPointsDeleted: number;
  fantasyMatchScoresCleared: boolean;
  waiverReset: {
    ok: boolean;
    message: string;
    deleted: {
      completedTransfers: number;
      waiverNominations: number;
      waiverBids: number;
      ownershipPeriods: number;
    };
    migratedCollectionsReset: boolean;
    ownerCount: number;
    playerDocCount: number;
  };
}

export async function callResetLeagueToAuctionBaseline(): Promise<ResetLeagueToAuctionBaselineResult> {
  const fn = await callable("adminResetLeagueToAuctionBaseline");
  const res = await fn({ adminSecret: ADMIN_SCORE_SYNC_SECRET });
  return res.data as ResetLeagueToAuctionBaselineResult;
}

// ─── Waiver mutations ───

export async function callWaiverNominate(params: {
  ownerName: string;
  ownerPassword: string;
  nominatedPlayerId: string;
  playerToDropId: string;
}): Promise<{ nominationId: string }> {
  const fn = await callable("waiverNominate");
  const res = await fn(params);
  return res.data as { nominationId: string };
}

export async function callWaiverBid(params: {
  ownerName: string;
  ownerPassword: string;
  nominationId: string;
  bidAmount: number;
  playerToDropId?: string;
}): Promise<{ bidId: string }> {
  const fn = await callable("waiverBid");
  const res = await fn(params);
  return res.data as { bidId: string };
}

export interface SettleResult {
  ok: boolean;
  outcome: "won" | "cancelled";
  winnerId?: string;
  bidAmount?: number;
  skippedBids: { ownerId: string; reason: string }[];
}

export async function callWaiverSettle(params: {
  nominationId: string;
  /** Match column id (`matchDate` + U+001F + `matchLabel`). Omit to use latest synced match. */
  effectiveAfterColumnId?: string | null;
}): Promise<SettleResult> {
  const fn = await callable("waiverSettle");
  const res = await fn({
    adminSecret: ADMIN_SCORE_SYNC_SECRET,
    nominationId: params.nominationId,
    effectiveAfterColumnId: params.effectiveAfterColumnId ?? undefined,
  });
  return res.data as SettleResult;
}

export interface WaiverCommitRevealResult {
  ok: true;
  transfersApplied: number;
  nominationsResolved: number;
}

/** Server-authoritative reveal: updates owners, players, completedTransfers, waiverState, app settings. */
export async function callWaiverCommitReveal(params: {
  effectiveAfterColumnId?: string | null;
}): Promise<WaiverCommitRevealResult> {
  const fn = await callable("waiverCommitReveal");
  const res = await fn({
    adminSecret: ADMIN_SCORE_SYNC_SECRET,
    effectiveAfterColumnId: params.effectiveAfterColumnId ?? undefined,
  });
  return res.data as WaiverCommitRevealResult;
}

export async function callSetWaiverPhase(params: {
  targetPhase: "idle" | "active";
}): Promise<{ phase: string; isWaiverWindowOpen: boolean }> {
  const fn = await callable("adminSetWaiverPhase");
  const res = await fn({
    adminSecret: ADMIN_SCORE_SYNC_SECRET,
    targetPhase: params.targetPhase,
  });
  return res.data as { phase: string; isWaiverWindowOpen: boolean };
}

export async function callAdminDeleteWaiverBid(params: {
  bidId: string;
}): Promise<{ ok: true }> {
  const fn = await callable("adminDeleteWaiverBid");
  const res = await fn({
    adminSecret: ADMIN_SCORE_SYNC_SECRET,
    bidId: params.bidId,
  });
  return res.data as { ok: true };
}

export async function callAdminDeleteWaiverNomination(params: {
  nominationId: string;
}): Promise<{ ok: true }> {
  const fn = await callable("adminDeleteWaiverNomination");
  const res = await fn({
    adminSecret: ADMIN_SCORE_SYNC_SECRET,
    nominationId: params.nominationId,
  });
  return res.data as { ok: true };
}

// ─── Read endpoints ───

export interface PlayerEntry {
  id: string;
  name: string;
  iplTeam: string;
  role: string;
  nationality?: string;
  isOwned: boolean;
  currentOwnerId: string | null;
  seasonTotalPoints: number;
}

export async function callGetPlayers(): Promise<{ players: PlayerEntry[] }> {
  const fn = await callable("getPlayers");
  const res = await fn({});
  return res.data as { players: PlayerEntry[] };
}

export interface OwnershipPeriod {
  periodId: string;
  playerId: string;
  ownerId: string;
  acquiredAt: string;
  releasedAt: string | null;
}

export interface MatchPlayerPoint {
  recordId: string;
  playerId: string;
  matchId: string;
  matchPlayedAt: string;
  points: number;
}

export interface PlayerHistoryResult {
  playerId: string;
  name: string;
  iplTeam: string;
  role: string;
  isOwned: boolean;
  currentOwnerId: string | null;
  seasonTotalPoints: number;
  ownershipPeriods: OwnershipPeriod[];
  matchPoints: MatchPlayerPoint[];
}

export async function callGetPlayerHistory(
  playerId: string,
): Promise<PlayerHistoryResult> {
  const fn = await callable("getPlayerHistory");
  const res = await fn({ playerId });
  return res.data as PlayerHistoryResult;
}

export interface PeriodBreakdown {
  acquiredAt: string;
  releasedAt: string | null;
  points: number;
}

export interface PlayerPointsBreakdown {
  playerId: string;
  name: string;
  pointsContributed: number;
  periods: PeriodBreakdown[];
}

export interface OwnerPointsResult {
  ownerId: string;
  totalPoints: number;
  breakdownByPlayer: PlayerPointsBreakdown[];
}

export async function callGetOwnerPoints(
  ownerId: string,
): Promise<OwnerPointsResult> {
  const fn = await callable("getOwnerPoints");
  const res = await fn({ ownerId });
  return res.data as OwnerPointsResult;
}

export interface SquadPlayerEntry {
  id: string;
  name: string;
  iplTeam: string;
  role: string;
  nationality?: string;
  pointsContributed: number;
}

export interface OwnerSquadResult {
  ownerId: string;
  teamName: string;
  remainingBudget: number;
  squad: SquadPlayerEntry[];
}

export async function callGetOwnerSquad(
  ownerId: string,
): Promise<OwnerSquadResult> {
  const fn = await callable("getOwnerSquad");
  const res = await fn({ ownerId });
  return res.data as OwnerSquadResult;
}

export interface LeaderboardEntry {
  ownerId: string;
  teamName: string;
  totalPoints: number;
  remainingBudget: number;
}

export async function callGetLeaderboard(): Promise<{
  leaderboard: LeaderboardEntry[];
}> {
  const fn = await callable("getLeaderboard");
  const res = await fn({});
  return res.data as { leaderboard: LeaderboardEntry[] };
}
