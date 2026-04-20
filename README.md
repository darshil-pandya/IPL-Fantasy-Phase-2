# IPL Fantasy

A mobile-friendly web app for a private IPL fantasy league: franchise squads, season and match-level points, a **By match** matrix (filter by franchise), auction pool visibility, and published rules. Built with [Vite](https://vitejs.dev/) and [React](https://react.dev/), deployable to **GitHub Pages**.

## Live site (after you deploy)

Once GitHub Pages is enabled, your friends open:

`https://<your-github-username>.github.io/IPL-Fantasy-Phase-2/`

Use **exact casing** for the repo name if your URL uses mixed case; the app’s asset `base` path must match the repository name (see `vite.config.ts`).

## Local development

1. Install [Node.js](https://nodejs.org/) (LTS).
2. In this folder:

```bash
npm install
npm run dev
```

3. Open the URL Vite prints (includes `/IPL-Fantasy-Phase-2/`). Edit JSON under `public/IPL-Fantasy-Phase-2/data/` and refresh the browser.

## Single-file UI preview (no build)

Open **`ipl-fantasy-ui-preview.html`** in Chrome, Edge, or Firefox (double-click or drag into the window). It embeds the same league JSON as `public/IPL-Fantasy-Phase-2/data/`, uses Tailwind via CDN, and mirrors the main screens (Home, Teams, team detail, Players, By match, Auction, Rules) with hash routing. The preview adds **sample match points** for a few players so standings and the match matrix are not empty.

To rebuild that file after you change JSON:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/merge-ui-preview.ps1
```

Source fragments: `preview-head.html`, `preview-app.js`, generated `preview-embed.json`.

## Deploy to GitHub Pages

1. Push this repository to GitHub (repo name should match the `REPO` constant in `vite.config.ts`, default `IPL-Fantasy-Phase-2`).
2. **Turn on Pages (required once):** In the repo go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch” and not “Disabled”). If this step is skipped, Actions will fail with **“Get Pages site failed” / HttpError: Not Found** on `configure-pages`.
3. Push to `main`; the workflow in `.github/workflows/deploy.yml` builds and publishes the `dist/IPL-Fantasy-Phase-2` folder. You can re-run a failed workflow from the **Actions** tab after fixing step 2.

Alternatively, after `npm run build`:

```bash
npx gh-pages -d dist/IPL-Fantasy-Phase-2
```

…with a `gh-pages` branch or your preferred Pages source.

If you rename the repository, update **both** `vite.config.ts` (`REPO` and `base`) **and** move data to `public/<new-repo-name>/data/` so URLs stay consistent.

## Firebase (optional — league + waivers in Firestore)

With `VITE_FIREBASE_*` set at build time, the app loads the **league bundle** from Firestore (`iplFantasy/leagueBundle`) and subscribes for live updates; **waiver state** syncs the same way (`iplFantasy/waiverState`). Static JSON in `public/.../data/` remains in git for editing and as a bootstrap input—commissioners use **Waivers → Publish league to Firestore** after deploy. **GitHub Actions** defaults to `VITE_LEAGUE_SOURCE=firestore` so production does not silently fall back to static JSON while waivers use Firestore (override with repository variable `VITE_LEAGUE_SOURCE` if needed). Setup: **[docs/firebase-waiver-setup.md](docs/firebase-waiver-setup.md)**. GitHub Pages: add **Actions secrets** `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, and `VITE_FIREBASE_PROJECT_ID`. Local dev uses `.env.local`.

## Updating league data

If you use **Firestore** for the live league, edit the JSON files below, commit, deploy (or rely on existing deploy), then open **Waivers** as commissioner and **Publish league to Firestore** so browsers load the new bundle without waiting for another path. With Firebase off, a refresh after deploy is enough.

| File | Purpose |
|------|---------|
| `public/IPL-Fantasy-Phase-2/data/franchises.json` | Seven franchises: `owner`, `teamName`, `playerIds` |
| `public/IPL-Fantasy-Phase-2/data/players.json` | Every player: `id`, `name`, `iplTeam`, `role`, optional `nationality` (`IND` / `OVS`), `seasonTotal`, `byMatch[]` |
| `public/IPL-Fantasy-Phase-2/data/auction.json` | `unsoldPlayerIds`, `sales[]` after each auction |
| `public/IPL-Fantasy-Phase-2/data/rules.json` | Team composition copy + scoring tables |
| `public/IPL-Fantasy-Phase-2/data/meta.json` | Season label, Cricbuzz link, last points update note |

**Auction workflow:** When a player is sold, add their `playerId` to the buyer’s `playerIds` in `franchises.json`, remove them from `unsoldPlayerIds`, append a row to `sales`, commit, and push. Everyone refreshes the site.

## Cricbuzz and points

The site does **not** scrape Cricbuzz (browser CORS and reliability make that unsuitable for a static GitHub Pages app). After each match, use the [Cricbuzz](https://www.cricbuzz.com/) scorecard and commentary, apply **your** scoring rules, then update `seasonTotal` and add a `byMatch` entry for each player in `players.json`. Set `lastPointsUpdate` in `meta.json` when you publish a batch of updates.

Fill in `rules.json` with your agreed **composition** and **scoring** text.

## Franchise owners & opening squads

Seven franchises (15 players each) are in `franchises.json` (player IDs) and `players.json` (names, IPL team, role, points).

All seven opening squads in `franchises.json` match the commissioner roster tables (including **Bhavya**, **Darshil**, **Hersh**, **Jash**, **Karan**, **Prajin**, **Sanket**).

If the **live** site still shows old squads, redeploy and use **Waivers → Publish league to Firestore** so Firestore picks up the latest `franchises.json`.

Owners: Darshil, Bhavya, Prajin, Sanket, Hersh, Jash, Karan.
