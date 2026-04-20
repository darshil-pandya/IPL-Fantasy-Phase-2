import { iplTeamPillClass } from "../lib/iplTheme";

export function IplTeamPill({ code }: { code: string }) {
  return (
    <span className={iplTeamPillClass(code)} title={code}>
      {code}
    </span>
  );
}
