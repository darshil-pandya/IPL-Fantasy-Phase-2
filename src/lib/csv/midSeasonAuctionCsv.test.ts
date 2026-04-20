import { describe, expect, it } from "vitest";
import type { LeagueBundle } from "../../types";
import { validateMidSeasonAuctionCsv } from "./midSeasonAuctionCsv";

const OWNERS = [
  "Darshil",
  "Bhavya",
  "Prajin",
  "Sanket",
  "Hersh",
  "Jash",
  "Karan",
] as const;

function minimalBundle(): LeagueBundle {
  const players = [];
  for (let i = 1; i <= 120; i++) {
    const id = `p${i}`;
    players.push({
      id,
      name: `Name ${i}`,
      iplTeam: "CSK",
      role: "BAT" as const,
      nationality: "IND" as const,
      seasonTotal: 0,
      byMatch: [],
    });
  }
  const franchises = OWNERS.map((owner, oi) => ({
    owner,
    teamName: `${owner} XI`,
    playerIds: Array.from({ length: 15 }, (_, j) => players[oi * 15 + j]!.id),
  }));
  return {
    meta: {
      seasonLabel: "Test",
      lastPointsUpdate: null,
      pointsUpdateNote: "",
      cricbuzzBaseUrl: "https://example.com",
    },
    franchises,
    players,
    waiverPool: [],
    auction: { unsoldPlayerIds: [], sales: [] },
    rules: {
      teamComposition: { title: "", bullets: [] },
      scoring: { title: "", sections: [], footer: "" },
    },
    predictions: {
      pointsPerCorrect: 0,
      actuals: {
        winner: null,
        runnerUp: null,
        orangeCap: null,
        purpleCap: null,
      },
      picks: [],
    },
  };
}

function csvForBundle(bundle: LeagueBundle): string {
  const header =
    "player_id,name,role,ipl_team,nationality,franchise_owner";
  const lines = [header];
  for (const f of bundle.franchises) {
    for (const pid of f.playerIds) {
      const p = bundle.players.find((x) => x.id === pid)!;
      lines.push(
        `${p.id},${p.name},${p.role},${p.iplTeam},${p.nationality},${f.owner}`,
      );
    }
  }
  return lines.join("\n");
}

describe("validateMidSeasonAuctionCsv", () => {
  it("accepts a valid 105-row CSV", () => {
    const bundle = minimalBundle();
    const csv = csvForBundle(bundle);
    const r = validateMidSeasonAuctionCsv(csv, bundle);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.length).toBe(105);
  });

  it("rejects wrong row count", () => {
    const bundle = minimalBundle();
    const csv = csvForBundle(bundle).split("\n").slice(0, 50).join("\n");
    const r = validateMidSeasonAuctionCsv(csv, bundle);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("105"))).toBe(true);
    }
  });

  it("rejects bad role", () => {
    const bundle = minimalBundle();
    let csv = csvForBundle(bundle);
    csv = csv.replace(",BAT,", ",INVALID,");
    const r = validateMidSeasonAuctionCsv(csv, bundle);
    expect(r.ok).toBe(false);
  });
});
