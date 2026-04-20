/**
 * Export per-match CSVs from live Firestore (same shape as a manual scoring sheet).
 *
 * Data source:
 * - iplFantasy/leagueBundle → player names, roles, IPL teams
 * - iplFantasy/fantasyMatchScores → per-match playerPoints + playerBreakdown (fantasy categories)
 * - ownershipPeriods → franchise owner per match (sequence: `effectiveAfterColumnId`; no calendar overlap)
 *
 * Raw IPL counting stats (runs, balls faced, overs bowled, etc.) are NOT stored in Firestore
 * after score sync; those columns are left blank. Fantasy category points are split into
 * Batting / Bowling / Fielding / Other like your spreadsheet subtotals.
 *
 * Prerequisites:
 * - GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   (or `gcloud auth application-default login` for a user with Firestore read access)
 *
 * Usage:
 *   npx tsx scripts/exportFirestoreMatchSheets.ts
 *   npx tsx scripts/exportFirestoreMatchSheets.ts --project ipl-fantasy-phase-2 --out reports/match-sheets
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

type PlayerSeasonFantasySlice = Record<string, number>;

const BATTING_KEYS = new Set([
  "battingRuns",
  "boundaryFours",
  "boundarySixes",
  "battingMilestones",
  "ducks",
  "strikeRate",
  "namedInXi",
]);

const BOWLING_KEYS = new Set([
  "wickets",
  "lbwOrBowled",
  "threeWicketHauls",
  "fourWicketHauls",
  "fiveWicketHauls",
  "maidens",
  "economy",
  "dotBalls",
]);

const FIELDING_KEYS = new Set([
  "catches",
  "threeCatchBonus",
  "stumpings",
  "runOutDirect",
  "runOutAssist",
]);

const OTHER_KEYS = new Set(["impactOrConcussion", "other"]);

function sumKeys(slice: PlayerSeasonFantasySlice | undefined, keys: Set<string>): number {
  if (!slice) return 0;
  let s = 0;
  for (const k of keys) {
    const v = slice[k];
    if (typeof v === "number" && Number.isFinite(v)) s += v;
  }
  return Math.round(s * 100) / 100;
}

function sumSlice(slice: PlayerSeasonFantasySlice | undefined): number {
  if (!slice) return 0;
  let s = 0;
  for (const v of Object.values(slice)) {
    if (typeof v === "number" && Number.isFinite(v)) s += v;
  }
  return Math.round(s * 100) / 100;
}

function csvCell(v: string | number): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface LeaguePlayerRow {
  id: string;
  name: string;
  iplTeam: string;
  role: string;
}

interface MatchEntry {
  matchKey: string;
  matchLabel: string;
  matchDate: string;
  playerPoints: Record<string, number>;
  playerBreakdown: Record<string, PlayerSeasonFantasySlice>;
}

interface MatchColumnRef {
  id: string;
}

interface OwnershipPeriod {
  playerId: string;
  ownerId: string;
  acquiredAt: string;
  releasedAt: string | null;
  effectiveAfterColumnId?: string | null;
}

function parseArgs(): { projectId: string; outDir: string } {
  let projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "ipl-fantasy-phase-2";
  let outDir = join("reports", "match-sheets");
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project" && argv[i + 1]) {
      projectId = argv[++i];
    } else if (argv[i] === "--out" && argv[i + 1]) {
      outDir = argv[++i];
    }
  }
  return { projectId, outDir: resolve(outDir) };
}

function matchColumnId(matchDate: string, matchLabel: string): string {
  return `${matchDate}\u001f${matchLabel}`;
}

function columnIndex(columns: MatchColumnRef[], columnId: string | null | undefined): number {
  if (columnId == null || columnId === "") return -1;
  const i = columns.findIndex((c) => c.id === columnId);
  return i >= 0 ? i : -1;
}

function sortPeriodSegments(segs: OwnershipPeriod[]): OwnershipPeriod[] {
  return [...segs].sort((a, b) => {
    const c = a.acquiredAt.localeCompare(b.acquiredAt);
    if (c !== 0) return c;
    return `${a.ownerId}|${a.playerId}`.localeCompare(`${b.ownerId}|${b.playerId}`);
  });
}

function periodsSupportSequence(
  periods: OwnershipPeriod[],
  columns: MatchColumnRef[],
): boolean {
  if (periods.length === 0 || columns.length === 0) return false;
  const byPlayer = new Map<string, OwnershipPeriod[]>();
  for (const p of periods) {
    const list = byPlayer.get(p.playerId) ?? [];
    list.push(p);
    byPlayer.set(p.playerId, list);
  }
  for (const [, segs] of byPlayer) {
    const sorted = sortPeriodSegments(segs);
    for (let i = 0; i < sorted.length; i++) {
      const eff = sorted[i]!.effectiveAfterColumnId;
      const hasEff = eff != null && eff !== "";
      if (i === 0) {
        if (hasEff && columnIndex(columns, eff) < 0) return false;
        continue;
      }
      if (!hasEff || columnIndex(columns, eff) < 0) return false;
    }
  }
  return true;
}

function segmentMatchBounds(
  columns: MatchColumnRef[],
  seg: OwnershipPeriod,
  next: OwnershipPeriod | undefined,
): { startJ: number; endJ: number } {
  const eff = seg.effectiveAfterColumnId;
  const k = eff == null || eff === "" ? -1 : columnIndex(columns, eff);
  const startJ = k + 1;
  let endJ = columns.length;
  if (next) {
    const ne = next.effectiveAfterColumnId;
    const nk = ne == null || ne === "" ? -1 : columnIndex(columns, ne);
    endJ = nk + 1;
  }
  return { startJ, endJ };
}

/** Same semantics as web app `period_sequence` scoring. */
function ownerAtMatchSequence(
  periods: OwnershipPeriod[],
  playerId: string,
  matchIndex: number,
  columns: MatchColumnRef[],
): string | null {
  const segs = periods.filter((p) => p.playerId === playerId);
  if (segs.length === 0) return null;
  const sorted = sortPeriodSegments(segs);
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i]!;
    const next = sorted[i + 1];
    const { startJ, endJ } = segmentMatchBounds(columns, seg, next);
    if (matchIndex >= startJ && matchIndex < endJ) return seg.ownerId;
  }
  return null;
}

