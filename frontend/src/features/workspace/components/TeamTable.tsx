import { Fragment, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";

import { WORKLOAD_CAPACITY } from "../constants";
import { useWorkspaceUi } from "../WorkspaceContext";
import type { TeamMemberWorkspaceData, WorkspaceItem, WorkspacePerson } from "../types";
import { dueInfo, isOpen } from "../utils/dates";
import { chapterOf, byUrgency, isAssignable, pagesOf } from "../utils/items";
import { AssigneePicker, rankPeople } from "./AssigneePicker";
import { Avatar, CustodyBadge, DueLabel, LoadBar, LockedName, StatePanel, ToneBadge } from "./Primitives";
import { kraBand } from "./KraRing";

interface Props {
  people: WorkspacePerson[];
  legacyMembers: TeamMemberWorkspaceData[];
  /** The stage selected in the banner: the table lists the people involved in it. */
  stage: string;
}

const isAdminRole = (role: string | null) => (role ?? "").replace(/\s+/g, "").toLowerCase() === "admin";

/**
 * People involved in a stage: their role is mapped to it in Stage Management, or they hold work in it.
 * Admin-role accounts can be assigned anywhere, so they only show where they actually hold work.
 */
export function stagePeople(people: WorkspacePerson[], items: WorkspaceItem[], stage: string): WorkspacePerson[] {
  const holders = new Set(items.filter((i) => i.stage_name === stage && i.assignee_name).map((i) => i.assignee_name as string));
  return people.filter((p) => holders.has(p.username) || (p.stage_names.includes(stage) && !isAdminRole(p.role)));
}

export function TeamTable({ people, legacyMembers, stage }: Props) {
  const ui = useWorkspaceUi();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"stage" | "all">("stage");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const statsBy = useMemo(() => new Map(legacyMembers.map((m) => [m.username, m.stats])), [legacyMembers]);
  const inStage = useMemo(() => stagePeople(people, ui.items, stage), [people, ui.items, stage]);
  // Figures follow the scope: this stage's chapters only, or everything.
  const scopedItems = useMemo(() => (scope === "stage" ? ui.items.filter((i) => i.stage_name === stage) : ui.items), [scope, ui.items, stage]);

  const shown = (scope === "stage" ? inStage : people).filter((p) => {
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
        <div role="group" aria-label="Which people" className="inline-flex rounded-lg border border-border bg-slate-100 p-0.5 dark:bg-slate-800">
          {([["stage", `${stage} (${inStage.length})`], ["all", `All people (${people.length})`]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={scope === k}
              onClick={() => setScope(k)}
              className={cn("rounded-md px-3 py-1 text-xs font-semibold", scope === k ? "bg-card text-text shadow-sm" : "text-muted")}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">Load bar turns amber at {WORKLOAD_CAPACITY - 1} and red at {WORKLOAD_CAPACITY} open tasks</span>
      </div>
      {shown.length === 0 ? (
        <StatePanel
          title={q ? "No one matches" : `No one is set up for ${stage}`}
          body={q ? "Clear the search to see the whole team." : `Map roles to ${stage} in Stage Management, or switch to All people.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-background text-left text-[11px] tracking-wide text-muted uppercase">
              <tr>
                <th className="w-10 px-3 py-2"><span className="sr-only">Expand</span></th>
                <th className="px-3 py-2">Person</th>{scope === "all" && <th className="px-3 py-2">Stage</th>}<th className="px-3 py-2">Load</th>
                <th className="px-3 py-2 text-right">Pages</th><th className="px-3 py-2 text-right">In review</th>
                <th className="px-3 py-2 text-right">Rework</th><th className="px-3 py-2 text-right">On time</th>
                <th className="px-3 py-2 text-right">Completed</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const mine = scopedItems.filter((i) => i.assignee_name === p.username);
                const open = mine.filter(isOpen).sort(byUrgency);
                const working = open.filter((i) => i.custody_status === "in_progress" || i.custody_status === "returned_for_review");
                const done = mine.filter((i) => !isOpen(i));
                const isOpenRow = expanded.has(p.username);
                const manage = scope === "stage" ? ui.canManage(stage) : p.stage_names.some((s) => ui.canManage(s));
                // On time: this stage's completed chapters when scoped; the overall KRA otherwise.
                const kra = scope === "stage"
                  ? (done.length ? (100 * done.filter((i) => (i.completion_delay_days ?? 0) <= 0).length) / done.length : null)
                  : statsBy.get(p.username)?.kra_meet_rate;
                const load = scope === "stage" ? working.length : p.open_count;
                const pages = scope === "stage" ? working.reduce((a, i) => a + pagesOf(i), 0) : p.open_pages;
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
                      {scope === "all" && <td className="px-3 py-2 text-muted">{isAdminRole(p.role) ? "All stages (Admin)" : p.stage_names.join(", ") || "—"}</td>}
                      <td className="px-3 py-2"><span className="flex min-w-28 items-center gap-2"><LoadBar open={load} /><span className="text-xs text-muted">{load}/{WORKLOAD_CAPACITY}</span></span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{pages}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{open.filter((i) => i.custody_status === "returned_for_review").length}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{mine.filter((i) => i.rework_count > 0).length}</td>
                      <td className="px-3 py-2 text-right">{kra == null ? "—" : <ToneBadge tone={kraBand(kra)}>{Math.round(kra)}%</ToneBadge>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{scope === "stage" ? done.length : p.completed_count}</td>
                      <td className="px-3 py-2 text-right">{manage && <Button size="sm" variant="secondary" onClick={() => ui.open.assignWork(p.username)}>Assign work</Button>}</td>
                    </tr>
                    {isOpenRow && (
                      <tr className="bg-background">
                        <td colSpan={scope === "all" ? 10 : 9} className="px-3 py-3 pl-12">
                          {open.length === 0 ? (
                            <span className="text-xs text-muted">No active tasks — available for new work.</span>
                          ) : (
                            <ul className="divide-y divide-border">
                              {open.map((i) => (
                                <li key={i.id} className="flex flex-wrap items-center gap-3 py-1.5">
                                  <span className="min-w-48 flex-1"><b className="text-text">{chapterOf(i)}</b> <span className="text-xs text-muted">{i.project} · {i.stage_name}</span></span>
                                  <CustodyBadge status={i.custody_status} />
                                  <DueLabel info={dueInfo(i, ui.todayKey)} />
                                  {ui.canManage(i.stage_name, i) && isAssignable(i) ? (
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
