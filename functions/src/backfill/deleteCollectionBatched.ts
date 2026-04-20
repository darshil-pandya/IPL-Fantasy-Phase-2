import type { Firestore } from "firebase-admin/firestore";

export async function deleteCollectionBatched(
  db: Firestore,
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
