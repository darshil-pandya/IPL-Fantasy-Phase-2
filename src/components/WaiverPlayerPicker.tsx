import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IplTeamPill } from "./IplTeamPill";
import { natBadgeClass, roleBadgeClass } from "../lib/playerBadges";
import type { Player, PlayerNationality } from "../types";

function natLabel(n?: PlayerNationality): string {
  if (n === "IND") return "India";
  if (n === "OVS") return "Overseas";
  return "—";
}

function PlayerRowInner({ p }: { p: Player }) {
  return (
    <>
      <span className="block font-medium text-white">{p.name}</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <IplTeamPill code={p.iplTeam} />
        <span className={roleBadgeClass(p.role)}>{p.role}</span>
        <span className={natBadgeClass(p.nationality)}>{natLabel(p.nationality)}</span>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-300">
          {Math.round(p.seasonTotal)} pts
        </span>
      </div>
    </>
  );
}

type WaiverPlayerPickerProps = {
  label: string;
  value: string;
  onChange: (playerId: string) => void;
  playerIds: string[];
  pmap: Map<string, Player>;
  placeholder?: string;
  /** When true, search and list are disabled (value still shown if set). */
  disabled?: boolean;
};

function normalizeSearch(s: string): string {
  return s.trim().toLowerCase();
}

export function WaiverPlayerPicker({
  label,
  value,
  onChange,
  playerIds,
  pmap,
  placeholder = "Type to search, then pick a player…",
  disabled = false,
}: WaiverPlayerPickerProps) {
  const [open, setOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const sortedIds = useMemo(() => {
    return [...playerIds].sort((a, b) => {
      const na = pmap.get(a)?.name ?? a;
      const nb = pmap.get(b)?.name ?? b;
      return na.localeCompare(nb);
    });
  }, [playerIds, pmap]);

  const filteredIds = useMemo(() => {
    const q = normalizeSearch(filterQuery);
    if (!q) return sortedIds;
    return sortedIds.filter((id) => {
      const name = pmap.get(id)?.name ?? id;
      return normalizeSearch(name).includes(q);
    });
  }, [sortedIds, filterQuery, pmap]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open && !disabled) {
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }
  }, [open, disabled]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
  }, [open]);

  const selected = value ? pmap.get(value) : undefined;

  return (
    <div ref={rootRef} className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <div className="relative">
        <div
          className={[
            "flex min-h-[2.75rem] w-full items-stretch overflow-hidden rounded-xl border border-cyan-500/25 bg-slate-950/80 shadow-inner transition-[box-shadow,border-color]",
            disabled ? "cursor-not-allowed opacity-60" : "",
            !disabled && open
              ? "border-amber-400/50 ring-2 ring-amber-400/25"
              : !disabled
                ? "hover:border-cyan-400/40"
                : "",
          ].join(" ")}
        >
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={filterQuery}
            onChange={(e) => {
              if (disabled) return;
              setFilterQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (!disabled) setOpen(true);
            }}
            placeholder={placeholder}
            aria-label={`${label} — type to filter by name`}
            aria-expanded={open}
            aria-controls={listId}
            className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-label={open ? "Close list" : "Open full list"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (disabled) return;
              setOpen((o) => !o);
              if (!open) inputRef.current?.focus();
            }}
            className="shrink-0 border-l border-cyan-500/25 bg-slate-900/80 px-2.5 text-slate-400 transition-colors hover:bg-cyan-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {open ? "▴" : "▾"}
          </button>
        </div>
        {selected && (
          <div className="mt-1.5 rounded-lg border border-cyan-500/25 bg-slate-900/60 px-2.5 py-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Selected
            </p>
            <PlayerRowInner p={selected} />
          </div>
        )}
        {open && !disabled && (
          <ul
            id={listId}
            className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-cyan-500/30 bg-slate-950 py-1 shadow-xl shadow-black/50 ring-1 ring-cyan-500/20"
            role="listbox"
            aria-label={label}
          >
            {sortedIds.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-slate-500">No players</li>
            ) : filteredIds.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-slate-500">
                No names match &ldquo;{filterQuery.trim()}&rdquo;
              </li>
            ) : (
              filteredIds.map((id) => {
                const p = pmap.get(id);
                if (!p) return null;
                return (
                  <li key={id} role="option" aria-selected={value === id}>
                    <button
                      type="button"
                      className="w-full border-b border-slate-800 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-cyan-500/10 focus:bg-cyan-500/15 focus:outline-none"
                      onClick={() => {
                        onChange(id);
                        setOpen(false);
                        setFilterQuery("");
                      }}
                    >
                      <PlayerRowInner p={p} />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
