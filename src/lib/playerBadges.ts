import type { PlayerNationality, PlayerRole } from "../types";

const ROLE_BASE =
  "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ";

export function roleBadgeClass(role: PlayerRole): string {
  switch (role) {
    case "BAT":
      return `${ROLE_BASE}bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/40`;
    case "BOWL":
      return `${ROLE_BASE}bg-rose-500/25 text-rose-200 ring-1 ring-rose-400/40`;
    case "AR":
      return `${ROLE_BASE}bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/40`;
    case "WK":
      return `${ROLE_BASE}bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/40`;
  }
}

const NAT_BASE =
  "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ";

export function natBadgeClass(n?: PlayerNationality): string {
  if (!n) return `${NAT_BASE}bg-slate-600/40 text-slate-400 ring-1 ring-slate-500/40`;
  return n === "IND"
    ? `${NAT_BASE}bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/35`
    : `${NAT_BASE}bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/40`;
}
