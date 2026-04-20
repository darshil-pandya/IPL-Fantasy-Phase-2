const FULL_NAME_TO_CODE: Record<string, string> = {
  "Royal Challengers Bengaluru": "RCB",
  "Royal Challengers Bangalore": "RCB",
  "Mumbai Indians": "MI",
  "Chennai Super Kings": "CSK",
  "Kolkata Knight Riders": "KKR",
  "Delhi Capitals": "DC",
  "Rajasthan Royals": "RR",
  "Sunrisers Hyderabad": "SRH",
  "Punjab Kings": "PBKS",
  "Lucknow Super Giants": "LSG",
  "Gujarat Titans": "GT",
};

const SORTED_NAMES = Object.keys(FULL_NAME_TO_CODE).sort(
  (a, b) => b.length - a.length,
);

/**
 * Replace full IPL team names with 3-letter codes and strip trailing
 * match-number suffixes (e.g. ", 1st Match").
 *
 * "Royal Challengers Bengaluru vs Sunrisers Hyderabad, 1st Match" → "RCB vs SRH"
 *
 * If the label doesn't contain recognisable team names (e.g. "1st Match"),
 * pass `teams` (derived from player data) to get "CSK vs RCB" instead.
 */
export function abbreviateMatchLabel(label: string, teams?: string[]): string {
  let out = label;
  for (const name of SORTED_NAMES) {
    out = out.replaceAll(name, FULL_NAME_TO_CODE[name]);
  }
  out = out.replace(/,?\s*\d+\w*\s+match$/i, "").trim();
  if (out && out !== label) {
    return out;
  }
  if (teams && teams.length === 2) {
    return `${teams[0]} vs ${teams[1]}`;
  }
  return out || label;
}

/** "2026-03-28T14:00:00.000Z" → "28 Mar" */
export function formatMatchDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}
