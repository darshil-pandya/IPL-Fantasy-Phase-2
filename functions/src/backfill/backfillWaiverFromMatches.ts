import { APRIL_2026_BACKFILL_TRANSFERS, type TransferRow } from "./april2026Transfers.js";

const SEP = "\u001f";

export type FantasyMatchEntry = {
  matchKey: string;
  matchLabel: string;
  matchDate: string;
};

export type FranchiseRow = { owner: string; teamName: string; playerIds: string[] };

export type RosterChangeEventOut = {
  at: string;
  roundId: number;
  orderInRound: number;
  winner: string;
  playerOutId: string;
  playerInId: string;
  effectiveAfterColumnId: string | null;
};

export type WaiverPayloadV2 = {
  version: 2;
  roundId: number;
  phase: "idle";
  rosters: Record<string, string[]>;
  budgets: Record<string, number>;
  pointCarryover: Record<string, number>;
  joinSnapshot: Record<string, number>;
  rosterHistory: RosterChangeEventOut[];
  nominations: unknown[];
  bids: unknown[];
  log: unknown[];
};

/** 11:58 PM IST except M8/M10 at 7:50 PM IST — attribution instants for cloud `matchPlayerPoints`. */
export const ATTRIBUTION_INSTANTS_UTC = [
  "2026-03-28T18:28:00.000Z",
  "2026-03-29T18:28:00.000Z",
  "2026-03-30T18:28:00.000Z",
  "2026-03-31T18:28:00.000Z",
  "2026-04-01T18:28:00.000Z",
  "2026-04-02T18:28:00.000Z",
  "2026-04-03T18:28:00.000Z",
  "2026-04-04T14:20:00.000Z",
  "2026-04-04T18:28:00.000Z",
  "2026-04-05T14:20:00.000Z",
  "2026-04-05T18:28:00.000Z",
] as const;

export function columnId(matchDate: string, matchLabel: string): string {
  return `${matchDate}${SEP}${matchLabel}`;
}

/**
 * Sort synced matches the same way the client builds columns: by matchDate then label.
 */
export function orderedMatchesFromFirestore(
  matches: Record<string, Record<string, unknown>>,
): FantasyMatchEntry[] {
  const rows: FantasyMatchEntry[] = [];
  for (const [, raw] of Object.entries(matches)) {
    if (!raw || typeof raw !== "object") continue;
    const matchKey = raw.matchKey;
    const matchLabel = raw.matchLabel;
    const matchDate = raw.matchDate;
    if (typeof matchKey !== "string" || typeof matchLabel !== "string") continue;
    let dateStr = "";
    if (typeof matchDate === "string") dateStr = matchDate;
    else if (
      matchDate &&
      typeof matchDate === "object" &&
      "toDate" in matchDate &&
      typeof (matchDate as { toDate?: () => Date }).toDate === "function"
    ) {
      dateStr = (matchDate as { toDate: () => Date }).toDate().toISOString();
    }
    if (!dateStr) continue;
    rows.push({ matchKey, matchLabel, matchDate: dateStr });
  }
  rows.sort(
    (a, b) =>
      a.matchDate.localeCompare(b.matchDate) || a.matchLabel.localeCompare(b.matchLabel),
  );
  return rows;
}

function cloneRosters(r: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(r)) out[k] = [...r[k]];
  return out;
}

function applySwap(
  rosters: Record<string, string[]>,
  owner: string,
  outId: string,
  inId: string,
): void {
  const r = rosters[owner];
  if (!r) return;
  if (!r.includes(outId) || r.includes(inId)) return;
  rosters[owner] = [...r.filter((id) => id !== outId), inId];
}

function validateTransferAgainstRosters(
  rosters: Record<string, string[]>,
  t: TransferRow,
): string | null {
  const squad = rosters[t.owner];
  if (!squad) return `Unknown owner "${t.owner}"`;
  if (!squad.includes(t.playerOutId)) {
    return `${t.owner} roster missing drop player "${t.playerOutId}"`;
  }
  if (squad.includes(t.playerInId)) {
    return `${t.owner} roster already has "${t.playerInId}"`;
  }
  const holders = Object.entries(rosters).filter(
    ([, ids]) => ids.includes(t.playerInId) && ids.length > 0,
  );
  if (holders.length > 0) {
    return `Player "${t.playerInId}" still on ${holders.map((h) => h[0]).join(", ")}`;
  }
  return null;
}

