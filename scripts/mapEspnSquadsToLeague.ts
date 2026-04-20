/**
 * One-off / refresh: fetch IPL 2026 ESPN squad pages and align with league JSON.
 * Run: npx tsx scripts/mapEspnSquadsToLeague.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText } from "../functions/src/scrape/http.js";
import { extractNextDataJson } from "../functions/src/scrape/espn.js";
import { normalizePlayerName } from "../functions/src/util/names.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * ESPN slug → league `Player.id` when ESPN and our JSON disagree (spelling / surname).
 * Re-check when squads change.
 */
const MANUAL_ESPN_SLUG_TO_LEAGUE_ID: Record<string, string> = {
  "abishek-porel": "abhishek-porel",
  "avesh-khan": "avesh-kumar",
};

/** ESPN squad slugs excluded on purpose (not in league JSON). */
const IGNORED_ESPN_SLUGS = new Set(["mustafizur-rahman"]);

const SQUAD_PATHS = [
  "/series/ipl-2026-1510719/chennai-super-kings-squad-1511148/series-squads",
  "/series/ipl-2026-1510719/delhi-capitals-squad-1511107/series-squads",
  "/series/ipl-2026-1510719/gujarat-titans-squad-1511094/series-squads",
  "/series/ipl-2026-1510719/kolkata-knight-riders-squad-1511092/series-squads",
  "/series/ipl-2026-1510719/lucknow-super-giants-squad-1511235/series-squads",
  "/series/ipl-2026-1510719/mumbai-indians-squad-1511109/series-squads",
  "/series/ipl-2026-1510719/punjab-kings-squad-1511082/series-squads",
  "/series/ipl-2026-1510719/rajasthan-royals-squad-1511089/series-squads",
  "/series/ipl-2026-1510719/royal-challengers-bengaluru-squad-1511134/series-squads",
  "/series/ipl-2026-1510719/sunrisers-hyderabad-squad-1511114/series-squads",
];

type LeagueP = { id: string; name: string };
type EspnP = {
  objectId: number;
  slug: string;
  longName: string;
  name: string;
  battingName: string;
  fieldingName: string;
  teamSlug: string;
};

function loadLeague(): { byId: Map<string, LeagueP>; normToIds: Map<string, string[]> } {
  const byId = new Map<string, LeagueP>();
  const normToIds = new Map<string, string[]>();
  const add = (p: LeagueP) => {
    if (!p?.id || byId.has(p.id)) return;
    byId.set(p.id, p);
    const n = normalizePlayerName(p.name);
    const arr = normToIds.get(n) ?? [];
    arr.push(p.id);
    normToIds.set(n, arr);
  };
  const pj = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public/IPL-Fantasy-Phase-2/data/players.json"), "utf8"),
  ) as { players: LeagueP[] };
  const wj = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public/IPL-Fantasy-Phase-2/data/waiver-pool.json"), "utf8"),
  ) as { players: LeagueP[] };
  for (const p of pj.players) add(p);
  for (const p of wj.players) add(p);
  return { byId, normToIds };
}

