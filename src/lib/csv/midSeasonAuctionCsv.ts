import type { LeagueBundle, Player, PlayerNationality, PlayerRole } from "../../types";
import { IPL_TEAM_CODES } from "../iplTheme";

const HEADER =
  "player_id,name,role,ipl_team,nationality,franchise_owner".split(",");

const ROLES: readonly PlayerRole[] = ["BAT", "BOWL", "AR", "WK"];
const NATIONALITIES: readonly PlayerNationality[] = ["IND", "OVS"];

const IPL_SET = new Set<string>(IPL_TEAM_CODES as readonly string[]);

export type MidSeasonCsvRow = {
  player_id: string;
  name: string;
  role: PlayerRole;
  ipl_team: string;
  nationality: PlayerNationality;
  franchise_owner: string;
};

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

/** Minimal CSV parser: handles double-quoted fields with escaped quotes. */
export function parseCsvRows(text: string): string[][] {
  const s = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;

  const pushCell = () => {
    row.push(cur);
    cur = "";
  };
  const pushRow = () => {
    if (row.length > 0 || cur.length > 0) {
      pushCell();
      rows.push(row);
      row = [];
    } else {
      cur = "";
    }
  };

  while (i < s.length) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      pushCell();
      i += 1;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  pushCell();
  if (row.length > 0) rows.push(row);

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

export type MidSeasonCsvResult =
  | { ok: true; rows: MidSeasonCsvRow[] }
  | { ok: false; errors: string[] };

/**
 * Validates mid-season auction CSV. Data row numbers in errors: row 2 = first data row (1-based file line).
 */
export function validateMidSeasonAuctionCsv(
  fileText: string,
  bundle: LeagueBundle,
): MidSeasonCsvResult {
  const errors: string[] = [];
  const grid = parseCsvRows(fileText);
  if (grid.length === 0) {
    return { ok: false, errors: ["File is empty."] };
  }

  const headerRow = grid[0]!.map(normalizeHeader);
  for (let c = 0; c < HEADER.length; c++) {
    if (headerRow[c] !== HEADER[c]) {
      errors.push(
        `Header must be: ${HEADER.join(",")}. Found column ${c + 1}: "${grid[0]![c] ?? ""}".`,
      );
      return { ok: false, errors };
    }
  }
  if (headerRow.length !== HEADER.length) {
    errors.push(`Expected ${HEADER.length} columns; found ${headerRow.length}.`);
    return { ok: false, errors };
  }

  const dataRows = grid.slice(1);
  const expectedOwners = new Set(bundle.franchises.map((f) => f.owner));
  const playerById = new Map(bundle.players.map((p) => [p.id, p] as const));

  if (dataRows.length !== 105) {
    errors.push(
      `Expected exactly 105 data rows; found ${dataRows.length}.`,
    );
  }

  const seenIds = new Set<string>();
  const byOwner = new Map<string, MidSeasonCsvRow[]>();

  for (let idx = 0; idx < dataRows.length; idx++) {
    const lineNo = idx + 2;
    const cells = dataRows[idx]!;
    if (cells.length !== HEADER.length) {
      errors.push(`Row ${lineNo}: expected ${HEADER.length} columns; found ${cells.length}.`);
      continue;
    }
    const [
      player_id,
      name,
      roleRaw,
      iplRaw,
      natRaw,
      ownerRaw,
    ] = cells.map((x) => x.trim());

    if (!player_id) errors.push(`Row ${lineNo}: player_id is required.`);
    if (seenIds.has(player_id)) {
      errors.push(`Row ${lineNo}: duplicate player_id "${player_id}".`);
    } else if (player_id) {
      seenIds.add(player_id);
    }

    const p = playerById.get(player_id);
    if (!player_id) {
      /* already logged */
    } else if (!p) {
      errors.push(`Row ${lineNo}: unknown player_id "${player_id}".`);
    } else if (p.name.trim() !== name.trim()) {
      errors.push(
        `Row ${lineNo}: name must match league data for this id (expected "${p.name}", got "${name}").`,
      );
    }

    const role = roleRaw as PlayerRole;
    if (!ROLES.includes(role)) {
      errors.push(
        `Row ${lineNo}: invalid role "${roleRaw}". Must be BAT, BOWL, AR, or WK.`,
      );
    }

    const nationality = natRaw as PlayerNationality;
    if (!NATIONALITIES.includes(nationality)) {
      errors.push(
        `Row ${lineNo}: invalid nationality "${natRaw}". Must be IND or OVS.`,
      );
    }

    const ipl = iplRaw.toUpperCase();
    if (!IPL_SET.has(ipl)) {
      errors.push(
        `Row ${lineNo}: invalid ipl_team "${iplRaw}". Must be one of: ${IPL_TEAM_CODES.join(", ")}.`,
      );
    }

    if (!ownerRaw) {
      errors.push(`Row ${lineNo}: franchise_owner is required.`);
    } else if (!expectedOwners.has(ownerRaw)) {
      errors.push(
        `Row ${lineNo}: unknown franchise_owner "${ownerRaw}". Expected one of: ${[...expectedOwners].join(", ")}.`,
      );
    }

    if (
      p &&
      ROLES.includes(role) &&
      NATIONALITIES.includes(nationality) &&
      IPL_SET.has(ipl) &&
      expectedOwners.has(ownerRaw) &&
      p.name.trim() === name.trim()
    ) {
      const row: MidSeasonCsvRow = {
        player_id,
        name,
        role,
        ipl_team: ipl,
        nationality,
        franchise_owner: ownerRaw,
      };
      const list = byOwner.get(ownerRaw) ?? [];
      list.push(row);
      byOwner.set(ownerRaw, list);
    }
  }

  for (const owner of expectedOwners) {
    const list = byOwner.get(owner) ?? [];
    if (list.length !== 15) {
      errors.push(
        `Franchise "${owner}": expected 15 rows; found ${list.length}.`,
      );
    }
  }

  const extraOwners = [...byOwner.keys()].filter((o) => !expectedOwners.has(o));
  for (const o of extraOwners) {
    errors.push(`Unknown franchise_owner in CSV: "${o}".`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const rows: MidSeasonCsvRow[] = [];
  for (const f of bundle.franchises) {
    rows.push(...(byOwner.get(f.owner) ?? []));
  }
  if (rows.length !== 105) {
    return {
      ok: false,
      errors: ["Internal row assembly failed (expected 105 rows)."],
    };
  }

  return { ok: true, rows };
}
