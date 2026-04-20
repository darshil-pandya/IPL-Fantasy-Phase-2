import type { LeagueBundle } from "../../types";
import type { WaiverPersistentState } from "../waiver/types";
import { getFirebaseApp, isFirebaseConfigured } from "./client";
import { stripUndefinedForFirestore } from "./waiverRemote";

/**
 * Atomically writes league bundle + waiver state after mid-season CSV import.
 */
export async function commitMidSeasonAuctionToFirestore(
  leagueBundle: LeagueBundle,
  waiverState: WaiverPersistentState,
): Promise<void> {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured.");
  }
  const { getFirestore, writeBatch, doc, serverTimestamp } = await import(
    "firebase/firestore"
  );
  const app = await getFirebaseApp();
  const db = getFirestore(app);

  const batch = writeBatch(db);
  const leagueRef = doc(db, "iplFantasy", "leagueBundle");
  const waiverRef = doc(db, "iplFantasy", "waiverState");

  batch.set(leagueRef, {
    payload: stripUndefinedForFirestore(leagueBundle),
    updatedAt: serverTimestamp(),
  });
  batch.set(waiverRef, {
    payload: stripUndefinedForFirestore(waiverState),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}
