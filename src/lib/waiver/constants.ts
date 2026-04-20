export const WAIVER_BUDGET_START = 250_000;
export const WAIVER_BID_INCREMENT = 5_000;
/** Nomination window length after round start (4.5 hours). */
export const WAIVER_NOMINATION_WINDOW_MS = Math.round(4.5 * 60 * 60 * 1000);
export const WAIVER_STATE_VERSION = 2 as const;
export const WAIVER_LS_KEY = "ipl-fantasy-waiver-state-v1";
export const WAIVER_SESSION_LS_KEY = "ipl-fantasy-waiver-session-v1";
