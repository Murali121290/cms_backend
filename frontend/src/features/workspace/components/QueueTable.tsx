import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Clock, Download, FolderOpen, Search, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { uiPaths } from "@/utils/appPaths";
import { cn } from "@/utils/cn";

import { PRIORITIES, type StatusFilter } from "../constants";
import { useWorkspaceUi } from "../WorkspaceContext";
import type { WorkspaceItem } from "../types";
import { dueInfo, fmtDay, isOpen } from "../utils/dates";
import {
  activeColumnFilters, applyFilters, chapterOf, clientOf, COLUMN_FIELD, COLUMN_TITLE, columnLabel, columnOptions,
  hasActiveFilters, isAssignable, pagesOf, pmOf, sortItems, statusCounts,
  type ColumnKey, type QueueFilters, type SortDir, type SortKey,
} from "../utils/items";
import { AssigneePicker, rankPeople } from "./AssigneePicker";
import { ColumnFilter } from "./ColumnFilter";
import { CustodyBadge, DueLabel, LockedName, PriorityBadge, StatePanel, ToneBadge } from "./Primitives";

interface Props {
  items: WorkspaceItem[];
  stageOptions: string[];
  /** The stage picked in the banner (marked in the stage dropdown). */
  currentStage?: string;
  filters: QueueFilters;
  onFilters: (patch: Partial<QueueFilters>) => void;
  onClear: () => void;
  selected: ReadonlySet<number>;
  onSelected: (next: Set<number>) => void;
  onExport: (rows: WorkspaceItem[], filtered: boolean) => void;
}

const CHIPS: [StatusFilter, string][] = [
  ["all", "All"], ["unassigned", "Inbound"], ["in_progress", "In progress"], ["returned_for_review", "In review"],
  ["qa_approved", "Ready"], ["delayed", "Delayed"], ["done", "Completed"],
];

const col = createColumnHelper<WorkspaceItem>();

