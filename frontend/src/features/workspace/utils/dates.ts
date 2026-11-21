import type { WorkspaceItem } from "../types";

export const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar day as YYYY-MM-DD. */
export function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local calendar day of an ISO timestamp (or a plain YYYY-MM-DD string). */
export function dayKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : toDayKey(d);
}

/** Whole days from a to b (both YYYY-MM-DD), DST-safe. */
export function daysBetween(aKey: string, bKey: string): number {
  return Math.round((Date.parse(`${bKey}T00:00:00Z`) - Date.parse(`${aKey}T00:00:00Z`)) / DAY_MS);
}

/** Local midnight for a YYYY-MM-DD key. */
export function dayStart(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function fmtDay(iso: string | null | undefined): string {
  const k = dayKeyOf(iso);
  if (!k) return "—";
  return dayStart(k).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const isOpen = (item: WorkspaceItem) => item.custody_status !== "transitioned";

/** Late = open and past its due day. The server decides this in the app timezone. */
export const isLate = (item: WorkspaceItem) => isOpen(item) && item.delayed;

export type DueTone = "bad" | "warn" | "none";

export interface DueInfo {
  text: string;
  tone: DueTone;
}

export function dueInfo(item: WorkspaceItem, todayKey: string): DueInfo {
  if (!isOpen(item)) {
    const late = item.completion_delay_days ?? 0;
    const when = item.actual_end_date ? fmtDay(item.actual_end_date) : "";
    return {
      text: `Completed${when ? ` ${when}` : ""} · ${late > 0 ? `${late}d late` : "on time"}`,
      tone: late > 0 ? "bad" : "none",
    };
  }
  const dueKey = dayKeyOf(item.planned_end_date);
  if (!dueKey) return { text: "No due date", tone: "none" };
  const d = daysBetween(todayKey, dueKey);
  if (d < 0 || item.delayed) {
    const late = item.delay_days && item.delay_days > 0 ? item.delay_days : Math.max(1, -d);
    return { text: `${late}d late`, tone: "bad" };
  }
  if (d === 0) return { text: "Due today", tone: "warn" };
  if (d === 1) return { text: "Due tomorrow", tone: "warn" };
  return { text: `Due in ${d}d`, tone: "none" };
}

export function agoText(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}
