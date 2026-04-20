import type { Firestore } from "firebase-admin/firestore";
import type { OwnerDoc, OwnershipPeriodDoc, PlayerDoc } from "../models/types.js";
import { validateSquadComposition } from "../validation/squadComposition.js";

export function newId(prefix: string): string {
  const rand = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Applies one waiver win: owner budget + squad, dropped/acquired players, ownership periods.
 * Does not touch waiverNominations / waiverBids / waiverState (callers add those).
 */
export async function applyWaiverPlayerSwap(
  db: Firestore,
  params: {
    winnerId: string;
    playerInId: string;
    playerOutId: string | null | undefined;
    bidAmount: number;
    /** Use the same ISO time as the waiver reveal record (ownership periods / log consistency). */
    timestampsAt?: string;
    /** Match-column id: new period earns points starting the match after this column (see client scoring). */
    effectiveAfterColumnId?: string | null;
  },
): Promise<{ now: string; simulatedSquadIds: string[]; newRemainingBudget: number }> {
  const { winnerId, playerInId, bidAmount } = params;
  const dropId = params.playerOutId?.trim() || null;

  const ownerSnap = await db.collection("owners").doc(winnerId).get();
  if (!ownerSnap.exists) {
    throw new Error(`Owner "${winnerId}" not found.`);
  }
  const owner = ownerSnap.data() as OwnerDoc;

  if (bidAmount > owner.remainingBudget) {
    throw new Error(`Bid ${bidAmount} exceeds remaining budget ${owner.remainingBudget}.`);
  }

  if (dropId && !owner.squad.includes(dropId)) {
    throw new Error(`Drop player "${dropId}" not on ${winnerId}'s squad.`);
  }

  const simulatedSquadIds = dropId
    ? owner.squad.filter((id) => id !== dropId).concat(playerInId)
    : [...owner.squad, playerInId];

  const playerSnaps = await Promise.all(
    simulatedSquadIds.map((id) => db.collection("players").doc(id).get()),
  );
  const simulatedPlayers: PlayerDoc[] = [];
  for (const ps of playerSnaps) {
    if (!ps.exists) {
      throw new Error(`Missing player data for squad validation.`);
    }
    simulatedPlayers.push(ps.data() as PlayerDoc);
  }

  const validation = validateSquadComposition(simulatedPlayers);
  if (!validation.valid) {
    throw new Error(`Squad invalid: ${validation.errors.join("; ")}`);
  }

  const now = params.timestampsAt?.trim() || nowIso();
  const batch = db.batch();

  batch.update(db.collection("owners").doc(winnerId), {
    remainingBudget: owner.remainingBudget - bidAmount,
    squad: simulatedSquadIds,
  });

  if (dropId) {
    const activePeriodSnap = await db
      .collection("ownershipPeriods")
      .where("playerId", "==", dropId)
      .where("ownerId", "==", winnerId)
      .where("releasedAt", "==", null)
      .limit(1)
      .get();
    if (!activePeriodSnap.empty) {
      batch.update(activePeriodSnap.docs[0].ref, { releasedAt: now });
    }

    batch.update(db.collection("players").doc(dropId), {
      isOwned: false,
      currentOwnerId: null,
    });
  }

  const periodId = newId("period");
  const newPeriod: OwnershipPeriodDoc = {
    periodId,
    playerId: playerInId,
    ownerId: winnerId,
    acquiredAt: now,
    releasedAt: null,
    effectiveAfterColumnId: params.effectiveAfterColumnId ?? null,
  };
  batch.set(db.collection("ownershipPeriods").doc(periodId), newPeriod);

  batch.update(db.collection("players").doc(playerInId), {
    isOwned: true,
    currentOwnerId: winnerId,
  });

  await batch.commit();

  return {
    now,
    simulatedSquadIds,
    newRemainingBudget: owner.remainingBudget - bidAmount,
  };
}
