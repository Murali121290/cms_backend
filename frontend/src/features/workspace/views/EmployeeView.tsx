import { useMemo, useState } from "react";

import { cn } from "@/utils/cn";

import { Hero, StatCards } from "../components/Header";
import { EmptyBox } from "../components/Primitives";
import { TaskCard } from "../components/TaskCard";
import { TONE_CLASSES, type Tone } from "../constants";
import type { UserWorkspaceData } from "../types";
import { isLate, isOpen } from "../utils/dates";
import { byUrgency, pagesOf, uniqueSorted } from "../utils/items";

interface Props {
  data: UserWorkspaceData;
  viewerName: string;
  subtitle: string;
}

function Section({ title, tone, children, count }: { title: string; tone: Tone; count: number; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold text-text">
        <span className={cn("size-2.5 rounded-full", TONE_CLASSES[tone].dot)} aria-hidden="true" />
        {title}
        <span className="rounded-full bg-slate-200 px-2 text-[11px] text-muted tabular-nums dark:bg-slate-700">{count}</span>
      </h2>
      {children}
    </section>
  );
}

export function EmployeeView({ data, viewerName, subtitle }: Props) {
  const [stage, setStage] = useState("all");
  const stages = useMemo(() => uniqueSorted(data.assignments.map((a) => a.stage_name)), [data.assignments]);
  const mine = useMemo(() => data.assignments.filter((a) => stage === "all" || a.stage_name === stage), [data.assignments, stage]);

  const open = mine.filter(isOpen);
  const rework = open.filter((i) => i.custody_status === "in_progress" && i.rework_count > 0).sort(byUrgency);
  const wip = open.filter((i) => i.custody_status === "in_progress" && i.rework_count === 0).sort(byUrgency);
  const review = open.filter((i) => i.custody_status === "returned_for_review");
  const approved = open.filter((i) => i.custody_status === "qa_approved");
  const inbound = open.filter((i) => i.custody_status === "unassigned");
  const done = mine.filter((i) => !isOpen(i)).sort((a, b) => (b.actual_end_date ?? "").localeCompare(a.actual_end_date ?? "")).slice(0, 6);
  const grid = "grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5";
  const cards = (list: typeof mine, empty: string) =>
    list.length ? <div className={grid}>{list.map((i) => <TaskCard key={i.id} item={i} showStage={stages.length > 1} />)}</div> : <EmptyBox>{empty}</EmptyBox>;

  return (
    <>
      <Hero title={`Hi ${viewerName.split(" ")[0]}`} subtitle={subtitle} rate={data.stats.kra_meet_rate} delayed={open.filter(isLate).length} total={open.length} />
      <StatCards
        cards={[
          { key: "desk", value: wip.length + rework.length, label: "On my desk", hint: `${[...wip, ...rework].reduce((a, i) => a + pagesOf(i), 0)} pages`, tone: "accent" },
          { key: "rework", value: rework.length, label: "Needs rework", hint: "Sent back by your owner", tone: rework.length ? "warn" : undefined },
          { key: "review", value: review.length, label: "Waiting for review", hint: "Handed back", tone: "violet" },
          { key: "late", value: open.filter(isLate).length, label: "Delayed", hint: "Past due", tone: open.some(isLate) ? "bad" : undefined },
          { key: "today", value: data.stats.today_assigned, label: "Assigned today", hint: `${data.stats.yesterday_assigned} yesterday` },
          { key: "done", value: data.stats.completed_count, label: "Completed", hint: "Recent window" },
        ]}
      />
      {stages.length > 1 && (
        <div role="group" aria-label="Filter by stage" className="mb-4 flex flex-wrap gap-1.5">
          {["all", ...stages].map((s) => (
            <button key={s} type="button" aria-pressed={stage === s} onClick={() => setStage(s)} className={cn("rounded-full border px-3 py-1 text-[12.5px] font-medium", stage === s ? "border-text bg-text text-card" : "border-border bg-card text-muted")}>
              {s === "all" ? "All stages" : s}
            </button>
          ))}
        </div>
      )}
      {rework.length > 0 && <Section title="Needs rework" tone="warn" count={rework.length}>{cards(rework, "")}</Section>}
      <Section title="In progress" tone="accent" count={wip.length}>{cards(wip, "Nothing on your desk. New work appears here when your stage owner assigns it.")}</Section>
      {inbound.length > 0 && <Section title="Held for you (not started)" tone="warn" count={inbound.length}>{cards(inbound, "")}</Section>}
      <Section title="Waiting for owner review" tone="violet" count={review.length}>{cards(review, "Nothing waiting for review.")}</Section>
      <Section title="Approved" tone="ok" count={approved.length}>{cards(approved, "Nothing approved yet.")}</Section>
      <Section title="Completed recently" tone="muted" count={done.length}>{cards(done, "Nothing completed yet.")}</Section>
    </>
  );
}
