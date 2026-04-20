import type {
  FantasyMatchOverlayEntry,
  LeagueBundle,
  Player,
  PlayerSeasonFantasyPoints,
} from "../../types";
import { SEASON_FANTASY_POINT_KEYS } from "../playerFantasyPoints";

function addSeasonFantasySlice(
  base: PlayerSeasonFantasyPoints | undefined,
  slice: PlayerSeasonFantasyPoints,
): PlayerSeasonFantasyPoints {
  const out: PlayerSeasonFantasyPoints = base ? { ...base } : {};
  for (const k of SEASON_FANTASY_POINT_KEYS) {
    const add = slice[k];
    if (typeof add !== "number" || !Number.isFinite(add) || add === 0) continue;
    const prev = out[k];
    const p = typeof prev === "number" && Number.isFinite(prev) ? prev : 0;
    out[k] = Math.round((p + add) * 100) / 100;
  }
  return out;
}

function mergeSeasonFantasyFromOverlays(
  base: PlayerSeasonFantasyPoints | undefined,
  overlays: FantasyMatchOverlayEntry[],
  playerId: string,
): PlayerSeasonFantasyPoints | undefined {
  let acc: PlayerSeasonFantasyPoints | undefined = base ? { ...base } : undefined;
  for (const o of overlays) {
    if (o.status === "abandoned") continue;
    const slice = o.playerBreakdown?.[playerId];
    if (!slice) continue;
    acc = addSeasonFantasySlice(acc, slice);
  }
  return acc;
}

function applyOverlaysToPlayer(
  p: Player,
  overlays: FantasyMatchOverlayEntry[],
): Player {
  let byMatch = p.byMatch.map((m) => ({ ...m }));
  for (const o of overlays) {
    if (o.status === "abandoned") {
      byMatch = byMatch.filter(
        (m) => (m.matchKey ?? m.matchLabel) !== o.matchKey,
      );
      continue;
    }
    const pts = o.playerPoints[p.id];
    if (pts === undefined) continue;
    byMatch = byMatch.filter(
      (m) => (m.matchKey ?? m.matchLabel) !== o.matchKey,
    );
    byMatch.push({
      matchLabel: o.matchLabel,
      matchDate: o.matchDate,
      points: pts,
      matchKey: o.matchKey,
    });
  }
  byMatch.sort((a, b) => a.matchDate.localeCompare(b.matchDate));
  const seasonTotal = byMatch.reduce((s, m) => s + m.points, 0);
  const seasonFantasyPoints = mergeSeasonFantasyFromOverlays(
    p.seasonFantasyPoints,
    overlays,
    p.id,
  );
  const next: Player = { ...p, byMatch, seasonTotal };
  if (seasonFantasyPoints !== undefined) {
    next.seasonFantasyPoints = seasonFantasyPoints;
  }
  return next;
}

function applyToPlayers(
  players: Player[],
  overlays: FantasyMatchOverlayEntry[],
): Player[] {
  if (overlays.length === 0) return players;
  return players.map((p) => applyOverlaysToPlayer(p, overlays));
}

/** Merges Firestore fantasy overlays into roster + waiver pool players (immutable). */
export function mergeBundleWithFantasyOverlays(
  base: LeagueBundle,
  overlays: FantasyMatchOverlayEntry[],
): LeagueBundle {
  if (overlays.length === 0) return base;
  return {
    ...base,
    players: applyToPlayers(base.players, overlays),
    waiverPool: base.waiverPool
      ? applyToPlayers(base.waiverPool, overlays)
      : undefined,
  };
}
