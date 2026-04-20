# Mid-season auction — CSV roster import (implementation spec)

Use this document as the full prompt for implementing the feature in the IPL Fantasy Phase 2 codebase (React + Vite, Firestore, GitHub Pages).

---

## 1. Summary

Add a **Commissioner-only** flow under **Waivers** to **upload a CSV** that defines **final squads** after a mid-season auction:

- **7 franchises × 15 players** (105 rows of data).
- CSV includes a **header row**; data starts on row 2.
- **No new players**: every `player_id` must already exist in the league bundle’s `players` list.
- Players **not** on any franchise roster after import must be placed **wherever the existing codebase expects** (waiver pool / unsold / etc.) so Waivers and nominations stay **consistent** with current logic—**centralize** or **reuse** the same invariants as “Publish league to Firestore” / bundle updates.
- **Waiver budgets**: **keep** each owner’s **current** budget; **do not** reset.
- **Waiver state**: import allowed **only when waiver phase is `idle`** (and any other “safe idle” checks the app already needs).
- **Past fantasy/match scores**: **must not** be changed.
- **Teams tab / former players**: **No backfill** of old season history from JSON. Teams already show history from waivers; **after** this import, also surface players who were on a franchise’s **pre-upload 15** but **not** on their **post-upload 15** (replaced in this auction), alongside existing waiver-driven history—via **`rosterHistory`** (or equivalent) events for this event only.
- **Player fields** (`iplTeam`, `role`, `nationality`): update in stored bundle **only when** the CSV value **differs** from current data for that `player_id`.
- **Validation**: if **anything** is invalid, show **clear errors** (including row numbers) and **do not** write any live data (atomic / all-or-nothing).
- **Composition rules** (max 3 per IPL team, OVS caps, etc.): **not** auto-enforced; the commissioner validates in the sheet. **Do** reject **bad/invalid data** (unknown ids, wrong enums, wrong owners, wrong row counts, duplicates, parse errors).

**Runtime source of truth:** **Firestore** (`iplFantasy/leagueBundle` and waiver state as today). **Git** remains for intentional snapshots; optional **export JSON** after success is nice-to-have, not required for MVP.

---

## 2. CSV format

### 2.1 Header row (required)

The **first line** must be headers **exactly** as below (comma-separated). **Do not** treat the header row as data.

```text
player_id,name,role,ipl_team,nationality,franchise_owner
```

- Prefer **mapping by column name** (not column index) so minor column order changes don’t break imports.
- Encoding: **UTF-8** (document whether BOM is accepted).

### 2.2 Columns

| Column             | Required | Description |
|--------------------|----------|-------------|
| `player_id`        | Yes      | Stable id matching `players[].id` in the league bundle. |
| `name`             | Yes      | Human-readable; used for errors and confirmation. |
| `role`             | Yes      | Must match app enums (e.g. BAT, BOWL, WK, AR — follow existing types). |
| `ipl_team`         | Yes      | IPL team code as used in the app (e.g. CSK, MI). |
| `nationality`      | Yes      | e.g. IND / OVS per app convention. |
| `franchise_owner`  | Yes      | Must match an existing franchise **`owner`** string **exactly** (spelling and casing). |

### 2.3 Data rows

- **Exactly 105** data rows (7 owners × 15 players), unless the codebase’s franchise count differs (today: **7** franchises, **15** each).
- **No duplicate `player_id`** across the file.
- Every `player_id` must **exist** in the current league `players` array before import.

---

## 3. Preconditions

1. **Commissioner / admin only** — same authorization model as other commissioner actions in Waivers.
2. **Waiver state** must be **`idle`** (and satisfy any additional “no active waiver round” rules). If not idle, **block** import with an explicit message.

---

## 4. Validation (all before any Firestore write)

Run validation **entirely in memory** first. On **any** failure:

- Show a **list of errors** with **row numbers** (relative to file; data rows = line 2 onward) and **reasons**.
- **Do not** partially update Firestore or local state.

Suggested checks (non-exhaustive; implement completely):

- CSV parseable; required columns present.
- Row count = **105** data rows; **7** distinct `franchise_owner` values; **15** rows per owner.
- Every `franchise_owner` matches a known franchise owner.
- Every `player_id` exists in current bundle `players`.
- No duplicate `player_id`.
- `role`, `ipl_team`, `nationality` values are **valid** for the app (reject typos / unknown codes).
- Optional: sanity checks on `name` vs existing player record (warn vs error—product choice; default: **error** if `player_id` maps to a different canonical name if the app stores one).

