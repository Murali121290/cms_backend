import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/utils/cn";

import { CustodyBadge } from "../components/Primitives";
import { WORKLOAD_CAPACITY } from "../constants";
import type { BulkAction, BulkResultItem, WorkspaceItem } from "../types";
import { chapterOf, isAssignable, type NameOf } from "../utils/items";

export function bulkEligible(action: BulkAction, item: WorkspaceItem): boolean {
  if (action === "assign") return isAssignable(item);
  if (action === "approve") return item.custody_status === "returned_for_review";
  return item.custody_status === "qa_approved";
}

interface ConfirmProps {
  action: BulkAction;
  items: WorkspaceItem[];
  assignee: string | null;
  assigneeLoad?: { open: number };
  nameOf: NameOf;
  onConfirm: () => void;
  onClose: () => void;
}

export function BulkConfirmModal({ action, items, assignee, assigneeLoad, nameOf, onConfirm, onClose }: ConfirmProps) {
  const go = items.filter((i) => bulkEligible(action, i));
  const skip = items.filter((i) => !bulkEligible(action, i));
  const n = go.length;
  const s = n === 1 ? "" : "s";
  const title =
    action === "assign"
      ? assignee ? `Assign ${n} chapter${s} to ${nameOf(assignee)}` : `Unassign ${n} chapter${s}`
      : action === "approve" ? `Approve ${n} chapter${s}` : `Move ${n} chapter${s} to the next stage`;
  const after = assigneeLoad ? assigneeLoad.open + n : 0;
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={title}
      description="Bulk action · please confirm"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={action === "assign" && !assignee ? "danger" : "primary"} disabled={!n} onClick={onConfirm}>Confirm</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {action === "assign" && assignee && assigneeLoad && (
          <p className={cn("rounded-lg px-3 py-2 text-sm", after > WORKLOAD_CAPACITY ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200")}>
            {nameOf(assignee).split(" ")[0]} has {assigneeLoad.open} open task{assigneeLoad.open === 1 ? "" : "s"}. After this: <b>{after}</b>{after > WORKLOAD_CAPACITY ? ` — over the usual ${WORKLOAD_CAPACITY}.` : "."}
          </p>
        )}
        {action === "assign" && !assignee && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">These chapters will go back to Inbound and their current assignees lose them.</p>
        )}
        {action === "move_next" && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">One hand-off email is sent per chapter to the next stage owner and team list.</p>
        )}
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto">
          {go.map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
              <span className="text-emerald-600" aria-hidden="true">✓</span>
              <span className="flex-1"><b className="text-text">{chapterOf(i)}</b> <span className="text-xs text-muted">{i.project} · {nameOf(i.assignee_name)}</span></span>
              <CustodyBadge status={i.custody_status} />
            </li>
          ))}
        </ul>
        {skip.length > 0 && (
          <p className="text-xs text-muted">
            {skip.length} selected item{skip.length > 1 ? "s" : ""} will be skipped because {skip.length > 1 ? "they are" : "it is"} not in the right status: {skip.map((i) => chapterOf(i)).join(", ")}.
          </p>
        )}
      </div>
    </Modal>
  );
}

const ICON: Record<BulkResultItem["status"], { mark: string; cls: string }> = {
  ok: { mark: "✓", cls: "text-emerald-600" },
  skipped: { mark: "–", cls: "text-muted" },
  conflict: { mark: "✕", cls: "text-red-600" },
  forbidden: { mark: "✕", cls: "text-red-600" },
  error: { mark: "✕", cls: "text-red-600" },
};

export function BulkResultsModal({ results, byId, onRefresh, onClose }: { results: BulkResultItem[]; byId: Map<number, WorkspaceItem>; onRefresh: () => void; onClose: () => void }) {
  const count = (s: BulkResultItem["status"][]) => results.filter((r) => s.includes(r.status)).length;
  const failed = count(["conflict", "forbidden", "error"]);
  const skipped = count(["skipped"]);
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={`${count(["ok"])} done${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped` : ""}`}
      description="Bulk action finished"
      footer={
        <div className="flex w-full justify-end gap-2">
          {failed > 0 && <Button variant="secondary" onClick={onRefresh}>Refresh</Button>}
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <ul className="flex max-h-80 flex-col gap-1.5 overflow-auto">
        {results.map((r) => {
          const it = r.item ?? byId.get(r.task_id);
          return (
            <li key={r.task_id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
              <span className={ICON[r.status].cls} aria-hidden="true">{ICON[r.status].mark}</span>
              <span className="flex-1"><b className="text-text">{it ? chapterOf(it) : `Task ${r.task_id}`}</b> <span className="text-xs text-muted">{it?.project}</span></span>
              <span className="text-xs text-muted">{r.status === "ok" ? "Done" : r.message ?? r.status}</span>
            </li>
          );
        })}
      </ul>
      {failed > 0 && <p className="mt-3 text-xs text-muted">Failed items were changed by someone else or are not yours to change. Refresh and try them again.</p>}
    </Modal>
  );
}
