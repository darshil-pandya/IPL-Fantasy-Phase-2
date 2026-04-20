# IPL Fantasy: full setup in plain language (GitHub + Firebase)

This is **one checklist** from “nothing configured” to “live site + optional Firestore-backed league.” **Rules and functions** deploy from **GitHub Actions**. Score sync uses a **hardcoded passphrase** in the repo (no Secret Manager step for that). Other configuration uses **web consoles** (Firebase, Google Cloud, GitHub).

Skim **Before you start**, then follow **Phase A → C → D** in order.

**Match scores:** the app no longer uses a paid Cricket Data API. Points can stay in git (`players.json`) or you can write **`iplFantasy/fantasyMatchScores`** in Firestore (Admin SDK / script). The site also supports an **admin Score sync** flow: a Cloud Function reads **ESPNcricinfo** scorecards and merges into `fantasyMatchScores` (see [firebase-waiver-setup.md](./firebase-waiver-setup.md)). The site **reads** that document and merges per-match points when Firebase is configured.

---

## Before you start (what you need)

| Thing | Why |
|--------|-----|
| A **Google account** | Owns Firebase and Google Cloud. |
| A **GitHub account** | Hosts code and runs workflows. |
| This **repository** on GitHub with `main` (or your default branch). | Workflows run from it. |

**Time:** first time, budget about 30–60 minutes with breaks.

---

# Phase A — Firebase project (browser only)

### A1. Open or create a project

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. **Add project** (or select your existing project).
3. Finish the wizard (Google Analytics is optional).

### A2. Register a **Web app** (if you have not already)

1. In the project overview, click the **Web** icon `</>` (“Add app”).
2. Register the app (nickname anything, e.g. “IPL Fantasy”).
3. Copy these three values somewhere safe (you will paste them into GitHub later):

   - `apiKey` → GitHub secret **`VITE_FIREBASE_API_KEY`**
   - `authDomain` → **`VITE_FIREBASE_AUTH_DOMAIN`**
   - `projectId` → **`VITE_FIREBASE_PROJECT_ID`**

### A3. Turn on Firestore

1. Left menu: **Build** → **Firestore Database**.
2. **Create database**.
3. Pick a **region** (e.g. close to India: `asia-south1`).
4. Start in **production mode** if you will deploy rules from git soon; or test mode temporarily (less secure).

### A4. Enable **Authentication** (optional — for “authorized domains” if you use Auth)

1. **Build** → **Authentication** → **Get started**.
2. You do **not** have to enable Email/Password for this league app unless you want to.
3. If you use hosted sign-in flows, add your **GitHub Pages host** under **Authentication → Settings → Authorized domains** (Phase D).

---

# Phase C — GitHub repository secrets

GitHub → your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

### C1. Secrets for the **website** build (GitHub Pages)

Described in [firebase-waiver-setup.md](./firebase-waiver-setup.md). Create **three** secrets:

| Secret name | Value |
|-------------|--------|
| `VITE_FIREBASE_API_KEY` | From Firebase Web app config (Phase A2). |
| `VITE_FIREBASE_AUTH_DOMAIN` | From Firebase Web app config. |
| `VITE_FIREBASE_PROJECT_ID` | From Firebase Web app config (your **project id** string). |

Without these, the built site cannot talk to Firebase (no Waivers sync, no live league).

### C2. Secrets for **Deploy Firebase backend** workflow

| Secret name | Value |
|-------------|--------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full contents of a **service account JSON file** (Phase C3 below). **Entire file**, including `{` and `}`. |
| `VITE_FIREBASE_PROJECT_ID` | **Same** project id as in C1 (workflow uses it as `--project` for Firebase CLI). |

You only create **one** secret named `VITE_FIREBASE_PROJECT_ID`; it is used by **both** the Pages workflow and the backend workflow.

### C3. Create the **service account JSON** (browser-only)

1. Firebase Console → **Project settings** (gear) → **Service accounts**.
2. Tab **Firebase Admin SDK**.
3. Click **Generate new private key** → **Generate key**. A `.json` file downloads.
4. Open that file in any text editor → **Select all** → **Copy**.
5. GitHub → **New repository secret** → name **`FIREBASE_SERVICE_ACCOUNT_JSON`** → paste → **Add secret**.

**Never** commit this file into git.

### C4. If the backend workflow fails with “permission denied”

1. [Google Cloud Console](https://console.cloud.google.com/) → same project as Firebase.
2. **IAM & Admin** → **IAM** → find the `client_email` from your JSON.
3. **Add role** — for a private league, **Firebase Rules Admin** or **Editor** (while debugging) is enough to deploy **Firestore rules** from CI.

---

# Phase D — GitHub Pages + workflows

### D1. Turn on GitHub Pages with Actions

1. GitHub repo → **Settings** → **Pages**.
2. **Build and deployment** → **Source**: **GitHub Actions**.

### D2. Workflow files on `main`

- `.github/workflows/deploy.yml` — builds and publishes the **website**.
- `.github/workflows/firebase-backend.yml` — deploys **`firestore.rules`** and **Cloud Functions** (`adminSyncMatchScores`).
- `firebase.json`, `firestore.rules` in the repo root.

### D3. Run **Deploy Firebase backend** (first time)

1. **Actions** → **Deploy Firebase backend** → **Run workflow**.
2. Wait until green.

Score sync authentication uses a **hardcoded passphrase** in the repo (see [firebase-waiver-setup.md](./firebase-waiver-setup.md)); no `firebase functions:secrets:set` step is required for it.

This publishes **`firestore.rules`** (waivers + league bundle client-writable; **`fantasyMatchScores`** read-only from browsers) and deploys **Cloud Functions**. Callable writes to **`fantasyMatchScores`** using the Admin SDK.

### D4. **Deploy to GitHub Pages**

Push to `main` or run **Deploy to GitHub Pages** manually. Open your Pages URL.

### D5. **Authorized domains** (only if you use Firebase Auth flows from the site)

Firebase → **Authentication** → **Settings** → **Authorized domains** → add e.g. `youruser.github.io` (no `https://`, no path).

---

# Phase E — Verify

### E1. Website

Open the live site; **Waivers** appears when the three `VITE_FIREBASE_*` secrets were set at build time.

### E2. Firestore

- `iplFantasy` / `waiverState`, `leagueBundle` — after waivers / publish.
- `iplFantasy` / `fantasyMatchScores` — optional; update via **Score sync** (callable) or your own Admin SDK pipeline (field `matches`: map of `matchKey` → `{ matchKey, matchLabel, matchDate, playerPoints, status? }`).

### E3. Waivers

See [firebase-waiver-setup.md](./firebase-waiver-setup.md).

---

# Phase F — When something changes

| Situation | What to do |
|-----------|------------|
| `firestore.rules` | Push → **Deploy Firebase backend**. |
| React site | Push → **Deploy to GitHub Pages**. |
| Old **`syncMatchFantasyScores`** still listed in Firebase | Remove it under **Firebase Console → Build → Functions** (or Google Cloud Console) so you are not charged for an unused function. |

---

# Troubleshooting

| Failed step | Common cause |
|-------------|----------------|
| **Verify required GitHub Actions secrets** | Missing `VITE_FIREBASE_PROJECT_ID` or `FIREBASE_SERVICE_ACCOUNT_JSON`. |
| **Deploy Firestore rules** | Invalid JSON secret; service account missing **Firebase Rules Admin** (or broader role). |

---

## Related docs

- [firebase-waiver-setup.md](./firebase-waiver-setup.md) — Waivers, league bundle, `VITE_LEAGUE_SOURCE`, Pages secrets.
