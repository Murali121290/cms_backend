import type { ReactNode } from "react";
import { AlertTriangle, Lock, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";

import { CUSTODY, TONE_CLASSES, WORKLOAD_CAPACITY, type Tone } from "../constants";
import type { CustodyStatus } from "../types";
import type { DueInfo } from "../utils/dates";

export function Avatar({ username, name, size = "sm" }: { username: string | null | undefined; name?: string; size?: "sm" | "lg" }) {
  const dims = size === "lg" ? "size-8 text-xs" : "size-6 text-[10.5px]";
  if (!username) {
    return (
      <span aria-hidden="true" className={cn("inline-grid place-items-center rounded-full bg-slate-200 text-slate-500 dark:bg-slate-700 font-bold shrink-0", dims)}>
        –
      </span>
    );
  }
  const label = (name || username).split(/[\s._-]+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  let h = 0;
  for (const c of username) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: `hsl(${h} 60% 88%)`, color: `hsl(${h} 50% 28%)` }}
      className={cn("inline-grid place-items-center rounded-full font-bold shrink-0", dims)}
    >
      {label}
    </span>
  );
}

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap", TONE_CLASSES[tone].badge, className)}>
      {children}
    </span>
  );
}

export function CustodyBadge({ status, short = true }: { status: CustodyStatus; short?: boolean }) {
  const m = CUSTODY[status];
  return <ToneBadge tone={m.tone}>{short ? m.short : m.label}</ToneBadge>;
}

export function PriorityBadge({ priority, showNormal = false }: { priority: string; showNormal?: boolean }) {
  if (priority === "Urgent") return <ToneBadge tone="bad">Urgent</ToneBadge>;
  if (priority === "High") return <ToneBadge tone="warn">High</ToneBadge>;
  return showNormal ? <span className="text-xs text-muted">Normal</span> : null;
}

export function DueLabel({ info }: { info: DueInfo }) {
  return (
    <span className={cn("text-xs tabular-nums", info.tone === "bad" && "font-semibold text-red-600 dark:text-red-400", info.tone === "warn" && "font-semibold text-amber-700 dark:text-amber-300", info.tone === "none" && "text-muted")}>
      {info.text}
    </span>
  );
}

export function LoadBar({ open, capacity = WORKLOAD_CAPACITY, className }: { open: number; capacity?: number; className?: string }) {
  const pct = Math.max(4, Math.min(100, Math.round((100 * open) / capacity)));
  const color = open >= capacity ? "bg-red-500" : open >= capacity - 1 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span role="img" aria-label={`${open} of ${capacity} slots used`} className={cn("block h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700", className)}>
      <span className={cn("block h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function LockedName({ name, locked }: { name: string; locked?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted" title={locked ? "Locked while in review / approved" : undefined}>
      {name}
      {locked && <Lock className="size-3" aria-label="locked" />}
    </span>
  );
}

export function EmptyBox({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted">{children}</div>;
}

export function StatePanel({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p className="mx-auto mt-1 mb-4 max-w-md text-sm text-muted">{body}</p>
      {action}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-border bg-card px-5 py-10 text-center">
      <AlertTriangle className="mx-auto mb-2 size-6 text-red-500" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-text">We couldn&apos;t load your workspace</h2>
      <p className="mx-auto mt-1 mb-4 max-w-md text-sm text-muted">{message} Nothing was changed.</p>
      <Button onClick={onRetry} leftIcon={<RefreshCw className="size-4" />}>Try again</Button>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none dark:bg-slate-700/50", className)} />;
}

export function WorkspaceSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading workspace" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-7 w-64" /><Skeleton className="h-4 w-80" /></div>
        <Skeleton className="h-20 w-52" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-72" />)}</div>
    </div>
  );
}

export const sectionCard = "rounded-2xl border border-border bg-card";
