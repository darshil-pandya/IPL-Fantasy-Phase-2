import type { Franchise, FranchiseStanding, LeagueBundle, Player } from "../types";
import { buildStandings, playerMapFromList } from "./buildStandings";
import type { RosterChangeEvent } from "./waiver/types";
import {
  inferEffectiveAfterColumnIdFromRevealTime,
  matchColumnsFromPlayers,
  pointsInMatch,
  type MatchColumn,
} from "./matchColumns";

export type FranchiseScoringMode =
  | "attributed"
  | "period_sequence"
  | "current";

/** Client-side representation of an ownership period from Firestore. */
export interface ClientOwnershipPeriod {
  playerId: string;
  ownerId: string;
  acquiredAt: string;
  releasedAt: string | null;
  /**
   * Waiver acquisitions: match column id after which points count (same as roster history).
   * Null/omit for auction baseline periods.
   */
  effectiveAfterColumnId?: string | null;
}

export type FranchiseScoringSummary = {
  mode: FranchiseScoringMode;
  columns: MatchColumn[];
  /** Fantasy points per owner per match column (same order as `columns`). Single source for chart + Match Center row totals. */
  perOwnerPerMatch: Record<string, number[]>;
  /** Roster at the start of each match (index aligns with `columns`). Set for sequence-based modes; null for `current`. */
  rostersAtStartOfMatch: Record<string, string[]>[] | null;
};

function playersForAttribution(bundle: LeagueBundle): Player[] {
  const seen = new Set<string>();
  const out: Player[] = [];
  for (const p of bundle.players) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  for (const p of bundle.waiverPool ?? []) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

export function initialRosterMap(franchises: Franchise[]): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const f of franchises) m[f.owner] = [...f.playerIds];
  return m;
}

function cloneRosters(r: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(r)) out[k] = [...r[k]];
  return out;
}

function columnIndex(columns: MatchColumn[], columnId: string | null): number {
  if (columnId == null) return -1;
  const i = columns.findIndex((c) => c.id === columnId);
  return i >= 0 ? i : -1;
}

function sortRosterEvents(
  events: RosterChangeEvent[],
  columns: MatchColumn[],
): RosterChangeEvent[] {
  return [...events].sort((a, b) => {
    const ia = columnIndex(columns, a.effectiveAfterColumnId);
    const ib = columnIndex(columns, b.effectiveAfterColumnId);
    if (ia !== ib) return ia - ib;
    if (a.roundId !== b.roundId) return a.roundId - b.roundId;
    return a.orderInRound - b.orderInRound;
  });
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

/** Roster each owner had at the **start** of match `j` (before points for column `j`). */
export function rostersAtStartOfEachMatch(
  initial: Record<string, string[]>,
  events: RosterChangeEvent[],
  columns: MatchColumn[],
): Record<string, string[]>[] {
  const sorted = sortRosterEvents(events, columns);
  const n = columns.length;
  const out: Record<string, string[]>[] = [];
  for (let j = 0; j < n; j++) {
    const r = cloneRosters(initial);
    for (const e of sorted) {
      if (columnIndex(columns, e.effectiveAfterColumnId) < j) {
        applySwap(r, e.winner, e.playerOutId, e.playerInId);
      }
    }
    out.push(r);
  }
  return out;
}

export function replayRostersAfterAllEvents(
  initial: Record<string, string[]>,
  events: RosterChangeEvent[],
  columns: MatchColumn[],
): Record<string, string[]> {
  const r = cloneRosters(initial);
  for (const e of sortRosterEvents(events, columns)) {
    applySwap(r, e.winner, e.playerOutId, e.playerInId);
  }
  return r;
}

/** Cloud settles used `effectiveAfterColumnId: null`, which sorted as index -1 and wrongly applied swaps from match 1. */
export function normalizeRosterHistoryForColumns(
  events: RosterChangeEvent[],
  columns: MatchColumn[],
): RosterChangeEvent[] {
  if (columns.length === 0) return events;
  return events.map((e) => {
    const id = e.effectiveAfterColumnId;
    if (id && columns.some((c) => c.id === id)) return e;
    return {
      ...e,
      effectiveAfterColumnId: inferEffectiveAfterColumnIdFromRevealTime(e.at, columns),
    };
  });
}

function rostersDeepEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
  owners: string[],
): boolean {
  for (const o of owners) {
    const x = [...(a[o] ?? [])].sort();
    const y = [...(b[o] ?? [])].sort();
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

function perOwnerPerMatchFromCurrentRosters(
  owners: string[],
  columns: MatchColumn[],
  currentRosters: Record<string, string[]>,
  pmap: Map<string, Player>,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const o of owners) {
    const row: number[] = [];
    for (const col of columns) {
      let round = 0;
      for (const id of currentRosters[o] ?? []) {
        const p = pmap.get(id);
        if (!p) continue;
        const v = pointsInMatch(p, col.id);
        if (v != null) round += v;
      }
      row.push(Math.round(round * 100) / 100);
    }
    out[o] = row;
  }
  return out;
}

function perOwnerPerMatchAttributed(
  owners: string[],
  columns: MatchColumn[],
  timeline: Record<string, string[]>[],
  pmap: Map<string, Player>,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const o of owners) out[o] = columns.map(() => 0);
  for (let j = 0; j < columns.length; j++) {
    const rosters = timeline[j];
    for (const owner of owners) {
      let round = 0;
      for (const id of rosters[owner] ?? []) {
        const p = pmap.get(id);
        if (!p) continue;
        const v = pointsInMatch(p, columns[j].id);
        if (v != null) round += v;
      }
      out[owner][j] = Math.round(round * 100) / 100;
    }
  }
  return out;
}

