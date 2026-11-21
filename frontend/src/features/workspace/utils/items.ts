import { CUSTODY, PRIORITY_RANK, type StatusFilter } from "../constants";
import type { CustodyStatus, WorkspaceItem } from "../types";
import { dayKeyOf, fmtDay, isLate, isOpen } from "./dates";

export type NameOf = (username: string | null | undefined) => string;

export const pagesOf = (item: WorkspaceItem) => item.manuscript_pages || item.ce_pages || 0;

export interface QueueFilters {
  q: string;
  status: StatusFilter;
  stage: string; // "all" or a stage name
  priority: string; // "all" or a priority
  // Excel-style column filters: selected values per column; empty = no filter.
  chapters: string[];
  projects: string[];
  clients: string[];
  pms: string[];
  stages: string[];
  statuses: string[];
  assignees: string[]; // usernames; "" = unassigned
  priorities: string[];
  dues: string[];      // YYYY-MM-DD; "" = no due date
  pages: string[];
}

/** Columns of the queue that can be filtered. */
export type ColumnKey = "chapter" | "project" | "client" | "pm" | "stage" | "status" | "assignee" | "priority" | "due" | "pages";

export const COLUMN_FIELD: Record<ColumnKey, keyof QueueFilters> = {
  chapter: "chapters", project: "projects", client: "clients", pm: "pms", stage: "stages",
  status: "statuses", assignee: "assignees", priority: "priorities", due: "dues", pages: "pages",
};

export const COLUMN_TITLE: Record<ColumnKey, string> = {
  chapter: "Chapter", project: "Project", client: "Client", pm: "PM", stage: "Stage",
  status: "Status", assignee: "Assignee", priority: "Priority", due: "Due", pages: "Pages",
};

export const EMPTY_FILTERS: QueueFilters = {
  q: "",
  status: "all",
  stage: "all",
  priority: "all",
  chapters: [],
  projects: [],
  clients: [],
  pms: [],
  stages: [],
  statuses: [],
  assignees: [],
  priorities: [],
  dues: [],
  pages: [],
};

/** "01" -> "Chapter 01", "00"/"0" -> "Book", anything else unchanged (same rule as the backend). */
export function chapterLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (/^\d+$/.test(t)) return Number(t) === 0 ? "Book" : `Chapter ${t}`;
  return t;
}
/** Display name of a task's chapter. */
export const chapterOf = (i: WorkspaceItem): string => i.chapter_label || chapterLabel(i.chapters);

/** Client company name for display/filtering, falling back to the stored code. */
export const clientOf = (i: WorkspaceItem): string => i.client_name || i.client || "-";
/** PM first name for display/filtering, falling back to the username. */
export const pmOf = (i: WorkspaceItem): string => i.project_manager_display || i.project_manager_name || "-";

/** The value a task has in a column, used for column filters (raw, not formatted). */
export function columnValue(i: WorkspaceItem, key: ColumnKey): string {
  switch (key) {
    case "chapter": return chapterOf(i);
    case "project": return i.project || "";
    case "client": return clientOf(i);
    case "pm": return pmOf(i);
    case "stage": return i.stage_name || "";
    case "status": return CUSTODY[i.custody_status].label;
    case "assignee": return i.assignee_name || "";
    case "priority": return i.priority || "Normal";
    case "due": return dayKeyOf(i.planned_end_date) ?? "";
    case "pages": return String(pagesOf(i));
  }
}

/** How a column value is shown in the filter list. */
export function columnLabel(key: ColumnKey, value: string, nameOf: NameOf): string {
  if (key === "assignee") return value ? nameOf(value) : "Unassigned";
  if (key === "due") return value ? fmtDay(`${value}T12:00:00`) : "No due date";
  return value || "(blank)";
}

export function activeColumnFilters(f: QueueFilters): ColumnKey[] {
  return (Object.keys(COLUMN_FIELD) as ColumnKey[]).filter((k) => (f[COLUMN_FIELD[k]] as string[]).length > 0);
}

export function hasActiveFilters(f: QueueFilters): boolean {
  return Boolean(f.q || f.status !== "all" || f.stage !== "all" || f.priority !== "all" || activeColumnFilters(f).length);
}

export function textMatch(item: WorkspaceItem, q: string, nameOf: NameOf): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    item.chapters, chapterOf(item), item.project, item.client, clientOf(item), item.stage_name,
    item.assignee_name ?? "", nameOf(item.assignee_name), item.project_manager_name ?? "", pmOf(item),
  ].join(" ").toLowerCase();
  return hay.includes(needle);
}

/** Filters that apply in every view (search, priority, stage, secondary column filters). */
export function baseMatch(item: WorkspaceItem, f: QueueFilters, nameOf: NameOf): boolean {
  if (!textMatch(item, f.q, nameOf)) return false;
  if (f.priority !== "all" && (item.priority || "Normal") !== f.priority) return false;
  if (f.stage !== "all" && item.stage_name !== f.stage) return false;
  for (const key of Object.keys(COLUMN_FIELD) as ColumnKey[]) {
    const wanted = f[COLUMN_FIELD[key]] as string[];
    if (wanted.length && !wanted.includes(columnValue(item, key))) return false;
  }
  return true;
}

