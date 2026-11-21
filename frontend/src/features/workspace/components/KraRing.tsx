import { KRA_AMBER_FROM, KRA_GREEN_FROM } from "../constants";

export type KraBand = "ok" | "warn" | "bad";

export function kraBand(rate: number): KraBand {
  return rate >= KRA_GREEN_FROM ? "ok" : rate >= KRA_AMBER_FROM ? "warn" : "bad";
}

export const KRA_LABEL: Record<KraBand, string> = { ok: "On track", warn: "At risk", bad: "Off track" };

const STROKE: Record<KraBand, string> = { ok: "#10b981", warn: "#f59e0b", bad: "#ef4444" };

export function KraRing({ rate, size = 52 }: { rate: number; size?: number }) {
  const band = kraBand(rate);
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, rate));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`On-time rate ${Math.round(rate)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-slate-200 dark:stroke-slate-700" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={STROKE[band]} strokeWidth={6} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fontSize={Math.round(size / 4.3)} fontWeight={700} className="fill-text">
        {Math.round(rate)}%
      </text>
    </svg>
  );
}
