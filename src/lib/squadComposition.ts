/** BAT / BOWL / AR / WK counts plus overseas (OVS) for current squad list. */
export function squadCompositionFromPlayers(
  players: readonly { role: string; nationality?: string | null }[],
): { label: string; count: number }[] {
  const roleCounts: Record<string, number> = {};
  let ovsCount = 0;
  for (const p of players) {
    roleCounts[p.role] = (roleCounts[p.role] ?? 0) + 1;
    if (p.nationality === "OVS") ovsCount++;
  }
  return [
    { label: "BAT", count: roleCounts["BAT"] ?? 0 },
    { label: "BOWL", count: roleCounts["BOWL"] ?? 0 },
    { label: "AR", count: roleCounts["AR"] ?? 0 },
    { label: "WK", count: roleCounts["WK"] ?? 0 },
    { label: "OVS", count: ovsCount },
  ];
}
