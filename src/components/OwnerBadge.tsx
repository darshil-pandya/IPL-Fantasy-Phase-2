import { ownerPillClass } from "../lib/ownerTheme";

export function OwnerBadge({
  owner,
  className = "",
}: {
  owner: string;
  className?: string;
}) {
  return (
    <span className={`${ownerPillClass(owner)} ${className}`.trim()}>{owner}</span>
  );
}
