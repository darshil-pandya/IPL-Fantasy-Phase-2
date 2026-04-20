import { getFirestore } from "firebase-admin/firestore";
import espnSquadNameData from "../data/espnSquadNameToLeaguePlayerId.json" with { type: "json" };
import {
  discoverEspnMatch,
  espnDismissalAsString,
  extractInningsFromScorecardHtml,
  espnMatchStartIso,
  espnMatchTitleFromHtml,
  espnScorecardLooksComplete,
  fetchEspnScorecard,
  parseEspnScorecardHtml,
  type EspnBatterAgg,
  type EspnBowlerAgg,
} from "../scrape/espn.js";
import {
  normalizePlayerName,
  resolveLeaguePlayerIdForScorecardName,
} from "../util/names.js";
import {
  compactFantasyBreakdownForFirestore,
  fantasyBreakdownForPlayer,
  sumComputedFantasyBreakdown,
  type Role,
} from "../scoring/points.js";
import {
  mergeFieldingRollupsIntoBreakdown,
  rollUpFieldingTalliesToLeagueIds,
  tallyEspnScorecardFielding,
} from "../scoring/fieldingFromScorecard.js";
import { statFromEspn } from "../scoring/mergeStats.js";

export type LeaguePlayerRow = {
  id: string;
  name: string;
  role: Role;
};

export type SyncDiagnostics = {
  /** Raw fielding tallies keyed by ESPN normalized name (before league-ID resolution). */
  espnFieldingTallies: {
    catches: Record<string, number>;
    stumpings: Record<string, number>;
    runOutDirect: Record<string, number>;
    runOutAssist: Record<string, number>;
    appearedInScorecard: string[];
  };
  /** Shows which fielding norms resolved to a league ID and which were dropped. */
  fieldingResolution: {
    resolved: Record<string, string>;
    unresolved: string[];
  };
  /** Per-player fantasy breakdown (all categories, before summing). */
  playerBreakdowns: Record<string, Record<string, number>>;
  /** Raw ESPN batting stats by normalized name. */
  espnBatters: Record<string, {
    runs: number; balls: number; fours: number; sixes: number;
    isOut: boolean; dismissalText: string;
  }>;
  /** Raw ESPN bowling stats by normalized name. */
  espnBowlers: Record<string, {
    balls: number; maidens: number; conceded: number;
    wickets: number; dots: number;
  }>;
};

export type AdminSyncResult = {
  ok: boolean;
  matchLabel: string;
  matchKey: string;
  matchDate: string;
  scorecardUrl: string;
  source: "espncricinfo";
  scorecardComplete: boolean;
  validated: boolean;
  playerPoints: Record<string, number>;
  inconsistencies: string[];
  warnings: string[];
  wroteFirestore: boolean;
  note?: string;
  /** How many distinct batter/bowler names ESPN returned (union of batting + bowling tables). */
  scorecardUniquePlayerCount: number;
  /** ESPN normalized names that did not map to exactly one league roster / waiver player. */
  unmappedScorecardNames: string[];
  diagnostics?: SyncDiagnostics;
};

function mergeBattersForNorms(
  norms: string[],
  batters: Map<string, EspnBatterAgg>,
): EspnBatterAgg | undefined {
  let acc: EspnBatterAgg | undefined;
  for (const n of norms) {
    const b = batters.get(n);
    if (!b) continue;
    if (!acc) acc = { ...b };
    else {
      acc = {
        runs: acc.runs + b.runs,
        balls: acc.balls + b.balls,
        fours: acc.fours + b.fours,
        sixes: acc.sixes + b.sixes,
        isOut: acc.isOut || b.isOut,
        dismissalType: acc.dismissalType ?? b.dismissalType,
        dismissalText: acc.dismissalText || b.dismissalText,
      };
    }
  }
  return acc;
}

function mergeBowlersForNorms(
  norms: string[],
  bowlers: Map<string, EspnBowlerAgg>,
): EspnBowlerAgg | undefined {
  let acc: EspnBowlerAgg | undefined;
  for (const n of norms) {
    const b = bowlers.get(n);
    if (!b) continue;
    if (!acc) acc = { ...b };
    else {
      acc = {
        balls: acc.balls + b.balls,
        maidens: acc.maidens + b.maidens,
        conceded: acc.conceded + b.conceded,
        wickets: acc.wickets + b.wickets,
        dots: acc.dots + b.dots,
      };
    }
  }
  return acc;
}

