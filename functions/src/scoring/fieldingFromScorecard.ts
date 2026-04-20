import { normalizePlayerName } from "../util/names.js";
import type { ComputedMatchFantasyPoints } from "./points.js";

/** Tallies keyed by `normalizePlayerName` (ESPN fielding / card names). */
export type EspnFieldingTallies = {
  catchesByNorm: Map<string, number>;
  stumpingsByNorm: Map<string, number>;
  runOutDirectByNorm: Map<string, number>;
  runOutAssistByNorm: Map<string, number>;
  /**
   * Anyone with a batting-card row or bowling row (incl. DNB, substitute lines) — treat as playing XII (+4 once).
   */
  appearedInScorecardNorms: Set<string>;
};

function fielderNorm(f: { player?: { longName?: string; fieldingName?: string; mobileName?: string; name?: string; battingName?: string } }): string | null {
  const p = f?.player;
  if (!p) return null;
  // Prefer longName ("Phil Salt") over fieldingName ("Salt") — bare surnames
  // fail league-ID resolution because the name map expects full names.
  const raw = p.longName || p.name || p.mobileName || p.fieldingName || p.battingName;
  if (!raw || typeof raw !== "string") return null;
  return normalizePlayerName(raw);
}

function runOutFielderNormsFromLong(longRaw: string): string[] {
  const m = longRaw.match(/run\s+out\s*\(([^)]*)\)/i);
  if (!m?.[1]) return [];
  const inner = m[1].trim();
  if (!inner) return [];
  return inner
    .split("/")
    .map((s) => s.replace(/^†\s*/u, "").trim())
    .filter(Boolean)
    .map((s) => normalizePlayerName(s));
}

function stumpingKeeperNormFromLong(longRaw: string): string | null {
  const t = longRaw.trim();
  const m = t.match(/^st\s*†?\s*(.+?)\s+b\s+/i);
  if (!m?.[1]) return null;
  return normalizePlayerName(m[1].trim());
}

function catchFromLong(longRaw: string): string | null {
  const t = longRaw.trim();
  if (/^st\b|^stumped/i.test(t)) return null;
  if (/run\s+out/i.test(t)) return null;
  let m = t.match(/^c\s*&\s*b\s+(.+)$/i);
  if (m?.[1]) return normalizePlayerName(m[1].trim());
  m = t.match(/^c\s+†?\s*(.+?)\s+b\s+/i);
  if (m?.[1]) return normalizePlayerName(m[1].trim());
  return null;
}