export type BuildBackfillResult =
  | { ok: true; payload: WaiverPayloadV2; orderedMatches: FantasyMatchEntry[]; warnings: string[] }
  | { ok: false; error: string; orderedMatches: FantasyMatchEntry[]; warnings: string[] };

const BUDGET_START = 250_000;

/**
 * Simulates transfers in order; assigns monotonic roundId / orderInRound.
 */
export function buildApril2026WaiverPayload(
  franchises: FranchiseRow[],
  matches: Record<string, Record<string, unknown>>,
): BuildBackfillResult {
  const warnings: string[] = [];
  const orderedMatches = orderedMatchesFromFirestore(matches);

  if (orderedMatches.length < 9) {
    return {
      ok: false,
      error: `Need at least 9 synced matches in fantasyMatchScores (got ${orderedMatches.length}). Run score sync for matches 1–9+ first.`,
      orderedMatches,
      warnings,
    };
  }

  const maxIdx = Math.max(...APRIL_2026_BACKFILL_TRANSFERS.map((t) => t.effectiveAfterMatchIndex));
  if (maxIdx >= orderedMatches.length) {
    return {
      ok: false,
      error: `effectiveAfterMatchIndex ${maxIdx} out of range: only ${orderedMatches.length} matches loaded.`,
      orderedMatches,
      warnings,
    };
  }

  if (orderedMatches.length !== 11) {
    warnings.push(
      `Expected 11 synced matches for full season slice; found ${orderedMatches.length}. Attribution patch uses min(count, 11).`,
    );
  }

  const rosters: Record<string, string[]> = {};
  const budgets: Record<string, number> = {};
  const pointCarryover: Record<string, number> = {};
  for (const f of franchises) {
    rosters[f.owner] = [...f.playerIds];
    budgets[f.owner] = BUDGET_START;
    pointCarryover[f.owner] = 0;
  }

  const columnIdAt = (matchIndex: number): string | null => {
    const m = orderedMatches[matchIndex];
    if (!m) return null;
    return columnId(m.matchDate, m.matchLabel);
  };

  const rosterHistory: RosterChangeEventOut[] = [];
  const roundId = 1;
  let orderInRound = 0;

  for (const t of APRIL_2026_BACKFILL_TRANSFERS) {
    const effCol = columnIdAt(t.effectiveAfterMatchIndex);
    if (!effCol) {
      return {
        ok: false,
        error: `No column for effectiveAfterMatchIndex ${t.effectiveAfterMatchIndex}`,
        orderedMatches,
        warnings,
      };
    }

    const err = validateTransferAgainstRosters(rosters, t);
    if (err) {
      return {
        ok: false,
        error: `Transfer validation failed: ${err} (owner ${t.owner}, ${t.playerOutId} → ${t.playerInId})`,
        orderedMatches,
        warnings,
      };
    }

    applySwap(rosters, t.owner, t.playerOutId, t.playerInId);
    budgets[t.owner] = (budgets[t.owner] ?? BUDGET_START) - t.amountInr;

    rosterHistory.push({
      at: t.atUtc,
      roundId,
      orderInRound,
      winner: t.owner,
      playerOutId: t.playerOutId,
      playerInId: t.playerInId,
      effectiveAfterColumnId: effCol,
    });
    orderInRound += 1;
  }

  const payload: WaiverPayloadV2 = {
    version: 2,
    roundId: 2,
    phase: "idle",
    rosters,
    budgets,
    pointCarryover,
    joinSnapshot: {},
    rosterHistory,
    nominations: [],
    bids: [],
    log: [],
  };

  return { ok: true, payload, orderedMatches, warnings };
}

/**
 * matchKey → attribution `matchPlayedAt` for cloud scoring parity with transfer ordering.
 */
export function matchKeyToAttributionInstant(
  orderedMatches: FantasyMatchEntry[],
): Map<string, string> {
  const map = new Map<string, string>();
  const n = Math.min(orderedMatches.length, ATTRIBUTION_INSTANTS_UTC.length);
  for (let i = 0; i < n; i++) {
    map.set(orderedMatches[i]!.matchKey, ATTRIBUTION_INSTANTS_UTC[i]!);
  }
  return map;
}
