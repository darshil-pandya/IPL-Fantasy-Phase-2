import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type {
  PlayerDoc,
  MatchPlayerPointDoc,
  OwnershipPeriodDoc,
} from "../models/types.js";

// ─── GET PLAYERS ───

export interface GetPlayersResult {
  players: (PlayerDoc & { seasonTotalPoints: number })[];
}

/**
 * Returns all players with a seasonTotalPoints field that sums ALL their
 * match points regardless of ownership (for scouting/bidding reference).
 */
export async function handleGetPlayers(): Promise<GetPlayersResult> {
  const db = getFirestore();

  const [playersSnap, mppSnap] = await Promise.all([
    db.collection("players").get(),
    db.collection("matchPlayerPoints").get(),
  ]);

  // Sum points per player (across all matches, irrespective of ownership)
  const pointsByPlayer = new Map<string, number>();
  for (const doc of mppSnap.docs) {
    const mp = doc.data() as MatchPlayerPointDoc;
    pointsByPlayer.set(
      mp.playerId,
      (pointsByPlayer.get(mp.playerId) ?? 0) + mp.points,
    );
  }

  const players = playersSnap.docs.map((d) => {
    const p = d.data() as PlayerDoc;
    const total = pointsByPlayer.get(p.id) ?? 0;
    return {
      ...p,
      seasonTotalPoints: Math.round(total * 100) / 100,
    };
  });

  return { players };
}

// ─── GET PLAYER HISTORY ───

export interface GetPlayerHistoryInput {
  playerId: string;
}

export interface GetPlayerHistoryResult {
  playerId: string;
  name: string;
  iplTeam: string;
  role: string;
  isOwned: boolean;
  currentOwnerId: string | null;
  seasonTotalPoints: number;
  ownershipPeriods: OwnershipPeriodDoc[];
  matchPoints: MatchPlayerPointDoc[];
}

export async function handleGetPlayerHistory(
  data: GetPlayerHistoryInput,
): Promise<GetPlayerHistoryResult> {
  const db = getFirestore();
  const { playerId } = data;

  if (!playerId || typeof playerId !== "string") {
    throw new HttpsError("invalid-argument", "playerId is required.");
  }

  const playerSnap = await db.collection("players").doc(playerId).get();
  if (!playerSnap.exists) {
    throw new HttpsError("not-found", `Player "${playerId}" not found.`);
  }
  const player = playerSnap.data() as PlayerDoc;

  const [periodsSnap, mppSnap] = await Promise.all([
    db.collection("ownershipPeriods").where("playerId", "==", playerId).get(),
    db.collection("matchPlayerPoints").where("playerId", "==", playerId).get(),
  ]);

  const ownershipPeriods = periodsSnap.docs
    .map((d) => d.data() as OwnershipPeriodDoc)
    .sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt));

  const matchPoints = mppSnap.docs
    .map((d) => d.data() as MatchPlayerPointDoc)
    .sort((a, b) => a.matchPlayedAt.localeCompare(b.matchPlayedAt));

  const seasonTotalPoints = matchPoints.reduce((s, m) => s + m.points, 0);

  return {
    playerId: player.id,
    name: player.name,
    iplTeam: player.iplTeam,
    role: player.role,
    isOwned: player.isOwned,
    currentOwnerId: player.currentOwnerId,
    seasonTotalPoints: Math.round(seasonTotalPoints * 100) / 100,
    ownershipPeriods,
    matchPoints,
  };
}