**Composition rules** (IPL team limits, OVS, position mix): **not** enforced automatically; commissioner responsibility. Invalid **data shape** still fails validation.

---

## 5. Successful import — data changes (atomic)

Apply updates in **one atomic operation** (transaction or batched writes with clear failure semantics) so subscribers never see inconsistent squads.

### 5.1 Franchises

- Set each franchise’s `playerIds` to the 15 `player_id` values from the CSV for that `franchise_owner`.

### 5.2 Players array

- For each `player_id` in the CSV, if `ipl_team`, `role`, or `nationality` **differs** from the current `players` entry, **update** those fields only.
- Do **not** overwrite unrelated fields unnecessarily (e.g. points history) unless required by types.

### 5.3 Players not assigned to any franchise

- All league `player_id`s **not** in any of the 7×15 rosters must be reflected in **`waiverPool`**, **`auction.unsoldPlayerIds`**, and any other bundle fields **exactly as required by existing app logic** so nomination availability and roster math match today’s behavior. **Refactor into one shared function** if needed so “publish league” and “CSV import” stay aligned.

### 5.4 Waiver state

- **Preserve** each owner’s **current waiver budget** (no reset to starting budget).
- Keep **`phase`** consistent with **idle** import rule; avoid clearing history unless necessary—**minimal** changes to nominations/bids/logs for idle state.

### 5.5 Former players for Teams tab (this event only)

- **No** historical backfill from old static JSON.
- Compute **per franchise**: set **A** = `playerIds` **before** import, **B** = `playerIds` **after** import. Players in **A \\ B** were **dropped** from that franchise in this auction.
- Append **`rosterHistory`** (or existing equivalent) events so the Teams UI can list these players as **former** alongside data already coming from waiver history. **Do not** alter stored **match** or **fantasy** points documents for past matches.

### 5.6 Persistence

- Write updated **`leagueBundle`** (and any waiver state patches) to Firestore per existing paths (`iplFantasy/leagueBundle`, `iplFantasy/waiverState`, etc.—follow current code).

---

## 6. UX

- Flow: choose file → validate → show errors **or** confirmation summary → apply.
- On failure: **errors only**; ask user to **fix CSV and re-upload**.
- On success: short confirmation; refresh league data as needed.

---

## 7. Non-goals

- Building the auction UI (bidding, timers).
- Introducing **new** `player_id`s not already in the league.
- Auto-enforcing squad composition rules beyond **validity** of fields.
- Auto-committing to **Git** from the browser (optional export/download is a separate nice-to-have).

---

## 8. Acceptance criteria

- [ ] Invalid CSV → **no** change to live Firestore data; clear **row-level** errors.
- [ ] Valid CSV → squads and player metadata updates applied; **105** assignments; pool/unsold consistent; waivers **idle**; budgets **unchanged** from pre-import.
- [ ] Past scores unchanged.
- [ ] Teams experience: former players from waivers **plus** players replaced by this import (pre 15 minus post 15 per franchise), **without** backfilling older history.
- [ ] `iplTeam` / `role` / `nationality` updated **only when** CSV differs from current.

---

## 9. Files / areas likely to touch (for implementers)

- `src/pages/Waivers.tsx` — Commissioner UI (file input, validation feedback, apply).
- `src/context/WaiverContext.tsx` / `src/lib/waiver/*` — idle checks, `rosterHistory`, budgets.
- `src/lib/firebase/leagueRemote.ts` / waiver remote — Firestore writes; may need **callable** for atomic server-side apply if client writes are too large or need admin rules.
- `firestore.rules` — only if new callables or paths are added; keep security model consistent.
- Types in `src/types.ts` — if new helper types for import summary/errors.

---

## 10. Example header + one data row (illustrative)

```csv
player_id,name,role,ipl_team,nationality,franchise_owner
virat-kohli,Virat Kohli,BAT,RCB,IND,Bhavya
```

(Values are illustrative; `franchise_owner` must match real owners in the league.)

---

*Document version: aligned with product decisions from the mid-season auction CSV import discussion.*
