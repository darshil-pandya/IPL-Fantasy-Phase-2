import type { LeagueBundle } from "../../types";
import { fetchLeagueBundleStatic } from "../loadLeague";
import { getFirebaseApp, isFirebaseConfigured } from "./client";

const COL = "iplFantasy";
const LEAGUE_DOC = "leagueBundle";

function isValidLeagueBundle(x: unknown): x is LeagueBundle {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  const poolOk =
    b.waiverPool == null ||
    (Array.isArray(b.waiverPool) &&
      b.waiverPool.every((p) => p != null && typeof p === "object"));
  return (
    b.meta != null &&
    typeof b.meta === "object" &&
    Array.isArray(b.franchises) &&
    Array.isArray(b.players) &&
    poolOk &&
    b.auction != null &&
    typeof b.auction === "object" &&
    b.rules != null &&
    typeof b.rules === "object" &&
    b.predictions != null &&
    typeof b.predictions === "object"
  );
}

export async function fetchLeagueBundleOnce(): Promise<LeagueBundle | null> {
  if (!isFirebaseConfigured()) return null;
  const { getFirestore, doc, getDoc } = await import("firebase/firestore");
  const app = await getFirebaseApp();
  const db = getFirestore(app);
  const snap = await getDoc(doc(db, COL, LEAGUE_DOC));
  if (!snap.exists()) return null;
  const raw = snap.data()?.payload;
  return isValidLeagueBundle(raw) ? raw : null;
}

/**
 * Live updates when the league document changes in Firestore.
 * If the document is missing, calls `onUpdate(null, null)` once.
 */
export async function subscribeLeagueBundle(
  onUpdate: (bundle: LeagueBundle | null, err: Error | null) => void,
): Promise<(() => void) | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const { getFirestore, doc, onSnapshot } = await import("firebase/firestore");
    const app = await getFirebaseApp();
    const db = getFirestore(app);
    const d = doc(db, COL, LEAGUE_DOC);
    return onSnapshot(
      d,
      (snap) => {
        if (!snap.exists()) {
          onUpdate(null, null);
          return;
        }
        const raw = snap.data()?.payload;
        if (!isValidLeagueBundle(raw)) {
          onUpdate(
            null,
            new Error("Firestore league payload is missing or invalid fields."),
          );
          return;
        }
        onUpdate(raw, null);
      },
      (err) => onUpdate(null, err),
    );
  } catch (e) {
    onUpdate(
      null,
      e instanceof Error ? e : new Error(String(e)),
    );
    return null;
  }
}

export async function publishLeagueBundleToFirestore(
  bundle: LeagueBundle,
): Promise<void> {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured.");
  }
  const { getFirestore, doc, setDoc, serverTimestamp } = await import(
    "firebase/firestore"
  );
  const app = await getFirebaseApp();
  const db = getFirestore(app);
  await setDoc(doc(db, COL, LEAGUE_DOC), {
    payload: bundle,
    updatedAt: serverTimestamp(),
  });
}

/** Reads JSON from this site (GitHub Pages) and writes the merged bundle to Firestore. */
export async function seedLeagueFromStaticToFirestore(): Promise<void> {
  const bundle = await fetchLeagueBundleStatic();
  await publishLeagueBundleToFirestore(bundle);
}
