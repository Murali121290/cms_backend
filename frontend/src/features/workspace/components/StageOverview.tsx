import { useMemo, useState } from "react";

import { cn } from "@/utils/cn";

import { BOARD_COLUMNS, CUSTODY, TONE_CLASSES } from "../constants";
import type { StageMetric, WorkspaceItem, WorkspaceStageInfo, WorkspaceWorkflow } from "../types";
import { isLate, isOpen } from "../utils/dates";
import { kraBand } from "./KraRing";
import { ToneBadge } from "./Primitives";

const STORE_KEY = "workspace.overview";

interface Prefs {
  process: string; // "all" or a workflow name
  scope: "all" | "active";
}

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Prefs>;
      return { process: typeof v.process === "string" ? v.process : "all", scope: v.scope === "active" ? "active" : "all" };
    }
  } catch {
    /* storage unavailable: use defaults */
  }
  return { process: "all", scope: "all" };
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

interface Props {
  stages: WorkspaceStageInfo[];
  items: WorkspaceItem[];
  workflows: WorkspaceWorkflow[];
  metrics: StageMetric[];
  current: string;
  onStage: (stage: string) => void;
}

/**
 * Overview of every stage the viewer oversees (all stages for admins/managers), optionally narrowed to
 * one process (workflow) and shown in flow order.
 */
export function StageOverview({ stages, items, workflows, metrics, current, onStage }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const update = (patch: Partial<Prefs>) => setPrefs((prev) => {
    const next = { ...prev, ...patch };
    savePrefs(next);
    return next;
  });

  const openByStage = useMemo(() => {
    const m = new Map<string, WorkspaceItem[]>();
    for (const i of items) {
      if (!isOpen(i)) continue;
      const list = m.get(i.stage_name);
      if (list) list.push(i);
      else m.set(i.stage_name, [i]);
    }
    return m;
  }, [items]);

  const workflow = workflows.find((w) => w.workflow_name === prefs.process);
  const byName = new Map(stages.map((s) => [s.stage_name, s]));
  const ordered: WorkspaceStageInfo[] = workflow
    ? workflow.stages.map((n) => byName.get(n)).filter((s): s is WorkspaceStageInfo => Boolean(s))
    : [...stages].sort((a, b) => a.stage_name.localeCompare(b.stage_name, undefined, { sensitivity: "base", numeric: true }));
  const withWork = ordered.filter((s) => (openByStage.get(s.stage_name)?.length ?? 0) > 0).length;
  const shown = prefs.scope === "active" ? ordered.filter((s) => (openByStage.get(s.stage_name)?.length ?? 0) > 0) : ordered;

  return (
    <section aria-label="Stage overview" className="mb-4">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-text">
          Process
          <select
            value={workflow ? prefs.process : "all"}
            onChange={(e) => update({ process: e.target.value })}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm font-normal"
          >
            <option value="all">All processes ({stages.length} stages)</option>
            {workflows.map((w) => (
              <option key={w.workflow_name} value={w.workflow_name}>{w.workflow_name} ({w.stages.length} stages)</option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Which stages to show" className="inline-flex rounded-lg border border-border bg-slate-100 p-0.5 dark:bg-slate-800">
          {([["all", `All stages (${ordered.length})`], ["active", `With work (${withWork})`]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={prefs.scope === k}
              onClick={() => update({ scope: k })}
              className={cn("rounded-md px-3 py-1 text-xs font-semibold", prefs.scope === k ? "bg-card text-text shadow-sm" : "text-muted")}
            >
              {label}
            </button>
          ))}
        </div>
        {workflow && <span className="text-xs text-muted">Shown in process order · click a stage to open its board</span>}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No open work in {workflow ? workflow.workflow_name : "any stage"}. Switch to “All stages” to see every stage.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
          {shown.map((s, idx) => {
            const its = openByStage.get(s.stage_name) ?? [];
            const metric = metrics.find((m) => m.stage_name === s.stage_name);
            const late = its.filter(isLate).length;
            const total = Math.max(1, its.length);
            const step = workflow ? workflow.stages.indexOf(s.stage_name) + 1 : idx + 1;
            return (
              <button
                key={s.stage_name}
                type="button"
                aria-current={s.stage_name === current}
                onClick={() => onStage(s.stage_name)}
                className={cn(
                  "rounded-xl border bg-card px-3.5 py-3 text-left",
                  s.stage_name === current ? "border-primary ring-1 ring-primary" : "border-border hover:border-slate-400",
                  its.length === 0 && "opacity-70",
                )}
              >
                <h3 className="flex items-start justify-between gap-2 text-sm font-semibold text-text">
                  <span>
                    {workflow && <span className="mr-1 text-xs font-semibold text-muted">{step}.</span>}
                    {s.stage_name}
                  </span>
                  {metric ? (
                    <ToneBadge tone={kraBand(metric.kra_meet_rate)}>{Math.round(metric.kra_meet_rate)}% on time</ToneBadge>
                  ) : (
                    <span className="text-xs font-normal text-muted">{its.length ? "" : "idle"}</span>
                  )}
                </h3>
                <div className="my-2.5 flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
                  {BOARD_COLUMNS.map((c) => (
                    <i key={c} className={TONE_CLASSES[CUSTODY[c].tone].bar} style={{ width: `${(100 * its.filter((i) => i.custody_status === c).length) / total}%` }} />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-muted">
                  <span>
                    {its.length} active · {its.filter((i) => i.custody_status === "unassigned").length} inbound ·{" "}
                    {its.filter((i) => i.custody_status === "returned_for_review").length} in review
                  </span>
                  <span className={late ? "font-semibold text-red-600" : undefined}>{late} late</span>
                </div>
                <div className="mt-1 truncate text-xs text-muted">Owner: {s.owner_name ?? s.owner_username ?? "Not set"}</div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