function dismissalRowsFromEspn(batters: Map<string, EspnBatterAgg>): { dismissal: string }[] {
  const out: { dismissal: string }[] = [];
  for (const b of batters.values()) {
    const t = espnDismissalAsString(b.dismissalText);
    if (t.trim()) out.push({ dismissal: t });
  }
  return out;
}

function buildNameToIds(players: LeaguePlayerRow[]): {
  map: Map<string, string[]>;
  dupes: string[];
} {
  const map = new Map<string, string[]>();
  for (const p of players) {
    const k = normalizePlayerName(p.name);
    const arr = map.get(k) ?? [];
    arr.push(p.id);
    map.set(k, arr);
  }
  const dupes: string[] = [];
  for (const [k, ids] of map) {
    if (ids.length > 1) dupes.push(`${k} → ${ids.join(", ")}`);
  }
  return { map, dupes };
}

function stableMatchKey(path: string): string {
  return `espn_${path.replace(/\//g, "_").replace(/^\/+/, "")}`;
}

const ESPN_SQUAD_NORM_TO_LEAGUE_ID: Record<string, string> =
  (espnSquadNameData as { normalizedDisplayNameToLeaguePlayerId?: Record<string, string> })
    .normalizedDisplayNameToLeaguePlayerId ?? {};

