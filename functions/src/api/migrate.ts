import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type {
  PlayerDoc,
  OwnerDoc,
  OwnershipPeriodDoc,
  MatchPlayerPointDoc,
  AppSettingsDoc,
  PlayerRole,
  PlayerNationality,
} from "../models/types.js";
import { BUDGET_START } from "../models/types.js";

interface LegacyPlayer {
  id?: string;
  name?: string;
  iplTeam?: string;
  role?: string;
  nationality?: string;
  seasonTotal?: number;
  byMatch?: { matchLabel: string; matchDate: string; points: number; matchKey?: string }[];
}

interface LegacyFranchise {
  owner: string;
  teamName: string;
  playerIds: string[];
}

interface LegacyRosterChangeEvent {
  at: string;
  roundId: number;
  orderInRound: number;
  winner: string;
  playerOutId: string;
  playerInId: string;
  effectiveAfterColumnId: string | null;
}

interface LegacyWaiverState {
  rosters?: Record<string, string[]>;
  budgets?: Record<string, number>;
  rosterHistory?: LegacyRosterChangeEvent[];
  phase?: string;
}

const VALID_ROLES: PlayerRole[] = ["BAT", "BOWL", "AR", "WK"];

function isValidRole(r: unknown): r is PlayerRole {
  return typeof r === "string" && VALID_ROLES.includes(r as PlayerRole);
}

function toNationality(v: unknown): PlayerNationality | undefined {
  if (v === "IND" || v === "OVS") return v;
  return undefined;
}

/**
 * Reads the 3 legacy Firestore docs and populates the new collection structure.
 * Idempotent: overwrites docs with the same IDs on re-run.
 */