function auctionOwnerForPlayer(
  franchises: { owner: string; playerIds: string[] }[],
  playerId: string,
): string | null {
  for (const f of franchises) {
    if (f.playerIds.includes(playerId)) return f.owner;
  }
  return null;
}

function normalizeMatchEntry(raw: Record<string, unknown>): MatchEntry | null {
  const matchKey = raw.matchKey;
  const matchLabel = raw.matchLabel;
  const matchDate = raw.matchDate;
  if (typeof matchKey !== "string" || !matchKey) return null;
  if (typeof matchLabel !== "string") return null;
  let dateStr = "";
  if (typeof matchDate === "string") dateStr = matchDate;
  else if (
    matchDate &&
    typeof matchDate === "object" &&
    "toDate" in matchDate &&
    typeof (matchDate as { toDate: () => Date }).toDate === "function"
  ) {
    dateStr = (matchDate as { toDate: () => Date }).toDate().toISOString();
  }
  if (!dateStr) return null;

  const pp = raw.playerPoints;
  const playerPoints: Record<string, number> = {};
  if (pp && typeof pp === "object" && !Array.isArray(pp)) {
    for (const [k, v] of Object.entries(pp as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) playerPoints[k] = n;
    }
  }

  const pb = raw.playerBreakdown;
  const playerBreakdown: Record<string, PlayerSeasonFantasySlice> = {};
  if (pb && typeof pb === "object" && !Array.isArray(pb)) {
    for (const [pid, sliceRaw] of Object.entries(pb as Record<string, unknown>)) {
      if (!sliceRaw || typeof sliceRaw !== "object" || Array.isArray(sliceRaw)) continue;
      const slice: PlayerSeasonFantasySlice = {};
      for (const [k, v] of Object.entries(sliceRaw as Record<string, unknown>)) {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n) && n !== 0) slice[k] = n;
      }
      if (Object.keys(slice).length > 0) playerBreakdown[pid] = slice;
    }
  }

  return { matchKey, matchLabel, matchDate: dateStr, playerPoints, playerBreakdown };
}

