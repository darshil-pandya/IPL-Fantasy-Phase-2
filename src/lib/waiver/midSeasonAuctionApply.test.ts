import { describe, expect, it } from "vitest";
import type { LeagueBundle } from "../../types";
import {
  buildSwapPairsForRosterChange,
  rebuildPoolAndAuctionFromRosters,
} from "./midSeasonAuctionApply";

const miniBundle = (): LeagueBundle => ({
  meta: {
    seasonLabel: "T",
    lastPointsUpdate: null,
    pointsUpdateNote: "",
    cricbuzzBaseUrl: "",
  },
  franchises: [
    { owner: "A", teamName: "A XI", playerIds: ["x1", "x2"] },
    { owner: "B", teamName: "B XI", playerIds: ["y1", "y2"] },
  ],
  players: [
    {
      id: "x1",
      name: "X1",
      iplTeam: "MI",
      role: "BAT",
      nationality: "IND",
      seasonTotal: 0,
      byMatch: [],
    },
    {
      id: "x2",
      name: "X2",
      iplTeam: "MI",
      role: "BOWL",
      nationality: "IND",
      seasonTotal: 0,
      byMatch: [],
    },
    {
      id: "y1",
      name: "Y1",
      iplTeam: "CSK",
      role: "BAT",
      nationality: "IND",
      seasonTotal: 0,
      byMatch: [],
    },
    {
      id: "y2",
      name: "Y2",
      iplTeam: "CSK",
      role: "BAT",
      nationality: "IND",
      seasonTotal: 0,
      byMatch: [],
    },
    {
      id: "z1",
      name: "Z1",
      iplTeam: "RCB",
      role: "WK",
      nationality: "IND",
      seasonTotal: 0,
      byMatch: [],
    },
  ],
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
});

describe("buildSwapPairsForRosterChange", () => {
  it("returns empty pairs when multisets match", () => {
    const r = buildSwapPairsForRosterChange(["a", "b", "c"], ["c", "b", "a"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pairs.length).toBe(0);
  });

  it("finds swaps for one replacement", () => {
    const r = buildSwapPairsForRosterChange(["a", "b"], ["a", "c"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pairs).toEqual([["b", "c"]]);
    }
  });
});

describe("rebuildPoolAndAuctionFromRosters", () => {
  it("puts unassigned players in pool and unsold", () => {
    const b = miniBundle();
    const { waiverPool, auction } = rebuildPoolAndAuctionFromRosters(
      b.players,
      b.franchises,
      b,
    );
    expect(auction.unsoldPlayerIds).toEqual(["z1"]);
    expect(waiverPool.map((p) => p.id)).toEqual(["z1"]);
  });
});