export async function runMigration(adminSecret: string, expectedSecret: string): Promise<{
  ok: boolean;
  playerCount: number;
  ownerCount: number;
  periodCount: number;
  matchPointCount: number;
  warnings: string[];
}> {
  if (adminSecret !== expectedSecret) {
    throw new HttpsError("permission-denied", "Invalid admin secret.");
  }

  const db = getFirestore();
  const warnings: string[] = [];

  // ── 1. Read legacy docs ──
  const [bundleSnap, waiverSnap, scoresSnap] = await Promise.all([
    db.doc("iplFantasy/leagueBundle").get(),
    db.doc("iplFantasy/waiverState").get(),
    db.doc("iplFantasy/fantasyMatchScores").get(),
  ]);

  const bundlePayload = bundleSnap.data()?.payload as {
    players?: LegacyPlayer[];
    waiverPool?: LegacyPlayer[];
    franchises?: LegacyFranchise[];
  } | undefined;

  const waiverData = waiverSnap.data()?.payload as LegacyWaiverState | undefined;
  const scoresData = scoresSnap.data() as {
    matches?: Record<string, {
      matchKey: string;
      matchDate: string;
      playerPoints?: Record<string, number>;
    }>;
  } | undefined;

  if (!bundlePayload?.franchises || !bundlePayload?.players) {
    throw new HttpsError(
      "failed-precondition",
      "iplFantasy/leagueBundle is missing franchises or players.",
    );
  }

  const franchises = bundlePayload.franchises;
  const rosters = waiverData?.rosters ?? {};
  const budgets = waiverData?.budgets ?? {};
  const rosterHistory = waiverData?.rosterHistory ?? [];

  // Build ownership map: playerId → owner name (from live rosters or franchise defaults)
  const ownershipMap = new Map<string, string>();
  for (const f of franchises) {
    const liveRoster = rosters[f.owner] ?? f.playerIds;
    for (const pid of liveRoster) {
      ownershipMap.set(pid, f.owner);
    }
  }

  // ── 2. Build player docs ──
  const allRawPlayers = [
    ...(bundlePayload.players ?? []),
    ...(bundlePayload.waiverPool ?? []),
  ];
  const seenPlayerIds = new Set<string>();
  const playerDocs: PlayerDoc[] = [];

  for (const raw of allRawPlayers) {
    if (!raw.id || !raw.name || !raw.iplTeam || !isValidRole(raw.role)) continue;
    if (seenPlayerIds.has(raw.id)) continue;
    seenPlayerIds.add(raw.id);

    const owner = ownershipMap.get(raw.id) ?? null;
    playerDocs.push({
      id: raw.id,
      name: raw.name,
      iplTeam: raw.iplTeam,
      role: raw.role,
      nationality: toNationality(raw.nationality),
      isOwned: owner !== null,
      currentOwnerId: owner,
      seasonTotal: raw.seasonTotal ?? 0,
      byMatch: (raw.byMatch ?? []).map((m) => ({
        matchLabel: m.matchLabel,
        matchDate: m.matchDate,
        points: m.points,
        ...(m.matchKey ? { matchKey: m.matchKey } : {}),
      })),
    });
  }

  // ── 3. Build owner docs ──
  const ownerDocs: OwnerDoc[] = franchises.map((f) => ({
    owner: f.owner,
    teamName: f.teamName,
    squad: rosters[f.owner] ?? [...f.playerIds],
    remainingBudget: budgets[f.owner] ?? BUDGET_START,
  }));

  // ── 4. Build ownership periods from rosterHistory ──
  //
  // For each franchise's auction roster, create an initial period (acquiredAt = season start).
  // Then replay rosterHistory to close/open periods for swaps.
  const periods: OwnershipPeriodDoc[] = [];
  let periodSeq = 0;

  // Map from matchDate strings so we can resolve effectiveAfterColumnId to a timestamp.
  // Collect all match dates from player byMatch entries.
  const matchDatesByColumnId = new Map<string, string>();
  for (const p of playerDocs) {
    for (const m of p.byMatch) {
      const colId = m.matchKey ?? `${m.matchDate}\x1f${m.matchLabel}`;
      if (!matchDatesByColumnId.has(colId)) {
        matchDatesByColumnId.set(colId, m.matchDate);
      }
    }
  }

  function resolveTimestampForColumnId(colId: string | null): string {
    if (!colId) return "2026-03-01T00:00:00.000Z";
    return matchDatesByColumnId.get(colId) ?? "2026-03-01T00:00:00.000Z";
  }

  const SEASON_START = "2026-03-21T00:00:00.000Z";

  // Initial auction periods: every player on the original franchise roster
  const auctionRosters = new Map<string, Set<string>>();
  for (const f of franchises) {
    auctionRosters.set(f.owner, new Set(f.playerIds));
  }

  // Track active periods per (owner, playerId)
  const activePeriods = new Map<string, OwnershipPeriodDoc>();

  function periodKey(ownerId: string, playerId: string): string {
    return `${ownerId}::${playerId}`;
  }

  // Create initial periods for auction rosters
  for (const f of franchises) {
    for (const pid of f.playerIds) {
      const doc: OwnershipPeriodDoc = {
        periodId: `period-${++periodSeq}`,
        playerId: pid,
        ownerId: f.owner,
        acquiredAt: SEASON_START,
        releasedAt: null,
        effectiveAfterColumnId: null,
      };
      periods.push(doc);
      activePeriods.set(periodKey(f.owner, pid), doc);
    }
  }

  // Sort rosterHistory by effective time
  const sortedHistory = [...rosterHistory].sort((a, b) => {
    const ta = resolveTimestampForColumnId(a.effectiveAfterColumnId);
    const tb = resolveTimestampForColumnId(b.effectiveAfterColumnId);
    if (ta !== tb) return ta.localeCompare(tb);
    if (a.roundId !== b.roundId) return a.roundId - b.roundId;
    return a.orderInRound - b.orderInRound;
  });

  for (const ev of sortedHistory) {
    const swapTime = ev.at || resolveTimestampForColumnId(ev.effectiveAfterColumnId);

    // Close the winner's out-player period
    const outKey = periodKey(ev.winner, ev.playerOutId);
    const outPeriod = activePeriods.get(outKey);
    if (outPeriod) {
      outPeriod.releasedAt = swapTime;
      activePeriods.delete(outKey);
    } else {
      warnings.push(
        `Migration: no active period for ${ev.winner}/${ev.playerOutId} to close at round ${ev.roundId}.`,
      );
    }

    // Create new period for the winner's acquired player
    const inDoc: OwnershipPeriodDoc = {
      periodId: `period-${++periodSeq}`,
      playerId: ev.playerInId,
      ownerId: ev.winner,
      acquiredAt: swapTime,
      releasedAt: null,
      effectiveAfterColumnId: ev.effectiveAfterColumnId ?? null,
    };
    periods.push(inDoc);
    activePeriods.set(periodKey(ev.winner, ev.playerInId), inDoc);
  }

  // ── 5. Build matchPlayerPoints from fantasyMatchScores ──
  const matchPointDocs: MatchPlayerPointDoc[] = [];
  const matches = scoresData?.matches ?? {};
  for (const [, entry] of Object.entries(matches)) {
    if (!entry.matchKey || !entry.playerPoints) continue;
    for (const [playerId, points] of Object.entries(entry.playerPoints)) {
      matchPointDocs.push({
        recordId: `${entry.matchKey}_${playerId}`,
        playerId,
        matchId: entry.matchKey,
        matchPlayedAt: entry.matchDate,
        points: typeof points === "number" ? points : 0,
      });
    }
  }

  // ── 6. Build appSettings ──
  const phase = waiverData?.phase;
  const openRound =
    phase === "active" || phase === "nomination" || phase === "bidding";
  const appSettings: AppSettingsDoc = {
    isWaiverWindowOpen: openRound,
    waiverPhase: openRound ? "active" : "idle",
  };

  // ── 7. Write to Firestore in batches (max 500 ops per batch) ──
  const MAX_BATCH = 490;

  async function writeBatched(
    ops: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[],
  ): Promise<void> {
    for (let i = 0; i < ops.length; i += MAX_BATCH) {
      const batch = db.batch();
      for (const op of ops.slice(i, i + MAX_BATCH)) {
        batch.set(op.ref, op.data);
      }
      await batch.commit();
    }
  }

  const allOps: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];

  for (const p of playerDocs) {
    allOps.push({ ref: db.collection("players").doc(p.id), data: { ...p } as unknown as Record<string, unknown> });
  }
  for (const o of ownerDocs) {
    allOps.push({ ref: db.collection("owners").doc(o.owner), data: { ...o } as unknown as Record<string, unknown> });
  }
  for (const p of periods) {
    allOps.push({ ref: db.collection("ownershipPeriods").doc(p.periodId), data: { ...p } as unknown as Record<string, unknown> });
  }
  for (const m of matchPointDocs) {
    allOps.push({ ref: db.collection("matchPlayerPoints").doc(m.recordId), data: { ...m } as unknown as Record<string, unknown> });
  }
  allOps.push({ ref: db.doc("appSettings/league"), data: { ...appSettings } as unknown as Record<string, unknown> });

  await writeBatched(allOps);

  return {
    ok: true,
    playerCount: playerDocs.length,
    ownerCount: ownerDocs.length,
    periodCount: periods.length,
    matchPointCount: matchPointDocs.length,
    warnings,
  };
}

