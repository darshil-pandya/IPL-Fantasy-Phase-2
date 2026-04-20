/**
 * Fetch listed IPL 2026 scorecards, collect ESPN batter/bowler display names,
 * resolve with the same logic as admin score sync (heuristics + squad alias JSON).
 *
 * Run: npx tsx scripts/auditScorecardNameMapping.ts
 *
 * Writes:
 *   reports/scorecard-name-audit/league_players_vs_espn_scorecards.csv
 *   reports/scorecard-name-audit/unmapped_espn_scorecard_names.csv
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { extractNextDataJson } from "../functions/src/scrape/espn.js";
import { fetchEspnScorecard, espnMatchTitleFromHtml } from "../functions/src/scrape/espn.js";
import {
  normalizePlayerName,
  resolveLeaguePlayerIdForScorecardName,
} from "../functions/src/util/names.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SCORECARD_PATHS = [
  "/series/ipl-2026-1510719/royal-challengers-bengaluru-vs-sunrisers-hyderabad-1st-match-1527674/full-scorecard",
  "/series/ipl-2026-1510719/mumbai-indians-vs-kolkata-knight-riders-2nd-match-1527675/full-scorecard",
  "/series/ipl-2026-1510719/rajasthan-royals-vs-chennai-super-kings-3rd-match-1527676/full-scorecard",
  "/series/ipl-2026-1510719/punjab-kings-vs-gujarat-titans-4th-match-1527677/full-scorecard",
  "/series/ipl-2026-1510719/lucknow-super-giants-vs-delhi-capitals-5th-match-1527678/full-scorecard",
  "/series/ipl-2026-1510719/kolkata-knight-riders-vs-sunrisers-hyderabad-6th-match-1527679/full-scorecard",
  "/series/ipl-2026-1510719/chennai-super-kings-vs-punjab-kings-7th-match-1527680/full-scorecard",
  "/series/ipl-2026-1510719/delhi-capitals-vs-mumbai-indians-8th-match-1527681/full-scorecard",
  "/series/ipl-2026-1510719/gujarat-titans-vs-rajasthan-royals-9th-match-1527682/full-scorecard",
];

type LeagueRow = { id: string; name: string };

function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function loadLeagueRows(): LeagueRow[] {
  const byId = new Map<string, LeagueRow>();
  const add = (p: { id?: string; name?: string }) => {
    if (!p?.id || !p?.name || byId.has(p.id)) return;
    byId.set(p.id, { id: p.id, name: p.name });
  };
  const pj = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public/IPL-Fantasy-Phase-2/data/players.json"), "utf8"),
  ) as { players: LeagueRow[] };
  const wj = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public/IPL-Fantasy-Phase-2/data/waiver-pool.json"), "utf8"),
  ) as { players: LeagueRow[] };
  for (const p of pj.players) add(p);
  for (const p of wj.players) add(p);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function buildNameToIds(rows: LeagueRow[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of rows) {
    const k = normalizePlayerName(p.name);
    const arr = m.get(k) ?? [];
    arr.push(p.id);
    m.set(k, arr);
  }
  return m;
}

function loadSquadAliases(): Record<string, string> {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "functions/src/data/espnSquadNameToLeaguePlayerId.json"),
      "utf8",
    ),
  ) as { normalizedDisplayNameToLeaguePlayerId?: Record<string, string> };
  return raw.normalizedDisplayNameToLeaguePlayerId ?? {};
}

function resolveToLeagueId(
  norm: string,
  nameToIds: Map<string, string[]>,
  rows: LeagueRow[],
  squadAliases: Record<string, string>,
): string | null {
  let id = resolveLeaguePlayerIdForScorecardName(norm, nameToIds, rows);
  if (!id) {
    const alt = squadAliases[norm];
    if (alt && rows.some((r) => r.id === alt)) id = alt;
  }
  return id;
}

/** norm -> { rawNames, matches: [{ path, title }] } */
function collectFromHtml(
  html: string,
  scorecardPath: string,
  matchTitle: string,
): Map<string, { rawNames: Set<string>; matches: { path: string; title: string }[] }> {
  const j = extractNextDataJson(html);
  const innings = j?.props?.appPageProps?.data?.content?.innings;
  if (!Array.isArray(innings)) throw new Error("ESPN innings missing");

  const out = new Map<
    string,
    { rawNames: Set<string>; matches: { path: string; title: string }[] }
  >();

  function note(norm: string, raw: string): void {
    let o = out.get(norm);
    if (!o) {
      o = { rawNames: new Set(), matches: [] };
      out.set(norm, o);
    }
    o.rawNames.add(raw);
    if (!o.matches.some((m) => m.path === scorecardPath)) {
      o.matches.push({ path: scorecardPath, title: matchTitle });
    }
  }

  for (const inn of innings) {
    for (const row of inn.inningBatsmen ?? []) {
      const name = row?.player?.name as string | undefined;
      if (!name) continue;
      note(normalizePlayerName(name), name.trim());
    }
    for (const row of inn.inningBowlers ?? []) {
      const name = row?.player?.name as string | undefined;
      if (!name) continue;
      note(normalizePlayerName(name), name.trim());
    }
  }
  return out;
}

