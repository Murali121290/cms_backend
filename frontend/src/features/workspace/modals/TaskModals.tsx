import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/utils/cn";

import { workspaceApi } from "../api";
import { Avatar, CustodyBadge, LoadBar, Skeleton, ToneBadge } from "../components/Primitives";
import type { PickerPerson } from "../components/AssigneePicker";
import { HANDBACK_CHECKLIST, HANDBACK_MIN_NOTES, PRIORITIES, REWORK_MIN_NOTES, WORKLOAD_CAPACITY } from "../constants";
import type { AssignRequest, CustodyConflict, HandbackRequest, Priority, ReviewRequest, WorkspaceItem } from "../types";
import { dayKeyOf, dueInfo, fmtDateTime } from "../utils/dates";
import { chapterOf, pagesOf, type NameOf } from "../utils/items";

const field = "flex flex-col gap-1.5 text-[13px] font-semibold text-text";
const input = "rounded-lg border border-border bg-card px-2.5 py-2 text-sm font-normal";

// ── Assign / reassign one task ───────────────────────────────────────────────

interface AssignProps {
  item: WorkspaceItem;
  people: PickerPerson[];
  nameOf: NameOf;
  todayKey: string;
  onSubmit: (body: Omit<AssignRequest, "expected_custody_status">) => void;
  onClose: () => void;
}

