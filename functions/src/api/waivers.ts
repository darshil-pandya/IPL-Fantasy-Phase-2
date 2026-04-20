import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type {
  AppSettingsDoc,
  OwnerDoc,
  PlayerDoc,
  WaiverNominationDoc,
  WaiverBidDoc,
  WaiverPhase,
} from "../models/types.js";
import { validateSquadComposition } from "../validation/squadComposition.js";
import { applyWaiverPlayerSwap } from "../waiver/applyWaiverSwap.js";

const WAIVER_STATE_DOC = "iplFantasy/waiverState";
const NOMINATION_WINDOW_MS = Math.round(4.5 * 60 * 60 * 1000);
const NOMINATION_CLOSED_MSG =
  "Nomination window has closed. Bidding is still open until reveal.";

// ─── helpers ───

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  const rand = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

async function readSettings(
  db: FirebaseFirestore.Firestore,
): Promise<AppSettingsDoc> {
  const snap = await db.doc("appSettings/league").get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "App settings not initialized. Run migration first.");
  }
  return snap.data() as AppSettingsDoc;
}

function assertWaiverOpen(settings: AppSettingsDoc): void {
  if (!settings.isWaiverWindowOpen) {
    throw new HttpsError("failed-precondition", "Waiver window is closed.");
  }
}

const FANTASY_MATCH_SCORES_DOC = "iplFantasy/fantasyMatchScores";

/** Build the same column id the web app uses (`matchDate` + unit separator + `matchLabel`). */
async function resolveDefaultEffectiveAfterColumnId(
  db: FirebaseFirestore.Firestore,
): Promise<string | null> {
  const snap = await db.doc(FANTASY_MATCH_SCORES_DOC).get();
  if (!snap.exists) return null;
  const data = snap.data() as {
    matches?: Record<string, { matchDate?: string; matchLabel?: string }>;
  };
  const matches = data?.matches;
  if (!matches || typeof matches !== "object") return null;
  const rows = Object.values(matches).filter(
    (m): m is { matchDate: string; matchLabel: string } =>
      typeof m?.matchDate === "string" && typeof m?.matchLabel === "string",
  );
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  const last = rows[rows.length - 1]!;
  const SEP = "\u001f";
  return `${last.matchDate}${SEP}${last.matchLabel}`;
}

/** Maps legacy persisted phases to the current state machine. */
function normalizedWaiverPhase(settings: AppSettingsDoc): WaiverPhase {
  const p = settings.waiverPhase as string;
  if (p === "idle") return "idle";
  if (p === "active" || p === "nomination" || p === "bidding") return "active";
  return "idle";
}

function assertPhase(settings: AppSettingsDoc, expected: WaiverPhase): void {
  const current = normalizedWaiverPhase(settings);
  if (current !== expected) {
    throw new HttpsError(
      "failed-precondition",
      `Expected waiver phase "${expected}", currently "${current}".`,
    );
  }
}

type WaiverPayloadLoose = Record<string, unknown>;

function parseWaiverPayload(data: FirebaseFirestore.DocumentData | undefined): WaiverPayloadLoose {
  const p = data?.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return { ...(p as Record<string, unknown>) };
  }
  return {};
}

