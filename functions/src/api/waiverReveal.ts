import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { OwnerDoc } from "../models/types.js";
import { applyWaiverPlayerSwap } from "../waiver/applyWaiverSwap.js";
import {
  alignStateWithOwnerSquads,
  resolveWaiverRoundForReveal,
  type WaiverPersistentStatePort,
} from "../waiver/revealResolve.js";

const WAIVER_STATE_DOC = "iplFantasy/waiverState";
const APP_SETTINGS_DOC = "appSettings/league";
const FANTASY_MATCH_SCORES_DOC = "iplFantasy/fantasyMatchScores";

function parseWaiverPayload(data: FirebaseFirestore.DocumentData | undefined): Record<string, unknown> {
  const p = data?.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return { ...(p as Record<string, unknown>) };
  }
  return {};
}

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

/** Firestore rejects `undefined` in nested maps; JSON round-trip drops those keys. */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asWaiverState(payload: Record<string, unknown>): WaiverPersistentStatePort | null {
  if (payload.version !== 2) return null;
  if (typeof payload.roundId !== "number") return null;
  if (typeof payload.phase !== "string") return null;
  if (!payload.rosters || typeof payload.rosters !== "object") return null;
  if (!payload.budgets || typeof payload.budgets !== "object") return null;
  if (!Array.isArray(payload.rosterHistory)) return null;
  if (!Array.isArray(payload.nominations)) return null;
  if (!Array.isArray(payload.bids)) return null;
  if (!Array.isArray(payload.log)) return null;
  return payload as unknown as WaiverPersistentStatePort;
}

export interface WaiverCommitRevealInput {
  adminSecret: string;
  effectiveAfterColumnId?: string | null;
}

export interface WaiverCommitRevealResult {
  ok: true;
  transfersApplied: number;
  nominationsResolved: number;
}

export async function handleWaiverCommitReveal(
  data: WaiverCommitRevealInput,
  expectedSecret: string,
): Promise<WaiverCommitRevealResult> {
  if (data.adminSecret !== expectedSecret) {
    throw new HttpsError("permission-denied", "Invalid admin secret.");
  }

  const db = getFirestore();
  const waiverRef = db.doc(WAIVER_STATE_DOC);
  const wsSnap = await waiverRef.get();
  if (!wsSnap.exists) {
    throw new HttpsError("failed-precondition", "Waiver state document is missing.");
  }

  const rawPayload = parseWaiverPayload(wsSnap.data());
  const parsed = asWaiverState(rawPayload);
  if (!parsed) {
    throw new HttpsError(
      "failed-precondition",
      "Waiver payload is invalid or missing version 2 fields.",
    );
  }

  if (parsed.phase !== "active") {
    throw new HttpsError("failed-precondition", "No active waiver round to reveal.");
  }

  const ownersSnap = await db.collection("owners").get();
  const franchises = ownersSnap.docs.map((d) => {
    const o = d.data() as OwnerDoc;
    return { owner: o.owner || d.id, playerIds: [...o.squad] };
  });

  const rostersFromServer: Record<string, string[]> = {};
  for (const f of franchises) {
    rostersFromServer[f.owner] = [...f.playerIds];
  }
  const parsedWithServerRosters: WaiverPersistentStatePort = {
    ...parsed,
    rosters: rostersFromServer,
  };

  const aligned = alignStateWithOwnerSquads(parsedWithServerRosters, franchises);
  const explicitEff = data.effectiveAfterColumnId?.trim() || null;
  const effectiveAfterColumnId =
    explicitEff || (await resolveDefaultEffectiveAfterColumnId(db));

  const resolved = resolveWaiverRoundForReveal(aligned, effectiveAfterColumnId);
  if (!resolved.ok) {
    throw new HttpsError("failed-precondition", resolved.error);
  }

  const { state: nextPayload, completedTransfers } = resolved;

  try {
    for (const t of completedTransfers) {
      const win = t.bids.find((b) => b.result === "WON");
      if (!win) continue;
      await applyWaiverPlayerSwap(db, {
        winnerId: win.owner,
        playerInId: t.playerInId,
        playerOutId: win.playerOutId,
        bidAmount: win.amount,
        timestampsAt: t.revealedAt,
        effectiveAfterColumnId: t.effectiveAfterColumnId ?? null,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HttpsError(
      "failed-precondition",
      `Reveal aborted while applying swaps: ${msg}`,
    );
  }

  const batch = db.batch();
  for (const t of completedTransfers) {
    batch.set(db.collection("completedTransfers").doc(t.id), t);
  }

  batch.set(
    waiverRef,
    {
      payload: stripUndefined(nextPayload),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.update(db.doc(APP_SETTINGS_DOC), {
    waiverPhase: "idle",
    isWaiverWindowOpen: false,
  });

  await batch.commit();

  return {
    ok: true,
    transfersApplied: completedTransfers.length,
    nominationsResolved: parsed.nominations.length,
  };
}
