import { matchColumnsFromPlayers } from "../matchColumns";
import type { Franchise, LeagueBundle, Player } from "../../types";
import type { MidSeasonCsvRow } from "../csv/midSeasonAuctionCsv";
import type { RosterChangeEvent, WaiverPersistentState } from "./types";

/**
 * Rebuilds waiver pool and auction unsold list from canonical franchises + full player list.
 * Players not on any franchise roster appear in `waiverPool` and `unsoldPlayerIds`.
 */
export function rebuildPoolAndAuctionFromRosters(
  players: Player[],
  franchises: Franchise[],
  previous: LeagueBundle,
): Pick<LeagueBundle, "waiverPool" | "auction"> {
  const assigned = new Set<string>();
  for (const f of franchises) {
    for (const id of f.playerIds) assigned.add(id);
  }
  const poolIds = players
    .map((p) => p.id)
    .filter((id) => !assigned.has(id))
    .sort();
  const pmap = new Map(players.map((p) => [p.id, p] as const));
  const oldPoolMap = new Map((previous.waiverPool ?? []).map((p) => [p.id, p] as const));

  const waiverPool: Player[] = poolIds.map((id) => {
    const fromPlayers = pmap.get(id);
    if (fromPlayers) return fromPlayers;
    const fromPool = oldPoolMap.get(id);
    if (fromPool) return fromPool;
    throw new Error(`Missing Player row for pool id ${id}`);
  });

  return {
    waiverPool,
    auction: {
      ...previous.auction,
      unsoldPlayerIds: [...poolIds],
    },
  };
}

/**
 * Builds a sequence of (playerOut, playerIn) swaps turning `oldRoster` into `newRoster` as sets
 * (order of `playerIds` does not matter).
 */
export function buildSwapPairsForRosterChange(
  oldRoster: string[],
  newRoster: string[],
):
  | { ok: true; pairs: [string, string][] }
  | { ok: false; error: string } {
  const target = new Set(newRoster);
  let cur = [...oldRoster];
  const pairs: [string, string][] = [];

  const multisetEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
  };

  for (let step = 0; step < 64; step++) {
    if (multisetEqual(cur, newRoster)) {
      return { ok: true, pairs };
    }
    const curSet = new Set(cur);
    const wrong = cur.filter((id) => !target.has(id));
    const missing = newRoster.filter((id) => !curSet.has(id));
    if (wrong.length === 0 && missing.length === 0) {
      if (multisetEqual(cur, newRoster)) return { ok: true, pairs };
      return {
        ok: false,
        error: "Roster multiset matches target but ordering could not be resolved.",
      };
    }
    if (wrong.length === 0 || missing.length === 0) {
      return {
        ok: false,
        error: `Stuck pairing swaps (wrong=${wrong.length}, missing=${missing.length}).`,
      };
    }
    const out = wrong[0]!;
    const inn = missing[0]!;
    if (!cur.includes(out)) {
      return { ok: false, error: `Invariant: roster missing player to drop (${out}).` };
    }
    if (cur.includes(inn)) {
      return {
        ok: false,
        error: `Invariant: cannot bring in ${inn} — already on roster.`,
      };
    }
    pairs.push([out, inn]);
    cur = [...cur.filter((id) => id !== out), inn];
  }
  return { ok: false, error: "Swap pairing did not finish within step limit." };
}

export type MidSeasonApplyResult =
  | {
      ok: true;
      leagueBundle: LeagueBundle;
      waiverState: WaiverPersistentState;
    }
  | { ok: false; error: string };

export function applyMidSeasonAuctionToState(
  bundle: LeagueBundle,
  waiverState: WaiverPersistentState,
  rows: MidSeasonCsvRow[],
): MidSeasonApplyResult {
  if (waiverState.phase !== "idle") {
    return { ok: false, error: "Waiver phase must be idle before importing." };
  }
  if (waiverState.nominations.length > 0 || waiverState.bids.length > 0) {
    return {
      ok: false,
      error: "Clear nominations and bids before importing (waivers must be idle).",
    };
  }

  const byOwner = new Map<string, MidSeasonCsvRow[]>();
  for (const r of rows) {
    const list = byOwner.get(r.franchise_owner) ?? [];
    list.push(r);
    byOwner.set(r.franchise_owner, list);
  }

  const rowById = new Map(rows.map((r) => [r.player_id, r] as const));

  const nextPlayers: Player[] = bundle.players.map((p) => {
    const r = rowById.get(p.id);
    if (!r) return p;
    const iplTeam = r.ipl_team;
    const role = r.role;
    const nationality = r.nationality;
    if (
      p.iplTeam === iplTeam &&
      p.role === role &&
      p.nationality === nationality
    ) {
      return p;
    }
    return { ...p, iplTeam, role, nationality };
  });

  const newFranchises: Franchise[] = [];
  for (const f of bundle.franchises) {
    const list = byOwner.get(f.owner);
    if (!list || list.length !== 15) {
      return {
        ok: false,
        error: `Internal error: expected 15 CSV rows for ${f.owner}.`,
      };
    }
    newFranchises.push({
      ...f,
      playerIds: list.map((x) => x.player_id),
    });
  }

  const poolAuction = rebuildPoolAndAuctionFromRosters(
    nextPlayers,
    newFranchises,
    bundle,
  );

  const allForColumns = [...nextPlayers, ...(poolAuction.waiverPool ?? [])];
  const columns = matchColumnsFromPlayers(allForColumns);
  const lastCol =
    columns.length > 0 ? columns[columns.length - 1]!.id : null;
  const at = new Date().toISOString();
  const newRoundId = waiverState.roundId + 1;
  let orderInRound = 0;
  const newEvents: RosterChangeEvent[] = [];

  const newRosters: Record<string, string[]> = {};
  for (const f of newFranchises) {
    newRosters[f.owner] = [...f.playerIds];
  }

  for (const f of bundle.franchises) {
    const owner = f.owner;
    const oldR = waiverState.rosters[owner] ?? [...f.playerIds];
    const newR = newRosters[owner];
    if (!newR) {
      return { ok: false, error: `Missing roster for owner ${owner}.` };
    }
    const pairResult = buildSwapPairsForRosterChange(oldR, newR);
    if (!pairResult.ok) {
      return {
        ok: false,
        error: `${owner}: ${pairResult.error}`,
      };
    }
    for (const [playerOutId, playerInId] of pairResult.pairs) {
      newEvents.push({
        at,
        roundId: newRoundId,
        orderInRound: orderInRound++,
        winner: owner,
        playerOutId,
        playerInId,
        effectiveAfterColumnId: lastCol,
      });
    }
  }

  const leagueBundle: LeagueBundle = {
    ...bundle,
    franchises: newFranchises,
    players: nextPlayers,
    waiverPool: poolAuction.waiverPool,
    auction: poolAuction.auction,
  };

  const waiverStateNext: WaiverPersistentState = {
    ...waiverState,
    roundId: newRoundId,
    rosters: { ...waiverState.rosters, ...newRosters },
    rosterHistory: [...waiverState.rosterHistory, ...newEvents],
  };

  return { ok: true, leagueBundle, waiverState: waiverStateNext };
}