function sortPeriodSegments(segs: ClientOwnershipPeriod[]): ClientOwnershipPeriod[] {
  return [...segs].sort((a, b) => {
    const c = a.acquiredAt.localeCompare(b.acquiredAt);
    if (c !== 0) return c;
    return `${a.ownerId}|${a.playerId}`.localeCompare(`${b.ownerId}|${b.playerId}`);
  });
}

/** True when every player chain has auction-style first segment and waiver segments carry a valid column id. */
function periodsSupportSequence(
  periods: ClientOwnershipPeriod[],
  columns: MatchColumn[],
): boolean {
  if (periods.length === 0 || columns.length === 0) return false;
  const byPlayer = new Map<string, ClientOwnershipPeriod[]>();
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
  columns: MatchColumn[],
  seg: ClientOwnershipPeriod,
  next: ClientOwnershipPeriod | undefined,
): { startJ: number; endJ: number } {
  const eff = seg.effectiveAfterColumnId;
  const k =
    eff == null || eff === "" ? -1 : columnIndex(columns, eff);
  const startJ = k + 1;
  let endJ = columns.length;
  if (next) {
    const ne = next.effectiveAfterColumnId;
    const nk =
      ne == null || ne === "" ? -1 : columnIndex(columns, ne);
    endJ = nk + 1;
  }
  return { startJ, endJ };
}

/** Same waiver semantics as roster replay: points start the match after `effectiveAfterColumnId`. */
function perOwnerPerMatchFromPeriodsSequence(
  owners: string[],
  columns: MatchColumn[],
  pmap: Map<string, Player>,
  periods: ClientOwnershipPeriod[],
): Record<string, number[]> {
  const byPlayer = new Map<string, ClientOwnershipPeriod[]>();
  for (const p of periods) {
    const list = byPlayer.get(p.playerId) ?? [];
    list.push(p);
    byPlayer.set(p.playerId, list);
  }
  const out: Record<string, number[]> = {};
  for (const o of owners) out[o] = columns.map(() => 0);

  for (const [, segs] of byPlayer) {
    const sorted = sortPeriodSegments(segs);
    for (let i = 0; i < sorted.length; i++) {
      const seg = sorted[i]!;
      const next = sorted[i + 1];
      const { startJ, endJ } = segmentMatchBounds(columns, seg, next);
      const owner = seg.ownerId;
      if (!owners.includes(owner)) continue;
      for (
        let j = Math.max(0, startJ);
        j < endJ && j < columns.length;
        j++
      ) {
        const p = pmap.get(seg.playerId);
        if (!p) continue;
        const v = pointsInMatch(p, columns[j]!.id);
        if (v != null) {
          out[owner][j] = Math.round((out[owner][j] + v) * 100) / 100;
        }
      }
    }
  }
  return out;
}

