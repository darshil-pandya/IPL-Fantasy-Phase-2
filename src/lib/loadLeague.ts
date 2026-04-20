import type {
  AuctionState,
  Franchise,
  LeagueBundle,
  LeagueMeta,
  LeagueRules,
  Player,
  PredictionsState,
} from "../types";
import { buildStandings, playerMapFromList } from "./buildStandings";

/**
 * JSON lives under `public/<repo>/data/` (same segment as Vite `base` / GitHub repo name),
 * so deployed URLs are `/IPL-Fantasy-Phase-2/IPL-Fantasy-Phase-2/data/...`, not `/IPL-Fantasy-Phase-2/data/...`.
 */
function leagueDataPrefix(): string {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const repo = basePath.slice(basePath.lastIndexOf("/") + 1) || "IPL-Fantasy-Phase-2";
  return `${repo}/data`;
}

async function fetchJson<T>(path: string): Promise<T> {
  const base = import.meta.env.BASE_URL;
  const url = `${base}${path.replace(/^\//, "")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchWaiverPoolPlayers(d: string): Promise<Player[]> {
  try {
    const w = await fetchJson<{ players?: Player[] }>(`${d}/waiver-pool.json`);
    return Array.isArray(w.players) ? w.players : [];
  } catch {
    return [];
  }
}

/** Loads league JSON from the static site (GitHub Pages `public/.../data/`). */
export async function fetchLeagueBundleStatic(): Promise<LeagueBundle> {
  const d = leagueDataPrefix();
  const [meta, franchiseFile, playerFile, auction, rules, predictions, waiverPool] =
    await Promise.all([
      fetchJson<LeagueMeta>(`${d}/meta.json`),
      fetchJson<{ franchises: Franchise[] }>(`${d}/franchises.json`),
      fetchJson<{ players: Player[] }>(`${d}/players.json`),
      fetchJson<AuctionState>(`${d}/auction.json`),
      fetchJson<LeagueRules>(`${d}/rules.json`),
      fetchJson<PredictionsState>(`${d}/predictions.json`),
      fetchWaiverPoolPlayers(d),
    ]);

  return {
    meta,
    franchises: franchiseFile.franchises,
    players: playerFile.players,
    waiverPool: waiverPool.length > 0 ? waiverPool : undefined,
    auction,
    rules,
    predictions,
  };
}

export function summarizeBundle(bundle: LeagueBundle) {
  const standings = buildStandings(bundle.franchises, bundle.players);
  const sorted = [...standings].sort((a, b) => b.totalPoints - a.totalPoints);
  const pmap = playerMapFromList(bundle.players);
  return { standings, sorted, pmap };
}
