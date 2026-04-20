import type { PlayerDoc } from "../models/types.js";
import {
  SQUAD_SIZE,
  MAX_PER_FRANCHISE,
  MAX_OVERSEAS,
  MIN_BAT_WK,
  MIN_BOWL,
  MIN_AR,
} from "../models/types.js";

export interface SquadValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates that a 15-player squad satisfies all composition rules.
 * Pure function — no Firestore I/O.
 */
export function validateSquadComposition(
  squad: Pick<PlayerDoc, "id" | "role" | "nationality" | "iplTeam">[],
): SquadValidationResult {
  const errors: string[] = [];

  if (squad.length !== SQUAD_SIZE) {
    errors.push(
      `Squad must have exactly ${SQUAD_SIZE} players, got ${squad.length}.`,
    );
  }

  // Franchise cap: max 3 from any single IPL team
  const franchiseCounts = new Map<string, number>();
  for (const p of squad) {
    franchiseCounts.set(p.iplTeam, (franchiseCounts.get(p.iplTeam) ?? 0) + 1);
  }
  for (const [team, count] of franchiseCounts) {
    if (count > MAX_PER_FRANCHISE) {
      errors.push(
        `Max ${MAX_PER_FRANCHISE} players from one IPL franchise; ${team} has ${count}.`,
      );
    }
  }

  // Overseas cap
  const overseasCount = squad.filter((p) => p.nationality === "OVS").length;
  if (overseasCount > MAX_OVERSEAS) {
    errors.push(
      `Max ${MAX_OVERSEAS} overseas players allowed; squad has ${overseasCount}.`,
    );
  }

  // Role minimums
  const batWkCount = squad.filter(
    (p) => p.role === "BAT" || p.role === "WK",
  ).length;
  const bowlCount = squad.filter((p) => p.role === "BOWL").length;
  const arCount = squad.filter((p) => p.role === "AR").length;

  if (batWkCount < MIN_BAT_WK) {
    errors.push(
      `Min ${MIN_BAT_WK} Batsmen + Wicketkeepers required; squad has ${batWkCount}.`,
    );
  }
  if (bowlCount < MIN_BOWL) {
    errors.push(
      `Min ${MIN_BOWL} Bowlers required; squad has ${bowlCount}.`,
    );
  }
  if (arCount < MIN_AR) {
    errors.push(
      `Min ${MIN_AR} All-Rounders required; squad has ${arCount}.`,
    );
  }

  return { valid: errors.length === 0, errors };
}
