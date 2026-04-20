# Firebase + Firestore (league + waivers)

**Full step-by-step from scratch (including GitHub Actions):** [full-setup-walkthrough.md](./full-setup-walkthrough.md).

The **React app** is built and hosted on **GitHub Pages**. **Firebase Firestore** holds the live **league bundle** (meta, franchises, players, optional `waiverPool`, auction, rules, predictions) and **waiver state** (phases, nominations, bids, rosters, budgets).

Static JSON under `public/IPL-Fantasy-Phase-2/data/` is still shipped with the site: it is the **source of truth for edits in git**, a **bootstrap path** when the Firestore league document is empty, and the payload used by **Publish league to Firestore** (Waivers → Commissioner). Waiver nominations use `players.json` plus `waiver-pool.json` (see `npm run build:waiver-pool`).

## 1. Create a Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) → **Add project** → finish the wizard (Google Analytics optional).
2. Click **Web** (`</>`) → register an app → copy the config values you need:
   - `apiKey`
   - `authDomain`
   - `projectId`

You do **not** need Firebase Hosting if you already use GitHub Pages.

## 2. Enable Firestore

1. **Build** → **Firestore Database** → **Create database**.
2. Choose a location close to your players (e.g. `asia-south1`).
3. Start in **production mode** if you will paste rules immediately, or **test mode** for a quick test (expires; insecure).

### Security rules (private league)

For a **small private league**, many groups use open read/write on **only** the `iplFantasy` documents. This is **not** secure against anyone who inspects the client; upgrade to Firebase Auth later if needed.