async function tryLogNominationWindowClosed(
  db: FirebaseFirestore.Firestore,
  roundId: number,
  nominationsSubmitted: number,
): Promise<void> {
  const ref = db.doc(WAIVER_STATE_DOC);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const payload = parseWaiverPayload(snap.data());
    const rid =
      typeof payload.roundId === "number" && Number.isFinite(payload.roundId)
        ? payload.roundId
        : 0;
    if (rid !== roundId) return;
    if (payload.nominationWindowClosedLoggedForRoundId === roundId) return;
    const at = nowIso();
    const prevLog = Array.isArray(payload.log) ? payload.log : [];
    const log = [
      ...prevLog,
      {
        at,
        kind: "NOMINATION_WINDOW_CLOSED",
        message: "Nomination window closed for this round.",
        meta: {
          event_type: "NOMINATION_WINDOW_CLOSED",
          timestamp: at,
          round_id: String(roundId),
          nominations_submitted: nominationsSubmitted,
        },
      },
    ].slice(-500);
    tx.set(
      ref,
      {
        payload: {
          ...payload,
          log,
          nominationWindowClosedLoggedForRoundId: roundId,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

// ─── NOMINATE ───

export interface NominateInput {
  ownerPassword: string;
  ownerName: string;
  nominatedPlayerId: string;
  playerToDropId: string;
}

export async function handleNominate(data: NominateInput): Promise<{ nominationId: string }> {
  const db = getFirestore();

  const settings = await readSettings(db);
  assertWaiverOpen(settings);
  assertPhase(settings, "active");

  const waiverSnap = await db.doc(WAIVER_STATE_DOC).get();
  const wp = parseWaiverPayload(waiverSnap.data());
  const roundId =
    typeof wp.roundId === "number" && Number.isFinite(wp.roundId) ? wp.roundId : 0;
  const wr = wp.waiverRound as { nominationDeadline?: string } | undefined;
  const deadlineIso =
    wr && typeof wr.nominationDeadline === "string" ? wr.nominationDeadline : null;
  if (deadlineIso && Date.now() >= Date.parse(deadlineIso)) {
    const noms = Array.isArray(wp.nominations) ? wp.nominations : [];
    await tryLogNominationWindowClosed(db, roundId, noms.length);
    throw new HttpsError("failed-precondition", NOMINATION_CLOSED_MSG);
  }

  const { ownerName, nominatedPlayerId, playerToDropId } = data;

  // Validate owner exists
  const ownerSnap = await db.collection("owners").doc(ownerName).get();
  if (!ownerSnap.exists) {
    throw new HttpsError("not-found", `Owner "${ownerName}" not found.`);
  }
  const owner = ownerSnap.data() as OwnerDoc;

  // Validate player to drop is on owner's squad
  if (!owner.squad.includes(playerToDropId)) {
    throw new HttpsError(
      "invalid-argument",
      `Player "${playerToDropId}" is not on your squad.`,
    );
  }

  // Validate nominated player is not owned
  const nomineeSnap = await db.collection("players").doc(nominatedPlayerId).get();
  if (!nomineeSnap.exists) {
    throw new HttpsError("not-found", `Player "${nominatedPlayerId}" not found.`);
  }
  const nominee = nomineeSnap.data() as PlayerDoc;
  if (nominee.isOwned) {
    throw new HttpsError(
      "invalid-argument",
      `Player "${nominee.name}" is already owned by ${nominee.currentOwnerId}.`,
    );
  }

  // Double nomination guard
  const openNoms = await db
    .collection("waiverNominations")
    .where("nominatedPlayerId", "==", nominatedPlayerId)
    .where("status", "==", "OPEN")
    .limit(1)
    .get();
  if (!openNoms.empty) {
    throw new HttpsError(
      "already-exists",
      `An open nomination already exists for "${nominee.name}".`,
    );
  }

  const nominationId = newId("nom");
  const doc: WaiverNominationDoc = {
    nominationId,
    nominatedPlayerId,
    nominatedByOwnerId: ownerName,
    playerToDropId,
    status: "OPEN",
    nominatedAt: nowIso(),
    closedAt: null,
  };

  await db.collection("waiverNominations").doc(nominationId).set(doc);
  return { nominationId };
}

// ─── BID ───

export interface BidInput {
  ownerPassword: string;
  ownerName: string;
  nominationId: string;
  bidAmount: number;
  playerToDropId?: string;
}

export async function handleBid(data: BidInput): Promise<{ bidId: string }> {
  const db = getFirestore();

  const settings = await readSettings(db);
  assertWaiverOpen(settings);
  assertPhase(settings, "active");

  const { ownerName, nominationId, bidAmount, playerToDropId } = data;

  if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
    throw new HttpsError("invalid-argument", "Bid amount must be a positive number.");
  }

  // Read nomination
  const nomSnap = await db.collection("waiverNominations").doc(nominationId).get();
  if (!nomSnap.exists) {
    throw new HttpsError("not-found", `Nomination "${nominationId}" not found.`);
  }
  const nom = nomSnap.data() as WaiverNominationDoc;
  if (nom.status !== "OPEN") {
    throw new HttpsError("failed-precondition", "Nomination is not open.");
  }

  // Read owner
  const ownerSnap = await db.collection("owners").doc(ownerName).get();
  if (!ownerSnap.exists) {
    throw new HttpsError("not-found", `Owner "${ownerName}" not found.`);
  }
  const owner = ownerSnap.data() as OwnerDoc;

  // Budget check
  if (bidAmount > owner.remainingBudget) {
    throw new HttpsError(
      "invalid-argument",
      `Bid ${bidAmount} exceeds remaining budget ${owner.remainingBudget}.`,
    );
  }

  // Non-nominating owner must specify playerToDropId; nominator may override drop via bid
  const isNominator = ownerName === nom.nominatedByOwnerId;
  const dropId = isNominator
    ? (playerToDropId?.trim() || nom.playerToDropId)
    : playerToDropId;

  if (!isNominator && !playerToDropId) {
    throw new HttpsError(
      "invalid-argument",
      "Non-nominating bidders must specify a playerToDropId.",
    );
  }

  if (dropId && !owner.squad.includes(dropId)) {
    throw new HttpsError(
      "invalid-argument",
      `Player "${dropId}" is not on your squad.`,
    );
  }

  // Upsert: find existing bid by (nominationId + ownerName)
  const existingQuery = await db
    .collection("waiverBids")
    .where("nominationId", "==", nominationId)
    .where("ownerId", "==", ownerName)
    .limit(1)
    .get();

  let bidId: string;
  if (!existingQuery.empty) {
    bidId = existingQuery.docs[0].id;
    await db.collection("waiverBids").doc(bidId).update({
      bidAmount,
      playerToDropId: dropId ?? FieldValue.delete(),
      bidPlacedAt: nowIso(),
    });
  } else {
    bidId = newId("bid");
    const bidDoc: WaiverBidDoc = {
      bidId,
      nominationId,
      ownerId: ownerName,
      bidAmount,
      ...(dropId ? { playerToDropId: dropId } : {}),
      bidPlacedAt: nowIso(),
      isWinningBid: false,
    };
    await db.collection("waiverBids").doc(bidId).set(bidDoc);
  }

  return { bidId };
}

// ─── SETTLE ───

export interface SettleInput {
  adminSecret: string;
  nominationId: string;
  /** Same format as client `MatchColumn.id`; defaults to latest match in fantasyMatchScores. */
  effectiveAfterColumnId?: string | null;
}

interface SettleResult {
  ok: boolean;
  outcome: "won" | "cancelled";
  winnerId?: string;
  bidAmount?: number;
  skippedBids: { ownerId: string; reason: string }[];
}

export async function handleSettle(
  data: SettleInput,
  expectedSecret: string,
): Promise<SettleResult> {
  if (data.adminSecret !== expectedSecret) {
    throw new HttpsError("permission-denied", "Invalid admin secret.");
  }

  const db = getFirestore();
  const { nominationId } = data;

  const explicitEff = data.effectiveAfterColumnId?.trim() || null;
  const effectiveAfterColumnId =
    explicitEff || (await resolveDefaultEffectiveAfterColumnId(db));

  // Read nomination
  const nomSnap = await db.collection("waiverNominations").doc(nominationId).get();
  if (!nomSnap.exists) {
    throw new HttpsError("not-found", `Nomination "${nominationId}" not found.`);
  }
  const nom = nomSnap.data() as WaiverNominationDoc;
  if (nom.status !== "OPEN") {
    throw new HttpsError("failed-precondition", "Nomination is not open.");
  }

  // Collect all bids (the nominator's bid is implicit from the nomination amount if they placed one)
  const bidsSnap = await db
    .collection("waiverBids")
    .where("nominationId", "==", nominationId)
    .get();

  const allBids = bidsSnap.docs.map((d) => d.data() as WaiverBidDoc);

  if (allBids.length === 0) {
    await db.collection("waiverNominations").doc(nominationId).update({
      status: "CANCELLED",
      closedAt: nowIso(),
    });
    return { ok: true, outcome: "cancelled", skippedBids: [] };
  }

  // Sort: highest bid first, earliest placement wins ties
  allBids.sort((a, b) => {
    if (b.bidAmount !== a.bidAmount) return b.bidAmount - a.bidAmount;
    return a.bidPlacedAt.localeCompare(b.bidPlacedAt);
  });

  const skippedBids: { ownerId: string; reason: string }[] = [];

  // Iterate to find first valid winner
  for (const bid of allBids) {
    const isNominator = bid.ownerId === nom.nominatedByOwnerId;
    const dropId = isNominator
      ? bid.playerToDropId ?? nom.playerToDropId
      : bid.playerToDropId;

    // Non-nominator must have a drop player
    if (!isNominator && !dropId) {
      skippedBids.push({ ownerId: bid.ownerId, reason: "No playerToDropId specified." });
      continue;
    }

    // Budget re-check
    const ownerSnap = await db.collection("owners").doc(bid.ownerId).get();
    if (!ownerSnap.exists) {
      skippedBids.push({ ownerId: bid.ownerId, reason: "Owner not found." });
      continue;
    }
    const owner = ownerSnap.data() as OwnerDoc;

    if (bid.bidAmount > owner.remainingBudget) {
      skippedBids.push({
        ownerId: bid.ownerId,
        reason: `Bid ${bid.bidAmount} exceeds budget ${owner.remainingBudget}.`,
      });
      continue;
    }

    // Simulate post-transfer squad
    if (dropId && !owner.squad.includes(dropId)) {
      skippedBids.push({
        ownerId: bid.ownerId,
        reason: `Drop player "${dropId}" not on squad.`,
      });
      continue;
    }

    const simulatedSquadIds = owner.squad
      .filter((id) => id !== dropId)
      .concat(nom.nominatedPlayerId);

    // Read player docs for validation
    const playerSnaps = await Promise.all(
      simulatedSquadIds.map((id) => db.collection("players").doc(id).get()),
    );
    const simulatedPlayers: PlayerDoc[] = [];
    let missingPlayer = false;
    for (const ps of playerSnaps) {
      if (!ps.exists) {
        missingPlayer = true;
        break;
      }
      simulatedPlayers.push(ps.data() as PlayerDoc);
    }
    if (missingPlayer) {
      skippedBids.push({ ownerId: bid.ownerId, reason: "Missing player data for validation." });
      continue;
    }

    const validation = validateSquadComposition(simulatedPlayers);
    if (!validation.valid) {
      skippedBids.push({
        ownerId: bid.ownerId,
        reason: `Squad invalid: ${validation.errors.join("; ")}`,
      });
      continue;
    }

    // ── This bid wins: apply roster/budget to canonical collections, then metadata. ──
    const now = nowIso();
    await applyWaiverPlayerSwap(db, {
      winnerId: bid.ownerId,
      playerInId: nom.nominatedPlayerId,
      playerOutId: dropId,
      bidAmount: bid.bidAmount,
      timestampsAt: now,
      effectiveAfterColumnId: effectiveAfterColumnId ?? null,
    });

    const waiverStateRef = db.doc(WAIVER_STATE_DOC);
    const wsSnap = await waiverStateRef.get();
    const payload = wsSnap.exists
      ? parseWaiverPayload(wsSnap.data())
      : ({} as Record<string, unknown>);
    const roundId =
      typeof payload.roundId === "number" && Number.isFinite(payload.roundId)
        ? payload.roundId
        : 0;
    const existingHistory = (payload.rosterHistory as unknown[]) ?? [];
    const orderInRound = existingHistory.filter((e) => {
      if (e == null || typeof e !== "object") return false;
      return (e as { roundId?: unknown }).roundId === roundId;
    }).length;
    const rosterEvent = {
      at: now,
      roundId,
      orderInRound,
      winner: bid.ownerId,
      playerOutId: dropId ?? "",
      playerInId: nom.nominatedPlayerId,
      effectiveAfterColumnId: effectiveAfterColumnId ?? null,
    };

    const ownerAfterSnap = await db.collection("owners").doc(bid.ownerId).get();
    const ownerAfter = ownerAfterSnap.data() as OwnerDoc | undefined;
    const prevBudgets =
      payload.budgets && typeof payload.budgets === "object" && !Array.isArray(payload.budgets)
        ? { ...(payload.budgets as Record<string, number>) }
        : ({} as Record<string, number>);
    if (ownerAfter && typeof ownerAfter.remainingBudget === "number") {
      prevBudgets[bid.ownerId] = ownerAfter.remainingBudget;
    }

    const dropForBid = (b: WaiverBidDoc): string => {
      const isNom = b.ownerId === nom.nominatedByOwnerId;
      if (isNom) return (b.playerToDropId ?? nom.playerToDropId) ?? "";
      return b.playerToDropId ?? "";
    };
    const nomBids = allBids.filter((b) => b.ownerId === nom.nominatedByOwnerId);
    const otherBids = allBids
      .filter((b) => b.ownerId !== nom.nominatedByOwnerId)
      .sort((a, b) => a.bidPlacedAt.localeCompare(b.bidPlacedAt));
    const orderedBids = [...nomBids, ...otherBids];
    const completedTransferDoc = {
      id: nominationId,
      roundId,
      revealedAt: now,
      playerInId: nom.nominatedPlayerId,
      nominatorOwner: nom.nominatedByOwnerId,
      bids: orderedBids.map((b) => ({
        owner: b.ownerId,
        amount: b.bidAmount,
        playerOutId: dropForBid(b),
        placedAt: b.bidPlacedAt,
        result: (b.ownerId === bid.ownerId ? "WON" : "LOST") as "WON" | "LOST",
      })),
      effectiveAfterColumnId: effectiveAfterColumnId ?? null,
    };

    const batch = db.batch();
    batch.update(db.collection("waiverBids").doc(bid.bidId), {
      isWinningBid: true,
    });
    batch.update(db.collection("waiverNominations").doc(nominationId), {
      status: "CLOSED",
      closedAt: now,
    });
    batch.set(
      db.collection("completedTransfers").doc(nominationId),
      completedTransferDoc,
    );
    if (wsSnap.exists) {
      batch.set(
        waiverStateRef,
        {
          payload: {
            rosterHistory: [...existingHistory, rosterEvent],
            budgets: prevBudgets,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    await batch.commit();

    return {
      ok: true,
      outcome: "won",
      winnerId: bid.ownerId,
      bidAmount: bid.bidAmount,
      skippedBids,
    };
  }

  // No valid winner
  await db.collection("waiverNominations").doc(nominationId).update({
    status: "CANCELLED",
    closedAt: nowIso(),
  });

  return { ok: true, outcome: "cancelled", skippedBids };
}

// ─── SET WAIVER PHASE ───

export interface SetPhaseInput {
  adminSecret: string;
  targetPhase: WaiverPhase;
}

export async function handleSetWaiverPhase(
  data: SetPhaseInput,
  expectedSecret: string,
): Promise<{ phase: WaiverPhase; isWaiverWindowOpen: boolean }> {
  if (data.adminSecret !== expectedSecret) {
    throw new HttpsError("permission-denied", "Invalid admin secret.");
  }

  const db = getFirestore();
  const settings = await readSettings(db);
  const { targetPhase } = data;
  const fromPhase = normalizedWaiverPhase(settings);

  const validTransitions: Record<WaiverPhase, WaiverPhase[]> = {
    idle: ["active"],
    active: ["idle"],
  };

  const allowed = validTransitions[fromPhase];
  if (!allowed || !allowed.includes(targetPhase)) {
    throw new HttpsError(
      "failed-precondition",
      `Cannot transition from "${fromPhase}" to "${targetPhase}". ` +
        `Allowed: ${(allowed ?? []).join(", ") || "none"}.`,
    );
  }

  const isWaiverWindowOpen = targetPhase !== "idle";
  const waiverRef = db.doc(WAIVER_STATE_DOC);
  const wsSnap = await waiverRef.get();
  const fullPayload = parseWaiverPayload(wsSnap.data());

  if (targetPhase === "active" && fromPhase === "idle") {
    const startedAt = nowIso();
    const nominationDeadline = new Date(
      Date.parse(startedAt) + NOMINATION_WINDOW_MS,
    ).toISOString();
    const rd =
      typeof fullPayload.roundId === "number" && Number.isFinite(fullPayload.roundId)
        ? fullPayload.roundId
        : 0;
    fullPayload.phase = "active";
    fullPayload.roundId = rd + 1;
    fullPayload.nominations = [];
    fullPayload.bids = [];
    fullPayload.waiverRound = { startedAt, nominationDeadline };
    delete fullPayload.nominationWindowClosedLoggedForRoundId;
  } else if (targetPhase === "idle" && fromPhase === "active") {
    fullPayload.phase = "idle";
    delete fullPayload.waiverRound;
    delete fullPayload.nominationWindowClosedLoggedForRoundId;
  }

  const batch = db.batch();
  batch.set(
    db.doc("appSettings/league"),
    {
      waiverPhase: targetPhase,
      isWaiverWindowOpen,
    },
    { merge: true },
  );
  batch.set(
    waiverRef,
    {
      payload: fullPayload,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();

  return { phase: targetPhase, isWaiverWindowOpen };
}

// ─── ADMIN DELETE (callable) ───

export interface AdminDeleteBidInput {
  adminSecret: string;
  bidId: string;
}

export interface AdminDeleteNominationInput {
  adminSecret: string;
  nominationId: string;
}

function appendWaiverLog(
  payload: WaiverPayloadLoose,
  entry: Record<string, unknown>,
): unknown[] {
  const prevLog = Array.isArray(payload.log) ? payload.log : [];
  return [...prevLog, entry].slice(-500);
}

export async function handleAdminDeleteWaiverBid(
  data: AdminDeleteBidInput,
  expectedSecret: string,
): Promise<{ ok: true }> {
  if (data.adminSecret !== expectedSecret) {
    throw new HttpsError("permission-denied", "Invalid admin secret.");
  }
  const bidId = typeof data.bidId === "string" ? data.bidId.trim() : "";
  if (!bidId) {
    throw new HttpsError("invalid-argument", "bidId is required.");
  }

  const db = getFirestore();
  const settings = await readSettings(db);
  assertPhase(settings, "active");

  const bidRef = db.collection("waiverBids").doc(bidId);
  const bidSnap = await bidRef.get();
  if (!bidSnap.exists) {
    throw new HttpsError("not-found", `Bid "${bidId}" not found.`);
  }
  const bid = bidSnap.data() as WaiverBidDoc;

  await bidRef.delete();

  const waiverRef = db.doc(WAIVER_STATE_DOC);
  const wsSnap = await waiverRef.get();
  const payload = parseWaiverPayload(wsSnap.data());
  const bidsRaw = Array.isArray(payload.bids) ? payload.bids : [];
  const bids = bidsRaw.filter((b) => {
    const id =
      b && typeof b === "object" && "id" in b && typeof (b as { id: unknown }).id === "string"
        ? (b as { id: string }).id
        : "";
    return id !== bidId;
  });
  const at = nowIso();
  payload.bids = bids;
  payload.log = appendWaiverLog(payload, {
    at,
    kind: "ADMIN_DELETE_BID",
    message: `Admin deleted bid ${bidId}.`,
    meta: {
      event_type: "ADMIN_DELETE_BID",
      performed_by: "admin",
      timestamp: at,
      nomination_id: bid.nominationId,
      bid_id: bidId,
      deleted_bid_owner_id: bid.ownerId,
      deleted_bid_amount: bid.bidAmount,
    },
  });

  await waiverRef.set(
    { payload, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  return { ok: true };
}

export async function handleAdminDeleteWaiverNomination(
  data: AdminDeleteNominationInput,
  expectedSecret: string,
): Promise<{ ok: true }> {
  if (data.adminSecret !== expectedSecret) {
    throw new HttpsError("permission-denied", "Invalid admin secret.");
  }
  const nominationId =
    typeof data.nominationId === "string" ? data.nominationId.trim() : "";
  if (!nominationId) {
    throw new HttpsError("invalid-argument", "nominationId is required.");
  }

  const db = getFirestore();
  const settings = await readSettings(db);
  assertPhase(settings, "active");

  const nomRef = db.collection("waiverNominations").doc(nominationId);
  const nomSnap = await nomRef.get();
  if (!nomSnap.exists) {
    throw new HttpsError("not-found", `Nomination "${nominationId}" not found.`);
  }
  const nom = nomSnap.data() as WaiverNominationDoc;
  if (nom.status !== "OPEN") {
    throw new HttpsError("failed-precondition", "Nomination is not open.");
  }

  const bidsSnap = await db
    .collection("waiverBids")
    .where("nominationId", "==", nominationId)
    .get();

  const cascadedBidIds: string[] = [];
  const batch = db.batch();
  for (const d of bidsSnap.docs) {
    cascadedBidIds.push(d.id);
    batch.delete(d.ref);
  }
  batch.update(nomRef, { status: "CANCELLED", closedAt: nowIso() });

  const waiverRef = db.doc(WAIVER_STATE_DOC);
  const wsSnap = await waiverRef.get();
  const payload = parseWaiverPayload(wsSnap.data());
  const bidsRaw = Array.isArray(payload.bids) ? payload.bids : [];
  const nomsRaw = Array.isArray(payload.nominations) ? payload.nominations : [];
  payload.bids = bidsRaw.filter((b) => {
    const nid =
      b && typeof b === "object" && "nominationId" in b
        ? String((b as { nominationId?: string }).nominationId ?? "")
        : "";
    return nid !== nominationId;
  });
  payload.nominations = nomsRaw.filter((n) => {
    const id =
      n && typeof n === "object" && "id" in n && typeof (n as { id: unknown }).id === "string"
        ? (n as { id: string }).id
        : "";
    return id !== nominationId;
  });
  const at = nowIso();
  payload.log = appendWaiverLog(payload, {
    at,
    kind: "ADMIN_DELETE_NOMINATION",
    message: `Admin cancelled nomination ${nominationId}.`,
    meta: {
      event_type: "ADMIN_DELETE_NOMINATION",
      performed_by: "admin",
      timestamp: at,
      nomination_id: nominationId,
      nominated_player_id: nom.nominatedPlayerId,
      nominating_owner_id: nom.nominatedByOwnerId,
      cascaded_bid_ids: cascadedBidIds,
    },
  });

  batch.set(
    waiverRef,
    { payload, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  await batch.commit();

  return { ok: true };
}
