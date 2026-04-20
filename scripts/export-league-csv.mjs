/**
 * One-off: export public/.../data players + franchise owner mapping to CSV.
 * Usage: node scripts/export-league-csv.mjs [outPath]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const dataDir = path.join(ROOT, "public", "IPL-Fantasy-Phase-2", "data");
const outPath =
  process.argv[2] ?? path.join(ROOT, "reports", "league-players-current.csv");

const players = JSON.parse(
  fs.readFileSync(path.join(dataDir, "players.json"), "utf8"),
).players;
const franchises = JSON.parse(
  fs.readFileSync(path.join(dataDir, "franchises.json"), "utf8"),
).franchises;

const ownerByPid = new Map();
for (const f of franchises) {
  for (const id of f.playerIds) ownerByPid.set(id, f.owner);
}

function esc(s) {
  const t = String(s ?? "");
  if (/[",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

const lines = ["player_id,name,role,ipl_team,nationality,franchise_owner"];
for (const p of players) {
  const owner = ownerByPid.get(p.id) ?? "";
  lines.push(
    [
      esc(p.id),
      esc(p.name),
      esc(p.role),
      esc(p.iplTeam),
      esc(p.nationality),
      esc(owner),
    ].join(","),
  );
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\r\n"), "utf8");
console.log(`Wrote ${outPath} (${players.length} data rows + header)`);
