import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IplTeamPill } from "../components/IplTeamPill";
import { OwnerBadge } from "../components/OwnerBadge";
import { useLeague } from "../context/LeagueContext";
import { useWaiver } from "../context/WaiverContext";
import { ownerForPlayerId } from "../lib/buildStandings";
import { natBadgeClass, roleBadgeClass } from "../lib/playerBadges";
import {
  breakdownMatchesSeasonTotal,
} from "../lib/playerFantasyPoints";
import { ownerNameClass } from "../lib/ownerTheme";
import type {
  Franchise,
  LeagueBundle,
  Player,
  PlayerNationality,
  PlayerRole,
} from "../types";

const BREAKDOWN_EPSILON = 0.15;

function natLabel(n?: PlayerNationality): string {
  if (n === "IND") return "India";
  if (n === "OVS") return "Overseas";
  return "—";
}

function fmtPts(n?: number): string {
  if (n == null || Number.isNaN(n)) return "—";
  return String(Math.round(n));
}

function fp(p: Player) {
  return p.seasonFantasyPoints;
}

function allPlayersInLeague(bundle: LeagueBundle): Player[] {
  const m = new Map<string, Player>();
  for (const p of bundle.players) m.set(p.id, p);
  for (const p of bundle.waiverPool ?? []) {
    if (!m.has(p.id)) m.set(p.id, p);
  }
  return [...m.values()];
}

function franchiseCell(
  bundle: LeagueBundle,
  franchises: Franchise[],
  playerId: string,
): { label: string; owner: string | null } {
  const owner = ownerForPlayerId(franchises, playerId);
  if (owner) return { label: owner, owner };
  if (bundle.auction.unsoldPlayerIds.includes(playerId)) {
    return { label: "Unsold", owner: null };
  }
  return { label: "Available", owner: null };
}

type PtCol = {
  key: string;
  label: string;
  title: string;
  get: (p: Player) => number | undefined;
};

const FANTASY_POINT_COLUMNS: PtCol[] = [
  {
    key: "batRuns",
    label: "Run",
    title: "Fantasy points from runs (+1 per run)",
    get: (p) => fp(p)?.battingRuns,
  },
  {
    key: "4s",
    label: "4s",
    title: "Boundary four bonus points (+2 each)",
    get: (p) => fp(p)?.boundaryFours,
  },
  {
    key: "6s",
    label: "6s",
    title: "Six bonus points (+4 each)",
    get: (p) => fp(p)?.boundarySixes,
  },
  {
    key: "mil",
    label: "Mil",
    title: "Milestone bonuses (30/50/75/100), net of stacking rules",
    get: (p) => fp(p)?.battingMilestones,
  },
  {
    key: "duck",
    label: "Duck",
    title: "Duck penalties (negative)",
    get: (p) => fp(p)?.ducks,
  },
  {
    key: "dot",
    label: "Dot",
    title: "Dot-ball points (+1 each)",
    get: (p) => fp(p)?.dotBalls,
  },
  {
    key: "w",
    label: "W",
    title: "Wicket points (+25 each, excl. run out)",
    get: (p) => fp(p)?.wickets,
  },
  {
    key: "lbw",
    label: "LBW",
    title: "LBW/bowled bonus points (+8 each)",
    get: (p) => fp(p)?.lbwOrBowled,
  },
  {
    key: "3w",
    label: "3W",
    title: "3-wicket haul bonus points",
    get: (p) => fp(p)?.threeWicketHauls,
  },
  {
    key: "4w",
    label: "4W",
    title: "4-wicket haul bonus points",
    get: (p) => fp(p)?.fourWicketHauls,
  },
  {
    key: "5w",
    label: "5W",
    title: "5-wicket haul bonus points",
    get: (p) => fp(p)?.fiveWicketHauls,
  },
  {
    key: "mdn",
    label: "Mdn",
    title: "Maiden over points (+12 each)",
    get: (p) => fp(p)?.maidens,
  },
  {
    key: "eco",
    label: "Eco",
    title: "Net economy-rate band points (can be negative)",
    get: (p) => fp(p)?.economy,
  },
  {
    key: "sr",
    label: "SR",
    title: "Net strike-rate band points (can be negative)",
    get: (p) => fp(p)?.strikeRate,
  },
  {
    key: "ct",
    label: "Ct",
    title: "Catch points (+8 each)",
    get: (p) => fp(p)?.catches,
  },
  {
    key: "3ct",
    label: "3Ct+",
    title: "3-catch bonus points (+4 per match when earned)",
    get: (p) => fp(p)?.threeCatchBonus,
  },
  {
    key: "st",
    label: "St",
    title: "Stumping points (+12 each)",
    get: (p) => fp(p)?.stumpings,
  },
  {
    key: "roD",
    label: "RO†",
    title: "Run out direct (+12 each)",
    get: (p) => fp(p)?.runOutDirect,
  },
  {
    key: "roA",
    label: "RO*",
    title: "Run out assist (+6 each)",
    get: (p) => fp(p)?.runOutAssist,
  },
  {
    key: "xi",
    label: "XI",
    title: "Named in XI (+4 each appearance)",
    get: (p) => fp(p)?.namedInXi,
  },
  {
    key: "imp",
    label: "Imp",
    title: "Impact/concussion sub (+4 each)",
    get: (p) => fp(p)?.impactOrConcussion,
  },
  {
    key: "oth",
    label: "Oth",
    title: "Other manual adjustments",
    get: (p) => fp(p)?.other,
  },
];