/**
 * Fielding tallies + “playing XII” set from ESPN innings JSON (batting + bowling tables).
 * Impact / concussion substitute bonus is not applied — anyone on the card shares the same +4 via {@code namedInXi}.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tallyEspnScorecardFielding(innings: any[]): EspnFieldingTallies {
  const catchesByNorm = new Map<string, number>();
  const stumpingsByNorm = new Map<string, number>();
  const runOutDirectByNorm = new Map<string, number>();
  const runOutAssistByNorm = new Map<string, number>();
  const appeared = new Set<string>();

  for (const inn of innings) {
    for (const row of inn.inningBatsmen ?? []) {
      const pname = row?.player?.name;
      if (typeof pname === "string" && pname.trim()) {
        appeared.add(normalizePlayerName(pname));
      }

      const dtRaw = row?.dismissalType;
      const dtNum = dtRaw == null || dtRaw === "" ? NaN : Number(dtRaw);
      const long = String(row?.dismissalText?.long ?? "").trim();
      const fielders = Array.isArray(row?.dismissalFielders) ? row.dismissalFielders : [];
      const isOut = row?.isOut === true;

      if (dtNum === 5 || /^st\b|^stumped/i.test(long)) {
        let got = false;
        for (const f of fielders) {
          const nn = fielderNorm(f);
          if (nn) {
            stumpingsByNorm.set(nn, (stumpingsByNorm.get(nn) ?? 0) + 1);
            got = true;
            break;
          }
        }
        if (!got) {
          const kn = stumpingKeeperNormFromLong(long);
          if (kn) stumpingsByNorm.set(kn, (stumpingsByNorm.get(kn) ?? 0) + 1);
        }
        continue;
      }

      if ((dtNum === 4 || /run\s+out/i.test(long)) && isOut) {
        const norms: string[] = [];
        for (const f of fielders) {
          const nn = fielderNorm(f);
          if (nn) norms.push(nn);
        }
        const fallback = norms.length === 0 ? runOutFielderNormsFromLong(long) : [];
        const use = norms.length > 0 ? norms : fallback;
        if (use.length === 1) {
          runOutDirectByNorm.set(use[0]!, (runOutDirectByNorm.get(use[0]!) ?? 0) + 1);
        } else if (use.length >= 2) {
          for (const n of use) {
            runOutAssistByNorm.set(n, (runOutAssistByNorm.get(n) ?? 0) + 1);
          }
        }
        continue;
      }

      if (dtNum === 1 && isOut) {
        let any = false;
        for (const f of fielders) {
          const nn = fielderNorm(f);
          if (nn) {
            catchesByNorm.set(nn, (catchesByNorm.get(nn) ?? 0) + 1);
            any = true;
          }
        }
        if (!any) {
          const cn = catchFromLong(long);
          if (cn) catchesByNorm.set(cn, (catchesByNorm.get(cn) ?? 0) + 1);
        }
      }
    }

    for (const row of inn.inningBowlers ?? []) {
      const pname = row?.player?.name;
      if (typeof pname === "string" && pname.trim()) {
        appeared.add(normalizePlayerName(pname));
      }
    }
  }

  return {
    catchesByNorm,
    stumpingsByNorm,
    runOutDirectByNorm,
    runOutAssistByNorm,
    appearedInScorecardNorms: appeared,
  };
}

function rollUpCountMap(
  m: Map<string, number>,
  resolve: (norm: string) => string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [norm, v] of m) {
    const id = resolve(norm);
    if (!id) continue;
    out.set(id, (out.get(id) ?? 0) + v);
  }
  return out;
}

function rollUpNormSetToIds(s: Set<string>, resolve: (norm: string) => string | null): Set<string> {
  const out = new Set<string>();
  for (const n of s) {
    const id = resolve(n);
    if (id) out.add(id);
  }
  return out;
}

export type FieldingRollupsByLeagueId = {
  catchCount: Map<string, number>;
  stumpingCount: Map<string, number>;
  runOutDirectCount: Map<string, number>;
  runOutAssistCount: Map<string, number>;
  appearedIds: Set<string>;
};

export function rollUpFieldingTalliesToLeagueIds(
  tallies: EspnFieldingTallies,
  resolveNormToLeagueId: (norm: string) => string | null,
): FieldingRollupsByLeagueId {
  return {
    catchCount: rollUpCountMap(tallies.catchesByNorm, resolveNormToLeagueId),
    stumpingCount: rollUpCountMap(tallies.stumpingsByNorm, resolveNormToLeagueId),
    runOutDirectCount: rollUpCountMap(tallies.runOutDirectByNorm, resolveNormToLeagueId),
    runOutAssistCount: rollUpCountMap(tallies.runOutAssistByNorm, resolveNormToLeagueId),
    appearedIds: rollUpNormSetToIds(tallies.appearedInScorecardNorms, resolveNormToLeagueId),
  };
}

/** Merge fielding and playing-XII points into an existing bat+bowl breakdown. */
export function mergeFieldingRollupsIntoBreakdown(
  breakdown: ComputedMatchFantasyPoints,
  roll: FieldingRollupsByLeagueId,
  leaguePlayerId: string,
): void {
  const catchC = roll.catchCount.get(leaguePlayerId) ?? 0;
  const stumpC = roll.stumpingCount.get(leaguePlayerId) ?? 0;
  const roD = roll.runOutDirectCount.get(leaguePlayerId) ?? 0;
  const roA = roll.runOutAssistCount.get(leaguePlayerId) ?? 0;

  if (catchC > 0) {
    breakdown.catches = (breakdown.catches ?? 0) + catchC * 8;
    if (catchC >= 3) breakdown.threeCatchBonus = (breakdown.threeCatchBonus ?? 0) + 4;
  }
  if (stumpC > 0) {
    breakdown.stumpings = (breakdown.stumpings ?? 0) + stumpC * 12;
  }
  if (roD > 0) {
    breakdown.runOutDirect = (breakdown.runOutDirect ?? 0) + roD * 12;
  }
  if (roA > 0) {
    breakdown.runOutAssist = (breakdown.runOutAssist ?? 0) + roA * 6;
  }
  if (roll.appearedIds.has(leaguePlayerId)) {
    breakdown.namedInXi = (breakdown.namedInXi ?? 0) + 4;
  }
}
