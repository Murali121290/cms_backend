import { Fragment, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";

import { WORKLOAD_CAPACITY } from "../constants";
import { useWorkspaceUi } from "../WorkspaceContext";
import type { TeamMemberWorkspaceData, WorkspacePerson } from "../types";
import { dueInfo, isOpen } from "../utils/dates";
import { chapterOf, byUrgency, isAssignable } from "../utils/items";
import { AssigneePicker, rankPeople } from "./AssigneePicker";
import { Avatar, CustodyBadge, DueLabel, LoadBar, LockedName, StatePanel, ToneBadge } from "./Primitives";
import { kraBand } from "./KraRing";

interface Props {
  people: WorkspacePerson[];
  legacyMembers: TeamMemberWorkspaceData[];
}

export function TeamTable({ people, legacyMembers }: Props) {
  const ui = useWorkspaceUi();
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const statsBy = useMemo(() => new Map(legacyMembers.map((m) => [m.username, m.stats])), [legacyMembers]);

  const shown = people.filter((p) => {
    const n = q.trim().toLowerCase();
    return !n || `${p.username} ${p.display_name} ${p.role ?? ""}`.toLowerCase().includes(n);
  });

  const toggle = (u: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative max-w-sm min-w-60 flex-1">
          <span className="sr-only">Search people</span>
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input id="workspace-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="w-full rounded-lg border border-border bg-card py-1.5 pr-2 pl-8 text-sm" />
        </label>
        <span className="ml-auto text-xs text-muted">Load bar turns amber at {WORKLOAD_CAPACITY - 1} and red at {WORKLOAD_CAPACITY} open tasks</span>
      </div>
      {shown.length === 0 ? (
        <StatePanel title="No one matches" body="Clear the search to see the whole team." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-background text-left text-[11px] tracking-wide text-muted uppercase">
              <tr>
                <th className="w-10 px-3 py-2"><span className="sr-only">Expand</span></th>
                <th className="px-3 py-2">Person</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Load</th>
                <th className="px-3 py-2 text-right">Pages</th><th className="px-3 py-2 text-right">In review</th>
                <th className="px-3 py-2 text-right">Rework</th><th className="px-3 py-2 text-right">On time</th>
                <th className="px-3 py-2 text-right">Completed</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const mine = ui.items.filter((i) => i.assignee_name === p.username);
                const open = mine.filter(isOpen).sort(byUrgency);
                const stats = statsBy.get(p.username);
                const isOpenRow = expanded.has(p.username);
                const manage = p.stage_names.some((s) => ui.canManage(s));
                const kra = stats?.kra_meet_rate;
                return (
                  <Fragment key={p.username}>
                    <tr className="border-t border-border">
                      <td className="px-3 py-2">
                        <button type="button" aria-expanded={isOpenRow} aria-label={`Show ${p.display_name}'s tasks`} onClick={() => toggle(p.username)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-background">
                          <ChevronRight className={cn("size-3.5 transition-transform motion-reduce:transition-none", isOpenRow && "rotate-90")} aria-hidden="true" />
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <Avatar username={p.username} name={p.display_name} size="lg" />
                          <span><span className="block font-semibold text-text">{p.display_name}</span><span className="text-xs text-muted">{p.role ?? "—"}</span></span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">{p.stage_names.join(", ") || "—"}</td>
                      <td className="px-3 py-2"><span className="flex min-w-28 items-center gap-2"><LoadBar open={p.open_count} /><span className="text-xs text-muted">{p.open_count}/{WORKLOAD_CAPACITY}</span></span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.open_pages}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{open.filter((i) => i.custody_status === "returned_for_review").length}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{mine.filter((i) => i.rework_count > 0).length}</td>
                      <td className="px-3 py-2 text-right">{kra == null ? "—" : <ToneBadge tone={kraBand(kra)}>{Math.round(kra)}%</ToneBadge>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.completed_count}</td>
                      <td className="px-3 py-2 text-right">{manage && <Button size="sm" variant="secondary" onClick={() => ui.open.assignWork(p.username)}>Assign work</Button>}</td>
                    </tr>
                    {isOpenRow && (
                      <tr className="bg-background">
                        <td colSpan={10} className="px-3 py-3 pl-12">
                          {open.length === 0 ? (
                            <span className="text-xs text-muted">No active tasks — available for new work.</span>
                          ) : (
                            <ul className="divide-y divide-border">
                              {open.map((i) => (
                                <li key={i.id} className="flex flex-wrap items-center gap-3 py-1.5">
                                  <span className="min-w-48 flex-1"><b className="text-text">{chapterOf(i)}</b> <span className="text-xs text-muted">{i.project} · {i.stage_name}</span></span>
                                  <CustodyBadge status={i.custody_status} />
                                  <DueLabel info={dueInfo(i, ui.todayKey)} />
                                  {ui.canManage(i.stage_name) && isAssignable(i) ? (
                                    <AssigneePicker
                                      people={rankPeople(ui.peopleFor([i.stage_name]), ui.items)}
                                      current={i.assignee_name}
                                      nameOf={ui.nameOf}
                                      triggerLabel={`Change assignee for ${chapterOf(i)}, currently ${ui.nameOf(i.assignee_name)}`}
                                      disabled={ui.pending.has(i.id)}
                                      onChoose={(u) => ui.quickAssign(i, u)}
                                    />
                                  ) : (
                                    <LockedName name={ui.nameOf(i.assignee_name)} locked={!isAssignable(i)} />
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