async function fetchSquadPlayers(): Promise<EspnP[]> {
  const out: EspnP[] = [];
  for (const pth of SQUAD_PATHS) {
    const html = await fetchText(`https://www.espncricinfo.com${pth}`);
    const j = extractNextDataJson(html);
    const fromPath = pth.match(/\/([a-z0-9-]+)-squad-\d+\//i)?.[1] ?? "";
    const teamSlug = String(
      j?.props?.appPageProps?.data?.content?.squadDetails?.team?.slug ?? fromPath,
    );
    const players = j?.props?.appPageProps?.data?.content?.squadDetails?.players;
    if (!Array.isArray(players)) {
      throw new Error(`Missing squad players for ${pth}`);
    }
    for (const row of players) {
      const pl = row?.player;
      if (!pl?.objectId) continue;
      out.push({
        objectId: Number(pl.objectId),
        slug: String(pl.slug ?? ""),
        longName: String(pl.longName ?? pl.name ?? ""),
        name: String(pl.name ?? ""),
        battingName: String(pl.battingName ?? ""),
        fieldingName: String(pl.fieldingName ?? ""),
        teamSlug,
      });
    }
  }
  return out;
}

function main(): void {
  void (async () => {
    const { byId: leagueById, normToIds } = loadLeague();
    const espnPlayers = await fetchSquadPlayers();
    const byObjectId = new Map<number, EspnP>();
    for (const e of espnPlayers) {
      if (!byObjectId.has(e.objectId)) byObjectId.set(e.objectId, e);
    }
    const uniqueEspn = [...byObjectId.values()].filter((e) => !IGNORED_ESPN_SLUGS.has(e.slug));

    type Row = {
      espnObjectId: number;
      espnSlug: string;
      espnLongName: string;
      espnTeamSlug: string;
      leaguePlayerId: string | null;
      method: string;
    };
    const rows: Row[] = [];
    const nameAlias: Record<string, string> = {};

    for (const e of uniqueEspn) {
      let leagueId: string | null = null;
      let method = "";

      const slugTarget = e.slug ? MANUAL_ESPN_SLUG_TO_LEAGUE_ID[e.slug] : undefined;
      if (slugTarget && leagueById.has(slugTarget)) {
        leagueId = slugTarget;
        method = "manualSlugOverride";
      } else if (e.slug && leagueById.has(e.slug)) {
        leagueId = e.slug;
        method = "slug==id";
      }
      if (!leagueId) {
        const ln = normalizePlayerName(e.longName);
        const ids = normToIds.get(ln);
        if (ids?.length === 1) {
          leagueId = ids[0]!;
          method = "longName";
        }
      }
      if (!leagueId) {
        const bn = normalizePlayerName(e.battingName);
        if (bn && bn !== normalizePlayerName(e.longName)) {
          const ids = normToIds.get(bn);
          if (ids?.length === 1) {
            leagueId = ids[0]!;
            method = "battingName";
          }
        }
      }
      if (!leagueId) {
        const fn = normalizePlayerName(e.fieldingName);
        if (
          fn &&
          fn !== normalizePlayerName(e.longName) &&
          fn !== normalizePlayerName(e.battingName)
        ) {
          const ids = normToIds.get(fn);
          if (ids?.length === 1) {
            leagueId = ids[0]!;
            method = "fieldingName";
          }
        }
      }

      rows.push({
        espnObjectId: e.objectId,
        espnSlug: e.slug,
        espnLongName: e.longName,
        espnTeamSlug: e.teamSlug,
        leaguePlayerId: leagueId,
        method,
      });

      if (leagueId) {
        const variants = new Set(
          [e.longName, e.name, e.battingName, e.fieldingName].filter(Boolean),
        );
        for (const v of variants) {
          const k = normalizePlayerName(v);
          if (!k) continue;
          // Omit single-token keys (e.g. "sharma") — ambiguous across squads.
          if (!k.includes(" ")) continue;
          if (nameAlias[k] && nameAlias[k] !== leagueId) continue;
          nameAlias[k] = leagueId;
        }
      }
    }

    const unmapped = rows.filter((r) => !r.leaguePlayerId);
    const leagueIdsInEspn = new Set(rows.filter((r) => r.leaguePlayerId).map((r) => r.leaguePlayerId!));
    const leagueOnly = [...leagueById.keys()].filter((id) => !leagueIdsInEspn.has(id));

    const mappedRows = rows.filter((r) => r.leaguePlayerId);
    const espnSquadPlayerRows = mappedRows
      .map((r) => ({
        espnObjectId: r.espnObjectId,
        espnSlug: r.espnSlug,
        espnLongName: r.espnLongName,
        espnTeamSlug: r.espnTeamSlug,
        leaguePlayerId: r.leaguePlayerId!,
        leagueName: leagueById.get(r.leaguePlayerId!)?.name ?? "",
        matchMethod: r.method,
      }))
      .sort((a, b) =>
        a.leagueName.localeCompare(b.leagueName, "en") ||
        a.leaguePlayerId.localeCompare(b.leaguePlayerId),
      );

    const meta = {
      source: "https://www.espncricinfo.com/series/ipl-2026-1510719/squads",
      scrapedAt: new Date().toISOString(),
      espnSquadPlayerCount: uniqueEspn.length,
      mappedCount: mappedRows.length,
      unmappedCount: unmapped.length,
      leaguePlayerCount: leagueById.size,
      leagueOnlyInJsonCount: leagueOnly.length,
      ignoredEspnSlugs: [...IGNORED_ESPN_SLUGS].sort(),
    };

    const payload = {
      meta,
      manualEspnSlugToLeaguePlayerId: MANUAL_ESPN_SLUG_TO_LEAGUE_ID,
      normalizedDisplayNameToLeaguePlayerId: nameAlias,
      espnSquadPlayerRows,
      unmappedEspnPlayers: unmapped,
      leaguePlayerIdsNotInSquads: leagueOnly.sort(),
    };

    const outPublic = path.join(ROOT, "public/IPL-Fantasy-Phase-2/data/espnSquadNameToLeaguePlayerId.json");
    const outFunctions = path.join(ROOT, "functions/src/data/espnSquadNameToLeaguePlayerId.json");
    fs.mkdirSync(path.dirname(outFunctions), { recursive: true });
    const text = JSON.stringify(payload, null, 2);
    fs.writeFileSync(outPublic, text, "utf8");
    fs.writeFileSync(outFunctions, text, "utf8");

    console.log(JSON.stringify(meta, null, 2));
    console.log("Wrote", outPublic, "and", outFunctions);
  })();
}

main();