export async function runAdminScoreSync(opts: {
  matchQuery: string;
  matchDateYmd: string;
  writeToFirestore: boolean;
}): Promise<AdminSyncResult> {
  const inconsistencies: string[] = [];
  const warnings: string[] = [];
  const matchQuery = opts.matchQuery.trim();
  const matchDateYmd = opts.matchDateYmd.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDateYmd)) {
    return {
      ok: false,
      matchLabel: matchQuery,
      matchKey: "",
      matchDate: "",
      scorecardUrl: "",
      source: "espncricinfo",
      scorecardComplete: false,
      validated: false,
      playerPoints: {},
      inconsistencies: ["Invalid matchDate (use YYYY-MM-DD)."],
      warnings: [],
      wroteFirestore: false,
      scorecardUniquePlayerCount: 0,
      unmappedScorecardNames: [],
    };
  }

  const esPick = await discoverEspnMatch(matchQuery, matchDateYmd);
  if (!esPick) {
    return {
      ok: false,
      matchLabel: matchQuery,
      matchKey: "",
      matchDate: `${matchDateYmd}T00:00:00.000Z`,
      scorecardUrl: "",
      source: "espncricinfo",
      scorecardComplete: false,
      validated: false,
      playerPoints: {},
      inconsistencies: [
        "ESPNcricinfo: no IPL 2026 fixture matched this query and date. Check the match date (IST), team abbreviations (e.g. CSK vs RR), and that the season fixtures URL in the Cloud Function still matches ESPN.",
      ],
      warnings: [],
      wroteFirestore: false,
      scorecardUniquePlayerCount: 0,
      unmappedScorecardNames: [],
    };
  }

  const scorecardUrl = `https://www.espncricinfo.com${esPick.path}`;
  const esHtml = await fetchEspnScorecard(esPick.path);

  const scorecardComplete = espnScorecardLooksComplete(esHtml);
  if (!scorecardComplete) {
    warnings.push(
      "This match does not look finished on ESPN (state/status). Firestore write is disabled until the match is complete.",
    );
  }

  const esParsed = parseEspnScorecardHtml(esHtml);
  const dismissEs = dismissalRowsFromEspn(esParsed.batters);

  const db = getFirestore();
  const leagueSnap = await db.doc("iplFantasy/leagueBundle").get();
  const payload = leagueSnap.data()?.payload as
    | { players?: LeaguePlayerRow[]; waiverPool?: LeaguePlayerRow[] }
    | undefined;

  const rows: LeaguePlayerRow[] = [];
  const seenId = new Set<string>();
  function pushRow(p: { id?: string; name?: string; role?: string }): void {
    if (!p?.id || !p?.name || !p?.role) return;
    if (seenId.has(p.id)) return;
    const role = p.role;
    if (role !== "BAT" && role !== "BOWL" && role !== "AR" && role !== "WK") return;
    seenId.add(p.id);
    rows.push({ id: p.id, name: p.name, role });
  }
  if (payload?.players) {
    for (const p of payload.players) pushRow(p);
  }
  if (payload?.waiverPool) {
    for (const p of payload.waiverPool) pushRow(p);
  }

  if (rows.length === 0) {
    inconsistencies.push(
      "Firestore iplFantasy/leagueBundle has no players — cannot map scorecard names to ids.",
    );
  }

  const { map: nameToIds, dupes } = buildNameToIds(rows);
  for (const d of dupes) {
    warnings.push(`Duplicate normalized name in roster (skipped auto-map): ${d}`);
  }

  const keys = new Set<string>();
  for (const k of esParsed.batters.keys()) keys.add(k);
  for (const k of esParsed.bowlers.keys()) keys.add(k);
  const scorecardUniquePlayerCount = keys.size;

  function resolveLeagueId(esNorm: string): string | null {
    let id = resolveLeaguePlayerIdForScorecardName(esNorm, nameToIds, rows);
    if (!id) {
      const fromSquad = ESPN_SQUAD_NORM_TO_LEAGUE_ID[esNorm];
      if (fromSquad && rows.some((r) => r.id === fromSquad)) id = fromSquad;
    }
    return id;
  }

  const innings = extractInningsFromScorecardHtml(esHtml);
  const fieldTallies = tallyEspnScorecardFielding(innings);
  const fieldRoll = rollUpFieldingTalliesToLeagueIds(fieldTallies, resolveLeagueId);

  // Collect fielding resolution diagnostics
  const allFieldingNorms = new Set<string>();
  for (const m of [fieldTallies.catchesByNorm, fieldTallies.stumpingsByNorm,
    fieldTallies.runOutDirectByNorm, fieldTallies.runOutAssistByNorm]) {
    for (const k of m.keys()) allFieldingNorms.add(k);
  }
  const fieldingResolved: Record<string, string> = {};
  const fieldingUnresolved: string[] = [];
  for (const norm of allFieldingNorms) {
    const id = resolveLeagueId(norm);
    if (id) fieldingResolved[norm] = id;
    else fieldingUnresolved.push(norm);
  }
  if (fieldingUnresolved.length > 0) {
    warnings.push(
      `${fieldingUnresolved.length} fielding name(s) could not be mapped to a league player and were dropped: ${fieldingUnresolved.join(", ")}`,
    );
  }

  const playerPoints: Record<string, number> = {};
  const playerBreakdown: Record<string, Record<string, number>> = {};
  const unmappedScorecardNames: string[] = [];
  let validated = true;

  for (const norm of keys) {
    const id = resolveLeagueId(norm);
    if (!id) unmappedScorecardNames.push(norm);
  }

  const allLeagueIds = new Set<string>();
  for (const norm of keys) {
    const id = resolveLeagueId(norm);
    if (id) allLeagueIds.add(id);
  }
  for (const m of [
    fieldRoll.catchCount,
    fieldRoll.stumpingCount,
    fieldRoll.runOutDirectCount,
    fieldRoll.runOutAssistCount,
  ]) {
    for (const id of m.keys()) allLeagueIds.add(id);
  }
  for (const id of fieldRoll.appearedIds) allLeagueIds.add(id);

  for (const id of allLeagueIds) {
    const leagueRow = rows.find((r) => r.id === id);
    if (!leagueRow) continue;

    const normsFor = [...keys].filter((n) => resolveLeagueId(n) === id);
    const bowlNorm = normsFor.find((n) => esParsed.bowlers.has(n)) ?? "";

    const esBat = mergeBattersForNorms(normsFor, esParsed.batters);
    const esBowl = mergeBowlersForNorms(normsFor, esParsed.bowlers);
    const stEs = statFromEspn(esBat, esBowl);

    const hasBowl = (esBowl?.balls ?? 0) > 0 || (esBowl?.wickets ?? 0) > 0;
    const breakdown = fantasyBreakdownForPlayer(leagueRow.role, stEs, hasBowl
      ? {
          allDismissals: dismissEs,
          playerNorm: bowlNorm,
        }
      : undefined);

    mergeFieldingRollupsIntoBreakdown(breakdown, fieldRoll, id);

    const total = Math.round(sumComputedFantasyBreakdown(breakdown) * 100) / 100;
    if (total !== 0) playerPoints[id] = total;
    const slice = compactFantasyBreakdownForFirestore(breakdown);
    if (Object.keys(slice).length > 0) playerBreakdown[id] = slice;
  }

  const matchKey = stableMatchKey(esPick.path);
  const title = espnMatchTitleFromHtml(esHtml);
  const matchLabel = title || esPick.label.replace(/-/g, " ");
  const matchDate = espnMatchStartIso(esHtml) ?? `${matchDateYmd}T12:00:00.000Z`;

  const scoredIds = Object.keys(playerPoints).length;
  if (rows.length > 0 && scoredIds === 0) {
    validated = false;
    inconsistencies.push(
      "No league roster players matched the ESPN scorecard — check display names vs ESPN.",
    );
  }

  if (unmappedScorecardNames.length > 0) {
    warnings.push(
      `${unmappedScorecardNames.length} scorecard player(s) were not mapped to your league roster or waiver pool (names use ESPN’s scorecard spelling; only owned players get points here).`,
    );
  }

  let wroteFirestore = false;
  const canWrite =
    opts.writeToFirestore &&
    validated &&
    inconsistencies.length === 0 &&
    scorecardComplete &&
    rows.length > 0 &&
    scoredIds > 0;

  if (canWrite) {
    const ref = db.doc("iplFantasy/fantasyMatchScores");
    await ref.set(
      {
        matches: {
          [matchKey]: {
            matchKey,
            matchLabel,
            matchDate,
            status: "final",
            playerPoints,
            playerBreakdown,
          },
        },
      },
      { merge: true },
    );

    // Dual-write: individual matchPlayerPoints docs for the new collection model
    const mppBatch = db.batch();
    for (const [pid, pts] of Object.entries(playerPoints)) {
      const recordId = `${matchKey}_${pid}`;
      mppBatch.set(db.collection("matchPlayerPoints").doc(recordId), {
        recordId,
        playerId: pid,
        matchId: matchKey,
        matchPlayedAt: matchDate,
        points: pts,
      });
    }
    await mppBatch.commit();

    wroteFirestore = true;
  } else if (opts.writeToFirestore) {
    warnings.push(
      "Firestore write skipped: resolve blocking issues, ensure the match is complete on ESPN, and that leagueBundle has players.",
    );
  }

  const note =
    "Points are derived from ESPNcricinfo scorecards. Catches, stumpings, and run-outs use dismissal JSON. Everyone listed on the batting or bowling card gets a single +4 playing-XII bonus (namedInXi); impact/concussion is not awarded separately.";

  const mapToObj = (m: Map<string, number>): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const [k, v] of m) o[k] = v;
    return o;
  };

  const espnBattersObj: SyncDiagnostics["espnBatters"] = {};
  for (const [norm, agg] of esParsed.batters) {
    espnBattersObj[norm] = {
      runs: agg.runs, balls: agg.balls, fours: agg.fours, sixes: agg.sixes,
      isOut: agg.isOut, dismissalText: espnDismissalAsString(agg.dismissalText),
    };
  }
  const espnBowlersObj: SyncDiagnostics["espnBowlers"] = {};
  for (const [norm, agg] of esParsed.bowlers) {
    espnBowlersObj[norm] = {
      balls: agg.balls, maidens: agg.maidens, conceded: agg.conceded,
      wickets: agg.wickets, dots: agg.dots,
    };
  }

  const diagnostics: SyncDiagnostics = {
    espnFieldingTallies: {
      catches: mapToObj(fieldTallies.catchesByNorm),
      stumpings: mapToObj(fieldTallies.stumpingsByNorm),
      runOutDirect: mapToObj(fieldTallies.runOutDirectByNorm),
      runOutAssist: mapToObj(fieldTallies.runOutAssistByNorm),
      appearedInScorecard: [...fieldTallies.appearedInScorecardNorms].sort(),
    },
    fieldingResolution: { resolved: fieldingResolved, unresolved: fieldingUnresolved },
    playerBreakdowns: playerBreakdown,
    espnBatters: espnBattersObj,
    espnBowlers: espnBowlersObj,
  };

  return {
    ok: true,
    matchLabel,
    matchKey,
    matchDate,
    scorecardUrl,
    source: "espncricinfo",
    scorecardComplete,
    validated,
    playerPoints,
    inconsistencies,
    warnings,
    wroteFirestore,
    note,
    scorecardUniquePlayerCount,
    unmappedScorecardNames: [...unmappedScorecardNames].sort(),
    diagnostics,
  };
}
