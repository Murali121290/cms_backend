import type { ReactNode } from "react";
import { Copy, HelpCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/utils/cn";

import { TONE_CLASSES, type Tone, type WorkspaceTab } from "../constants";
import type { WorkspaceStageInfo } from "../types";
import { agoText } from "../utils/dates";
import { KraRing, KRA_LABEL, kraBand } from "./KraRing";
import { Avatar } from "./Primitives";
import { StagePicker } from "./StagePicker";

export function Hero({ title, subtitle, rate, delayed, total }: { title: string; subtitle: string; rate: number; delayed: number; total: number }) {
  return (
    <section className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card py-2.5 pr-4 pl-2.5">
        <KraRing rate={rate} />
        <div className="text-left">
          <small className="block text-xs text-muted">On-time rate (KRA)</small>
          <b className="text-[15px] text-text">{KRA_LABEL[kraBand(rate)]}</b>
          <small className="block text-xs text-muted">{delayed} delayed of {total} active</small>
        </div>
      </div>
    </section>
  );
}

export function Freshness({ updatedAt, nowMs, fetching, onRefresh, onHelp }: { updatedAt: number; nowMs: number; fetching: boolean; onRefresh: () => void; onHelp: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        <span className={cn("size-1.5 rounded-full", fetching ? "animate-pulse bg-blue-500 motion-reduce:animate-none" : "bg-emerald-500")} aria-hidden="true" />
        {fetching ? "Refreshing…" : `Updated ${agoText(updatedAt, nowMs)}`}
      </span>
      <button type="button" onClick={onRefresh} aria-label="Refresh now" title="Refresh (R)" className="grid size-8 place-items-center rounded-lg border border-border bg-card text-muted hover:text-text">
        <RefreshCw className={cn("size-4", fetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      </button>
      <button type="button" onClick={onHelp} aria-label="Keyboard shortcuts" title="Shortcuts (?)" className="grid size-8 place-items-center rounded-lg border border-border bg-card text-muted hover:text-text">
        <HelpCircle className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function StageBanner({ stages, stage, onStage, nextStageHint, counts }: { stages: WorkspaceStageInfo[]; stage: WorkspaceStageInfo; onStage: (s: string) => void; nextStageHint: string | null; counts?: ReadonlyMap<string, number> }) {
  const copy = async () => {
    if (!stage.group_email) return;
    try {
      await navigator.clipboard.writeText(stage.group_email);
      toast.success("Team email copied.");
    } catch {
      toast.error("Copy failed — select the text instead.");
    }
  };
  const eyebrow = "text-[11px] font-semibold tracking-wider text-muted uppercase";
  return (
    <section aria-label="Stage details" className="mb-3.5 flex flex-wrap items-center gap-x-7 gap-y-3 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <label htmlFor="workspace-stage" className={eyebrow}>Stage</label>
        {stages.length > 1 ? (
          <StagePicker id="workspace-stage" stages={stages} value={stage.stage_name} onChange={onStage} counts={counts} />
        ) : (
          <b className="text-text">{stage.stage_name}</b>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className={eyebrow}>Stage owner</span>
        {stage.owner_per_project ? (
          <span className="text-sm text-text" title="Each chapter's owner is its project's PM (Project → PM).">
            Project&apos;s PM <span className="text-muted">(per project)</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm text-text">
            <Avatar username={stage.owner_username} name={stage.owner_name ?? undefined} />
            {stage.owner_name ?? stage.owner_username ?? "Not set"}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className={eyebrow}>Team email</span>
        {stage.group_email ? (
          <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 text-sm font-medium text-primary" title="Copy">
            {stage.group_email} <Copy className="size-3.5" aria-hidden="true" />
          </button>
        ) : (
          <span className="text-sm text-muted">Not set</span>
        )}
      </div>
      {nextStageHint && (
        <div className="flex flex-col gap-0.5">
          <span className={eyebrow}>Hands off to</span>
          <b className="text-sm text-text">{nextStageHint}</b>
        </div>
      )}
      {stage.sla_days != null && (
        <div className="flex flex-col gap-0.5">
          <span className={eyebrow}>SLA</span>
          <b className="text-sm text-text">{stage.sla_days} working days</b>
        </div>
      )}
      {!stage.can_manage && <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-muted dark:bg-slate-800">View only</span>}
    </section>
  );
}

export interface StatCardSpec {
  key: string;
  value: number;
  label: string;
  hint?: string;
  tone?: Tone;
  onClick?: () => void;
}

export function StatCards({ cards }: { cards: StatCardSpec[] }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => {
        const inner: ReactNode = (
          <>
            <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[3px]", c.tone ? TONE_CLASSES[c.tone].dot : "bg-border")} />
            <div className="text-2xl font-bold tracking-tight text-text tabular-nums">{c.value}</div>
            <div className="text-[12.5px] text-muted">{c.label}</div>
            {c.hint && <div className="mt-0.5 text-[11.5px] text-muted/80">{c.hint}</div>}
          </>
        );
        return c.onClick ? (
          <button key={c.key} type="button" onClick={c.onClick} className="relative overflow-hidden rounded-xl border border-border bg-card px-3.5 py-3 text-left hover:border-slate-400">
            {inner}
          </button>
        ) : (
          <div key={c.key} className="relative overflow-hidden rounded-xl border border-border bg-card px-3.5 py-3">{inner}</div>
        );
      })}
    </div>
  );
}

export function Tabs({ tabs, current, onChange }: { tabs: { key: WorkspaceTab; label: string; count?: number }[]; current: WorkspaceTab; onChange: (t: WorkspaceTab) => void }) {
  return (
    <div role="tablist" aria-label="Workspace sections" className="mb-3.5 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          id={`workspace-tab-${t.key}`}
          role="tab"
          type="button"
          aria-selected={current === t.key}
          aria-controls="workspace-tabpanel"
          title={`Shortcut: ${i + 1}`}
          onClick={() => onChange(t.key)}
          className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap", current === t.key ? "border-primary text-text" : "border-transparent text-muted hover:text-text")}
        >
          {t.label}
          {t.count != null && <span className="rounded-full bg-slate-200 px-1.5 text-[11px] text-muted tabular-nums dark:bg-slate-700">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