export interface ColumnOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Values offered in a column's filter list: like Excel, computed from the rows that pass every
 * *other* filter, so the list only shows values that can still match.
 */
export function columnOptions(items: WorkspaceItem[], f: QueueFilters, key: ColumnKey, nameOf: NameOf): ColumnOption[] {
  const field = COLUMN_FIELD[key];
  const others: QueueFilters = { ...f, [field]: [] };
  const counts = new Map<string, number>();
  for (const i of applyFilters(items, others, nameOf)) {
    const v = columnValue(i, key);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  // Keep currently selected values visible even if nothing matches them any more.
  for (const v of f[field] as string[]) if (!counts.has(v)) counts.set(v, 0);
  const opts = [...counts].map(([value, count]) => ({ value, count, label: columnLabel(key, value, nameOf) }));
  const blankLast = (a: ColumnOption, b: ColumnOption) => Number(a.value === "") - Number(b.value === "");
  if (key === "pages") return opts.sort((a, b) => blankLast(a, b) || Number(a.value) - Number(b.value));
  if (key === "due") return opts.sort((a, b) => blankLast(a, b) || a.value.localeCompare(b.value));
  if (key === "priority") return opts.sort((a, b) => (PRIORITY_RANK[a.value] ?? 9) - (PRIORITY_RANK[b.value] ?? 9));
  return opts.sort((a, b) => blankLast(a, b) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function statusMatch(item: WorkspaceItem, status: StatusFilter): boolean {
  if (status === "done") return !isOpen(item);
  if (!isOpen(item)) return false;
  if (status === "all") return true;
  if (status === "delayed") return isLate(item);
  return item.custody_status === status;
}

export function applyFilters(items: WorkspaceItem[], f: QueueFilters, nameOf: NameOf): WorkspaceItem[] {
  return items.filter((i) => baseMatch(i, f, nameOf) && statusMatch(i, f.status));
}

export type StatusCounts = Record<StatusFilter, number>;

export function statusCounts(items: WorkspaceItem[], f: QueueFilters, nameOf: NameOf): StatusCounts {
  const base = items.filter((i) => baseMatch(i, f, nameOf));
  const open = base.filter(isOpen);
  const by = (s: CustodyStatus) => open.filter((i) => i.custody_status === s).length;
  return {
    all: open.length,
    unassigned: by("unassigned"),
    in_progress: by("in_progress"),
    returned_for_review: by("returned_for_review"),
    qa_approved: by("qa_approved"),
    transitioned: base.length - open.length,
    delayed: open.filter(isLate).length,
    done: base.length - open.length,
  };
}

export type SortKey = "chapter" | "project" | "client" | "pm" | "stage" | "custody" | "assignee" | "priority" | "due" | "pages";
export type SortDir = 1 | -1;

const CUSTODY_ORDER: CustodyStatus[] = ["unassigned", "in_progress", "returned_for_review", "qa_approved", "transitioned"];

export const byUrgency = (a: WorkspaceItem, b: WorkspaceItem) =>
  (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
  (a.planned_end_date ?? "9999").localeCompare(b.planned_end_date ?? "9999");

export function sortItems(items: WorkspaceItem[], key: SortKey, dir: SortDir, nameOf: NameOf): WorkspaceItem[] {
  const val = (i: WorkspaceItem): string | number => {
    switch (key) {
      case "chapter": return i.chapters;
      case "project": return i.project || "";
      case "client": return clientOf(i);
      case "pm": return pmOf(i);
      case "stage": return i.stage_name;
      case "custody": return CUSTODY_ORDER.indexOf(i.custody_status);
      case "assignee": return nameOf(i.assignee_name);
      case "priority": return PRIORITY_RANK[i.priority] ?? 2;
      case "pages": return pagesOf(i);
      case "due": return (isOpen(i) ? i.planned_end_date : i.actual_end_date) ?? "9999";
    }
  };
  return [...items].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return c * dir || byUrgency(a, b);
  });
}

export interface Workload {
  open: number;
  pages: number;
}

/** Open = in progress or waiting for review (items still on the person's desk). */
export function workloadOf(items: WorkspaceItem[], username: string): Workload {
  const mine = items.filter(
    (i) => i.assignee_name === username && (i.custody_status === "in_progress" || i.custody_status === "returned_for_review"),
  );
  return { open: mine.length, pages: mine.reduce((a, i) => a + pagesOf(i), 0) };
}

export const isAssignable = (item: WorkspaceItem) =>
  item.custody_status === "unassigned" || item.custody_status === "in_progress";

export function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
}

/** Replace one item everywhere it appears (by id). */
export function replaceItem(items: WorkspaceItem[], next: WorkspaceItem): WorkspaceItem[] {
  return items.map((i) => (i.id === next.id ? next : i));
}
