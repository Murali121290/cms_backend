import { useState } from "react";
import { ChevronRight, Clock } from "lucide-react";

import { cn } from "@/utils/cn";

import { useWorkspaceUi } from "../WorkspaceContext";
import type { WorkspaceItem } from "../types";
import { fmtDateTime, fmtDay } from "../utils/dates";
import { chapterOf, pagesOf } from "../utils/items";
import { Avatar, EmptyBox, ToneBadge } from "./Primitives";

export function CompletedStrip({ stage, items, windowDays }: { stage: string; items: WorkspaceItem[]; windowDays: number }) {
  const ui = useWorkspaceUi();
  const [open, setOpen] = useState(false);
  const done = [...items].sort((a, b) => (b.actual_end_date ?? "").localeCompare(a.actual_end_date ?? ""));
  const late = done.filter((i) => (i.completion_delay_days ?? 0) > 0).length;

  return (
    <section className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-primary"
      >
        <ChevronRight className={cn("size-3.5 text-muted transition-transform motion-reduce:transition-none", open && "rotate-90")} aria-hidden="true" />
        <b className="text-text">Completed in {stage}</b>
        <span className="rounded-full bg-slate-200 px-2 text-[11px] font-semibold text-muted dark:bg-slate-700">{done.length}</span>
        <span className="text-xs text-muted">{done.length - late} on time · {late} late · last {windowDays} days</span>
        <span className="ml-auto text-xs text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-2">
          {done.length === 0 ? (
            <EmptyBox>Nothing completed in this stage in the last {windowDays} days.</EmptyBox>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-background text-left text-[11px] tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-3 py-2">Chapter</th><th className="px-3 py-2">Done by</th><th className="px-3 py-2">Planned</th>
                    <th className="px-3 py-2">Completed</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Went to</th>
                    <th className="px-3 py-2"><span className="sr-only">Activity</span></th>
                  </tr>
                </thead>
                <tbody>
                  {done.map((i) => {
                    const lateBy = i.completion_delay_days ?? 0;
                    return (
                      <tr key={i.id} className="border-t border-border">
                        <td className="px-3 py-2"><div className="font-semibold text-text">{chapterOf(i)}</div><div className="text-xs text-muted">{i.project} · {pagesOf(i)} pp</div></td>
                        <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 text-muted"><Avatar username={i.assignee_name} name={ui.nameOf(i.assignee_name)} />{ui.nameOf(i.assignee_name)}</span></td>
                        <td className="px-3 py-2 text-muted">{fmtDay(i.planned_start_date)} – {fmtDay(i.planned_end_date)}</td>
                        <td className="px-3 py-2 text-muted">{fmtDateTime(i.actual_end_date)}</td>
                        <td className="px-3 py-2">
                          {lateBy > 0 ? <ToneBadge tone="bad">{lateBy}d late</ToneBadge> : <ToneBadge tone="ok">On time</ToneBadge>}
                          {i.rework_count > 0 && <ToneBadge tone="warn" className="ml-1">Rework ×{i.rework_count}</ToneBadge>}
                        </td>
                        <td className="px-3 py-2 text-muted">{i.next_stage ?? "Complete"}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => ui.open.activity(i)} aria-label={`Activity for ${chapterOf(i)}`} className="grid size-7 place-items-center rounded-lg border border-border text-muted hover:text-text">
                            <Clock className="size-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
