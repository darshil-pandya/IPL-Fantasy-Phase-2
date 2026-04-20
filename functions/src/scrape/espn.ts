import { fetchText } from "./http.js";
import { normalizePlayerName, queryTokens, scoreAgainstTokens } from "../util/names.js";

/** ESPN JSON sometimes uses a string; sometimes a nested object with `text` / `plainText`. */
export function espnDismissalAsString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["text", "plainText", "shortText", "html"]) {
      const x = o[k];
      if (typeof x === "string" && x.length > 0) return x;
    }
  }
  return "";
}

/**
 * IPL season fixtures (all matches + dates). Update `series` segment when ESPN uses a new series id.
 * @see https://www.espncricinfo.com/series/ipl-2026-1510719/match-schedule-fixtures-and-results
 */
const IPL_FIXTURES_AND_RESULTS_URL =
  "https://www.espncricinfo.com/series/ipl-2026-1510719/match-schedule-fixtures-and-results";

export type EspnMatchPick = {
  path: string;
  label: string;
  score: number;
  /** Calendar date of match start in Asia/Kolkata (YYYY-MM-DD). */
  matchDayYmd: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractNextDataJson(html: string): any {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const si = html.indexOf(marker);
  if (si < 0) throw new Error("ESPN page missing __NEXT_DATA__");
  const start = si + marker.length;
  const end = html.indexOf("</script>", start);
  if (end < 0) throw new Error("ESPN __NEXT_DATA__ truncated");
  return JSON.parse(html.slice(start, end));
}

/** Match kickoff calendar day in India (YYYY-MM-DD). */
export function matchStartYmdIST(html: string): string | null {
  try {
    const j = extractNextDataJson(html);
    const m = j?.props?.appPageProps?.data?.match;
    const iso = m?.startTime ?? m?.startDate;
    if (iso == null) return null;
    const d = new Date(typeof iso === "number" ? iso : String(iso));
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  } catch {
    return null;
  }
}

export function espnScorecardLooksComplete(html: string): boolean {
  try {
    const j = extractNextDataJson(html);
    const m = j?.props?.appPageProps?.data?.match;
    if (!m) return false;
    if (m.state !== "POST") return false;
    const st = String(m.status ?? "").toUpperCase();
    if (st === "LIVE" || st === "UPCOMING" || st === "PREVIEW") return false;
    return true;
  } catch {
    return false;
  }
}

export function espnMatchStartIso(html: string): string | null {
  try {
    const j = extractNextDataJson(html);
    const m = j?.props?.appPageProps?.data?.match;
    const iso = m?.startTime ?? m?.startDate;
    if (iso == null) return null;
    const d = new Date(typeof iso === "number" ? iso : String(iso));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

/** Calendar day in Asia/Kolkata from ESPN ISO timestamps. */
export function ymdISTFromEspnTime(startTime: unknown, startDate: unknown): string | null {
  const iso = startTime ?? startDate;
  if (iso == null) return null;
  const d = new Date(typeof iso === "number" ? iso : String(iso));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fullScorecardPathFromFixtureMatch(match: any): string | null {
  const series = match?.series;
  const slug = match?.slug;
  const oid = match?.objectId;
  if (!series?.slug || typeof slug !== "string" || oid == null) return null;
  const seriesSeg = `${series.slug}-${series.objectId}`;
  return `/series/${seriesSeg}/${slug}-${oid}/full-scorecard`;
}

/**
 * Load IPL fixtures/results JSON and pick the best match for query + calendar date (IST).
 */
export async function discoverEspnMatch(
  matchQuery: string,
  matchDateYmd: string,
): Promise<EspnMatchPick | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDateYmd)) return null;

  const html = await fetchText(IPL_FIXTURES_AND_RESULTS_URL);
  const j = extractNextDataJson(html);
  const matches = j?.props?.appPageProps?.data?.content?.matches;
  if (!Array.isArray(matches) || matches.length === 0) return null;

  const tokens = queryTokens(matchQuery);

  type Scored = { path: string; label: string; score: number; matchDayYmd: string };
  const scored: Scored[] = [];

  for (const m of matches) {
    if (m?.isCancelled === true) continue;
    const ymd = ymdISTFromEspnTime(m?.startTime, m?.startDate);
    if (!ymd || ymd !== matchDateYmd) continue;

    const path = fullScorecardPathFromFixtureMatch(m);
    if (!path) continue;

    const slug = String(m.slug ?? "");
    const title = String(m.title ?? "");
    const teamHay = Array.isArray(m.teams)
      ? m.teams.map((t: { team?: { name?: string; longName?: string } }) =>
          [t?.team?.name, t?.team?.longName].filter(Boolean).join(" "),
        ).join(" ")
      : "";
    const haystack = `${slug} ${title} ${teamHay}`.replace(/-/g, " ");
    const s = scoreAgainstTokens(tokens, haystack);
    if (s < 4) continue;

    scored.push({
      path,
      label: slug || path,
      score: s,
      matchDayYmd: ymd,
    });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  return {
    path: best.path,
    label: best.label,
    score: best.score,
    matchDayYmd: best.matchDayYmd,
  };
}

export function espnScorecardUrl(path: string): string {
  return `https://www.espncricinfo.com${path}`;
}

export type EspnBatterAgg = {
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  isOut: boolean;
  dismissalType?: string;
  dismissalText?: string;
};

export type EspnBowlerAgg = {
  balls: number;
  maidens: number;
  conceded: number;
  wickets: number;
  dots: number;
};

export type EspnParsed = {
  batters: Map<string, EspnBatterAgg>;
  bowlers: Map<string, EspnBowlerAgg>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeBat(m: Map<string, EspnBatterAgg>, row: any): void {
  const name = row?.player?.name as string | undefined;
  if (!name) return;
  const key = normalizePlayerName(name);
  const cur = m.get(key);
  const dt = espnDismissalAsString(row.dismissalText) || espnDismissalAsString(cur?.dismissalText);
  const next: EspnBatterAgg = {
    runs: (cur?.runs ?? 0) + Number(row.runs ?? 0),
    balls: (cur?.balls ?? 0) + Number(row.balls ?? 0),
    fours: (cur?.fours ?? 0) + Number(row.fours ?? 0),
    sixes: (cur?.sixes ?? 0) + Number(row.sixes ?? 0),
    isOut: Boolean(row.isOut) || cur?.isOut === true,
    dismissalType:
      typeof row.dismissalType === "string"
        ? row.dismissalType
        : typeof cur?.dismissalType === "string"
          ? cur.dismissalType
          : undefined,
    dismissalText: dt || undefined,
  };
  m.set(key, next);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeBowl(m: Map<string, EspnBowlerAgg>, row: any): void {
  const name = row?.player?.name as string | undefined;
  if (!name) return;
  const key = normalizePlayerName(name);
  const cur = m.get(key);
  const ballsBowled = Number(row.balls ?? Math.round(Number(row.overs ?? 0) * 6));
  const next: EspnBowlerAgg = {
    balls: (cur?.balls ?? 0) + ballsBowled,
    maidens: (cur?.maidens ?? 0) + Number(row.maidens ?? 0),
    conceded: (cur?.conceded ?? 0) + Number(row.conceded ?? 0),
    wickets: (cur?.wickets ?? 0) + Number(row.wickets ?? 0),
    dots: (cur?.dots ?? 0) + Number(row.dots ?? 0),
  };
  m.set(key, next);
}

/** Raw innings array from scorecard JSON (fielding / dismissals). */
export function extractInningsFromScorecardHtml(html: string): any[] {
  const j = extractNextDataJson(html);
  const innings = j?.props?.appPageProps?.data?.content?.innings;
  return Array.isArray(innings) ? innings : [];
}

export function parseEspnScorecardHtml(html: string): EspnParsed {
  const innings = extractInningsFromScorecardHtml(html);
  if (innings.length === 0) throw new Error("ESPN innings missing");

  const batters = new Map<string, EspnBatterAgg>();
  const bowlers = new Map<string, EspnBowlerAgg>();

  for (const inn of innings) {
    for (const row of inn.inningBatsmen ?? []) mergeBat(batters, row);
    for (const row of inn.inningBowlers ?? []) mergeBowl(bowlers, row);
  }

  return { batters, bowlers };
}

export async function fetchEspnScorecard(path: string): Promise<string> {
  return fetchText(espnScorecardUrl(path));
}

/** Title from ESPN JSON (e.g. team vs team). */
export function espnMatchTitleFromHtml(html: string): string {
  try {
    const j = extractNextDataJson(html);
    const t = j?.props?.appPageProps?.data?.match?.title;
    return typeof t === "string" ? t.trim() : "";
  } catch {
    return "";
  }
}
