import { espnDismissalAsString, type EspnBatterAgg, type EspnBowlerAgg } from "../scrape/espn.js";
import type { PlayerMatchStat } from "./points.js";

export function statFromEspn(
  bat: EspnBatterAgg | undefined,
  bowl: EspnBowlerAgg | undefined,
): PlayerMatchStat {
  const s: PlayerMatchStat = {};
  if (bat) {
    s.runsBat = bat.runs;
    s.ballsBat = bat.balls;
    s.fours = bat.fours;
    s.sixes = bat.sixes;
    s.isOut = bat.isOut;
    s.dismissalText = espnDismissalAsString(bat.dismissalText);
  }
  if (bowl) {
    s.ballsBowled = bowl.balls;
    s.maidens = bowl.maidens;
    s.conceded = bowl.conceded;
    s.wickets = bowl.wickets;
    s.dots = bowl.dots;
  }
  return s;
}
