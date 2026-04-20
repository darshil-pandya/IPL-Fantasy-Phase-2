import type { PredictionActuals, PredictionsState, PredictionPick } from "../types";

const LS_KEY = "ipl-fantasy-prediction-actuals-v1";

function normTeam(s: string): string {
  return s.trim().toUpperCase();
}

function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function loadStoredActuals(): Partial<PredictionActuals> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<PredictionActuals>;
  } catch {
    return null;
  }
}

export function saveStoredActuals(actuals: PredictionActuals): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(actuals));
}

/** Merge JSON file actuals with optional browser overrides (commissioner preview). */
export function mergeActuals(
  base: PredictionActuals,
  overrides: Partial<PredictionActuals> | null,
): PredictionActuals {
  if (!overrides) return { ...base };
  return {
    winner:
      overrides.winner !== undefined ? overrides.winner : base.winner,
    runnerUp:
      overrides.runnerUp !== undefined ? overrides.runnerUp : base.runnerUp,
    orangeCap:
      overrides.orangeCap !== undefined ? overrides.orangeCap : base.orangeCap,
    purpleCap:
      overrides.purpleCap !== undefined ? overrides.purpleCap : base.purpleCap,
  };
}

export function countCorrectPicks(
  pick: PredictionPick,
  actuals: PredictionActuals,
): number {
  let n = 0;
  if (actuals.winner && normTeam(pick.winner) === normTeam(actuals.winner)) n++;
  if (actuals.runnerUp && normTeam(pick.runnerUp) === normTeam(actuals.runnerUp)) n++;
  if (
    actuals.orangeCap &&
    normName(pick.orangeCap) === normName(actuals.orangeCap)
  )
    n++;
  if (
    actuals.purpleCap &&
    normName(pick.purpleCap) === normName(actuals.purpleCap)
  )
    n++;
  return n;
}

export function predictionScore(
  pick: PredictionPick | undefined,
  actuals: PredictionActuals,
  pointsPerCorrect: number,
): number {
  if (!pick) return 0;
  return countCorrectPicks(pick, actuals) * pointsPerCorrect;
}

export function pickForOwner(
  predictions: PredictionsState,
  owner: string,
): PredictionPick | undefined {
  return predictions.picks.find((p) => p.owner === owner);
}

export function exportActualsJson(actuals: PredictionActuals): string {
  return JSON.stringify({ actuals }, null, 2);
}
