import * as XLSX from "xlsx";

import { CUSTODY } from "../constants";
import type { WorkspaceItem } from "../types";
import { isOpen } from "./dates";
import { chapterOf, clientOf, pmOf, type NameOf } from "./items";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB") : "-");

/**
 * Exactly the rows on screen (after search, status chip and column filters), in the queue's column
 * order: Client, Project code, PM, Chapter, Stage, Due date, then status/assignee/priority/pages and
 * the extra legacy export columns.
 */
export function exportQueueToExcel(items: WorkspaceItem[], nameOf: NameOf, filtered = false): void {
  const rows = items.map((item) => ({
    Client: clientOf(item),
    "Project Code": item.project || "",
    PM: pmOf(item),
    Chapter: chapterOf(item),
    Stage: item.stage_name || "",
    "Due Date": fmt(item.planned_end_date),
    Status: CUSTODY[item.custody_status].label,
    Assignee: item.assignee_name ? nameOf(item.assignee_name) : "Unassigned",
    Priority: item.priority || "Normal",
    "MSS Pages": item.manuscript_pages || 0,
    "CE Pages": item.ce_pages || 0,
    "Start Date": fmt(item.planned_start_date),
    "SLA Status": isOpen(item)
      ? item.delayed ? `Delayed (${item.delay_days ?? 0}d)` : "On Schedule"
      : (item.completion_delay_days ?? 0) > 0 ? `Completed ${item.completion_delay_days}d late` : "Completed on time",
    "Completed On": fmt(item.actual_end_date && !isOpen(item) ? item.actual_end_date : null),
    "Client Code": item.client || "",
    "Chapter No": item.chapters || "",
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [26, 18, 14, 16, 22, 12, 18, 18, 10, 10, 10, 12, 22, 14, 12, 10].map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1" };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Queue");
  XLSX.writeFile(book, `workspace_queue${filtered ? "_filtered" : ""}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
