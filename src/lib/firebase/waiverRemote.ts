/**
 * Optional Firestore sync for shared waiver state (honor-system; use open rules only in private leagues).
 * Set VITE_FIREBASE_* env vars to enable.
 */

import { getFirebaseApp, isFirebaseConfigured } from "./client";

const DOC_PATH = "iplFantasy/waiverState";

export const isFirebaseWaiverConfigured = isFirebaseConfigured;

export type Unsub = () => void;

export async function subscribeWaiverRemote(
  onRemote: (data: unknown) => void,
  onError?: (e: Error) => void,
): Promise<Unsub | null> {
  if (!isFirebaseWaiverConfigured()) return null;
  try {
    const { getFirestore, doc, onSnapshot } = await import("firebase/firestore");
    const app = await getFirebaseApp();
    const db = getFirestore(app);
    const [col, id] = DOC_PATH.split("/");
    const d = doc(db, col, id);
    return onSnapshot(
      d,
      (snap) => {
        // Always notify caller that a snapshot arrived. This prevents a client
        // from writing a seeded/local state over an existing remote state
        // before it has hydrated from Firestore.
        if (!snap.exists()) {
          onRemote(null);
          return;
        }
        onRemote(snap.data()?.payload ?? null);
      },
      (err) => onError?.(err),
    );
  } catch (e) {
    onError?.(e instanceof Error ? e : new Error(String(e)));
    return null;
  }
}

/** Firestore rejects `undefined` anywhere in the tree; JSON round-trip drops those keys. */
export function stripUndefinedForFirestore<T>(value: T): T {
  if (value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export async function pushWaiverRemote(payload: unknown): Promise<void> {
  if (!isFirebaseWaiverConfigured()) return;
  const { getFirestore, doc, setDoc, serverTimestamp } = await import(
    "firebase/firestore"
  );
  const app = await getFirebaseApp();
  const db = getFirestore(app);
  const [col, id] = DOC_PATH.split("/");
  const cleanPayload = stripUndefinedForFirestore(payload);
  await setDoc(
    doc(db, col, id),
    { payload: cleanPayload, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

import type { CompletedTransfer } from "../waiver/types";

const TRANSFERS_COLLECTION = "completedTransfers";
const OWNERS_COLLECTION = "owners";

/**
 * Cloud waiver settles update `owners/{ownerId}.remainingBudget` but do not write
 * `completedTransfers`. Reading budgets here avoids the client “repair” overwriting
 * waiverState with 250k − (sum of incomplete transfer docs).
 */
export async function loadOwnerRemainingBudgets(): Promise<
  Record<string, number>
> {
  if (!isFirebaseConfigured()) return {};
  try {
    const { getFirestore, collection, getDocs } = await import("firebase/firestore");
    const app = await getFirebaseApp();
    const db = getFirestore(app);
    const snap = await getDocs(collection(db, OWNERS_COLLECTION));
    const out: Record<string, number> = {};
    for (const d of snap.docs) {
      const data = d.data() as { owner?: string; remainingBudget?: unknown };
      const owner =
        typeof data.owner === "string" && data.owner.length > 0 ? data.owner : d.id;
      const rb = data.remainingBudget;
      const n = typeof rb === "number" ? rb : Number(rb);
      if (Number.isFinite(n)) {
        out[owner] = n;
        // Doc id may differ from `owner` field casing; allow lookup either way.
        if (d.id !== owner) out[d.id] = n;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Match franchise owner name to `owners` map (exact id, field, or case-insensitive). */
export function lookupOwnerRemainingBudget(
  cloud: Record<string, number>,
  franchiseOwner: string,
): number | undefined {
  if (typeof cloud[franchiseOwner] === "number" && Number.isFinite(cloud[franchiseOwner]))
    return cloud[franchiseOwner];
  const lower = franchiseOwner.toLowerCase();
  for (const [k, v] of Object.entries(cloud)) {
    if (k.toLowerCase() === lower && typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

export async function writeCompletedTransfers(
  transfers: CompletedTransfer[],
): Promise<void> {
  if (!isFirebaseWaiverConfigured() || transfers.length === 0) return;
  const { getFirestore, doc, writeBatch } = await import("firebase/firestore");
  const app = await getFirebaseApp();
  const db = getFirestore(app);
  const batch = writeBatch(db);
  for (const t of transfers) {
    const clean = stripUndefinedForFirestore(t);
    batch.set(doc(db, TRANSFERS_COLLECTION, t.id), clean);
  }
  await batch.commit();
}

export async function loadCompletedTransfers(): Promise<CompletedTransfer[]> {
  if (!isFirebaseWaiverConfigured()) return [];
  const { getFirestore, collection, query, orderBy, getDocs } = await import(
    "firebase/firestore"
  );
  const app = await getFirebaseApp();
  const db = getFirestore(app);
  const q = query(
    collection(db, TRANSFERS_COLLECTION),
    orderBy("revealedAt", "desc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as CompletedTransfer);
}
