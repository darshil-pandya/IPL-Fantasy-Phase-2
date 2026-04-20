/**
 * Zero fantasy fields on all players in public/IPL-Fantasy-Phase-2/data/players.json and waiver-pool.json.
 * Removes seasonFantasyPoints; keeps seasonStats (counting stats) if present.
 * Preserves compact one-line-per-player formatting used in this repo.
 * Run from repo root: node scripts/reset-player-fantasy-json.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "public", "IPL-Fantasy-Phase-2", "data");

function stripFantasyFields(player) {
  const o = { ...player };
  o.seasonTotal = 0;
  o.byMatch = [];
  delete o.seasonFantasyPoints;
  return o;
}

function writePlayersJson(raw) {
  const ps = raw.players.map((p) => `    ${JSON.stringify(p)}`).join(",\n");
  return `{\n  "players": [\n${ps}\n  ]\n}\n`;
}

function processPlayersOnly(relPath) {
  const full = path.join(dataDir, relPath);
  if (!fs.existsSync(full)) {
    console.warn("Skip (missing):", relPath);
    return false;
  }
  const raw = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!Array.isArray(raw.players)) {
    console.warn("Skip (no players array):", relPath);
    return false;
  }
  raw.players = raw.players.map(stripFantasyFields);
  fs.writeFileSync(full, writePlayersJson(raw), "utf8");
  console.log("Reset fantasy fields:", relPath, `(${raw.players.length} players)`);
  return true;
}

function processWaiverPool(relPath) {
  const full = path.join(dataDir, relPath);
  if (!fs.existsSync(full)) {
    console.warn("Skip (missing):", relPath);
    return false;
  }
  const raw = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!Array.isArray(raw.players)) {
    console.warn("Skip (no players array):", relPath);
    return false;
  }
  raw.players = raw.players.map(stripFantasyFields);
  fs.writeFileSync(full, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  console.log("Reset fantasy fields:", relPath, `(${raw.players.length} players)`);
  return true;
}

processPlayersOnly("players.json");
processWaiverPool("waiver-pool.json");
console.log("Done.");