type SortColumnId =
  | "name"
  | "franchise"
  | "ipl"
  | "role"
  | "nat"
  | "total"
  | "delta"
  | (typeof FANTASY_POINT_COLUMNS)[number]["key"];

function isNumericSortColumn(k: SortColumnId): boolean {
  if (k === "total" || k === "delta") return true;
  return FANTASY_POINT_COLUMNS.some((c) => c.key === k);
}

function defaultSortDir(k: SortColumnId): "asc" | "desc" {
  return isNumericSortColumn(k) ? "desc" : "asc";
}

function compareNum(
  a: number | undefined,
  b: number | undefined,
  dir: "asc" | "desc",
): number {
  const na = a == null || Number.isNaN(a);
  const nb = b == null || Number.isNaN(b);
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  const diff = (a as number) - (b as number);
  return dir === "asc" ? diff : -diff;
}

type Row = {
  p: Player;
  fc: { label: string; owner: string | null };
  br: ReturnType<typeof breakdownMatchesSeasonTotal>;
};

function compareRows(a: Row, b: Row, key: SortColumnId, dir: "asc" | "desc"): number {
  const s = (x: string, y: string) => (dir === "asc" ? x.localeCompare(y) : y.localeCompare(x));

  switch (key) {
    case "name":
      return s(a.p.name, b.p.name);
    case "franchise":
      return s(a.fc.label, b.fc.label) || s(a.p.name, b.p.name);
    case "ipl":
      return s(a.p.iplTeam, b.p.iplTeam) || s(a.p.name, b.p.name);
    case "role":
      return s(a.p.role, b.p.role) || s(a.p.name, b.p.name);
    case "nat": {
      const la = natLabel(a.p.nationality);
      const lb = natLabel(b.p.nationality);
      return s(la, lb) || s(a.p.name, b.p.name);
    }
    case "total":
      return compareNum(a.p.seasonTotal, b.p.seasonTotal, dir);
    case "delta": {
      const da = a.br.checked ? a.br.delta : undefined;
      const db = b.br.checked ? b.br.delta : undefined;
      return compareNum(da, db, dir);
    }
    default: {
      const col = FANTASY_POINT_COLUMNS.find((c) => c.key === key);
      if (!col) return 0;
      return compareNum(col.get(a.p), col.get(b.p), dir);
    }
  }
}

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="ml-0.5 text-slate-600">↕</span>;
  return <span className="ml-0.5 text-cyan-400">{dir === "asc" ? "↑" : "↓"}</span>;
}

