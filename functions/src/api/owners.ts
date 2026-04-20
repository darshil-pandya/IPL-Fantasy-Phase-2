import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type {
  OwnerDoc,
  PlayerDoc,
  OwnershipPeriodDoc,
  MatchPlayerPointDoc,
} from "../models/types.js";
import {
  calculateOwnerPoints,
  type OwnerPointsResult,
} from "../scoring/ownerPoints.js";

// ─── shared helpers ───

async function loadAllPeriodsAndMatchPoints(
  db: FirebaseFirestore.Firestore,
): Promise<{
  periods: OwnershipPeriodDoc[];
  matchPoints: MatchPlayerPointDoc[];
  playerNames: Map<string, string>;
}> {
  const [periodsSnap, mppSnap, playersSnap] = await Promise.all([
    db.collection("ownershipPeriods").get(),
    db.collection("matchPlayerPoints").get(),
    db.collection("players").get(),
  ]);

  const periods = periodsSnap.docs.map((d) => d.data() as OwnershipPeriodDoc);
  const matchPoints = mppSnap.docs.map((d) => d.data() as MatchPlayerPointDoc);
  const playerNames = new Map<string, string>();
  for (const d of playersSnap.docs) {
    const p = d.data() as PlayerDoc;
    playerNames.set(p.id, p.name);
  }

  return { periods, matchPoints, playerNames };
}

// ─── GET OWNER POINTS ───

export interface GetOwnerPointsInput {
  ownerId: string;
}

export async function handleGetOwnerPoints(
  data: GetOwnerPointsInput,
): Promise<OwnerPointsResult> {
  const db = getFirestore();
  const { ownerId } = data;

  if (!ownerId || typeof ownerId !== "string") {
    throw new HttpsError("invalid-argument", "ownerId is required.");
  }

  const ownerSnap = await db.collection("owners").doc(ownerId).get();
  if (!ownerSnap.exists) {
    throw new HttpsError("not-found", `Owner "${ownerId}" not found.`);
  }

  const { periods, matchPoints, playerNames } = await loadAllPeriodsAndMatchPoints(db);

  return calculateOwnerPoints(ownerId, periods, matchPoints, playerNames);
}

// ─── GET OWNER SQUAD ───

export interface GetOwnerSquadInput {
  ownerId: string;
}

export interface SquadPlayerEntry {
  id: string;
  name: string;
  iplTeam: string;
  role: string;
  nationality?: string;
  pointsContributed: number;
}

export interface GetOwnerSquadResult {
  ownerId: string;
  teamName: string;
  remainingBudget: number;
  squad: SquadPlayerEntry[];
}

export async function handleGetOwnerSquad(
  data: GetOwnerSquadInput,
): Promise<GetOwnerSquadResult> {
  const db = getFirestore();
  const { ownerId } = data;

  if (!ownerId || typeof ownerId !== "string") {
    throw new HttpsError("invalid-argument", "ownerId is required.");
  }

  const ownerSnap = await db.collection("owners").doc(ownerId).get();
  if (!ownerSnap.exists) {
    throw new HttpsError("not-found", `Owner "${ownerId}" not found.`);
  }
  const owner = ownerSnap.data() as OwnerDoc;

  // Load player docs for the squad
  const playerSnaps = await Promise.all(
    owner.squad.map((id) => db.collection("players").doc(id).get()),
  );
  const players: PlayerDoc[] = [];
  for (const ps of playerSnaps) {
    if (ps.exists) players.push(ps.data() as PlayerDoc);
  }

  // Calculate points contributed per player for this owner
  const [periodsSnap, mppSnap] = await Promise.all([
    db.collection("ownershipPeriods").where("ownerId", "==", ownerId).get(),
    db.collection("matchPlayerPoints").get(),
  ]);

  const periods = periodsSnap.docs.map((d) => d.data() as OwnershipPeriodDoc);
  const allMatchPoints = mppSnap.docs.map((d) => d.data() as MatchPlayerPointDoc);
  const playerNames = new Map<string, string>();
  for (const p of players) playerNames.set(p.id, p.name);

  const result = calculateOwnerPoints(ownerId, periods, allMatchPoints, playerNames);
  const pointsByPlayer = new Map<string, number>();
  for (const bp of result.breakdownByPlayer) {
    pointsByPlayer.set(bp.playerId, bp.pointsContributed);
  }

  const squad: SquadPlayerEntry[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    iplTeam: p.iplTeam,
    role: p.role,
    nationality: p.nationality,
    pointsContributed: pointsByPlayer.get(p.id) ?? 0,
  }));

  return {
    ownerId: owner.owner,
    teamName: owner.teamName,
    remainingBudget: owner.remainingBudget,
    squad,
  };
}

// ─── GET LEADERBOARD ───

export interface LeaderboardEntry {
  ownerId: string;
  teamName: string;
  totalPoints: number;
  remainingBudget: number;
}

export interface GetLeaderboardResult {
  leaderboard: LeaderboardEntry[];
}

export async function handleGetLeaderboard(): Promise<GetLeaderboardResult> {
  const db = getFirestore();

  const ownersSnap = await db.collection("owners").get();
  const owners = ownersSnap.docs.map((d) => d.data() as OwnerDoc);

  const { periods, matchPoints, playerNames } = await loadAllPeriodsAndMatchPoints(db);

  const entries: LeaderboardEntry[] = owners.map((owner) => {
    const result = calculateOwnerPoints(
      owner.owner,
      periods,
      matchPoints,
      playerNames,
    );
    return {
      ownerId: owner.owner,
      teamName: owner.teamName,
      totalPoints: result.totalPoints,
      remainingBudget: owner.remainingBudget,
    };
  });

  entries.sort((a, b) => b.totalPoints - a.totalPoints);

  return { leaderboard: entries };
}
