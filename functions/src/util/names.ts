export function normalizePlayerName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*\(wk\)\s*/gi, " ")
    .replace(/\s*\(c\)\s*/gi, " ")
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

/** Tokens from user query e.g. "CSK vs RR" */
export function queryTokens(query: string): Set<string> {
  const ABBR: Record<string, string[]> = {
    csk: ["chennai", "super", "kings", "csk"],
    mi: ["mumbai", "indians", "mi"],
    rcb: ["royal", "challengers", "bengaluru", "bangalore", "rcb"],
    kkr: ["kolkata", "knight", "riders", "kkr"],
    dc: ["delhi", "capitals", "dc"],
    srh: ["sunrisers", "hyderabad", "srh"],
    pbks: ["punjab", "kings", "pbks", "pk"],
    lsg: ["lucknow", "giants", "lsg"],
    rr: ["rajasthan", "royals", "rr"],
    gt: ["gujarat", "titans", "gt"],
  };
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  const out = new Set<string>();
  for (const t of raw) {
    out.add(t);
    for (const syn of ABBR[t] ?? []) out.add(syn);
  }
  return out;
}

export function scoreAgainstTokens(tokens: Set<string>, haystack: string): number {
  const h = haystack.toLowerCase();
  let sc = 0;
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (h.includes(t)) sc += Math.min(t.length, 8);
  }
  return sc;
}

/** True for short tokens like "ybk", "dc" (no vowels) — typical ESPN abbreviation clusters. */
function looksLikeInitialCluster(token: string): boolean {
  if (token.length < 2 || token.length > 4) return false;
  return !/[aeiou]/.test(token);
}

/**
 * ESPN full-scorecard JSON often uses initials ("B Sai Sudharsan", "YB Jaiswal", "RA Jadeja").
 * Strip those so we can match league roster names ("Sai Sudharsan", "Yashasvi Jaiswal", …).
 */
export function collapseEspnStyleName(norm: string): string {
  const parts = norm
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let out = [...parts];
  while (out.length > 1 && out[0]!.length <= 2) {
    out = out.slice(1);
  }
  while (out.length > 1 && looksLikeInitialCluster(out[0]!)) {
    out = out.slice(1);
  }
  return out.join(" ");
}

type IdNameRow = { id: string; name: string };

/**
 * Map one ESPN normalized batter/bowler name to at most one league player id.
 * Returns null if ambiguous (duplicate roster names) or no match.
 */
export function resolveLeaguePlayerIdForScorecardName(
  esNorm: string,
  nameToIds: Map<string, string[]>,
  rows: IdNameRow[],
): string | null {
  const singleFromKey = (key: string): string | null => {
    const ids = nameToIds.get(key);
    if (ids?.length === 1) return ids[0]!;
    return null;
  };

  let id = singleFromKey(esNorm);
  if (id) return id;

  const collapsed = collapseEspnStyleName(esNorm);
  if (collapsed !== esNorm) {
    id = singleFromKey(collapsed);
    if (id) return id;
  }

  const candidates = new Set<string>();

  for (const r of rows) {
    const rn = normalizePlayerName(r.name);
    const ids = nameToIds.get(rn);
    if (ids?.length !== 1) continue;
    const pid = ids[0]!;
    if (esNorm === rn || esNorm.endsWith(" " + rn)) {
      candidates.add(pid);
    }
  }

  if (collapsed !== esNorm) {
    for (const r of rows) {
      const rn = normalizePlayerName(r.name);
      const ids = nameToIds.get(rn);
      if (ids?.length !== 1) continue;
      const pid = ids[0]!;
      if (rn === collapsed || rn.endsWith(" " + collapsed)) {
        candidates.add(pid);
      }
    }
  }

  if (candidates.size === 1) return [...candidates][0]!;
  return null;
}
