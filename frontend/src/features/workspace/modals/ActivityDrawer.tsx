import { useQuery } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { SlideDrawer } from "@/components/ui/SlideDrawer";

import { workspaceApi } from "../api";
import { CustodyBadge, PriorityBadge, Skeleton } from "../components/Primitives";
import type { WorkspaceItem } from "../types";
import { dueInfo, fmtDateTime, fmtDay } from "../utils/dates";
import { chapterOf, clientOf, pagesOf, pmOf, type NameOf } from "../utils/items";

export function ActivityDrawer({ item, nameOf, todayKey, onClose }: { item: WorkspaceItem; nameOf: NameOf; todayKey: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["workspace-activity", item.id], queryFn: () => workspaceApi.activity(item.id) });
  const t = q.data?.task ?? item;
  const events = [...(q.data?.events ?? [])].reverse();
  const row = (k: string, v: string) => (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="m-0 font-medium text-text">{v}</dd>
    </>
  );
  return (
    <SlideDrawer isOpen onClose={onClose} title={chapterOf(t)} description={`${t.project} · ${clientOf(t)}`} width="lg">
      <div className="mb-3 flex gap-1.5"><CustodyBadge status={t.custody_status} short={false} /><PriorityBadge priority={t.priority} /></div>
      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-sm">
        {row("Stage", t.stage_name)}
        {row("Assignee", nameOf(t.assignee_name))}
        {row("Project manager", pmOf(t))}
        {row("Planned", `${fmtDay(t.planned_start_date)} – ${fmtDay(t.planned_end_date)}`)}
        {row("Due", dueInfo(t, todayKey).text)}
        {row("Pages", String(pagesOf(t)))}
        {row("Rework rounds", String(t.rework_count))}
        {t.assigned_by ? row("Assigned by", nameOf(t.assigned_by)) : null}
        {t.qa_approved_by ? row("QA approved", `${nameOf(t.qa_approved_by)} · ${fmtDateTime(t.qa_approved_at)}`) : null}
      </dl>
      {t.assignment_notes && <p className="mt-3 rounded-lg border-l-[3px] border-l-blue-500 bg-background px-2.5 py-1.5 text-sm"><b>Instructions:</b> {t.assignment_notes}</p>}
      <h3 className="mt-5 mb-2 text-sm font-semibold text-text">Activity</h3>
      {q.isLoading ? (
        <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-red-600">{getApiErrorMessage(q.error, "Activity could not be loaded.")}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted">No recorded activity yet.</p>
      ) : (
        <ol className="m-0 list-none border-l-2 border-border p-0">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="relative pb-3.5 pl-4 text-sm">
              <span aria-hidden="true" className={`absolute top-1 -left-[6px] size-2.5 rounded-full border-2 border-blue-500 ${i === 0 ? "bg-blue-500" : "bg-card"}`} />
              {e.text}
              <small className="block text-[11.5px] text-muted">{e.actor ? nameOf(e.actor) : "System"} · {fmtDateTime(e.at)}</small>
            </li>
          ))}
        </ol>
      )}
    </SlideDrawer>
  );
}
