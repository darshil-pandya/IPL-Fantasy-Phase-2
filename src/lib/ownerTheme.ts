/** Distinct accent per fantasy franchise owner (not IPL team colours). Dark stadium UI. */
const OWNERS: Record<
  string,
  { pill: string; text: string; card: string; cardMuted: string }
> = {
  Darshil: {
    pill: "bg-sky-400/20 text-sky-100 ring-sky-400/45",
    text: "text-sky-300",
    card: "border-sky-500/35 bg-gradient-to-br from-sky-950/70 via-slate-900/90 to-slate-950 shadow-lg shadow-sky-500/10 ring-1 ring-sky-400/25",
    cardMuted: "text-sky-200/65",
  },
  Bhavya: {
    pill: "bg-fuchsia-500/25 text-fuchsia-100 ring-fuchsia-400/40",
    text: "text-fuchsia-300",
    card: "border-fuchsia-500/35 bg-gradient-to-br from-fuchsia-950/60 via-slate-900/90 to-slate-950 shadow-lg shadow-fuchsia-500/10 ring-1 ring-fuchsia-400/25",
    cardMuted: "text-fuchsia-200/65",
  },
  Prajin: {
    pill: "bg-teal-400/20 text-teal-100 ring-teal-400/45",
    text: "text-teal-300",
    card: "border-teal-500/35 bg-gradient-to-br from-teal-950/65 via-slate-900/90 to-slate-950 shadow-lg shadow-teal-500/10 ring-1 ring-teal-400/25",
    cardMuted: "text-teal-200/65",
  },
  Sanket: {
    pill: "bg-orange-400/25 text-orange-100 ring-orange-400/45",
    text: "text-orange-300",
    card: "border-orange-500/35 bg-gradient-to-br from-orange-950/55 via-slate-900/90 to-slate-950 shadow-lg shadow-orange-500/10 ring-1 ring-orange-400/25",
    cardMuted: "text-orange-200/65",
  },
  Hersh: {
    pill: "bg-lime-400/20 text-lime-100 ring-lime-400/40",
    text: "text-lime-300",
    card: "border-lime-500/35 bg-gradient-to-br from-lime-950/50 via-slate-900/90 to-slate-950 shadow-lg shadow-lime-500/10 ring-1 ring-lime-400/25",
    cardMuted: "text-lime-200/65",
  },
  Jash: {
    pill: "bg-indigo-400/25 text-indigo-100 ring-indigo-400/45",
    text: "text-indigo-300",
    card: "border-indigo-500/35 bg-gradient-to-br from-indigo-950/65 via-slate-900/90 to-slate-950 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-400/25",
    cardMuted: "text-indigo-200/65",
  },
  Karan: {
    pill: "bg-rose-400/25 text-rose-100 ring-rose-400/45",
    text: "text-rose-300",
    card: "border-rose-500/35 bg-gradient-to-br from-rose-950/60 via-slate-900/90 to-slate-950 shadow-lg shadow-rose-500/10 ring-1 ring-rose-400/25",
    cardMuted: "text-rose-200/65",
  },
};

/** Line-chart stroke (hex) aligned with owner accents; works on dark backgrounds. */
const OWNER_CHART_STROKE: Record<string, string> = {
  Darshil: "#38bdf8",
  Bhavya: "#e879f9",
  Prajin: "#2dd4bf",
  Sanket: "#fb923c",
  Hersh: "#a3e635",
  Jash: "#818cf8",
  Karan: "#fb7185",
};

const PILL =
  "inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ";

const CARD_BASE =
  "rounded-xl border px-3 py-2.5 transition-[box-shadow,transform] duration-150";

export function ownerPillClass(owner: string): string {
  const t = OWNERS[owner];
  return PILL + (t?.pill ?? "bg-slate-600/40 text-slate-100 ring-slate-500/40");
}

export function ownerNameClass(owner: string): string {
  return OWNERS[owner]?.text ?? "text-slate-300";
}

/** Card shell (border, wash, ring) for waiver / roster summaries. */
export function ownerCardClass(owner: string): string {
  const t = OWNERS[owner];
  return `${CARD_BASE} ${t?.card ?? "border-slate-600/50 bg-gradient-to-br from-slate-900/90 via-slate-950 to-slate-950 shadow-md ring-1 ring-slate-500/25"}`;
}

/** Muted label text on an owner card (owner name, captions). */
export function ownerCardMutedClass(owner: string): string {
  return OWNERS[owner]?.cardMuted ?? "text-slate-400";
}

export function ownerChartStroke(owner: string): string {
  return OWNER_CHART_STROKE[owner] ?? "#94a3b8";
}
