import { useMemo, useState, type CSSProperties } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { getApiErrorMessage } from "@/api/client";
import { cn } from "@/utils/cn";

import { CUSTODY, TONE_CLASSES, type Tone } from "../constants";
import { useSchedule } from "../hooks/useSchedule";
import { useWorkspaceUi } from "../WorkspaceContext";
import type { WorkspaceItem } from "../types";
import { dayStart, fmtDateTime, fmtDay, isLate, isOpen } from "../utils/dates";
import { chapterOf, pagesOf, textMatch, workloadOf } from "../utils/items";
import { actualWindow, barGeometry, dayCells, makeRange, offsetPct, plannedWindow, type ScheduleRange, type ScheduleWeeks } from "../utils/schedule";
import { Avatar, ErrorPanel, LoadBar, Skeleton, StatePanel } from "./Primitives";

type Group = "chapter" | "person";

/** Planned row for a stage the chapter hasn't reached: shown for planning, never workable. */
const isUpcoming = (i: WorkspaceItem) => i.live === false;
const isActive = (i: WorkspaceItem) => isOpen(i) && !isUpcoming(i);

function barTone(item: WorkspaceItem): Tone {
  if (!isOpen(item)) return (item.completion_delay_days ?? 0) > 0 ? "bad" : "ok";
  if (isLate(item)) return "bad";
  return CUSTODY[item.custody_status].tone;
}

function barLabel(item: WorkspaceItem): string {
  if (!isOpen(item)) {
    const late = item.completion_delay_days ?? 0;
    return late > 0 ? `Done · ${late}d late` : "Done";
  }
  const s = CUSTODY[item.custody_status].short;
  return isLate(item) ? `${item.delay_days ?? 1}d late · ${s}` : s;
}

function Bars({ item, range, nowMs }: { item: WorkspaceItem; range: ScheduleRange; nowMs: number }) {
  const plan = plannedWindow(item);
  const act = actualWindow(item, nowMs);
  const pg = plan ? barGeometry(range, plan[0], plan[1]) : null;
  const ag = act && !isUpcoming(item) ? barGeometry(range, act[0], act[1]) : null;
  const pos = (g: { left: number; width: number }): CSSProperties => ({ left: `${g.left}%`, width: `${g.width}%` });
  if (!pg && !ag) {
    const end = act?.[1] ?? plan?.[1] ?? 0;
    const earlier = end <= range.start.getTime();
    return <span className={cn("absolute top-4 text-xs text-muted", earlier ? "left-2" : "right-2")}>{earlier ? "‹ earlier" : "later ›"}</span>;
  }
  const tone = barTone(item);
  return (
    <>
      {pg && (
        <div
          className="absolute top-2 h-8 rounded-lg border-[1.5px] border-dashed border-slate-400 bg-slate-100/40 dark:border-slate-500 dark:bg-slate-800/40"
          style={pos(pg)}
          title={`Planned ${fmtDay(item.planned_start_date)} – ${fmtDay(item.planned_end_date)}`}
        />
      )}
      {ag && (
        <div
          className={cn("absolute top-3.5 flex h-5 items-center overflow-hidden rounded-md px-1.5 text-[11px] font-bold whitespace-nowrap text-white", TONE_CLASSES[tone].bar)}
          style={pos(ag)}
          title={`Started ${fmtDateTime(item.actual_start_date)}${item.actual_end_date && !isOpen(item) ? `, completed ${fmtDateTime(item.actual_end_date)}` : ", still open"}`}
        >
          {barLabel(item)}
        </div>
      )}
    </>
  );
}

