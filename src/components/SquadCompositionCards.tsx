import { squadCompositionFromPlayers } from "../lib/squadComposition";

export function SquadCompositionCards({
  players,
}: {
  players: readonly { role: string; nationality?: string | null }[];
}) {
  const cards = squadCompositionFromPlayers(players);
  return (
    <div
      className="flex flex-wrap gap-2"
      aria-label="Squad composition by role and overseas count"
    >
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex min-w-[4.5rem] flex-col items-center rounded-lg border border-cyan-500/15 bg-slate-900/60 px-4 py-2"
        >
          <span className="text-lg font-bold tabular-nums text-white">{c.count}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {c.label}
          </span>
        </div>
      ))}
    </div>
  );
}