const RESET_BATCH = 490;

/** Zero per-match rows and season totals on bundle players (Firestore + client scoring). */
function stripFantasyStatsFromLeaguePayload<
  T extends { players?: LegacyPlayer[]; waiverPool?: LegacyPlayer[] },
>(payload: T): T {
  const strip = (p: LegacyPlayer): LegacyPlayer => ({
    ...p,
    byMatch: [],
    seasonTotal: 0,
  });
  return {
    ...payload,
    players: (payload.players ?? []).map(strip),
    waiverPool: (payload.waiverPool ?? []).map(strip),
  };
}

async function deleteCollectionDocuments(
  db: FirebaseFirestore.Firestore,
  collectionId: string,
): Promise<number> {
  const ref = db.collection(collectionId);
  let total = 0;
  const page = 500;
  for (;;) {
    const snap = await ref.limit(page).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    total += snap.size;
    if (snap.size < page) break;
  }
  return total;
}

async function writeBatchedOps(
  db: FirebaseFirestore.Firestore,
  ops: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[],
): Promise<void> {
  for (let i = 0; i < ops.length; i += RESET_BATCH) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + RESET_BATCH)) {
      batch.set(op.ref, op.data);
    }
    await batch.commit();
  }
}

/**
 * Clears waiver activity and resets waiver budgets to the season start (₹2,50,000).
 * Rosters revert to auction squads from `iplFantasy/leagueBundle` (same as post-migration baseline).
 * Does not delete `leagueBundle`, `fantasyMatchScores`, or `matchPlayerPoints`. For a full scoring +
 * waiver wipe plus stripped bundle stats, use {@link runResetLeagueAndScoringToAuctionBaseline}.
 */