const HEADER = [
  "Match_ID",
  "Fixture",
  "Player",
  "Runs",
  "Balls",
  "4s",
  "6s",
  "Dismissed",
  "Wickets",
  "LBW_Bowled_W",
  "Overs",
  "Maidens",
  "Runs_Conceded",
  "Dot_Balls",
  "Catches",
  "Stumpings",
  "RO_Direct",
  "RO_Indirect",
  "Role",
  "IPL_Team",
  "Franchise",
  "Balls_Bowled",
  "Strike_Rate",
  "Economy",
  "Batting_Point",
  "Bowling_Point",
  "Fielding_Point",
  "Other_Point",
  "Total_Points",
];

function rowForPlayer(
  matchId: string,
  fixture: string,
  p: LeaguePlayerRow | undefined,
  franchise: string,
  slice: PlayerSeasonFantasySlice | undefined,
  totalFromDoc: number,
): string[] {
  const bat = sumKeys(slice, BATTING_KEYS);
  const bowl = sumKeys(slice, BOWLING_KEYS);
  const field = sumKeys(slice, FIELDING_KEYS);
  const other = sumKeys(slice, OTHER_KEYS);
  const fromSlice = sumSlice(slice);
  const total =
    fromSlice > 0 || Object.keys(slice ?? {}).length > 0
      ? fromSlice
      : totalFromDoc;

  const empty = "";
  return [
    matchId,
    fixture,
    p?.name ?? "",
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    p?.role ?? "",
    p?.iplTeam ?? "",
    franchise,
    empty,
    empty,
    empty,
    String(bat),
    String(bowl),
    String(field),
    String(other),
    String(total),
  ];
}

