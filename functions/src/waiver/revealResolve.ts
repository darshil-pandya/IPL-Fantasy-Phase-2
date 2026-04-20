/**
 * Server-side copy of client `resolveRound` (src/lib/waiver/engine.ts) for authoritative reveals.
 */

import { BUDGET_START } from "../models/types.js";

export interface WaiverNominationPort {
  id: string;
  roundId: number;
  nominatorOwner: string;
  playerInId: string;
  playerOutId: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WaiverBidPort {
  id: string;
  nominationId: string;
  bidderOwner: string;
  playerOutId: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WaiverLogEntryPort {
  at: string;
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface RosterChangeEventPort {
  at: string;
  roundId: number;
  orderInRound: number;
  winner: string;
  playerOutId: string;
  playerInId: string;
  effectiveAfterColumnId: string | null;
}

export interface CompletedBidPort {
  owner: string;
  amount: number;
  playerOutId: string;
  placedAt: string;
  result: "WON" | "LOST";
}

export interface CompletedTransferPort {
  id: string;
  roundId: number;
  revealedAt: string;
  playerInId: string;
  nominatorOwner: string;
  bids: CompletedBidPort[];
  effectiveAfterColumnId?: string | null;
}

export interface WaiverPersistentStatePort {
  version: 2;
  roundId: number;
  phase: string;
  waiverRound?: { startedAt: string; nominationDeadline: string };
  nominationWindowClosedLoggedForRoundId?: number;
  rosters: Record<string, string[]>;
  budgets: Record<string, number>;
  pointCarryover: Record<string, number>;
  joinSnapshot: Record<string, number>;
  rosterHistory: RosterChangeEventPort[];
  nominations: WaiverNominationPort[];
  bids: WaiverBidPort[];
  log: WaiverLogEntryPort[];
}

export type FranchiseOwnerPort = { owner: string; playerIds: string[] };

function nowIso(): string {
  return new Date().toISOString();
}

function logEntry(
  kind: string,
  message: string,
  meta?: Record<string, unknown>,
): WaiverLogEntryPort {
  const at = nowIso();
  if (meta == null) return { at, kind, message };
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined) cleaned[k] = v;
  }
  if (Object.keys(cleaned).length === 0) return { at, kind, message };
  return { at, kind, message, meta: cleaned };
}

function pushLog(
  state: WaiverPersistentStatePort,
  entry: WaiverLogEntryPort,
): WaiverPersistentStatePort {
  return { ...state, log: [...state.log, entry].slice(-500) };
}

type Candidate = {
  owner: string;
  playerOutId: string;
  amount: number;
  ts: number;
};

export function alignStateWithOwnerSquads(
  state: WaiverPersistentStatePort,
  franchises: FranchiseOwnerPort[],
): WaiverPersistentStatePort {
  const rosters = { ...state.rosters };
  const budgets = { ...state.budgets };
  const pointCarryover = { ...state.pointCarryover };
  const joinSnapshot = { ...state.joinSnapshot };
  const rosterHistory = [...state.rosterHistory];

  for (const f of franchises) {
    if (!rosters[f.owner]) rosters[f.owner] = [...f.playerIds];
    if (budgets[f.owner] == null) budgets[f.owner] = BUDGET_START;
    if (pointCarryover[f.owner] == null) pointCarryover[f.owner] = 0;
  }

  const rawPhase = state.phase;
  const phase =
    rawPhase === "idle"
      ? "idle"
      : rawPhase === "active" ||
          rawPhase === "nomination" ||
          rawPhase === "bidding"
        ? "active"
        : "idle";

  return {
    ...state,
    version: 2,
    phase,
    rosters,
    budgets,
    pointCarryover,
    joinSnapshot,
    rosterHistory,
  };
}

export type ResolveRevealResult =
  | {
      ok: true;
      state: WaiverPersistentStatePort;
      completedTransfers: CompletedTransferPort[];
    }
  | { ok: false; error: string };

/**
 * Resolves an active waiver round the same way the web client does on `admin_reveal`.
 */
export function resolveWaiverRoundForReveal(
  state: WaiverPersistentStatePort,
  revealEffectiveAfterColumnId: string | null,
): ResolveRevealResult {
  if (state.phase !== "active") {
    return { ok: false, error: "Reveal only during an active waiver round." };
  }

  let rosters = { ...state.rosters };
  const budgets = { ...state.budgets };
  let log = state.log;
  const rosterHistory = [...state.rosterHistory];
  const completedTransfers: CompletedTransferPort[] = [];
  let orderInRound = 0;

  const push = (entry: WaiverLogEntryPort) => {
    log = [...log, entry].slice(-500);
  };

  for (const nom of state.nominations) {
    const bidsOn = state.bids.filter((b) => b.nominationId === nom.id);
    const nominatorBid = bidsOn.find((b) => b.bidderOwner === nom.nominatorOwner);
    const bidsFromOthers = bidsOn.filter((b) => b.bidderOwner !== nom.nominatorOwner);
    const nominatorCandidate: Candidate = nominatorBid
      ? {
          owner: nom.nominatorOwner,
          playerOutId: nominatorBid.playerOutId,
          amount: nominatorBid.amount,
          ts: Date.parse(nominatorBid.updatedAt),
        }
      : {
          owner: nom.nominatorOwner,
          playerOutId: nom.playerOutId,
          amount: nom.amount,
          ts: Date.parse(nom.createdAt),
        };
    const candidates: Candidate[] = [
      nominatorCandidate,
      ...bidsFromOthers.map((b) => ({
        owner: b.bidderOwner,
        playerOutId: b.playerOutId,
        amount: b.amount,
        ts: Date.parse(b.createdAt),
      })),
    ];

    const affordable = candidates.filter((c) => budgets[c.owner] >= c.amount);
    affordable.sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.ts - b.ts;
    });

