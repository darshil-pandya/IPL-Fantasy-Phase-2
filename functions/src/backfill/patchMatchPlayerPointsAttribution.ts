import type { Firestore } from "firebase-admin/firestore";
import {
  matchKeyToAttributionInstant,
  type FantasyMatchEntry,
} from "./backfillWaiverFromMatches.js";

const BATCH = 450;

/**
 * Sets `matchPlayedAt` on each `matchPlayerPoints` doc so cloud scoring
 * (`calculateOwnerPoints`) orders transfers vs matches consistently with the
 * April 2026 backfill timeline (11:58 PM / 7:50 PM IST instants).
 */
export async function patchMatchPlayerPointsAttribution(
  db: Firestore,
  orderedMatches: FantasyMatchEntry[],
): Promise<{ updated: number }> {
  const keyToInstant = matchKeyToAttributionInstant(orderedMatches);
  const snap = await db.collection("matchPlayerPoints").get();
  let updated = 0;
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const matchId = data.matchId as string | undefined;
    if (!matchId) continue;
    const instant = keyToInstant.get(matchId);
    if (!instant) continue;
    if (data.matchPlayedAt === instant) continue;
    batch.update(doc.ref, { matchPlayedAt: instant });
    ops++;
    updated++;
    if (ops >= BATCH) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  return { updated };
}
