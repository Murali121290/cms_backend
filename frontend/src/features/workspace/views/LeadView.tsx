import { useMemo } from "react";

import { cn } from "@/utils/cn";

import { CompletedStrip } from "../components/CompletedStrip";
import { Hero, StageBanner, StatCards, Tabs } from "../components/Header";
import { kraBand } from "../components/KraRing";
import { PipelineBoard } from "../components/PipelineBoard";
import { ToneBadge } from "../components/Primitives";
import { QueueTable } from "../components/QueueTable";
import { ScheduleView } from "../components/ScheduleView";
import { StageOverview } from "../components/StageOverview";
import { stagePeople, TeamTable } from "../components/TeamTable";
import { BOARD_COLUMNS, CUSTODY, TONE_CLASSES, type StatusFilter, type WorkspaceTab } from "../constants";
import { useWorkspaceUi } from "../WorkspaceContext";
import type { WorkspaceDashboardResponse, WorkspaceItem, WorkspacePipeline, WorkspaceStageInfo } from "../types";
import { isLate, isOpen } from "../utils/dates";
import { baseMatch, EMPTY_FILTERS, type QueueFilters } from "../utils/items";

interface Props {
  data: WorkspaceDashboardResponse;
  pipeline: WorkspacePipeline;
  stage: WorkspaceStageInfo;
  tab: WorkspaceTab;
  filters: QueueFilters;
  viewerName: string;
  selected: ReadonlySet<number>;
  onTab: (t: WorkspaceTab) => void;
  onStage: (s: string) => void;
  onFilters: (patch: Partial<QueueFilters>) => void;
  onClearFilters: () => void;
  onJump: (status: StatusFilter, stage: string) => void;
  onSelected: (next: Set<number>) => void;
  onExport: (rows: WorkspaceItem[], filtered: boolean) => void;
}