    const winner = affordable[0];
    const pidIn = nom.playerInId;

    if (!winner) {
      push(
        logEntry("reveal", `No valid winner for nomination ${pidIn} (budget).`, {
          nominationId: nom.id,
        }),
      );
      continue;
    }

    const rWin = [...(rosters[winner.owner] ?? [])];
    if (!rWin.includes(winner.playerOutId) || rWin.includes(pidIn)) {
      push(
        logEntry("reveal", `Skipped ${pidIn}: roster changed for ${winner.owner}.`, {
          nominationId: nom.id,
        }),
      );
      continue;
    }

    const nextR = rWin.filter((id) => id !== winner.playerOutId);
    nextR.push(pidIn);
    rosters[winner.owner] = nextR;

    budgets[winner.owner] = budgets[winner.owner] - winner.amount;

    const tReveal = nowIso();
    rosterHistory.push({
      at: tReveal,
      roundId: state.roundId,
      orderInRound: orderInRound++,
      winner: winner.owner,
      playerOutId: winner.playerOutId,
      playerInId: pidIn,
      effectiveAfterColumnId: revealEffectiveAfterColumnId,
    });

    const allBids: CompletedBidPort[] = [
      {
        owner: nom.nominatorOwner,
        amount: nominatorBid ? nominatorBid.amount : nom.amount,
        playerOutId: nominatorBid ? nominatorBid.playerOutId : nom.playerOutId,
        placedAt: nominatorBid ? nominatorBid.updatedAt : nom.createdAt,
        result: winner.owner === nom.nominatorOwner ? "WON" : "LOST",
      },
      ...bidsFromOthers.map((b): CompletedBidPort => ({
        owner: b.bidderOwner,
        amount: b.amount,
        playerOutId: b.playerOutId,
        placedAt: b.createdAt,
        result: winner.owner === b.bidderOwner ? "WON" : "LOST",
      })),
    ];
    completedTransfers.push({
      id: nom.id,
      roundId: state.roundId,
      revealedAt: tReveal,
      playerInId: pidIn,
      nominatorOwner: nom.nominatorOwner,
      bids: allBids,
      effectiveAfterColumnId: revealEffectiveAfterColumnId,
    });

    push(
      logEntry(
        "reveal",
        `${winner.owner} wins ${pidIn} for ${winner.amount} (drops ${winner.playerOutId}).`,
        {
          nominationId: nom.id,
          winner: winner.owner,
          amount: winner.amount,
          playerInId: pidIn,
          playerOutId: winner.playerOutId,
          effectiveAfterColumnId: revealEffectiveAfterColumnId,
        },
      ),
    );
  }

  const next: WaiverPersistentStatePort = {
    ...state,
    phase: "idle",
    rosters,
    budgets,
    rosterHistory,
    nominations: [],
    bids: [],
    log,
    waiverRound: undefined,
    nominationWindowClosedLoggedForRoundId: undefined,
  };

  return {
    ok: true,
    state: pushLog(next, logEntry("phase", "Waiver round revealed; rosters updated.")),
    completedTransfers,
  };
}
