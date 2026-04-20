/**
 * Merge `espn_scorecard_display_names` from the name-audit CSV into
 * `normalizedDisplayNameToLeaguePlayerId` (same map the Cloud Function uses).
 *
 * Run after: npm run audit-scorecard-names
 * Then:      npx tsx scripts/mergeScorecardAuditIntoEspnNameMap.ts
 *
 * Or:        npm run merge-scorecard-audit-into-espn-map
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePlayerName } from "../functions/src/util/names.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CSV_PATH = path.join(
  ROOT,
  "reports/scorecard-name-audit/league_players_vs_espn_scorecards.csv",
);
const JSON_FUNCTIONS = path.join(ROOT, "functions/src/data/espnSquadNameToLeaguePlayerId.json");
const JSON_PUBLIC = path.join(ROOT, "public/IPL-Fantasy-Phase-2/data/espnSquadNameToLeaguePlayerId.json");

type Payload = {
  meta: Record<string, unknown>;
  manualEspnSlugToLeaguePlayerId?: Record<string, string>;
  normalizedDisplayNameToLeaguePlayerId: Record<string, string>;
  espnSquadPlayerRows?: unknown[];
  unmappedEspnPlayers?: unknown[];
  leaguePlayerIdsNotInSquads?: string[];
};

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (!inQ && c === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function main(): void {
  if (!fs.existsSync(CSV_PATH)) {
    console.error("Missing CSV. Run: npm run audit-scorecard-names");
    process.exit(1);
  }
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0]!.split(",");
  if (
    header[0] !== "league_player_id" ||
    header[2] !== "espn_scorecard_display_names"
  ) {
    console.error("Unexpected CSV header", header);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(JSON_FUNCTIONS, "utf8")) as Payload;
  const map = { ...payload.normalizedDisplayNameToLeaguePlayerId };
  const collisions: string[] = [];
  let added = 0;
  let skippedEmpty = 0;

  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvRow(lines[li]!);
    if (cols.length < 5) continue;
    const leagueId = cols[0]!.trim();
    const espnCell = cols[2]!.trim();
    if (!espnCell) {
      skippedEmpty++;
      continue;
    }
    const displayNames = espnCell.split(";").map((s) => s.trim()).filter(Boolean);
    for (const display of displayNames) {
      const norm = normalizePlayerName(display);
      if (!norm) continue;
      const existing = map[norm];
      if (existing && existing !== leagueId) {
        collisions.push(`${norm} -> existing ${existing}, csv wants ${leagueId} (${display})`);
        continue;
      }
      if (!existing) added++;
      map[norm] = leagueId;
    }
  }

  payload.normalizedDisplayNameToLeaguePlayerId = map;
  payload.meta = {
    ...payload.meta,
    scorecardAuditMergedAt: new Date().toISOString(),
    scorecardAuditSourceCsv: path.relative(ROOT, CSV_PATH),
    scorecardAuditAliasesAdded: added,
    scorecardAuditCollisions: collisions.length,
  };

  const text = JSON.stringify(payload, null, 2);
  fs.writeFileSync(JSON_FUNCTIONS, text, "utf8");
  fs.writeFileSync(JSON_PUBLIC, text, "utf8");

  console.log(
    JSON.stringify(
      {
        csvRows: lines.length - 1,
        skippedNoEspnNames: skippedEmpty,
        newNormalizedKeysFromScorecards: added,
        collisions: collisions.length,
        wrote: [path.relative(ROOT, JSON_FUNCTIONS), path.relative(ROOT, JSON_PUBLIC)],
      },
      null,
      2,
    ),
  );
  if (collisions.length) {
    console.warn("Collisions (skipped):\n", collisions.slice(0, 30).join("\n"));
  }
}

main();