In Firestore → **Rules**, use something like:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /iplFantasy/{docId} {
      allow read, write: if true;
    }
  }
}
```

Click **Publish**.

This repo ships **`firestore.rules`** in the root: waivers and league bundle stay client-writable; **`fantasyMatchScores` is read-only from the browser** (update it with Admin SDK / your own tooling if you want live overlays). Deploy rules from GitHub (**Actions → Deploy Firebase backend**) — no local CLI required.

## 3. League source mode (`VITE_LEAGUE_SOURCE`)

When all three `VITE_FIREBASE_*` variables are set:

| Value | Behavior |
|-------|----------|
| **`auto`** (default) | Subscribe to `iplFantasy/leagueBundle`. If the document is missing or empty, load JSON from the same GitHub Pages site and show a notice on Home. |
| **`firestore`** | Firestore only; no static fallback. Use after you have published the league at least once. |
| **`static`** | Always load league JSON from `public/.../data/*.json` (Firestore ignored for league data; waivers can still sync if Firebase env is set). |

Set in `.env.local` locally or add a repository variable / secret for the build if you need a non-default value.

### Single source of truth (avoid split state)

When Firebase is enabled, **Firestore** should drive everything users see, except where noted:

| What | Canonical store | Notes |
|------|-----------------|--------|
| League JSON (franchises, players, `byMatch`, `seasonTotal`, meta, rules, …) | `iplFantasy/leagueBundle` | Static files in git are the **edit template** and **Publish** input—not what other devices see once the doc exists. |
| Match-level fantasy overlays (synced scores) | `iplFantasy/fantasyMatchScores` | Merged into the bundle in the client. Clear + republish if overlays and bundle disagree. |
| Waiver engine (phase, rosters, budgets, noms, bids) | `iplFantasy/waiverState` | Server callables update this; clients listen. |
| Completed waiver rounds | `completedTransfers` (+ optional `waiverNominations` / `waiverBids`) | Cleared by full reset. |
| Migrated mirror (optional) | `players`, `owners`, `ownershipPeriods`, `matchPlayerPoints`, `appSettings/league` | Rebuilt by **Migrate to collections** from bundle + waiver + scores; full reset strips bundle stats and clears match rows before resetting waivers. |

**Production recommendation:** set `VITE_LEAGUE_SOURCE=firestore` (the GitHub Pages workflow defaults to this; override with repository variable `VITE_LEAGUE_SOURCE` if you need `auto` until the first publish). Do **not** use `static` for league data while Firebase is on, or the UI can show **stale squads/points from `public/.../data`** while waivers and scores follow Firestore—especially confusing after a reset.

The app shows a **Home** banner when the league bundle is not loaded from Firestore but Firebase is configured (`auto` fallback to empty doc, or explicit `static` mode).

## 4. First-time: seed league in Firestore

1. Deploy the site with Firebase env vars so the app can talk to Firestore.
2. Sign in on **Waivers** as **Commissioner** (admin).
3. Click **Publish league to Firestore**. That reads the merged JSON from your deployed static paths and writes document `iplFantasy/leagueBundle` with field `payload` (full `LeagueBundle`).

After that, all clients with `auto` or `firestore` load the league from Firestore and receive live updates when you publish again.

## 5. Local development

1. Copy `.env.example` to **`.env.local`** in the repo root (this file is gitignored).
2. Fill in:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
```

3. Run `npm run dev`, open **Waivers**. You should see **Firestore: listening** under the page title when all three variables are set.

## 6. Live site (GitHub Actions)

Vite embeds `VITE_*` variables at **build** time. The GitHub Pages workflow passes optional secrets into `npm run build`.

1. On GitHub: repo **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add exactly these names (case-sensitive):

| Secret name | Value |
|-------------|--------|
| `VITE_FIREBASE_API_KEY` | from Firebase web config |
| `VITE_FIREBASE_AUTH_DOMAIN` | e.g. `project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | project id string |

3. Push to `main` (or re-run **Deploy to GitHub Pages**). After deploy, open the live site → **Waivers** and confirm **Firestore: listening**.

If a secret is missing, the build still succeeds; the app uses **static JSON only** for the league and **localStorage-only** waivers (no cross-device sync).

### Admin score sync (Cloud Functions)

After **Waivers → Admin** login, the **Score sync** nav link runs a callable that reads **ESPNcricinfo** scorecards server-side (match query + date), computes fantasy points, and can merge a match into `iplFantasy/fantasyMatchScores`.

1. **Deploy functions** (local Firebase CLI or GitHub Action **Deploy Firebase backend**).
2. The score-sync callable uses a **hardcoded passphrase** in the repo (`ViratAnushka`), shared between `functions/src/index.ts` and `src/lib/firebase/adminScoreSyncCall.ts`. No `ADMIN_SCORE_SYNC_SECRET` in Secret Manager is required. Change both files together if you want a different value.
3. Optional: set the web app region to match the function (default **`asia-south1`**):

   ```env
   VITE_FIREBASE_FUNCTIONS_REGION=asia-south1
   ```

4. On **Score sync**, enter match query + date; **Write to Firestore** is on by default. The Waivers Admin password is separate (honor-system login only).

**IPL season URL:** score sync loads the full fixture list from ESPN (currently **IPL 2026** — `match-schedule-fixtures-and-results` for series `ipl-2026-1510719`). When ESPN publishes a new IPL edition, update `IPL_FIXTURES_AND_RESULTS_URL` in `functions/src/scrape/espn.ts` and redeploy functions.

The GitHub Actions service account needs permission to deploy Cloud Functions. Secret Manager is not required for score sync unless you add other secrets later.

## 7. Data model in Firestore

| Collection | Document ID | Fields |
|------------|-------------|--------|
| `iplFantasy` | `leagueBundle` | `payload` (object: full league bundle), `updatedAt` (server timestamp) |
| `iplFantasy` | `waiverState` | `payload` (object: same shape as localStorage waiver state), `updatedAt` (server timestamp) |
| `iplFantasy` | `fantasyMatchScores` | `matches` (map: `matchKey` → `{ matchKey, matchLabel, matchDate, status?, playerPoints }`) — read in the app; written by the `adminSyncMatchScores` callable (Admin SDK) |
| `matchPlayerPoints` | *(doc per row)* | Per-player match breakdowns; rebuilt by **Migrate to collections** |
| `completedTransfers`, `waiverNominations`, `waiverBids` | *(docs)* | Waiver history; cleared by full reset-to-auction |
| `players`, `owners`, `ownershipPeriods` | *(docs)* | Migrated mirror for server waivers; periods use **`effectiveAfterColumnId`** (match column id) for sequence-based points, not calendar overlap |
| `appSettings` | `league` | `isWaiverWindowOpen`, `waiverPhase` when using migrated path |

## 8. Troubleshooting

| Symptom | Check |
|---------|--------|
| **Firestore: listening** never appears | All three `VITE_*` vars set? Rebuild after changing `.env` or secrets. |
| Permission denied in browser console | Firestore **Rules** allow read/write for `iplFantasy/{docId}`. |
| League empty with `firestore` mode | Run **Publish league to Firestore** once, or create `leagueBundle` manually. |
| Home shows “Firestore league document is empty” | Expected in `auto` until you publish; static JSON is used meanwhile. |
| Two browsers show different waivers | One build has Firebase env, the other doesn’t; or rules blocked writes on one side. |
| `Missing or insufficient permissions` | Rules too strict; or wrong project ID. |
| Deploy error: function in project but **not in local source** (non-interactive) | An old function name/region is still deployed. The **Deploy Firebase backend** workflow uses `--force` so GitHub Actions can remove orphans. Or delete once locally: `firebase functions:delete OLD_NAME --region REGION`. |

## 9. What stays in the repo (GitHub)

- League JSON files under **`public/IPL-Fantasy-Phase-2/data/`** — edit, commit, push; then **Publish league to Firestore** so the live app picks up changes without redeploying (or redeploy and publish again).
- Waiver **login** passwords → still the in-app honor-system list (`src/lib/waiver/auth.ts`), not Firebase Authentication.
