import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OwnerPointsChartRow } from "../lib/cumulativeOwnerMatchPoints";
import { ownerChartStroke } from "../lib/ownerTheme";

type TooltipPayloadItem = {
  name?: string;
  value?: number;
  color?: string;
  payload?: OwnerPointsChartRow;
};

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row || typeof row.fullLabel !== "string") return null;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-950/95 px-3 py-2 text-sm shadow-xl">
      <p className="font-medium text-slate-200">{row.fullLabel}</p>
      <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
        {payload.map((p) => (
          <li key={String(p.name)} className="flex justify-between gap-6 tabular-nums">
            <span style={{ color: p.color ?? "#e2e8f0" }}>{p.name}</span>
            <span className="text-slate-100">
              {typeof p.value === "number" ? Math.round(p.value) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Props = {
  data: OwnerPointsChartRow[];
  owners: string[];
};

export function OwnerPointsLineChart({ data, owners }: Props) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.55} />
        <XAxis
          dataKey="label"
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          width={48}
          domain={["auto", "auto"]}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend
          wrapperStyle={{ paddingTop: 12 }}
          formatter={(value) => <span className="text-slate-300">{value}</span>}
        />
        {owners.map((o) => (
          <Line
            key={o}
            type="monotone"
            dataKey={o}
            name={o}
            stroke={ownerChartStroke(o)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
