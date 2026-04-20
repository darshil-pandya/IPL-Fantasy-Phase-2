import { WAIVER_BID_INCREMENT } from "../lib/waiver/constants";

const PRESET_AMOUNTS = [
  10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000,
] as const;

function moneyShort(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function snapBidToIncrement(raw: number, max: number): number {
  const inc = WAIVER_BID_INCREMENT;
  if (!Number.isFinite(raw) || max < inc) return inc;
  const clamped = Math.min(Math.max(raw, inc), max);
  return Math.round(clamped / inc) * inc;
}

type WaiverBidFieldProps = {
  value: string;
  onChange: (v: string) => void;
  budgetRemaining: number;
  label?: string;
  className?: string;
  inputClassName?: string;
};

export function WaiverBidField({
  value,
  onChange,
  budgetRemaining,
  label = "Your bid (₹)",
  className = "",
  inputClassName = "",
}: WaiverBidFieldProps) {
  const maxBid = Math.max(WAIVER_BID_INCREMENT, budgetRemaining);

  return (
    <div className={`flex flex-col gap-1 ${className}`.trim()}>
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        type="number"
        step={WAIVER_BID_INCREMENT}
        min={WAIVER_BID_INCREMENT}
        max={maxBid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const n = Number(value);
          if (!Number.isFinite(n)) return;
          onChange(String(snapBidToIncrement(n, maxBid)));
        }}
        className={`app-input py-2 text-sm ${inputClassName}`.trim()}
      />
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {PRESET_AMOUNTS.map((p) => {
          const disabled = p > budgetRemaining;
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              title={
                disabled
                  ? `Over remaining budget (${moneyShort(budgetRemaining)})`
                  : `Set bid to ${moneyShort(p)}`
              }
              onClick={() => onChange(String(p))}
              className={[
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                disabled
                  ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-600"
                  : "border-cyan-500/35 bg-cyan-500/10 text-cyan-100 hover:border-amber-400/50 hover:bg-amber-500/15",
              ].join(" ")}
            >
              {moneyShort(p)}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] leading-snug text-slate-500">
        Multiples of {moneyShort(WAIVER_BID_INCREMENT)} · between{" "}
        {moneyShort(WAIVER_BID_INCREMENT)} and {moneyShort(maxBid)}
      </p>
    </div>
  );
}