export async function runResetWaiverActivityToAuctionBaseline(
  adminSecret: string,
  expectedSecret: string,
): Promise<{
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
}> {
  if (adminSecret !== expectedSecret) {
    throw new HttpsError("permission-denied", "Invalid admin secret.");
  }

  const db = getFirestore();

  const bundleSnap = await db.doc("iplFantasy/leagueBundle").get();
  const bundlePayload = bundleSnap.data()?.payload as {
    players?: LegacyPlayer[];
    waiverPool?: LegacyPlayer[];
    franchises?: LegacyFranchise[];
  } | undefined;

  if (!bundlePayload?.franchises || !bundlePayload?.players) {
    throw new HttpsError(
      "failed-precondition",
      "iplFantasy/leagueBundle is missing franchises or players.",
    );
  }

  const franchises = bundlePayload.franchises;
  const settingsSnap = await db.doc("appSettings/league").get();
  const migratedCollectionsReset = settingsSnap.exists;

  const deleted = {
    completedTransfers: await deleteCollectionDocuments(db, "completedTransfers"),
    waiverNominations: await deleteCollectionDocuments(db, "waiverNominations"),
    waiverBids: await deleteCollectionDocuments(db, "waiverBids"),
    ownershipPeriods: 0,
  };

  const ownershipMap = new Map<string, string>();
  for (const f of franchises) {
    for (const pid of f.playerIds) {
      ownershipMap.set(pid, f.owner);
    }
  }

  const allRawPlayers = [
    ...(bundlePayload.players ?? []),
    ...(bundlePayload.waiverPool ?? []),
  ];
  const seenPlayerIds = new Set<string>();
  const playerDocs: PlayerDoc[] = [];

  for (const raw of allRawPlayers) {
    if (!raw.id || !raw.name || !raw.iplTeam || !isValidRole(raw.role)) continue;
    if (seenPlayerIds.has(raw.id)) continue;
    seenPlayerIds.add(raw.id);

    const owner = ownershipMap.get(raw.id) ?? null;
    playerDocs.push({
      id: raw.id,
      name: raw.name,
      iplTeam: raw.iplTeam,
      role: raw.role,
      nationality: toNationality(raw.nationality),
      isOwned: owner !== null,
      currentOwnerId: owner,
      seasonTotal: raw.seasonTotal ?? 0,
      byMatch: (raw.byMatch ?? []).map((m) => ({
        matchLabel: m.matchLabel,
        matchDate: m.matchDate,
        points: m.points,
        ...(m.matchKey ? { matchKey: m.matchKey } : {}),
      })),
    });
  }

  const ownerDocs: OwnerDoc[] = franchises.map((f) => ({
    owner: f.owner,
    teamName: f.teamName,
    squad: [...f.playerIds],
    remainingBudget: BUDGET_START,
  }));

  const SEASON_START = "2026-03-21T00:00:00.000Z";
  const periods: OwnershipPeriodDoc[] = [];
  let periodSeq = 0;
  for (const f of franchises) {
    for (const pid of f.playerIds) {
      periods.push({
        periodId: `period-${++periodSeq}`,
        playerId: pid,
        ownerId: f.owner,
        acquiredAt: SEASON_START,
        releasedAt: null,
        effectiveAfterColumnId: null,
      });
    }
  }

  const rosters: Record<string, string[]> = {};
  const budgets: Record<string, number> = {};
  const pointCarryover: Record<string, number> = {};
  for (const f of franchises) {
    rosters[f.owner] = [...f.playerIds];
    budgets[f.owner] = BUDGET_START;
    pointCarryover[f.owner] = 0;
  }

  const waiverPayload = {
    version: 2,
    roundId: 0,
    phase: "idle" as const,
    rosters,
    budgets,
    pointCarryover,
    joinSnapshot: {} as Record<string, number>,
    rosterHistory: [] as LegacyRosterChangeEvent[],
    nominations: [] as unknown[],
    bids: [] as unknown[],
    log: [] as unknown[],
  };

  await db.doc("iplFantasy/waiverState").set({
    payload: waiverPayload,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (migratedCollectionsReset) {
    deleted.ownershipPeriods = await deleteCollectionDocuments(
      db,
      "ownershipPeriods",
    );

    const appSettings: AppSettingsDoc = {
      isWaiverWindowOpen: false,
      waiverPhase: "idle",
    };

    const ops: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] =
      [];
    for (const p of playerDocs) {
      ops.push({
        ref: db.collection("players").doc(p.id),
        data: { ...p } as unknown as Record<string, unknown>,
      });
    }
    for (const o of ownerDocs) {
      ops.push({
        ref: db.collection("owners").doc(o.owner),
        data: { ...o } as unknown as Record<string, unknown>,
      });
    }
    for (const p of periods) {
      ops.push({
        ref: db.collection("ownershipPeriods").doc(p.periodId),
        data: { ...p } as unknown as Record<string, unknown>,
      });
    }
    ops.push({
      ref: db.doc("appSettings/league"),
      data: { ...appSettings } as unknown as Record<string, unknown>,
    });
    await writeBatchedOps(db, ops);
  }

  const message = migratedCollectionsReset
    ? "Waiver activity cleared: legacy waiverState, completedTransfers, nominations, bids, ownership periods; owners/players reset to auction squads with ₹2,50,000 waiver budget. Waiver phase set to idle (window closed)."
    : "Waiver activity cleared: legacy waiverState and transfer/nomination/bid collections emptied. Cloud waiver collections (owners/players) were not changed — run migration first if you use server-side waivers.";

  return {
    ok: true,
    message,
    deleted,
    migratedCollectionsReset,
    ownerCount: ownerDocs.length,
    playerDocCount: playerDocs.length,
  };
}

/**
 * Strips fantasy stats from `leagueBundle`, clears `fantasyMatchScores` and `matchPlayerPoints`,
 * then runs {@link runResetWaiverActivityToAuctionBaseline} so rosters and waiver state match
 * auction squads only.
 */
export async function runResetLeagueAndScoringToAuctionBaseline(
  adminSecret: string,
  expectedSecret: string,
): Promise<{
  ok: boolean;
  leagueBundleFantasyStripped: boolean;
  matchPlayerPointsDeleted: number;
  fantasyMatchScoresCleared: boolean;
  waiverReset: Awaited<ReturnType<typeof runResetWaiverActivityToAuctionBaseline>>;
}> {
  if (adminSecret !== expectedSecret) {
    throw new HttpsError("permission-denied", "Invalid admin secret.");
  }

  const db = getFirestore();
  const bundleRef = db.doc("iplFantasy/leagueBundle");
  const bundleSnap = await bundleRef.get();
  const rawPayload = bundleSnap.data()?.payload as
    | {
        players?: LegacyPlayer[];
        waiverPool?: LegacyPlayer[];
        franchises?: LegacyFranchise[];
      }
    | undefined;

  if (!rawPayload?.franchises || !rawPayload?.players) {
    throw new HttpsError(
      "failed-precondition",
      "iplFantasy/leagueBundle is missing franchises or players.",
    );
  }

  const strippedPayload = stripFantasyStatsFromLeaguePayload(rawPayload);
  await bundleRef.set(
    {
      payload: strippedPayload,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.doc("iplFantasy/fantasyMatchScores").set({ matches: {} });
  const matchPlayerPointsDeleted = await deleteCollectionDocuments(db, "matchPlayerPoints");

  const waiverReset = await runResetWaiverActivityToAuctionBaseline(
    adminSecret,
    expectedSecret,
  );

  return {
    ok: true,
    leagueBundleFantasyStripped: true,
    matchPlayerPointsDeleted,
    fantasyMatchScoresCleared: true,
    waiverReset,
  };
}