async function main(): Promise<void> {
  const { projectId, outDir } = parseArgs();

  if (!getApps().length) {
    initializeApp({
      projectId,
      credential: applicationDefault(),
    });
  }
  const db = getFirestore();

  const bundleSnap = await db.doc("iplFantasy/leagueBundle").get();
  const payload = bundleSnap.data()?.payload as
    | {
        players?: LeaguePlayerRow[];
        waiverPool?: LeaguePlayerRow[];
        franchises?: { owner: string; playerIds: string[] }[];
      }
    | undefined;

  const playerRows: LeaguePlayerRow[] = [
    ...(payload?.players ?? []),
    ...(payload?.waiverPool ?? []),
  ];
  const pmap = new Map<string, LeaguePlayerRow>();
  for (const r of playerRows) {
    if (r?.id && !pmap.has(r.id)) pmap.set(r.id, r);
  }
  const franchises = payload?.franchises ?? [];

  const scoresSnap = await db.doc("iplFantasy/fantasyMatchScores").get();
  const matchesRaw = scoresSnap.data()?.matches as Record<string, unknown> | undefined;
  const entries: MatchEntry[] = [];
  if (matchesRaw && typeof matchesRaw === "object") {
    for (const v of Object.values(matchesRaw)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const e = normalizeMatchEntry(v as Record<string, unknown>);
      if (e) entries.push(e);
    }
  }

  entries.sort(
    (a, b) =>
      a.matchDate.localeCompare(b.matchDate) || a.matchLabel.localeCompare(b.matchLabel),
  );

  const periodsSnap = await db.collection("ownershipPeriods").get();
  const periods: OwnershipPeriod[] = periodsSnap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    const acquiredAt =
      typeof x.acquiredAt === "string"
        ? x.acquiredAt
        : x.acquiredAt &&
            typeof x.acquiredAt === "object" &&
            "toDate" in (x.acquiredAt as object)
          ? (x.acquiredAt as { toDate: () => Date }).toDate().toISOString()
          : "";
    let releasedAt: string | null = null;
    if (x.releasedAt === null || x.releasedAt === undefined) releasedAt = null;
    else if (typeof x.releasedAt === "string") releasedAt = x.releasedAt;
    else if (
      x.releasedAt &&
      typeof x.releasedAt === "object" &&
      "toDate" in (x.releasedAt as object)
    ) {
      releasedAt = (x.releasedAt as { toDate: () => Date }).toDate().toISOString();
    }
    const effRaw = x.effectiveAfterColumnId;
    const effectiveAfterColumnId =
      typeof effRaw === "string" || effRaw === null ? effRaw : undefined;
    return {
      playerId: String(x.playerId ?? ""),
      ownerId: String(x.ownerId ?? ""),
      acquiredAt,
      releasedAt,
      ...(effectiveAfterColumnId !== undefined
        ? { effectiveAfterColumnId }
        : {}),
    };
  });

  const usePeriods = periods.length > 0;
  const columns: MatchColumnRef[] = entries.map((e) => ({
    id: matchColumnId(e.matchDate, e.matchLabel),
  }));
  const periodsSequenceOk =
    usePeriods && columns.length > 0 && periodsSupportSequence(periods, columns);

  if (!usePeriods) {
    console.warn(
      "[exportFirestoreMatchSheets] No ownershipPeriods found — Franchise column uses auction opening rosters only (waivers not reflected).",
    );
  } else if (!periodsSequenceOk) {
    console.warn(
      "[exportFirestoreMatchSheets] ownershipPeriods missing valid effectiveAfterColumnId on waiver segments — Franchise column uses auction opening rosters only. Re-run migrate or deploy current waiver code.",
    );
  }

  await mkdir(outDir, { recursive: true });

  const combinedLines: string[] = [HEADER.map(csvCell).join(",")];

  for (let i = 0; i < entries.length; i++) {
    const matchIndex = i;
    const e = entries[i]!;
    const matchId = `M${String(i + 1).padStart(2, "0")}`;
    const fixture = e.matchLabel;
    const playerIds = new Set<string>([
      ...Object.keys(e.playerPoints),
      ...Object.keys(e.playerBreakdown),
    ]);

    const lines: string[] = [HEADER.map(csvCell).join(",")];
    const sortedIds = [...playerIds].sort((a, b) => {
      const na = pmap.get(a)?.name ?? a;
      const nb = pmap.get(b)?.name ?? b;
      return na.localeCompare(nb);
    });

    for (const pid of sortedIds) {
      const meta = pmap.get(pid);
      let franchise = "-";
      if (usePeriods && periodsSequenceOk) {
        const o = ownerAtMatchSequence(periods, pid, matchIndex, columns);
        if (o) franchise = o;
        else {
          const a = auctionOwnerForPlayer(franchises, pid);
          franchise = a ?? "-";
        }
      } else {
        franchise = auctionOwnerForPlayer(franchises, pid) ?? "-";
      }

      const slice = e.playerBreakdown[pid];
      const totalPts = e.playerPoints[pid] ?? sumSlice(slice);
      const cells = rowForPlayer(matchId, fixture, meta, franchise, slice, totalPts);
      lines.push(cells.map(csvCell).join(","));
      combinedLines.push(cells.map(csvCell).join(","));
    }

    const safeName = e.matchKey.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
    const filePath = join(outDir, `${matchId}_${safeName}.csv`);
    await writeFile(filePath, lines.join("\r\n") + "\r\n", "utf8");
    console.log(`Wrote ${filePath} (${sortedIds.length} players)`);
  }

  const allPath = join(outDir, "all_matches.csv");
  await writeFile(allPath, combinedLines.join("\r\n") + "\r\n", "utf8");
  console.log(`Wrote ${allPath} (${combinedLines.length - 1} data rows)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