export function AssignTaskModal({ item, people, nameOf, todayKey, onSubmit, onClose }: AssignProps) {
  const [who, setWho] = useState<string | null>(item.assignee_name);
  const [priority, setPriority] = useState<Priority>((PRIORITIES as string[]).includes(item.priority) ? (item.priority as Priority) : "Normal");
  const [due, setDue] = useState(dayKeyOf(item.planned_end_date) ?? "");
  const [notes, setNotes] = useState(item.assignment_notes ?? "");
  const [notify, setNotify] = useState(true);
  const originalDue = dayKeyOf(item.planned_end_date) ?? "";

  const submit = () => {
    if (!who) return;
    onSubmit({
      assignee: who,
      priority,
      planned_end_date: due && due !== originalDue ? `${due}T23:59:59` : undefined,
      notes: notes.trim() || null,
      notify,
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xl"
      title={`${item.assignee_name ? "Reassign" : "Assign"} “${chapterOf(item)}”`}
      description={`${item.stage_name} · ${item.project} · ${pagesOf(item)} pages`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted">You can undo from the confirmation message.</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!who}>{item.assignee_name ? "Save" : "Assign"}</Button>
        </div>
      }
    >
      <form id="ws-assign" onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-text">Assign to</legend>
          {people.length === 0 ? (
            <p className="text-sm text-muted">No team members are mapped to this stage.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {people.map((p, i) => (
                <label key={p.username} className={cn("relative flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-2.5 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary", who === p.username && "border-blue-500 bg-blue-50 dark:bg-blue-950/30")}>
                  <input type="radio" name="who" value={p.username} checked={who === p.username} onChange={() => setWho(p.username)} className="sr-only" />
                  <Avatar username={p.username} name={nameOf(p.username)} size="lg" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <b className="truncate text-[13px] text-text">{nameOf(p.username)}</b>
                    <small className="text-[11.5px] text-muted">{p.open} open · {p.pages} pages</small>
                    <LoadBar open={p.open} />
                  </span>
                  {i === 0 && <ToneBadge tone="ok" className="absolute -top-2 right-2">Lightest load</ToneBadge>}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-semibold text-text">Priority</legend>
            <div className="inline-flex overflow-hidden rounded-lg border border-border">
              {PRIORITIES.map((p) => (
                <label key={p} className={cn("cursor-pointer border-r border-border px-3 py-1.5 text-sm last:border-r-0 has-[:focus-visible]:outline-2", priority === p && "bg-text text-card")}>
                  <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="sr-only" />
                  {p}
                </label>
              ))}
            </div>
          </fieldset>
          <label className={field}>
            Due date
            <input type="date" value={due} min={todayKey} onChange={(e) => setDue(e.target.value)} className={input} />
          </label>
        </div>
        <label className={field}>
          <span>Instructions <span className="font-normal text-muted">— optional, shown on the person&apos;s task</span></span>
          <textarea rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Follow APA 7. Check equations in §3 carefully." className={input} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 accent-primary" /> Email the assignee with these details
        </label>
      </form>
    </Modal>
  );
}

// ── Person-first: assign inbound chapters to one employee ───────────────────

interface AssignWorkProps {
  username: string;
  nameOf: NameOf;
  stageNames: string[];
  inbound: WorkspaceItem[];
  load: { open: number; pages: number };
  todayKey: string;
  onSubmit: (ids: number[], notify: boolean) => void;
  onClose: () => void;
}

export function AssignWorkModal({ username, nameOf, stageNames, inbound, load, todayKey, onSubmit, onClose }: AssignWorkProps) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [notify, setNotify] = useState(true);
  const first = nameOf(username).split(" ")[0];
  const n = picked.size;
  const addPages = inbound.filter((i) => picked.has(i.id)).reduce((a, i) => a + pagesOf(i), 0);
  const after = load.open + n;
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={`Assign work to ${nameOf(username)}`}
      description={stageNames.join(", ")}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!n} onClick={() => onSubmit([...picked], notify)}>{n ? `Assign ${n} chapter${n > 1 ? "s" : ""}` : "Assign"}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className={cn("rounded-lg px-3 py-2 text-sm", after > WORKLOAD_CAPACITY ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200")} aria-live="polite">
          {first} has <b>{load.open}</b> open task{load.open === 1 ? "" : "s"} ({load.pages} pages)
          {n ? <> → <b>{after}</b> ({load.pages + addPages} pages) after this{after > WORKLOAD_CAPACITY ? ` — over the usual ${WORKLOAD_CAPACITY}` : ""}.</> : ". Tick chapters to see the new load."}
        </div>
        {inbound.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-sm text-muted">
            No chapters are waiting in Inbound. To move work from someone else, use the assignee picker in the Queue or Team tab.
          </p>
        ) : (
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-semibold text-text">Inbound chapters waiting</legend>
            <div className="flex max-h-72 flex-col gap-1.5 overflow-auto">
              {inbound.map((i) => {
                const d = dueInfo(i, todayKey);
                return (
                  <label key={i.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-2.5 py-2", picked.has(i.id) && "border-blue-500 bg-blue-50 dark:bg-blue-950/30")}>
                    <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} className="size-4 accent-primary" />
                    <span className="flex-1">
                      <b className="text-sm text-text">{chapterOf(i)}</b>
                      <span className="block text-xs text-muted">{i.project} · {i.stage_name} · {pagesOf(i)} pp · <span className={d.tone === "bad" ? "text-red-600" : undefined}>{d.text}</span></span>
                    </span>
                    {i.priority !== "Normal" && <ToneBadge tone={i.priority === "Urgent" ? "bad" : "warn"}>{i.priority}</ToneBadge>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 accent-primary" /> Email {first} the list
        </label>
      </div>
    </Modal>
  );
}

// ── Employee hand-back ───────────────────────────────────────────────────────

export function HandbackModal({ item, ownerName, onSubmit, onClose }: { item: WorkspaceItem; ownerName: string; onSubmit: (b: Omit<HandbackRequest, "expected_custody_status">) => void; onClose: () => void }) {
  const [checks, setChecks] = useState<boolean[]>(HANDBACK_CHECKLIST.map(() => false));
  const [notes, setNotes] = useState("");
  const len = notes.trim().length;
  const valid = checks.every(Boolean) && len >= HANDBACK_MIN_NOTES;
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={`Hand back “${chapterOf(item)}”`}
      description={`${item.stage_name} · back to ${ownerName} for review`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => onSubmit({ notes: notes.trim(), checklist_confirmed: true })}>Hand back for review</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        {item.rework_count > 0 && item.rework_notes && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><b>Rework requested:</b> {item.rework_notes}</p>
        )}
        <fieldset className="flex flex-col gap-2 rounded-xl bg-background p-3">
          <legend className="mb-1 text-[13px] font-semibold text-text">Before you hand back</legend>
          {HANDBACK_CHECKLIST.map((label, i) => (
            <label key={label} className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} className="mt-0.5 size-4 accent-primary" />
              {label}
            </label>
          ))}
        </fieldset>
        <label className={field}>
          Notes for {ownerName.split(" ")[0]}
          <textarea rows={4} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="What you did, open queries, anything the reviewer should check." className={input} />
          <span className={cn("self-end text-[11.5px] font-normal", len > 0 && len < HANDBACK_MIN_NOTES ? "text-red-600" : "text-muted")} aria-live="polite">
            {len} / at least {HANDBACK_MIN_NOTES} characters
          </span>
        </label>
      </div>
    </Modal>
  );
}

// ── Stage-owner QA review ────────────────────────────────────────────────────

export function ReviewModal({ item, preset, nameOf, onSubmit, onClose }: { item: WorkspaceItem; preset?: "approve" | "rework"; nameOf: NameOf; onSubmit: (b: Omit<ReviewRequest, "expected_custody_status">) => void; onClose: () => void }) {
  const [decision, setDecision] = useState<"approve" | "rework">(preset ?? "approve");
  const [notes, setNotes] = useState("");
  const rework = decision === "rework";
  const valid = !rework || notes.trim().length >= REWORK_MIN_NOTES;
  const who = nameOf(item.assignee_name);
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={`Review “${chapterOf(item)}”`}
      description={`${item.stage_name} · QA sign-off`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => onSubmit({ decision, notes: notes.trim() || null })}>{rework ? "Send back for rework" : "Approve"}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <blockquote className="rounded-lg border-l-[3px] border-l-violet-500 bg-violet-50 px-3 py-2.5 text-sm dark:bg-violet-950/30">
          {item.handback_notes || "No notes provided."}
          <small className="mt-1 block text-muted">{who} · handed back {fmtDateTime(item.handback_at)}{item.rework_count ? ` · reworked ${item.rework_count}×` : ""}</small>
        </blockquote>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-text">Decision</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["approve", "rework"] as const).map((d) => (
              <label key={d} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-xl border border-border px-3 py-2.5 has-[:focus-visible]:outline-2", decision === d && (d === "approve" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-amber-500 bg-amber-50 dark:bg-amber-950/30"))}>
                <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="sr-only" />
                <b className="text-sm text-text">{d === "approve" ? "Approve" : "Send back for rework"}</b>
                <small className="text-xs text-muted">{d === "approve" ? "Moves to “Ready to move”" : `Returns to ${who.split(" ")[0]} with your notes`}</small>
              </label>
            ))}
          </div>
        </fieldset>
        <label className={field}>
          <span>{rework ? "What needs fixing?" : "Notes"} <span className="font-normal text-muted">({rework ? "required" : "optional"})</span></span>
          <textarea rows={3} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder={`Feedback for ${who.split(" ")[0]}`} className={input} />
        </label>
      </div>
    </Modal>
  );
}

// ── Move to next stage (with hand-off email preview) ────────────────────────

export function MoveNextModal({ item, onConfirm, onClose }: { item: WorkspaceItem; onConfirm: () => void; onClose: () => void }) {
  const preview = useQuery({ queryKey: ["workspace-move-preview", item.id], queryFn: () => workspaceApi.moveNextPreview(item.id), staleTime: 0 });
  const p = preview.data;
  const final = p ? !p.next_stage : !item.next_stage;
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xl"
      title={final ? `Complete “${chapterOf(item)}”?` : `Move “${chapterOf(item)}” to ${p?.next_stage ?? item.next_stage ?? "the next stage"}`}
      description="Stage hand-off"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {!final && <span className="mr-auto text-xs text-muted">This sends an email and can&apos;t be undone.</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onConfirm} disabled={preview.isLoading}>{final ? "Mark complete" : "Move and notify"}</Button>
        </div>
      }
    >
      {preview.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-20" /></div>
      ) : preview.isError || !p ? (
        <p role="alert" className="text-sm text-red-600">{getApiErrorMessage(preview.error, "The hand-off preview could not be loaded.")} You can still move the chapter.</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-1 items-center gap-2.5 sm:grid-cols-[1fr_auto_1fr]">
            <div className="rounded-xl border border-border bg-background px-3 py-2.5">
              <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">From</p>
              <b className="text-text">{p.from_stage}</b>
              <div className="text-xs text-muted">QA approved</div>
            </div>
            <ArrowRight className="mx-auto size-5 text-blue-500 max-sm:rotate-90" aria-hidden="true" />
            <div className="rounded-xl border border-blue-500 bg-blue-50 px-3 py-2.5 dark:bg-blue-950/30">
              <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">To</p>
              <b className="text-text">{p.next_stage ?? "Complete"}</b>
              <div className="text-xs text-muted">{p.next_stage ? `Lands in Inbound · owner ${p.next_owner_name ?? "not set"}` : "Final stage of the workflow"}</div>
            </div>
          </div>
          {p.late_days > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              This stage finished <b>{p.late_days} day{p.late_days > 1 ? "s" : ""} late</b>. Later due dates for this chapter will shift by {p.late_days} day{p.late_days > 1 ? "s" : ""}.
            </p>
          )}
          <div>
            <span className="mb-1.5 block text-[13px] font-semibold text-text">Hand-off email</span>
            {(["to", "cc"] as const).map((k) => (
              <div key={k} className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="w-7 text-xs font-bold text-muted uppercase">{k}</span>
                {p[k].length ? p[k].map((r) => (
                  <span key={r.email} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pr-2.5 pl-0.5 text-xs">
                    <Avatar username={r.username ?? r.email} name={r.name ?? undefined} />{r.name ? `${r.name} · ` : ""}{r.email}
                  </span>
                )) : <span className="text-xs text-muted">Nobody resolved</span>}
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"><b className="text-text">{p.subject}</b></div>
        </div>
      )}
    </Modal>
  );
}

// ── Conflict (409) ───────────────────────────────────────────────────────────

export function ConflictModal({ seen, conflict, nameOf, onRefresh, onClose }: { seen: WorkspaceItem; conflict: CustodyConflict; nameOf: NameOf; onRefresh: () => void; onClose: () => void }) {
  const now = conflict.current;
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="This task changed while you were looking at it"
      description="409 · Conflict"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={onRefresh}>Refresh to see latest</Button>
        </div>
      }
    >
      <p className="mb-3 text-sm"><b>{chapterOf(seen)}</b> was updated by someone else, so <b>your change was not saved</b>. Nothing was overwritten.</p>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-border px-3 py-2.5">
          <p className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">You saw</p>
          <CustodyBadge status={seen.custody_status} />
          <div className="mt-1.5 text-xs text-muted">{nameOf(seen.assignee_name)}</div>
        </div>
        <div className="rounded-xl border border-border px-3 py-2.5">
          <p className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Now</p>
          {now ? (<><CustodyBadge status={now.custody_status} /><div className="mt-1.5 text-xs text-muted">{nameOf(now.assignee_name)}</div></>) : <span className="text-xs text-muted">Refresh to see</span>}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{conflict.message}</p>
    </Modal>
  );
}

// ── Shortcuts help ───────────────────────────────────────────────────────────

export function ShortcutsModal({ onClose, showTabs }: { onClose: () => void; showTabs: boolean }) {
  const rows: [string[], string][] = [
    [["/"], "Search"],
    ...(showTabs ? ([[["1", "2", "3", "4"], "Board · Queue · Schedule · Team"]] as [string[], string][]) : []),
    [["R"], "Refresh"],
    [["Esc"], "Close / clear selection"],
    [["?"], "This help"],
  ];
  return (
    <Modal isOpen onClose={onClose} size="sm" title="Keyboard shortcuts" footer={<div className="flex w-full justify-end"><Button onClick={onClose}>Close</Button></div>}>
      <ul className="flex flex-col gap-1.5">
        {rows.map(([keys, label]) => (
          <li key={label} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm">
            <span className="flex gap-1">{keys.map((k) => <kbd key={k} className="rounded border border-b-2 border-border bg-background px-1.5 font-mono text-[11px] text-muted">{k}</kbd>)}</span>
            <span className="text-muted">{label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">In the assignee picker: type to filter, ↑ ↓ to move, Enter to choose.</p>
    </Modal>
  );
}