function ownerForPlayerAtMatchIndex(
  sortedSegs: ClientOwnershipPeriod[],
  columns: MatchColumn[],
  j: number,
): string | null {
  for (let i = 0; i < sortedSegs.length; i++) {
    const seg = sortedSegs[i]!;
    const next = sortedSegs[i + 1];
    const { startJ, endJ } = segmentMatchBounds(columns, seg, next);
    if (j >= startJ && j < endJ) return seg.ownerId;
  }
  return null;
}

function rostersAtStartFromPeriodsSequence(
  columns: MatchColumn[],
  owners: string[],
  periods: ClientOwnershipPeriod[],
): Record<string, string[]>[] {
  const byPlayer = new Map<string, ClientOwnershipPeriod[]>();
  for (const p of periods) {
    const list = byPlayer.get(p.playerId) ?? [];
    list.push(p);
    byPlayer.set(p.playerId, list);
  }
  const n = columns.length;
  const out: Record<string, string[]>[] = [];
  for (let j = 0; j < n; j++) {
    const sets: Record<string, Set<string>> = {};
    for (const o of owners) sets[o] = new Set();
    for (const [playerId, segs] of byPlayer) {
      const owner = ownerForPlayerAtMatchIndex(
        sortPeriodSegments(segs),
        columns,
        j,
      );
      if (owner && owners.includes(owner)) sets[owner]!.add(playerId);
    }
    out.push(
      Object.fromEntries(owners.map((o) => [o, [...sets[o]!]])),
    );
  }
  return out;
}

/**
 * Standings + per-match grid from one definition.
 *
 * Authority order (sequence only — match column order + waiver `effectiveAfterColumnId`):
 * 1. **Attributed** — replay `rosterHistory` when it matches current waiver rosters (or auction-only).
 * 2. **Period sequence** — `ownershipPeriods` with `effectiveAfterColumnId` on waiver pickups (same semantics as roster replay).
 * 3. **Current** — current rosters on every match when history disagrees or periods lack sequence metadata (re-run migration / fix periods).
 */
