import { getFirebaseApp, isFirebaseConfigured } from "./client";

/** Hardcoded passphrase sent to Cloud Function (must match `functions/src/index.ts`). */
export const ADMIN_SCORE_SYNC_SECRET = "ViratAnushka";

export type AdminScoreSyncResponse = {
  ok: boolean;
  matchLabel: string;
  matchKey: string;
  matchDate: string;
  /** ESPN full scorecard URL (single source of truth). */
  scorecardUrl: string;
  source: "espncricinfo";
  scorecardComplete: boolean;
  validated: boolean;
  playerPoints: Record<string, number>;
  inconsistencies: string[];
  warnings: string[];
  wroteFirestore: boolean;
  note?: string;
  /** Distinct names on the ESPN scorecard (batting + bowling). */
  scorecardUniquePlayerCount?: number;
  /** Normalized ESPN names with no single league roster/waiver match. */
  unmappedScorecardNames?: string[];
};

function functionsRegion(): string {
  return import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || "asia-south1";
}

export async function callAdminScoreSync(params: {
  matchQuery: string;
  matchDateYmd: string;
  /** Defaults to true. */
  writeToFirestore?: boolean;
}): Promise<AdminScoreSyncResponse> {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env).");
  }
  const { getFunctions, httpsCallable } = await import("firebase/functions");
  const app = await getFirebaseApp();
  const fns = getFunctions(app, functionsRegion());
  const fn = httpsCallable(fns, "adminSyncMatchScores");
  const res = await fn({
    matchQuery: params.matchQuery,
    matchDateYmd: params.matchDateYmd,
    adminSyncSecret: ADMIN_SCORE_SYNC_SECRET,
    writeToFirestore: params.writeToFirestore !== false,
  });
  return res.data as AdminScoreSyncResponse;
}

export type AdminResetFantasyResponse = {
  ok: boolean;
  message?: string;
};

export async function callAdminResetFantasyMatchScores(): Promise<AdminResetFantasyResponse> {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env).");
  }
  const { getFunctions, httpsCallable } = await import("firebase/functions");
  const app = await getFirebaseApp();
  const fns = getFunctions(app, functionsRegion());
  const fn = httpsCallable(fns, "adminResetFantasyMatchScores");
  const res = await fn({
    adminSyncSecret: ADMIN_SCORE_SYNC_SECRET,
  });
  return res.data as AdminResetFantasyResponse;
}
