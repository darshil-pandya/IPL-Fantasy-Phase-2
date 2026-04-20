import type { Franchise } from "../../types";
import type { RosterChangeEvent, WaiverPersistentState } from "./types";
import {
  WAIVER_BUDGET_START,
  WAIVER_STATE_VERSION,
} from "./constants";

export function seedWaiverState(franchises: Franchise[]): WaiverPersistentState {
  const rosters: Record<string, string[]> = {};
  const budgets: Record<string, number> = {};
  const pointCarryover: Record<string, number> = {};
  const joinSnapshot: Record<string, number> = {};
  const rosterHistory: RosterChangeEvent[] = [];
  for (const f of franchises) {
    rosters[f.owner] = [...f.playerIds];
    budgets[f.owner] = WAIVER_BUDGET_START;
    pointCarryover[f.owner] = 0;
  }
  return {
    version: WAIVER_STATE_VERSION,
    roundId: 0,
    phase: "idle",
    rosters,
    budgets,
    pointCarryover,
    joinSnapshot,
    rosterHistory,
    nominations: [],
    bids: [],
    log: [],
  };
}

export function rosterMapFromFranchises(
  franchises: Franchise[],
): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const f of franchises) m[f.owner] = [...f.playerIds];
  return m;
}
