import type { MatchColumn } from "./matchColumns";

export type OwnerPointsChartRow = {
  step: number;
  /** Short X-axis tick (e.g. MM-DD or M1). */
  label: string;
  /** Full text for tooltips. */
  fullLabel: string;
} & Record<string, number | string>;

/**
 * Cumulative fantasy from `perOwnerPerMatch` (single source from franchiseAttributedScoring).
 */
export function buildOwnerCumulativeFromPerMatch(
  perOwnerPerMatch: Record<string, number[]>,
  columns: MatchColumn[],
  ownerOrder: string[],
  ownersInStandings: string[],
): { data: OwnerPointsChartRow[]; owners: string[] } {
  const ownersBase =
    ownerOrder.length > 0
      ? ownerOrder.filter((o) => ownersInStandings.includes(o))
      : ownersInStandings;

  if (columns.length === 0) {
    return { data: [], owners: ownersBase };
  }

  const cumByOwner = new Map<string, number[]>();
  for (const o of ownersBase) {
    const rounds = perOwnerPerMatch[o] ?? [];
    let running = 0;
    const arr: number[] = [];
    for (let i = 0; i < columns.length; i++) {
      running += rounds[i] ?? 0;
      arr.push(Math.round(running * 100) / 100);
    }
    cumByOwner.set(o, arr);
  }

  const owners = ownersBase;
  const data: OwnerPointsChartRow[] = [];
  const start: OwnerPointsChartRow = {
    step: 0,
    label: "—",
    fullLabel: "Before first match",
  };
  for (const o of owners) start[o] = 0;
  data.push(start);

  columns.forEach((col, i) => {
    const row: OwnerPointsChartRow = {
      step: i + 1,
      label:
        col.date.length >= 10
          ? `${col.date.slice(8, 10)}/${col.date.slice(5, 7)}`
          : `M${i + 1}`,
      fullLabel: `${col.date} — ${col.label}`,
    };
    for (const o of owners) {
      const series = cumByOwner.get(o);
      row[o] = series?.[i] ?? 0;
    }
    data.push(row);
  });

  return { data, owners };
}