function mergeGlobal(
  global: Map<string, { rawNames: Set<string>; matches: { path: string; title: string }[] }>,
  local: Map<string, { rawNames: Set<string>; matches: { path: string; title: string }[] }>,
): void {
  for (const [norm, v] of local) {
    let g = global.get(norm);
    if (!g) {
      g = { rawNames: new Set(), matches: [] };
      global.set(norm, g);
    }
    for (const r of v.rawNames) g.rawNames.add(r);
    for (const m of v.matches) {
      if (!g.matches.some((x) => x.path === m.path)) g.matches.push(m);
    }
  }
}

function main(): void {
  void (async () => {
    const rows = loadLeagueRows();
    const nameToIds = buildNameToIds(rows);
    const squadAliases = loadSquadAliases();

    const global = new Map<
      string,
      { rawNames: Set<string>; matches: { path: string; title: string }[] }
    >();

    for (const pth of SCORECARD_PATHS) {
      const html = await fetchEspnScorecard(pth);
      const title = espnMatchTitleFromHtml(html) || pth;
      const local = collectFromHtml(html, pth, title);
      mergeGlobal(global, local);
    }

    const leagueIdToEspnRaws = new Map<string, Set<string>>();
    const leagueIdToMatches = new Map<string, Set<string>>();
    const unmapped: {
      norm: string;
      rawNames: string[];
      matches: string;
    }[] = [];

    for (const [norm, { rawNames, matches }] of global) {
      const id = resolveToLeagueId(norm, nameToIds, rows, squadAliases);
      if (!id) {
        unmapped.push({
          norm,
          rawNames: [...rawNames].sort(),
          matches: matches.map((m) => m.title).join(" | "),
        });
        continue;
      }
      let rs = leagueIdToEspnRaws.get(id);
      if (!rs) {
        rs = new Set();
        leagueIdToEspnRaws.set(id, rs);
      }
      for (const r of rawNames) rs.add(r);
      let ms = leagueIdToMatches.get(id);
      if (!ms) {
        ms = new Set();
        leagueIdToMatches.set(id, ms);
      }
      for (const m of matches) ms.add(m.title);
    }

    const outDir = path.join(ROOT, "reports/scorecard-name-audit");
    fs.mkdirSync(outDir, { recursive: true });

    const leagueCsv = [
      [
        "league_player_id",
        "league_player_name",
        "espn_scorecard_display_names",
        "matches_where_appeared",
        "on_these_scorecards",
      ].join(","),
    ];
    for (const p of rows) {
      const raws = leagueIdToEspnRaws.get(p.id);
      const mt = leagueIdToMatches.get(p.id);
      leagueCsv.push(
        [
          csvCell(p.id),
          csvCell(p.name),
          csvCell(raws ? [...raws].sort().join("; ") : ""),
          csvCell(mt ? String(mt.size) : "0"),
          csvCell(mt ? [...mt].sort().join("; ") : ""),
        ].join(","),
      );
    }
    fs.writeFileSync(path.join(outDir, "league_players_vs_espn_scorecards.csv"), leagueCsv.join("\n"), "utf8");

    unmapped.sort((a, b) => a.norm.localeCompare(b.norm));
    const unmappedCsv = [
      [
        "espn_normalized_key",
        "espn_display_names_seen",
        "match_titles",
        "scorecard_paths",
      ].join(","),
    ];
    for (const u of unmapped) {
      const m = [...global.get(u.norm)!.matches];
      unmappedCsv.push(
        [
          csvCell(u.norm),
          csvCell(u.rawNames.join("; ")),
          csvCell(m.map((x) => x.title).join(" | ")),
          csvCell(m.map((x) => x.path).join(" | ")),
        ].join(","),
      );
    }
    fs.writeFileSync(path.join(outDir, "unmapped_espn_scorecard_names.csv"), unmappedCsv.join("\n"), "utf8");

    console.log(
      JSON.stringify(
        {
          scorecardsFetched: SCORECARD_PATHS.length,
          distinctEspnNormKeys: global.size,
          leaguePlayers: rows.length,
          mappedNormKeys: global.size - unmapped.length,
          unmappedNormKeys: unmapped.length,
          outDir: path.relative(ROOT, outDir),
        },
        null,
        2,
      ),
    );
  })();
}

main();
