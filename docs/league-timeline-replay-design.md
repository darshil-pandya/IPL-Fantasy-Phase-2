# League timeline & replay (event-sourced) — design

This document specifies the **event schema**, **replay algorithm**, and **integration** with existing Firestore (`matchPlayerPoints`, `fantasyMatchScores`, `ownershipPeriods`, `owners`, waiver UI). No implementation yet — implement after review and a dry run on **staging or exported JSON**.

## Goals

1. **Single ordered timeline** of transfers and score applications so backfill matches real-world sequence (IST wall times).
2. **Rebuild derived state** from that timeline + immutable match points: `ownershipPeriods`, owner `squad` + `remainingBudget`, and optional audit tables.
3. **Keep waiver UI** unchanged for day-to-day use: new real transfers append events (or dual-write) and trigger the same replay or incremental update.
4. **Do not roll back** recent client/cloud `effectiveAfterColumnId` fixes until replay is verified; after replay owns attribution, those UI fields become secondary or legacy-only.

## Clarifications captured

| Topic | Decision |
|--------|----------|
| Match points source | Existing `iplFantasy/fantasyMatchScores` + `matchPlayerPoints` (no re-scrape during replay). |
| “Roster at start of match” | **Initial squads = original auction** (`franchises.json` / published `owners` at season start). **Before match 1**, every player is only on their auction owner. After each **transfer** at time `t`, rosters change; a later **score application** for match M attributes points to whoever holds the player under the rules below. |
| After simulation | **Waiver UI stays**; it should eventually **append** canonical events (via Cloud Functions) so production does not diverge from the timeline. |

**Example (your wording):** Before 1 Apr transfers, Sai Kishore is on Hersh and Tushar Deshpande is on Bhavya — that is the **evolving** roster state, not “every match uses auction rosters forever.”

## Critical detail: `matchPlayedAt` vs transfer times

Backend attribution today (`functions/src/scoring/ownerPoints.ts`) uses:

- `period.acquiredAt <= matchPlayedAt`
- `matchPlayedAt < period.releasedAt` (or `releasedAt` null)

So **ordering is entirely string/ISO comparison** on `matchPlayedAt` and period bounds.

If `matchPlayerPoints.matchPlayedAt` is the **ESPN match start** (or midday) and your transfer is **same calendar day 7 PM IST**, it is possible that `matchPlayedAt` sorts **before** the transfer instant. Then the engine would still award that match’s points to the **pre-transfer** roster, even though you intend “match 5 sync at 11:58 PM” to mean points are applied **after** the 7 PM transfers.

**Required policy (pick one for implementation):**

- **A — Attribution anchor (recommended):** For each logical match, define `attributionInstantUtc` = the instant you list for “score sync” (e.g. 1 Apr 11:58 PM IST → ISO UTC). During replay, **attribute** using that instant: either temporarily override `matchPlayedAt` in an in-memory copy of MPP rows for that match, or **one-time patch** Firestore `matchPlayerPoints` so `matchPlayedAt` for all rows with that `matchId` equals `attributionInstantUtc`.  
- **B — Trust existing `matchPlayedAt`:** Only valid if every `matchPlayedAt` is already **after** any same-day transfers that must affect that match (verify with a script before replay).

The sample timeline in this doc assumes **A** unless you prove **B** for all 11 matches.

## Event schema (versioned)

All times are stored as **UTC ISO-8601** (`...Z` or explicit offset). Convert IST at authoring time.

