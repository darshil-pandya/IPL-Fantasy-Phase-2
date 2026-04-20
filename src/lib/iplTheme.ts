/** IPL franchise colours as pill styles (inspired by official palettes). */
const IPL: Record<string, string> = {
  CSK: "bg-[#ffcc00]/35 text-[#fbbf24] ring-[#ca8a04]/50",
  MI: "bg-[#004ba0]/20 text-[#60a5fa] ring-[#004ba0]/40",
  RCB: "bg-[#ec1c24]/20 text-[#ef4444] ring-red-400/50",
  KKR: "bg-[#3a225d]/20 text-[#a78bfa] ring-purple-400/45",
  DC: "bg-[#2563eb]/20 text-[#3b82f6] ring-blue-400/45",
  RR: "bg-[#e8298c]/20 text-[#ec4899] ring-pink-400/45",
  SRH: "bg-[#ff822a]/25 text-[#f97316] ring-orange-400/50",
  PBKS: "bg-[#dd1f2d]/20 text-[#dc2626] ring-red-400/45",
  LSG: "bg-[#00bfff]/25 text-[#22d3ee] ring-cyan-500/50",
  GT: "bg-[#1c2157]/15 text-[#818cf8] ring-indigo-400/45",
};

const PILL =
  "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ";

export function iplTeamPillClass(teamCode: string): string {
  const key = teamCode.trim().toUpperCase();
  return PILL + (IPL[key] ?? "bg-slate-600/40 text-slate-200 ring-slate-500/45");
}

export const IPL_TEAM_CODES = [
  "CSK",
  "MI",
  "RCB",
  "KKR",
  "DC",
  "RR",
  "SRH",
  "PBKS",
  "LSG",
  "GT",
] as const;