export function QueueTable({ items, stageOptions, currentStage, filters, onFilters, onClear, selected, onSelected, onExport }: Props) {
  const ui = useWorkspaceUi();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "due", dir: 1 });
  const multiStage = stageOptions.length > 1;

  const rows = useMemo(
    () => sortItems(applyFilters(items, filters, ui.nameOf), sort.key, sort.dir, ui.nameOf),
    [items, filters, sort, ui.nameOf],
  );
  const counts = useMemo(() => statusCounts(items, filters, ui.nameOf), [items, filters, ui.nameOf]);
  const selectable = useMemo(() => rows.filter((r) => isOpen(r) && ui.canManage(r.stage_name, r)), [rows, ui]);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const someSelected = selectable.some((r) => selected.has(r.id));
  const headerBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const toggle = (id: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelected(next);
  };

  const optionsFor = useCallback((key: ColumnKey) => () => columnOptions(items, filters, key, ui.nameOf), [items, filters, ui.nameOf]);

  /** Header cell: click the label to sort, click the funnel to filter (Excel-style). */
  const sortHeader = (key: SortKey, label: string, filterKey?: ColumnKey) => {
    const on = sort.key === key;
    return (
      <span className="inline-flex items-center whitespace-nowrap">
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as SortDir) : 1 }))}
          className="inline-flex items-center gap-1 uppercase hover:text-text"
          aria-label={`Sort by ${label}`}
        >
          {label}{on ? (sort.dir > 0 ? " ↑" : " ↓") : ""}
        </button>
        {filterKey && (
          <ColumnFilter
            title={COLUMN_TITLE[filterKey]}
            getOptions={optionsFor(filterKey)}
            selected={filters[COLUMN_FIELD[filterKey]] as string[]}
            onChange={(values) => onFilters({ [COLUMN_FIELD[filterKey]]: values } as Partial<QueueFilters>)}
          />
        )}
      </span>
    );
  };

  const columns = [
    col.display({
      id: "select",
      header: () => (
        <input
          ref={headerBox}
          type="checkbox"
          aria-label="Select all visible"
          checked={allSelected}
          disabled={!selectable.length}
          onChange={(e) => {
            const next = new Set(selected);
            selectable.forEach((r) => (e.target.checked ? next.add(r.id) : next.delete(r.id)));
            onSelected(next);
          }}
          className="size-4 accent-primary"
        />
      ),
      cell: ({ row }) =>
        isOpen(row.original) && ui.canManage(row.original.stage_name, row.original) ? (
          <input
            type="checkbox"
            aria-label={`Select ${chapterOf(row.original)}`}
            checked={selected.has(row.original.id)}
            onChange={(e) => toggle(row.original.id, e.target.checked)}
            className="size-4 accent-primary"
          />
        ) : null,
    }),
    col.accessor((r) => clientOf(r), {
      id: "client",
      header: () => sortHeader("client", "Client", "client"),
      cell: ({ row }) => <span className="text-text" title={row.original.client}>{clientOf(row.original)}</span>,
    }),
    col.accessor("project", {
      header: () => sortHeader("project", "Project code", "project"),
      cell: (c) => <span className="whitespace-nowrap text-text">{c.getValue()}</span>,
    }),
    col.accessor((r) => pmOf(r), {
      id: "pm",
      header: () => sortHeader("pm", "PM", "pm"),
      cell: ({ row }) => <span className="text-muted" title={row.original.project_manager_name ?? undefined}>{pmOf(row.original)}</span>,
    }),
    col.accessor("chapters", {
      header: () => sortHeader("chapter", "Chapter", "chapter"),
      cell: ({ row }) => <span className="font-semibold text-text">{chapterOf(row.original)}</span>,
    }),
    col.accessor("stage_name", { header: () => sortHeader("stage", "Stage", "stage"), cell: (c) => <span className="text-muted">{c.getValue()}</span> }),
    col.accessor("planned_end_date", {
      header: () => sortHeader("due", "Due date", "due"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {isOpen(row.original) && <span className="text-xs text-muted">{fmtDay(row.original.planned_end_date)} · </span>}
          <DueLabel info={dueInfo(row.original, ui.todayKey)} />
        </span>
      ),
    }),
    col.accessor("custody_status", {
      header: () => sortHeader("custody", "Status", "status"),
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1">
          <CustodyBadge status={row.original.custody_status} />
          {row.original.rework_count > 0 && <ToneBadge tone="warn">×{row.original.rework_count}</ToneBadge>}
        </span>
      ),
    }),
    col.accessor("assignee_name", {
      header: () => sortHeader("assignee", "Assignee", "assignee"),
      cell: ({ row }) => {
        const it = row.original;
        if (ui.canManage(it.stage_name, it) && isAssignable(it)) {
          return (
            <AssigneePicker
              people={rankPeople(ui.peopleFor([it.stage_name]), ui.items)}
              current={it.assignee_name}
              nameOf={ui.nameOf}
              triggerLabel={`Change assignee for ${chapterOf(it)}, currently ${ui.nameOf(it.assignee_name)}`}
              disabled={ui.pending.has(it.id)}
              onChoose={(u) => ui.quickAssign(it, u)}
            />
          );
        }
        return <LockedName name={ui.nameOf(it.assignee_name)} locked={isOpen(it) && !isAssignable(it)} />;
      },
    }),
    col.accessor("priority", { header: () => sortHeader("priority", "Priority", "priority"), cell: (c) => <PriorityBadge priority={c.getValue()} showNormal /> }),
    col.accessor((r) => pagesOf(r), { id: "pages", header: () => sortHeader("pages", "Pages", "pages"), cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
    col.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const it = row.original;
        const manage = ui.canManage(it.stage_name, it);
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {manage && it.custody_status === "unassigned" && <Button size="sm" variant="secondary" onClick={() => ui.open.assign(it)}>Assign</Button>}
            {manage && it.custody_status === "returned_for_review" && <Button size="sm" variant="secondary" onClick={() => ui.open.review(it)}>Review</Button>}
            {manage && it.custody_status === "qa_approved" && <Button size="sm" variant="secondary" onClick={() => ui.open.moveNext(it)}>Move →</Button>}
            {it.project_id && it.chapter_id ? (
              <Link
                to={uiPaths.chapterDetail(it.project_id, it.chapter_id)}
                aria-label={`Open chapter folder for ${chapterOf(it)}`}
                title="Open chapter folder"
                className="grid size-7 place-items-center rounded-lg border border-border text-muted hover:text-text"
              >
                <FolderOpen className="size-3.5" aria-hidden="true" />
              </Link>
            ) : null}
            <button type="button" onClick={() => ui.open.activity(it)} aria-label={`Activity for ${chapterOf(it)}`} className="grid size-7 place-items-center rounded-lg border border-border text-muted hover:text-text">
              <Clock className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        );
      },
    }),
  ];

  const LABELS: Record<string, string> = {
    select: "", client: "Client", project: "Project code", pm: "PM", chapters: "Chapter", stage_name: "Stage",
    planned_end_date: "Due date", custody_status: "Status", assignee_name: "Assignee", priority: "Priority", pages: "Pages", actions: "",
  };
  const SORT_OF: Record<string, SortKey> = {
    client: "client", project: "project", pm: "pm", chapters: "chapter", stage_name: "stage", planned_end_date: "due",
    custody_status: "custody", assignee_name: "assignee", priority: "priority", pages: "pages",
  };

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), getRowId: (r) => String(r.id) });
  const active = hasActiveFilters(filters);
  const columnFilters = activeColumnFilters(filters);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative max-w-sm min-w-60 flex-1">
          <span className="sr-only">Search the queue</span>
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            id="workspace-search"
            type="search"
            value={filters.q}
            onChange={(e) => onFilters({ q: e.target.value })}
            placeholder="Search chapter, project, client or person"
            autoComplete="off"
            className="w-full rounded-lg border border-border bg-card py-1.5 pr-8 pl-8 text-sm"
          />
          <kbd className="absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border px-1 text-[10px] text-muted">/</kbd>
        </label>
        {multiStage && (
          <select aria-label="Stage" value={filters.stage} onChange={(e) => onFilters({ stage: e.target.value })} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm">
            <option value="all">All stages</option>
            {stageOptions.map((s) => <option key={s} value={s}>{s}{s === currentStage ? " (selected stage)" : ""}</option>)}
          </select>
        )}
        <select aria-label="Priority" value={filters.priority} onChange={(e) => onFilters({ priority: e.target.value })} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm">
          <option value="all">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="flex-1" />
        {active && <Button size="sm" variant="ghost" onClick={onClear} leftIcon={<X className="size-3.5" />}>Clear filters</Button>}
        <Button
          size="sm"
          variant="secondary"
          disabled={!rows.length}
          title={active ? "Download only the rows matching the current filters" : "Download all rows"}
          onClick={() => onExport(rows, active)}
          leftIcon={<Download className="size-3.5" />}
        >
          Export {rows.length} row{rows.length === 1 ? "" : "s"}{active ? " (filtered)" : ""}
        </Button>
      </div>

      {columnFilters.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Active column filters">
          <span className="font-semibold text-muted">Filtered by</span>
          {columnFilters.map((k) => {
            const vals = filters[COLUMN_FIELD[k]] as string[];
            const shown = vals.slice(0, 2).map((v) => columnLabel(k, v, ui.nameOf)).join(", ");
            return (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pr-1 pl-2.5 text-text">
                <b>{COLUMN_TITLE[k]}:</b> {shown}{vals.length > 2 ? ` +${vals.length - 2}` : ""}
                <button
                  type="button"
                  aria-label={`Remove ${COLUMN_TITLE[k]} filter`}
                  onClick={() => onFilters({ [COLUMN_FIELD[k]]: [] } as Partial<QueueFilters>)}
                  className="grid size-4 place-items-center rounded-full hover:bg-primary/20"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div role="group" aria-label="Status filter" className="mb-3 flex flex-wrap gap-1.5">
        {CHIPS.map(([s, label]) => (
          <button
            key={s}
            type="button"
            aria-pressed={filters.status === s}
            onClick={() => onFilters({ status: s })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-medium",
              filters.status === s ? "border-text bg-text text-card" : "border-border bg-card text-muted hover:text-text",
            )}
          >
            {label}
            <span className="rounded-full bg-black/10 px-1.5 text-[11px] tabular-nums dark:bg-white/10">{counts[s]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <StatePanel
          title="No chapters match"
          body="Try a different search or status."
          action={active ? <Button variant="secondary" onClick={onClear}>Clear filters</Button> : undefined}
        />
      ) : (
        <div
          // Rows scroll inside the table box (header stays visible); the page itself doesn't grow with the list.
          tabIndex={0}
          aria-label="Chapters list"
          className="max-h-[calc(100vh-300px)] min-h-64 overflow-auto overscroll-contain rounded-2xl border border-border bg-card focus-visible:outline-2 focus-visible:outline-primary max-md:max-h-none"
        >
          <table className="w-full text-sm max-md:block">
            <thead className="bg-background text-left text-[11px] tracking-wide text-muted max-md:hidden">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={SORT_OF[h.id] === sort.key ? (sort.dir > 0 ? "ascending" : "descending") : undefined}
                      className={cn("sticky top-0 z-[2] bg-background px-3 py-2 font-semibold shadow-[inset_0_-1px_0_var(--color-border)]", h.id === "select" && "w-9", h.id === "pages" && "text-right")}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="max-md:block">
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  aria-busy={ui.pending.has(row.original.id) || undefined}
                  className={cn(
                    "border-t border-border align-middle max-md:relative max-md:block max-md:px-1 max-md:py-2",
                    selected.has(row.original.id) && "bg-blue-50/70 dark:bg-blue-950/30",
                    ui.pending.has(row.original.id) && "opacity-55",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      data-label={LABELS[cell.column.id] ?? ""}
                      className={cn(
                        "px-3 py-2",
                        cell.column.id === "pages" && "text-right",
                        cell.column.id === "actions" && "text-right",
                        "max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:py-1 max-md:text-right max-md:before:text-xs max-md:before:text-muted max-md:before:content-[attr(data-label)]",
                        cell.column.id === "select" && "max-md:absolute max-md:top-2 max-md:right-2 max-md:before:content-none",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