```typescript
// leagueTimeline/events — logical types (v1)

export type LeagueEventV1 =
  | SeasonBaselineV1
  | TransferV1
  | ScoreSyncAppliedV1;

/** Optional: explicit reset marker for audits */
export interface SeasonBaselineV1 {
  kind: "season_baseline";
  schemaVersion: 1;
  /** Monotonic sequence within a league run */
  seq: number;
  effectiveAt: string; // ISO UTC
  source: "auction_json" | "firestore_snapshot";
  /** Ref or hash of franchises payload used */
  franchisesRef?: string;
}

export interface TransferV1 {
  kind: "transfer";
  schemaVersion: 1;
  seq: number;
  effectiveAt: string; // ISO UTC — when the swap and budget debit take effect
  ownerId: string; // display name, same as Firestore owners/{id}
  playerOutId: string;
  playerInId: string;
  amountInr: number;
  /** Traceability */
  note?: string;
  waiverRoundId?: number;
  nominationId?: string;
}

/**
 * Declares that match points are “applied” at this instant for attribution.
 * Does not recompute fantasy points — reads existing MPP / fantasyMatchScores.
 */
export interface ScoreSyncAppliedV1 {
  kind: "score_sync_applied";
  schemaVersion: 1;
  seq: number;
  effectiveAt: string; // ISO UTC — should match attribution policy (see above)
  matchId: string; // same as matchKey / MPP grouping key
  /** If using policy A, equals effectiveAt; else omitted */
  attributionInstantUtc?: string;
}
```

**Ordering:** Events are processed in strict **`seq`** order (or `seq` tie-break by `effectiveAt`). Every event must have a unique `seq`.

**Idempotency:** Replays should be keyed by `replayRunId` (optional) so you can write outputs to a staging path or compare hashes before touching production.

## Firestore layout (proposal)

| Collection / doc | Purpose |
|------------------|--------|
| `leagueTimeline/events/{seq}` | Append-only event documents (`LeagueEventV1` + metadata: `createdBy`, `importBatchId`). |
| `leagueTimeline/meta/current` | `lastSeq`, `lastReplayAt`, `contentHash` of derived state. |
| Existing `ownershipPeriods` | **Overwritten** by replay output (or batch delete + rewrite). |
| Existing `owners` | **Squads + remainingBudget** overwritten from replay end state. |
| Existing `players` | `currentOwnerId`, `isOwned` updated from final rosters + pool rules. |
| `matchPlayerPoints` | **Read-only** during replay unless policy A applies a one-time patch. |
| `iplFantasy/waiverState` | After cutover, either rebuilt from timeline or kept in sync via waiver Cloud Functions appending events. |

Alternative: store the whole timeline as a single versioned JSON in Storage for bulk import; still normalize to `events/{seq}` for incremental waiver appends.

## Replay function (pure core + I/O shell)

### Inputs

1. Ordered `LeagueEventV1[]`.
2. `initialSquads: Record<ownerId, string[]>` from auction.
3. `budgetStart` (e.g. `250_000` — align with `WAIVER_BUDGET_START`).
4. Full `MatchPlayerPointDoc[]` (or loaded per `matchId` as needed).
5. `attributionPolicy`: `{ mode: "use_mpp_matchPlayedAt" } | { mode: "use_anchor"; anchors: Record<matchId, string> }`.

### State machine (in memory)

```
squads: Map<ownerId, Set<playerId>>
budgets: Map<ownerId, number>
ownershipPeriods: OwnershipPeriodDoc[]  // append-only with updates to releasedAt
activePeriodKey: Map<string, OwnershipPeriodDoc>  // key = `${ownerId}::${playerId}`
pool: Set<playerId>  // optional; derivable from who has no active owner period
```

**Initialize (after `season_baseline` or at replay start):**

- For each auction player on owner O: create period  
  `{ playerId, ownerId: O, acquiredAt: SEASON_START, releasedAt: null }`  
  (reuse same `SEASON_START` convention as migrate, or set from baseline event).
- `budgets[O] = budgetStart`.

**On `transfer` at `t`:**

1. Validate: `playerOutId` in `squads[ownerId]`, `playerInId` not in any squad (league-specific: pool-only pickups).
2. Validate squad composition + budget (same rules as `validateSquadComposition` / waiver handlers).
3. `budgets[ownerId] -= amountInr`.
4. Update squads: remove `playerOutId`, add `playerInId`.
5. Close active period for `(ownerId, playerOutId)`: set `releasedAt = t`.
6. Open period for `(ownerId, playerInId)`: `acquiredAt = t`, `releasedAt = null`.

