/** Players not on any franchise roster. */
export function availablePlayerIds(rosters: Record<string, string[]>): Set<string> {
  const taken = new Set<string>();
  for (const ids of Object.values(rosters)) {
    for (const id of ids) taken.add(id);
  }
  return taken;
}

export function isPlayerAvailable(
  rosters: Record<string, string[]>,
  playerId: string,
): boolean {
  for (const ids of Object.values(rosters)) {
    if (ids.includes(playerId)) return false;
  }
  return true;
}