export function LeadView(p: Props) {
  const ui = useWorkspaceUi();
  const { data, pipeline, stage } = p;
  const isManager = data.role === "manager";
  const legacy = isManager ? data.manager_workspace : data.teamlead_workspace;
  const stats = legacy?.stats;

  const stageItems = useMemo(() => pipeline.items.filter((i) => i.stage_name === stage.stage_name), [pipeline.items, stage.stage_name]);
  const open = pipeline.items.filter(isOpen);
  const stageOpen = stageItems.filter(isOpen);
  const stageDone = stageItems.filter((i) => !isOpen(i));
  const onTimeDone = stageDone.filter((i) => (i.completion_delay_days ?? 0) <= 0).length;
  const count = (s: string) => stageOpen.filter((i) => i.custody_status === s).length;
  const boardFilters: QueueFilters = { ...EMPTY_FILTERS, q: p.filters.q, priority: p.filters.priority };
  const boardItems = stageItems.filter((i) => baseMatch(i, boardFilters, ui.nameOf));
  const boardFiltered = Boolean(p.filters.q || p.filters.priority !== "all");
  const nextStage =
    stage.next_stage ?? stageOpen.find((i) => i.next_stage)?.next_stage ?? stageDone.find((i) => i.next_stage)?.next_stage ?? null;
  const stageNames = pipeline.stages.map((s) => s.stage_name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  const openCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of pipeline.items) if (isOpen(i)) m.set(i.stage_name, (m.get(i.stage_name) ?? 0) + 1);
    return m;
  }, [pipeline.items]);
  const people = pipeline.people.filter((x) => x.stage_names.includes(stage.stage_name)).map((x) => x.username);
  // The chapter list follows the banner stage unless "All stages" (or another stage) is picked.
  const queueFilters = useMemo(
    () => (p.filters.stage === "current" ? { ...p.filters, stage: stage.stage_name } : p.filters),
    [p.filters, stage.stage_name],
  );
  const queueStage = queueFilters.stage;
  const queueOpen = queueStage === "all" ? open.length : open.filter((i) => i.stage_name === queueStage).length;
  const teamCount = useMemo(() => stagePeople(pipeline.people, pipeline.items, stage.stage_name).length, [pipeline.people, pipeline.items, stage.stage_name]);
  const day = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const managed = pipeline.stages.filter((s) => s.can_manage).map((s) => s.stage_name);

  const tabs: { key: WorkspaceTab; label: string; count?: number }[] = [
    { key: "board", label: isManager ? `Pipeline · ${stage.stage_name}` : "Pipeline board" },
    { key: "queue", label: queueStage === "all" ? "All chapters" : `Chapters · ${queueStage}`, count: queueOpen },
    { key: "schedule", label: isManager ? `Schedule · ${stage.stage_name}` : "Schedule" },
    { key: "team", label: `Team · ${stage.stage_name}`, count: teamCount },
  ];

  return (
    <>
      <Hero
        title={isManager ? "Production overview" : `Good morning, ${p.viewerName.split(" ")[0]}`}
        subtitle={isManager
          ? `All stages · ${open.length} active chapters · ${open.filter((i) => i.custody_status === "returned_for_review").length} waiting for sign-off · ${open.filter((i) => i.custody_status === "qa_approved").length} ready to move`
          : `Stage owner · ${managed.join(", ") || "no managed stages"} · ${day}`}
        rate={stats?.kra_meet_rate ?? 100}
        delayed={open.filter(isLate).length}
        total={open.length}
      />

      {isManager && (
        <StageOverview
          stages={pipeline.stages}
          items={pipeline.items}
          workflows={pipeline.workflows ?? []}
          metrics={data.manager_workspace?.stages ?? []}
          current={stage.stage_name}
          onStage={p.onStage}
        />
      )}

      <StageBanner stages={pipeline.stages} stage={stage} onStage={p.onStage} nextStageHint={nextStage} counts={openCounts} />

      <StatCards
        cards={[
          { key: "in", value: count("unassigned"), label: "Inbound", hint: "Waiting to be assigned", tone: "warn", onClick: () => p.onJump("unassigned", stage.stage_name) },
          { key: "wip", value: count("in_progress"), label: "In progress", hint: (() => { const r = stageOpen.filter((i) => i.custody_status === "in_progress" && i.rework_count > 0).length; return r ? `${r} in rework` : "With your team"; })(), tone: "accent", onClick: () => p.onJump("in_progress", stage.stage_name) },
          { key: "rev", value: count("returned_for_review"), label: "Returned for review", hint: "Needs sign-off", tone: "violet", onClick: () => p.onJump("returned_for_review", stage.stage_name) },
          { key: "ready", value: count("qa_approved"), label: "Ready to move", hint: nextStage ? `Next: ${nextStage}` : undefined, tone: "ok", onClick: () => p.onJump("qa_approved", stage.stage_name) },
          { key: "late", value: stageOpen.filter(isLate).length, label: "Delayed", hint: "Past due date", tone: stageOpen.some(isLate) ? "bad" : undefined, onClick: () => p.onJump("delayed", stage.stage_name) },
          { key: "done", value: stageDone.length, label: "Completed", hint: `${stageDone.length ? Math.round((100 * onTimeDone) / stageDone.length) : 100}% on time · ${pipeline.completed_window_days}d`, onClick: () => p.onJump("done", stage.stage_name) },
        ]}
      />

      <Tabs tabs={tabs} current={p.tab} onChange={p.onTab} />

      <div id="workspace-tabpanel" role="tabpanel" aria-labelledby={`workspace-tab-${p.tab}`}>
        {p.tab === "board" && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                id="workspace-search"
                type="search"
                aria-label="Filter cards"
                value={p.filters.q}
                onChange={(e) => p.onFilters({ q: e.target.value })}
                placeholder="Filter cards by chapter, project or person"
                className="max-w-sm min-w-60 flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
              />
              <select aria-label="Priority" value={p.filters.priority} onChange={(e) => p.onFilters({ priority: e.target.value })} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm">
                <option value="all">Any priority</option>
                <option>Urgent</option><option>High</option><option>Normal</option>
              </select>
            </div>
            <PipelineBoard items={boardItems} filtered={boardFiltered} readOnly={!stage.can_manage} />
            <CompletedStrip stage={stage.stage_name} items={boardItems.filter((i) => !isOpen(i))} windowDays={pipeline.completed_window_days} />
          </>
        )}
        {p.tab === "queue" && (
          <QueueTable
            items={pipeline.items}
            stageOptions={stageNames}
            filters={queueFilters}
            currentStage={stage.stage_name}
            onFilters={(f) => p.onFilters(f.stage !== undefined && f.stage === stage.stage_name ? { ...f, stage: "current" } : f)}
            onClear={p.onClearFilters}
            selected={p.selected}
            onSelected={p.onSelected}
            onExport={p.onExport}
          />
        )}
        {p.tab === "schedule" && <ScheduleView stage={stage.stage_name} people={people} />}
        {p.tab === "team" && <TeamTable key={stage.stage_name} stage={stage.stage_name} people={pipeline.people} legacyMembers={legacy?.members ?? []} />}
      </div>
    </>
  );
}
