import type { CustodyStatus, Priority } from "./types";

export const DASHBOARD_QUERY_KEY = "workspace-dashboard";
export const SCHEDULE_QUERY_KEY = "workspace-schedule";
export const COMPLETED_WINDOW_DAYS = 30;
export const REFETCH_INTERVAL_MS = 60_000;

/** KRA ring bands (Phase 6 replaces these with per-role settings from Role Master). */
export const KRA_GREEN_FROM = 90;
export const KRA_AMBER_FROM = 80;

/** Open tasks per person before the workload bar turns red. */
export const WORKLOAD_CAPACITY = 4;

export const PRIORITIES: Priority[] = ["Normal", "High", "Urgent"];
export const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Normal: 2 };

export type Tone = "warn" | "accent" | "violet" | "ok" | "muted" | "bad";

export interface CustodyMeta {
  label: string;
  short: string;
  tone: Tone;
  hint: string;
}

export const CUSTODY: Record<CustodyStatus, CustodyMeta> = {
  unassigned: { label: "Inbound", short: "Inbound", tone: "warn", hint: "Arrived from the previous stage. Assign someone." },
  in_progress: { label: "In progress", short: "In progress", tone: "accent", hint: "Being worked on by your team." },
  returned_for_review: { label: "Returned for review", short: "In review", tone: "violet", hint: "Handed back. Approve or send back for rework." },
  qa_approved: { label: "Ready to move", short: "Ready", tone: "ok", hint: "QA approved. Move to the next stage." },
  transitioned: { label: "Completed", short: "Completed", tone: "muted", hint: "" },
};

export const BOARD_COLUMNS: CustodyStatus[] = ["unassigned", "in_progress", "returned_for_review", "qa_approved"];

/** Tailwind classes per tone (badge background + text; dot colour; solid bar colour). */
export const TONE_CLASSES: Record<Tone, { badge: string; dot: string; bar: string; border: string }> = {
  warn: { badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200", dot: "bg-amber-500", bar: "bg-amber-500", border: "border-l-amber-500" },
  accent: { badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200", dot: "bg-blue-500", bar: "bg-blue-600", border: "border-l-blue-500" },
  violet: { badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200", dot: "bg-violet-500", bar: "bg-violet-600", border: "border-l-violet-500" },
  ok: { badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", dot: "bg-emerald-500", bar: "bg-emerald-600", border: "border-l-emerald-500" },
  muted: { badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", dot: "bg-slate-400", bar: "bg-slate-400", border: "border-l-slate-400" },
  bad: { badge: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200", dot: "bg-red-500", bar: "bg-red-600", border: "border-l-red-500" },
};

export type WorkspaceTab = "board" | "queue" | "schedule" | "team";
export const TABS: WorkspaceTab[] = ["board", "queue", "schedule", "team"];

export type StatusFilter = "all" | CustodyStatus | "delayed" | "done";

export const HANDBACK_MIN_NOTES = 15;
export const REWORK_MIN_NOTES = 5;

export const HANDBACK_CHECKLIST = [
  "Track changes reviewed and clean",
  "Author queries inserted and numbered",
  "Style sheet updated with new decisions",
] as const;
