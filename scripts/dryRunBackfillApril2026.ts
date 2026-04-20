/**
 * Validates April 2026 waiver backfill logic locally (no Firestore).
 * Uses synthetic `fantasyMatchScores`-shaped matches in IPL 1–11 chronological order.
 *
 * Run: npx tsx scripts/dryRunBackfillApril2026.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildApril2026WaiverPayload,
  columnId,
  ATTRIBUTION_INSTANTS_UTC,
} from "../functions/src/backfill/backfillWaiverFromMatches.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Placeholder matches: sort order must match real Firestore after score sync (date + label). */
function syntheticMatches(): Record<string, Record<string, unknown>> {
  const rows: { key: string; date: string; label: string }[] = [
    { key: "syn-m1", date: "2026-03-27T14:00:00.000Z", label: "SRH vs RCB" },
    { key: "syn-m2", date: "2026-03-28T14:00:00.000Z", label: "KKR vs MI" },
    { key: "syn-m3", date: "2026-03-29T14:00:00.000Z", label: "CSK vs RR" },
    { key: "syn-m4", date: "2026-03-30T14:00:00.000Z", label: "GT vs PBKS" },
    { key: "syn-m5", date: "2026-03-31T14:00:00.000Z", label: "LSG vs DC" },
    { key: "syn-m6", date: "2026-04-01T14:00:00.000Z", label: "SRH vs KKR" },
    { key: "syn-m7", date: "2026-04-02T14:00:00.000Z", label: "CSK vs PBKS" },
    { key: "syn-m8", date: "2026-04-03T18:20:00.000Z", label: "MI vs DC" },
    { key: "syn-m9", date: "2026-04-04T14:00:00.000Z", label: "RR vs GT" },
    { key: "syn-m10", date: "2026-04-04T14:00:00.000Z", label: "SRH vs LSG" },
    { key: "syn-m11", date: "2026-04-05T14:00:00.000Z", label: "RCB vs CSK" },
  ];
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    out[r.key] = {
      matchKey: r.key,
      matchDate: r.date,
      matchLabel: r.label,
      status: "final",
      playerPoints: {},
    };
  }
  return out;
}

function main(): void {
  const frPath = path.join(ROOT, "public", "IPL-Fantasy-Phase-2", "data", "franchises.json");
  const raw = JSON.parse(fs.readFileSync(frPath, "utf8")) as {
    franchises: { owner: string; teamName: string; playerIds: string[] }[];
  };
  const franchises = raw.franchises;

  const matches = syntheticMatches();
  const result = buildApril2026WaiverPayload(franchises, matches);

  console.log("--- April 2026 backfill dry run ---\n");
  if (!result.ok) {
    console.error("FAILED:", result.error);
    process.exit(1);
  }

  console.log("Ordered columns (verify against Firestore fantasyMatchScores sort order):");
  for (let i = 0; i < result.orderedMatches.length; i++) {
    const m = result.orderedMatches[i]!;
    const cid = columnId(m.matchDate, m.matchLabel);
    const att = ATTRIBUTION_INSTANTS_UTC[i] ?? "(no patch slot)";
    console.log(
      `  ${i + 1}. ${m.matchDate.slice(0, 10)} ${m.matchLabel} → columnId prefix: ${cid.slice(0, 28)}…`,
    );
    console.log(`      attribution UTC (MPP patch): ${att}`);
  }

  if (result.warnings.length) {
    console.log("\nWarnings:");
    for (const w of result.warnings) console.log(`  - ${w}`);
  }

  console.log(`\nRoster history events: ${result.payload.rosterHistory.length}`);
  console.log("\nFinal budgets (INR):");
  for (const [o, b] of Object.entries(result.payload.budgets).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`  ${o}: ${b.toLocaleString("en-IN")}`);
  }

  console.log("\nSanity: Hersh final squad includes tim-david, prince-yadav?");
  const h = result.payload.rosters.Hersh ?? [];
  console.log(`  tim-david: ${h.includes("tim-david")}, prince-yadav: ${h.includes("prince-yadav")}`);

  console.log(
    "\nNext: ensure real Firestore matches sort to the same 1–11 order (dates from ESPN).",
  );
  console.log(
    "Note: the admin backfill Cloud Function is disabled in this build.",
  );
  console.log(
    "Player byMatch / leagueBundle must include points for those matches (score sync or JSON).",
  );
}

main();
