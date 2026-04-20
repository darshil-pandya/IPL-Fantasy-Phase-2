import type { FirebaseApp, FirebaseOptions } from "firebase/app";

/**
 * Single Firebase app for Firestore (league bundle + waiver state).
 * Set all three VITE_FIREBASE_* vars to enable.
 */
export function isFirebaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY &&
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
      import.meta.env.VITE_FIREBASE_PROJECT_ID,
  );
}

function firebaseOptions(): FirebaseOptions {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!apiKey || !authDomain || !projectId) {
    throw new Error("Firebase env incomplete");
  }
  return { apiKey, authDomain, projectId };
}

let appInit: Promise<FirebaseApp> | null = null;

export async function getFirebaseApp(): Promise<FirebaseApp> {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env).");
  }
  if (!appInit) {
    appInit = (async () => {
      const { initializeApp, getApp, getApps } = await import("firebase/app");
      if (getApps().length) return getApp();
      return initializeApp(firebaseOptions());
    })();
  }
  return appInit;
}

/** Where league JSON is loaded from when Firebase env is set. */
export type LeagueDataSourceMode = "auto" | "firestore" | "static";

export function leagueDataSourceMode(): LeagueDataSourceMode {
  const v = import.meta.env.VITE_LEAGUE_SOURCE?.toLowerCase().trim();
  if (v === "static") return "static";
  if (v === "firestore") return "firestore";
  return "auto";
}