export function ScheduleView({ stage, people }: { stage: string; people: string[] }) {
  const ui = useWorkspaceUi();
  const [weeks, setWeeks] = useState<ScheduleWeeks>(2);
  const [group, setGroup] = useState<Group>("chapter");
  const [showDone, setShowDone] = useState(true);
  const [q, setQ] = useState("");
  const today = useMemo(() => dayStart(ui.todayKey), [ui.todayKey]);
  const range = useMemo(() => makeRange(today, weeks), [today, weeks]);
  const query = useSchedule(stage, range, showDone);
  const manage = ui.canManage(stage);

  const rows = useMemo(
    () =>
      (query.data?.items ?? [])
        .filter((i) => (showDone || isOpen(i)) && textMatch(i, q, ui.nameOf))
        .sort((a, b) => (a.planned_start_date ?? "").localeCompare(b.planned_start_date ?? "") || (a.planned_end_date ?? "").localeCompare(b.planned_end_date ?? "")),
    [query.data, showDone, q, ui.nameOf],
  );
  const cells = useMemo(() => dayCells(range, ui.todayKey), [range, ui.todayKey]);
  const todayPct = offsetPct(range, ui.nowMs);
  const done = rows.filter((r) => !isOpen(r));
  const live = rows.filter((r) => !isUpcoming(r));
  const upcoming = rows.length - live.length;
  const onTime = done.filter((r) => (r.completion_delay_days ?? 0) <= 0).length;

  const seg = <T extends string | number>(value: T, current: T, set: (v: T) => void, label: string) => (
    <button type="button" aria-pressed={value === current} onClick={() => set(value)} className={cn("rounded-md px-3 py-1 text-sm font-medium", value === current ? "bg-card text-text shadow-sm" : "text-muted")}>
      {label}
    </button>
  );

  const renderRow = (item: WorkspaceItem) => (
    <div key={item.id} className={cn("relative grid min-h-[50px] grid-cols-[var(--lab)_1fr] border-b border-border", isUpcoming(item) && "opacity-60")}>
      <div className="sticky left-0 z-[3] flex min-w-0 items-center gap-2 border-r border-border bg-card px-3 py-1.5">
        <button type="button" onClick={() => ui.open.activity(item)} title="Open activity" className="flex min-w-0 flex-1 flex-col text-left focus-visible:outline-2 focus-visible:outline-primary">
          <b className={cn("truncate font-semibold", isActive(item) ? "text-text" : "text-muted")}>{chapterOf(item)}</b>
          <span className="text-xs text-muted">
            {item.project} · {pagesOf(item)} pp{isUpcoming(item) ? "" : isOpen(item) ? "" : " · completed"}
          </span>
          {isUpcoming(item) && <span className="text-xs font-medium text-muted">Upcoming · still in {item.upcoming_from ?? "an earlier stage"}</span>}
        </button>
        {isUpcoming(item) ? null : item.custody_status === "unassigned" && manage ? (
          <Button size="sm" onClick={() => ui.open.assign(item)}>Assign</Button>
        ) : group === "chapter" ? (
          <span title={ui.nameOf(item.assignee_name)}><Avatar username={item.assignee_name} name={ui.nameOf(item.assignee_name)} /></span>
        ) : null}
      </div>
      <div className="relative z-[1]"><Bars item={item} range={range} nowMs={ui.nowMs} /></div>
    </div>
  );

  let body: JSX.Element[];
  if (group === "person") {
    body = [...people, null].flatMap((u) => {
      const rs = live.filter((r) => (r.assignee_name || null) === u);
      if (u === null && !rs.length) return [];
      const load = u ? workloadOf(ui.items, u) : null;
      return [
        <div key={`g-${u ?? "none"}`} className="relative z-[3] flex flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-2 font-semibold">
          <Avatar username={u} name={u ? ui.nameOf(u) : undefined} />
          <span>{u ? ui.nameOf(u) : "Not assigned yet"}</span>
          {load ? (
            <>
              <span className="text-xs font-normal text-muted">{load.open} open · {load.pages} pp</span>
              <LoadBar open={load.open} className="max-w-32" />
              {manage && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => ui.open.assignWork(u as string)}>Assign work</Button>}
            </>
          ) : (
            <span className="text-xs font-normal text-muted">{rs.length} waiting in Inbound</span>
          )}
        </div>,
        ...(rs.length
          ? rs.map(renderRow)
          : [<div key={`e-${u}`} className="grid min-h-[44px] grid-cols-[var(--lab)_1fr] border-b border-border"><div className="sticky left-0 bg-card px-3 py-2 text-xs text-muted">Nothing scheduled in this period — free for new work</div><div /></div>]),
      ];
    });
  } else {
    body = rows.map(renderRow);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative max-w-xs min-w-52 flex-1">
          <span className="sr-only">Filter chapters or people</span>
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input id="workspace-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter chapters or people" className="w-full rounded-lg border border-border bg-card py-1.5 pr-2 pl-8 text-sm" />
        </label>
        <div role="group" aria-label="Date range" className="inline-flex gap-0.5 rounded-lg border border-border bg-background p-0.5">
          {seg<ScheduleWeeks>(2, weeks, setWeeks, "2 weeks")}
          {seg<ScheduleWeeks>(4, weeks, setWeeks, "4 weeks")}
        </div>
        <div role="group" aria-label="Group rows" className="inline-flex gap-0.5 rounded-lg border border-border bg-background p-0.5">
          {seg<Group>("chapter", group, setGroup, "By chapter")}
          {seg<Group>("person", group, setGroup, "By person")}
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="size-4 accent-primary" /> Show completed
        </label>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-80" />
      ) : query.isError ? (
        <ErrorPanel message={getApiErrorMessage(query.error, "The schedule could not be loaded.")} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full border border-border bg-card px-2.5 py-0.5">{live.filter(isOpen).length} in flight</span>
            <span className="rounded-full border border-border bg-card px-2.5 py-0.5">{live.filter((r) => isOpen(r) && r.custody_status === "unassigned").length} not assigned</span>
            <span className={cn("rounded-full border border-border bg-card px-2.5 py-0.5", live.some(isLate) && "text-red-600 dark:text-red-400")}>{live.filter(isLate).length} running late</span>
            {upcoming > 0 && <span className="rounded-full border border-dashed border-border bg-card px-2.5 py-0.5 text-muted">{upcoming} upcoming from earlier stages</span>}
            <span className="rounded-full border border-border bg-card px-2.5 py-0.5">{done.length} completed · {done.length ? Math.round((100 * onTime) / done.length) : 100}% on time</span>
            {query.data?.truncated && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-amber-800">Showing the first {query.data.items.length} — narrow the range</span>}
          </div>
          {rows.length || group === "person" ? (
            <div className="max-h-[70vh] overflow-auto rounded-2xl border border-border bg-card [--lab:170px] md:[--lab:260px]">
              <div className="min-w-[820px]" style={{ ["--n" as string]: range.days } as CSSProperties}>
                <div className="sticky top-0 z-[4] grid grid-cols-[var(--lab)_1fr] border-b border-border bg-background">
                  <div className="sticky left-0 bg-background px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{group === "person" ? "Person / chapter" : "Chapter"}</div>
                  <div className="grid grid-cols-[repeat(var(--n),minmax(0,1fr))]">
                    {cells.map((c) => (
                      <span key={c.key} className={cn("flex flex-col border-l border-border pt-1 pb-1.5 text-center text-[11px] leading-tight text-muted", c.weekend && "bg-slate-100 dark:bg-slate-800/60", c.today && "bg-blue-50 dark:bg-blue-950/40")}>
                        <small className="h-3 text-[10px]">{c.monthLabel}</small>
                        <b className={cn("text-[12.5px] text-text", c.today && "text-blue-600 dark:text-blue-400")}>{c.date.getDate()}</b>
                        {c.date.toLocaleDateString(undefined, { weekday: "narrow" })}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 left-[var(--lab)] grid grid-cols-[repeat(var(--n),minmax(0,1fr))]">
                    {cells.map((c) => <i key={c.key} className={cn("border-l border-border", c.weekend && "bg-slate-100/50 dark:bg-slate-800/30")} />)}
                  </div>
                  {todayPct >= 0 && todayPct <= 100 && (
                    <div aria-hidden="true" title="Today" className="pointer-events-none absolute inset-y-0 z-[2] w-0.5 bg-blue-500" style={{ left: `calc(var(--lab) + (100% - var(--lab)) * ${(todayPct / 100).toFixed(4)})` }} />
                  )}
                  {body}
                </div>
              </div>
            </div>
          ) : (
            <StatePanel title="Nothing scheduled in this period" body="Try 4 weeks, turn on “Show completed”, or clear the search." />
          )}
          <div className="mt-2.5 flex flex-wrap gap-3.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-[18px] rounded border-[1.5px] border-dashed border-slate-400" />Planned window</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-[18px] rounded bg-blue-600" />In progress</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-[18px] rounded bg-violet-600" />In review</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-[18px] rounded bg-emerald-600" />Approved / completed on time</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-[18px] rounded bg-red-600" />Late</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3.5 w-0.5 bg-blue-500" />Today</span>
            <span className="opacity-60">Faded rows: upcoming — still in an earlier stage, assignable once moved here.</span>
            <span>Click a chapter for its full history.</span>
          </div>
        </>
      )}
    </div>
  );
}
