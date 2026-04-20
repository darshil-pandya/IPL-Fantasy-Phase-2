export const PREDICTION_ACTUALS_EVENT = "ipl-pred-actuals";

export function notifyPredictionActualsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PREDICTION_ACTUALS_EVENT));
  }
}