**Dropped players:** Period for `playerOutId` ends at `t`; no new period until a later `transfer` brings them in (pool).

**On `score_sync_applied`:**

- No mutation to squads/budgets/periods.
- Optionally validate that MPP rows exist for `matchId`.
- If using anchor policy, ensure anchor is recorded for `calculateOwnerPoints` pass.

### Output phase

After all events:

1. Write `ownershipPeriods` to Firestore.
2. Write each `owners/{id}`: `squad` array, `remainingBudget`.
3. Update `players` docs for `isOwned` / `currentOwnerId`.
4. Run **`calculateOwnerPoints` per owner** (existing pure function) against final periods + MPP (with patched `matchPlayedAt` if policy A).

### Waiver UI alignment (later)

- `waiverSettle` (and local reveal, if still used) should **append** a `TransferV1` (and optional metadata) with `effectiveAt = now` or commissioner-chosen instant, then call **incremental replay** or full replay from `seq` checkpoint.
- Avoid writing `rosterHistory.effectiveAfterColumnId: null` for anything that still feeds scoring; timeline becomes authoritative.

## Mapping your 16-step scenario

Authoring workflow:

1. Fix a **single timezone source** (IST → UTC) for every `effectiveAt`.
2. Expand each bullet into **one or more** `TransferV1` rows (same `effectiveAt` if simultaneous; use distinct `seq` with stable order within the second).
3. Insert `ScoreSyncAppliedV1` after each match block with `matchId` matching keys in `fantasyMatchScores.matches` / `matchPlayerPoints`.
4. Run **seq** = global order when sorting: e.g.  
   `… match3_sync → … → match4_sync → transfers_1apr_7pm → match5_sync → …`

**Batch import:** YAML/JSON file in repo (e.g. `scripts/data/ipl2026-timeline.v1.json`) under version control; admin callable `importTimeline` validates IDs against `players` collection and dry-runs replay.

## Verification checklist (staging)

1. Load events + auction squads only — no transfers — replay — totals match **match-1-only** world.
2. After full timeline — owner totals match your spreadsheet (± rounding).
3. Spot-check **Sanket / Jaydev Unadkat**: no points for matches 1–7 on Sanket if transfer is after match 7 sync instant under policy A.
4. Budgets match sum of `amountInr` per owner.
5. Squad composition valid after every transfer.

## Production cutover (once)

1. Export current Firestore (backup).
2. Reset: clear `ownershipPeriods`, reset `owners` to auction, clear waiver state or mark obsolete, optionally clear MPP only if re-importing (you said use existing MPP — **do not clear** unless fixing anchors).
3. Import timeline events.
4. Run replay; write derived collections.
5. Deploy Functions + client that append new events after settle.
6. Only then consider simplifying client `rosterHistory` / `effectiveAfterColumnId` paths if timeline is sole source of truth.

## Risks

- **Wrong IST → UTC** on any row corrupts attribution for same-day match vs transfer.
- **Duplicate player IDs** (name typos) fail validation — good; fix in import file.
- **Parallel edits** during replay (owners using app) — freeze waivers during cutover.

## Next implementation tickets (suggested)

1. `packages/timeline` or `functions/src/timeline/` — types + pure `replayTimeline()` + unit tests (small fake MPP set).
2. Script: `validateTimelineJson.ts` — checks player IDs, seq uniqueness, chronological sanity.
3. Callable: `adminReplayTimeline` — dry-run vs commit; staging only first.
4. Waiver settle: append `TransferV1` + trigger replay from checkpoint.

---

*Document version: 1.0 — aligned with repo patterns (`calculateOwnerPoints`, migrate ownership build, `WAIVER_BUDGET_START = 250_000`).*