export function computeFranchiseScoring(
  bundle: LeagueBundle,
  baseFranchises: Franchise[],
  displayFranchises: Franchise[],
  currentRosters: Record<string, string[]>,
  rosterHistory: RosterChangeEvent[],
  ownershipPeriods?: ClientOwnershipPeriod[],
): FranchiseScoringSummary & {
  standings: FranchiseStanding[];
  sorted: FranchiseStanding[];
  pmap: Map<string, Player>;
  formerPlayersPerOwner: Record<string, { player: Player; attributedPoints: number }[]>;
} {
  const players = playersForAttribution(bundle);
  const columns = matchColumnsFromPlayers(players);
  const pmap = playerMapFromList(players);
  const owners = baseFranchises.map((f) => f.owner);
  const initial = initialRosterMap(baseFranchises);

  const baseStandings = buildStandings(displayFranchises, players);

  const rosterHistoryNorm =
    columns.length > 0
      ? normalizeRosterHistoryForColumns(rosterHistory, columns)
      : rosterHistory;

  let mode: FranchiseScoringMode;
  let perOwnerPerMatch: Record<string, number[]>;
  let rostersAtStartOfMatch: Record<string, string[]>[] | null;

  const periods = ownershipPeriods ?? [];
  const replayed = replayRostersAfterAllEvents(initial, rosterHistoryNorm, columns);
  const hasHistory = rosterHistoryNorm.length > 0;
  const replayOk = hasHistory && rostersDeepEqual(replayed, currentRosters, owners);
  const idleNoMoves =
    !hasHistory && rostersDeepEqual(initial, currentRosters, owners);

  if ((replayOk || idleNoMoves) && columns.length > 0) {
    mode = "attributed";
    const timeline =
      columns.length === 0
        ? []
        : rostersAtStartOfEachMatch(initial, rosterHistoryNorm, columns);
    rostersAtStartOfMatch = timeline.length > 0 ? timeline : null;
    perOwnerPerMatch =
      columns.length === 0
        ? Object.fromEntries(owners.map((o) => [o, []]))
        : perOwnerPerMatchAttributed(owners, columns, timeline, pmap);
  } else if (
    periods.length > 0 &&
    columns.length > 0 &&
    periodsSupportSequence(periods, columns)
  ) {
    mode = "period_sequence";
    rostersAtStartOfMatch = rostersAtStartFromPeriodsSequence(
      columns,
      owners,
      periods,
    );
    perOwnerPerMatch = perOwnerPerMatchFromPeriodsSequence(
      owners,
      columns,
      pmap,
      periods,
    );
  } else if (replayOk || idleNoMoves) {
    mode = "attributed";
    rostersAtStartOfMatch = null;
    perOwnerPerMatch = Object.fromEntries(owners.map((o) => [o, []]));
  } else {
    mode = "current";
    rostersAtStartOfMatch = null;
    perOwnerPerMatch = perOwnerPerMatchFromCurrentRosters(
      owners,
      columns,
      currentRosters,
      pmap,
    );
  }

  const playerPointsByOwner: Record<string, Record<string, number>> = {};
  if (columns.length > 0) {
    for (const o of owners) playerPointsByOwner[o] = {};

    if (
      (mode === "attributed" || mode === "period_sequence") &&
      rostersAtStartOfMatch
    ) {
      for (let j = 0; j < columns.length; j++) {
        const rosters = rostersAtStartOfMatch[j];
        for (const o of owners) {
          for (const id of rosters[o] ?? []) {
            const p = pmap.get(id);
            if (!p) continue;
            const v = pointsInMatch(p, columns[j].id);
            if (v != null) {
              playerPointsByOwner[o][id] =
                Math.round(((playerPointsByOwner[o][id] ?? 0) + v) * 100) / 100;
            }
          }
        }
      }
    } else if (mode === "current") {
      for (let j = 0; j < columns.length; j++) {
        const col = columns[j];
        for (const o of owners) {
          for (const id of currentRosters[o] ?? []) {
            const p = pmap.get(id);
            if (!p) continue;
            const v = pointsInMatch(p, col.id);
            if (v != null) {
              playerPointsByOwner[o][id] =
                Math.round(((playerPointsByOwner[o][id] ?? 0) + v) * 100) / 100;
            }
          }
        }
      }
    }
  }

  const standings: FranchiseStanding[] = baseStandings.map((s) => {
    const fromMatches =
      perOwnerPerMatch[s.owner]?.reduce((a, b) => a + b, 0) ?? 0;
    const ownerPlayerPts = playerPointsByOwner[s.owner];
    const playersResolved = ownerPlayerPts
      ? s.playersResolved.map((p) => ({
          ...p,
          seasonTotal: ownerPlayerPts[p.id] ?? 0,
        }))
      : s.playersResolved;
    return { ...s, totalPoints: fromMatches, playersResolved };
  });

  const sorted = [...standings].sort((a, b) => b.totalPoints - a.totalPoints);

  // Former players: dropped via waiver swaps, no longer on the current roster
  const formerPlayersPerOwner: Record<
    string,
    { player: Player; attributedPoints: number }[]
  > = {};
  for (const o of owners) {
    const currentIds = new Set(currentRosters[o] ?? []);
    const droppedIds = new Set<string>();
    for (const e of rosterHistoryNorm) {
      if (e.winner === o) droppedIds.add(e.playerOutId);
    }
    const former: { player: Player; attributedPoints: number }[] = [];
    for (const id of droppedIds) {
      if (currentIds.has(id)) continue;
      const p = pmap.get(id);
      if (!p) continue;
      former.push({
        player: p,
        attributedPoints: playerPointsByOwner[o]?.[id] ?? 0,
      });
    }
    former.sort((a, b) => b.attributedPoints - a.attributedPoints);
    if (former.length > 0) formerPlayersPerOwner[o] = former;
  }

  return {
    mode,
    columns,
    perOwnerPerMatch,
    rostersAtStartOfMatch,
    standings,
    sorted,
    pmap,
    formerPlayersPerOwner,
  };
}
