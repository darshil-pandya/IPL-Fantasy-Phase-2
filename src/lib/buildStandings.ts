import type { Franchise, FranchiseStanding, Player } from "../types";

export function playerMapFromList(players: Player[]): Map<string, Player> {
  const m = new Map<string, Player>();
  for (const p of players) m.set(p.id, p);
  return m;
}

export function buildStandings(
  franchises: Franchise[],
  players: Player[],
): FranchiseStanding[] {
  const pmap = playerMapFromList(players);
  return franchises.map((f) => {
    const playersResolved: Player[] = [];
    const missingPlayerIds: string[] = [];
    for (const id of f.playerIds) {
      const p = pmap.get(id);
      if (p) playersResolved.push(p);
      else missingPlayerIds.push(id);
    }
    const totalPoints = playersResolved.reduce((s, p) => s + p.seasonTotal, 0);
    return { ...f, totalPoints, playersResolved, missingPlayerIds };
  });
}

export function ownerForPlayerId(
  franchises: Franchise[],
  playerId: string,
): string | null {
  for (const f of franchises) {
    if (f.playerIds.includes(playerId)) return f.owner;
  }
  return null;
}
