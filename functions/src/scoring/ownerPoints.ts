import type {
  OwnershipPeriodDoc,
  MatchPlayerPointDoc,
} from "../models/types.js";

export interface PeriodBreakdown {
  acquiredAt: string;
  releasedAt: string | null;
  points: number;
}

export interface PlayerPointsBreakdown {
  playerId: string;
  name: string;
  pointsContributed: number;
  periods: PeriodBreakdown[];
}

export interface OwnerPointsResult {
  ownerId: string;
  totalPoints: number;
  breakdownByPlayer: PlayerPointsBreakdown[];
}

/**
 * Pure computation: sum match points that fall within active ownership periods.
 *
 * A match counts for an owner if:
 *   period.acquiredAt <= matchPlayedAt
 *   AND (period.releasedAt is null OR matchPlayedAt < period.releasedAt)
 */
export function calculateOwnerPoints(
  ownerId: string,
  ownershipPeriods: OwnershipPeriodDoc[],
  matchPlayerPoints: MatchPlayerPointDoc[],
  playerNames: Map<string, string>,
): OwnerPointsResult {
  const ownerPeriods = ownershipPeriods.filter((p) => p.ownerId === ownerId);

  // Group periods by playerId
  const periodsByPlayer = new Map<string, OwnershipPeriodDoc[]>();
  for (const p of ownerPeriods) {
    const arr = periodsByPlayer.get(p.playerId) ?? [];
    arr.push(p);
    periodsByPlayer.set(p.playerId, arr);
  }

  // Index match points by playerId for fast lookup
  const matchPointsByPlayer = new Map<string, MatchPlayerPointDoc[]>();
  for (const mp of matchPlayerPoints) {
    const arr = matchPointsByPlayer.get(mp.playerId) ?? [];
    arr.push(mp);
    matchPointsByPlayer.set(mp.playerId, arr);
  }

  let totalPoints = 0;
  const breakdownByPlayer: PlayerPointsBreakdown[] = [];

  for (const [playerId, periods] of periodsByPlayer) {
    const playerMatches = matchPointsByPlayer.get(playerId) ?? [];
    let playerTotal = 0;
    const periodBreakdowns: PeriodBreakdown[] = [];

    for (const period of periods) {
      let periodPts = 0;

      for (const mp of playerMatches) {
        if (isMatchInPeriod(mp.matchPlayedAt, period)) {
          periodPts += mp.points;
        }
      }

      periodPts = Math.round(periodPts * 100) / 100;
      periodBreakdowns.push({
        acquiredAt: period.acquiredAt,
        releasedAt: period.releasedAt,
        points: periodPts,
      });
      playerTotal += periodPts;
    }

    playerTotal = Math.round(playerTotal * 100) / 100;
    if (playerTotal !== 0 || periodBreakdowns.length > 0) {
      breakdownByPlayer.push({
        playerId,
        name: playerNames.get(playerId) ?? playerId,
        pointsContributed: playerTotal,
        periods: periodBreakdowns,
      });
      totalPoints += playerTotal;
    }
  }

  totalPoints = Math.round(totalPoints * 100) / 100;

  breakdownByPlayer.sort((a, b) => b.pointsContributed - a.pointsContributed);

  return { ownerId, totalPoints, breakdownByPlayer };
}

function isMatchInPeriod(matchPlayedAt: string, period: OwnershipPeriodDoc): boolean {
  return (
    period.acquiredAt <= matchPlayedAt &&
    (period.releasedAt === null || matchPlayedAt < period.releasedAt)
  );
}