export function Players() {
  const { bundle } = useLeague();
  const { displayFranchises } = useWaiver();

  const [filterPlayer, setFilterPlayer] = useState("");
  const [filterFranchise, setFilterFranchise] = useState<string>("all");
  const [filterIpl, setFilterIpl] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterNat, setFilterNat] = useState<string>("all");

  const [sort, setSort] = useState<{ key: SortColumnId; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });

  const pool = useMemo(
    () => (bundle ? allPlayersInLeague(bundle) : []),
    [bundle],
  );

  const ownerOptions = useMemo(() => {
    return [...displayFranchises.map((f) => f.owner)].sort((a, b) => a.localeCompare(b));
  }, [displayFranchises]);

  const iplOptions = useMemo(() => {
    return Array.from(new Set(pool.map((p) => p.iplTeam))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [pool]);

  const filteredPool = useMemo(() => {
    if (!bundle) return [];
    const q = filterPlayer.trim().toLowerCase();
    return pool.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      const fc = franchiseCell(bundle, displayFranchises, p.id);
      if (filterFranchise !== "all") {
        if (filterFranchise === "__unsold__" && fc.label !== "Unsold") return false;
        if (filterFranchise === "__avail__" && fc.label !== "Available") return false;
        if (
          filterFranchise !== "__unsold__" &&
          filterFranchise !== "__avail__" &&
          fc.owner !== filterFranchise
        ) {
          return false;
        }
      }
      if (filterIpl !== "all" && p.iplTeam !== filterIpl) return false;
      if (filterRole !== "all" && p.role !== filterRole) return false;
      if (filterNat === "unset" && p.nationality != null) return false;
      if (filterNat === "IND" && p.nationality !== "IND") return false;
      if (filterNat === "OVS" && p.nationality !== "OVS") return false;
      return true;
    });
  }, [
    bundle,
    pool,
    displayFranchises,
    filterPlayer,
    filterFranchise,
    filterIpl,
    filterRole,
    filterNat,
  ]);

  const rows = useMemo(() => {
    if (!bundle) return [];
    const list: Row[] = filteredPool.map((p) => ({
      p,
      fc: franchiseCell(bundle, displayFranchises, p.id),
      br: breakdownMatchesSeasonTotal(p, BREAKDOWN_EPSILON),
    }));
    list.sort((a, b) => compareRows(a, b, sort.key, sort.dir));
    return list;
  }, [bundle, displayFranchises, filteredPool, sort]);

  const onHeaderClick = (key: SortColumnId) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultSortDir(key) },
    );
  };

  const thBase =
    "font-medium transition-colors hover:bg-cyan-500/15 cursor-pointer select-none";
  const thSticky =
    "sticky left-0 z-[2] bg-slate-950 shadow-[2px_0_12px_-2px_rgba(0,0,0,0.5)]";

  if (!bundle) return null;

  return (
    <div className="space-y-4">
      <h2 className="font-display text-3xl tracking-wide text-white">Players</h2>

      <div className="app-card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium text-slate-300">
          Player
          <input
            type="search"
            value={filterPlayer}
            onChange={(e) => setFilterPlayer(e.target.value)}
            placeholder="Search name…"
            className="app-input"
          />
        </label>
        <label className="flex min-w-[9rem] flex-col gap-1 text-xs font-medium text-slate-300">
          Franchise
          <select
            value={filterFranchise}
            onChange={(e) => setFilterFranchise(e.target.value)}
            className="app-input"
          >
            <option value="all">All</option>
            {ownerOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            <option value="__unsold__">Unsold</option>
            <option value="__avail__">Available</option>
          </select>
        </label>
        <label className="flex min-w-[7rem] flex-col gap-1 text-xs font-medium text-slate-300">
          IPL team
          <select
            value={filterIpl}
            onChange={(e) => setFilterIpl(e.target.value)}
            className="app-input"
          >
            <option value="all">All</option>
            {iplOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[7rem] flex-col gap-1 text-xs font-medium text-slate-300">
          Role
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="app-input"
          >
            <option value="all">All</option>
            {(["BAT", "BOWL", "AR", "WK"] as PlayerRole[]).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[8rem] flex-col gap-1 text-xs font-medium text-slate-300">
          Nationality
          <select
            value={filterNat}
            onChange={(e) => setFilterNat(e.target.value)}
            className="app-input"
          >
            <option value="all">All</option>
            <option value="IND">India</option>
            <option value="OVS">Overseas</option>
            <option value="unset">Not set</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-slate-500">
        Showing {rows.length} of {pool.length} players. Sort:{" "}
        <span className="font-semibold text-white">{sort.key}</span>{" "}
        {sort.dir === "asc" ? "ascending" : "descending"}.
      </p>

      <div className="app-table">
        <table className="w-full min-w-[1200px] border-collapse text-left text-xs sm:text-sm">
          <thead className="app-table-head">
            <tr>
              <th
                scope="col"
                className={`${thBase} ${thSticky} px-2 py-2 text-left sm:px-3 sm:py-3`}
                onClick={() => onHeaderClick("name")}
              >
                Player
                <SortArrow active={sort.key === "name"} dir={sort.dir} />
              </th>
              <th
                scope="col"
                className={`${thBase} px-2 py-2 text-left sm:px-3 sm:py-3`}
                onClick={() => onHeaderClick("franchise")}
              >
                Franchise
                <SortArrow active={sort.key === "franchise"} dir={sort.dir} />
              </th>
              <th
                scope="col"
                className={`${thBase} px-2 py-2 text-left sm:px-3 sm:py-3`}
                onClick={() => onHeaderClick("ipl")}
              >
                IPL
                <SortArrow active={sort.key === "ipl"} dir={sort.dir} />
              </th>
              <th
                scope="col"
                className={`${thBase} px-2 py-2 text-left sm:px-3 sm:py-3`}
                onClick={() => onHeaderClick("role")}
              >
                Role
                <SortArrow active={sort.key === "role"} dir={sort.dir} />
              </th>
              <th
                scope="col"
                className={`${thBase} px-2 py-2 text-left sm:px-3 sm:py-3`}
                onClick={() => onHeaderClick("nat")}
              >
                Nat
                <SortArrow active={sort.key === "nat"} dir={sort.dir} />
              </th>
              <th
                scope="col"
                className={`${thBase} px-2 py-2 text-right sm:px-3 sm:py-3`}
                onClick={() => onHeaderClick("total")}
                title="Authoritative fantasy total"
              >
                Total
                <SortArrow active={sort.key === "total"} dir={sort.dir} />
              </th>
              {FANTASY_POINT_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  title={c.title}
                  className={`${thBase} min-w-[2.6rem] px-1.5 py-2 text-right sm:px-2 sm:py-3`}
                  onClick={() => onHeaderClick(c.key as SortColumnId)}
                >
                  <span className="border-b border-dotted border-slate-500">{c.label}</span>
                  <SortArrow active={sort.key === c.key} dir={sort.dir} />
                </th>
              ))}
              <th
                scope="col"
                className={`${thBase} px-2 py-2 text-right sm:px-3 sm:py-3`}
                title="seasonTotal minus sum of categories"
                onClick={() => onHeaderClick("delta")}
              >
                Δ
                <SortArrow active={sort.key === "delta"} dir={sort.dir} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, fc, br }) => {
              const mismatch = br.checked && !br.inSync;
              return (
                <tr
                  key={p.id}
                  className={
                    mismatch
                      ? "border-b border-red-500/20 bg-red-950/50 hover:bg-red-950/70"
                      : "app-table-row"
                  }
                >
                  <td
                    className={`sticky left-0 z-[1] bg-slate-900 px-2 py-2 font-medium text-white shadow-[2px_0_12px_-2px_rgba(0,0,0,0.5)] sm:px-3 sm:py-2.5 ${mismatch ? "bg-red-950/95" : ""}`}
                  >
                    <span title={p.id}>{p.name}</span>
                  </td>
                  <td className="px-2 py-2 sm:px-3 sm:py-2.5">
                    {fc.owner ? (
                      <Link
                        to={`/teams?owner=${encodeURIComponent(fc.owner)}`}
                        className={`inline-flex flex-wrap items-center gap-2 ${ownerNameClass(fc.owner)} hover:opacity-80`}
                      >
                        <OwnerBadge owner={fc.owner} />
                      </Link>
                    ) : (
                      <span className="text-slate-500">{fc.label}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 sm:px-3 sm:py-2.5">
                    <IplTeamPill code={p.iplTeam} />
                  </td>
                  <td className="px-2 py-2 sm:px-3 sm:py-2.5">
                    <span className={roleBadgeClass(p.role)}>{p.role}</span>
                  </td>
                  <td className="px-2 py-2 sm:px-3 sm:py-2.5">
                    <span className={natBadgeClass(p.nationality)}>
                      {natLabel(p.nationality)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-amber-400 sm:px-3 sm:py-2.5">
                    {Math.round(p.seasonTotal)}
                  </td>
                  {FANTASY_POINT_COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className="px-1.5 py-2 text-right tabular-nums text-slate-300 sm:px-2 sm:py-2.5"
                    >
                      {fmtPts(c.get(p))}
                    </td>
                  ))}
                  <td
                    className={`px-2 py-2 text-right text-xs tabular-nums sm:px-3 sm:py-2.5 ${
                      mismatch ? "font-semibold text-red-700" : "text-slate-500"
                    }`}
                  >
                    {!br.checked
                      ? "—"
                      : br.inSync
                        ? "✓"
                        : (br.delta >= 0 ? "+" : "") + Math.round(br.delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        Reconciliation: sum of <code className="app-code-inline">seasonFantasyPoints</code> should match{" "}
        <code className="app-code-inline">seasonTotal</code> when every source is bucketed.
        Prediction bonuses are franchise-level only.
      </p>
    </div>
  );
}
