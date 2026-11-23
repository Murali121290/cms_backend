import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock } from "lucide-react";

import { getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { toast } from "@/store/useToastStore";
import { useUsersStore } from "@/stores/usersStore";
import { cn } from "@/utils/cn";
import { getUserDisplayName } from "@/utils/userUtils";

import { workspaceApi } from "../api";
import { DASHBOARD_QUERY_KEY, SCHEDULE_QUERY_KEY } from "../constants";
import { ActivityDrawer } from "../modals/ActivityDrawer";
import { AssignTaskModal, HandbackModal, MoveNextModal, ReviewModal } from "../modals/TaskModals";
import type { ChapterTask, CustodyStatus, WorkspaceItem } from "../types";
import { toDayKey } from "../utils/dates";
import { chapterOf } from "../utils/items";
import { availableActions } from "../utils/moves";

export const chapterTaskQueryKey = (chapterId: number) => ["workspace-chapter-task", chapterId] as const;

const STEPS: { key: CustodyStatus; label: string }[] = [
  { key: "unassigned", label: "Inbound" },
  { key: "in_progress", label: "With employee" },
  { key: "returned_for_review", label: "Lead review" },
  { key: "qa_approved", label: "Ready to move" },
  { key: "transitioned", label: "Moved to next stage" },
];

/** Inbound ─ With employee ─ Lead review ─ Ready to move ─ Moved: compact dots, current step highlighted. */
export function WorkflowStepper({ status }: { status: CustodyStatus }) {
  const at = STEPS.findIndex((s) => s.key === status);
  return (
    <ol aria-label="Workflow steps" className="flex flex-wrap items-center gap-1 text-[11.5px] text-muted">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden="true" className={cn("h-0.5 w-3.5 rounded", i <= at ? "bg-primary" : "bg-border")} />}
          <span
            aria-current={i === at ? "step" : undefined}
            className={cn("inline-flex items-center gap-1", i === at && "font-bold text-primary", i < at && "text-text")}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-3 place-items-center rounded-full border-2",
                i < at ? "border-primary bg-primary text-white" : i === at ? "border-primary bg-card ring-2 ring-primary/25" : "border-border bg-card",
              )}
            >
              {i < at && <Check className="size-2" strokeWidth={4} />}
            </span>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function waitingText(item: WorkspaceItem, task: ChapterTask, nameOf: (u: string | null | undefined) => string): string {
  switch (item.custody_status) {
    case "unassigned":
      return `Waiting for ${task.owner_name ?? "the team lead"} to assign it`;
    case "in_progress":
      return task.can_manage ? `${nameOf(item.assignee_name)} is working on it` : `Waiting for ${nameOf(item.assignee_name)} to hand back`;
    case "returned_for_review":
      return `Waiting for ${task.owner_name ?? "the team lead"}'s review`;
    case "qa_approved":
      return `Approved — ${task.owner_name ?? "the team lead"} moves it to ${item.next_stage ?? "completion"}.`;
    default:
      return "This stage is finished.";
  }
}

type Dialog = "assign" | "handback" | "approve" | "rework" | "move" | "activity" | null;

interface Props {
  chapterId: number;
  /** Called after a successful action (the page reloads the chapter, e.g. its stage after Move next). */
  onChanged?: (item: WorkspaceItem) => void;
  /** Tells the page whether this chapter is run by the workspace flow (so it can hide the legacy Proceed). */
  onTaskLoaded?: (hasTask: boolean) => void;
  /** Whether the viewer may change the chapter's files (drives the file page's edit controls) and, if not, why. */
  onAccess?: (canWrite: boolean, reason: string) => void;
}

/**
 * The same workflow actions the workspace task card offers, for the chapter folder page:
 * lead Assign → employee Hand back → lead Approve / Send back → Ready to move → lead Move to next stage.
 */
export function ChapterWorkflowBar({ chapterId, onChanged, onTaskLoaded, onAccess }: Props) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: chapterTaskQueryKey(chapterId), queryFn: () => workspaceApi.chapterTask(chapterId), retry: false });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const usersByUsername = useUsersStore((s) => s.usersByUsername);

  const task = query.data;
  const item = task?.item ?? null;
  useEffect(() => {
    if (query.isSuccess) onTaskLoaded?.(Boolean(item && item.live !== false));
  }, [query.isSuccess, item, onTaskLoaded]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    Object.entries(usersByUsername).forEach(([u, rec]) => m.set(u, getUserDisplayName(rec)));
    task?.people.forEach((p) => m.set(p.username, p.display_name));
    return m;
  }, [usersByUsername, task]);
  const nameOf = useCallback((u: string | null | undefined) => (u ? names.get(u) ?? u : "Unassigned"), [names]);

  useEffect(() => {
    if (!task) return;
    const where = task.stage_name ? ` in ${task.stage_name}` : "";
    const held = item?.assignee_name ? `Assigned to ${nameOf(item.assignee_name)}${where}.` : `Not assigned yet${where}.`;
    onAccess?.(task.can_write, `${held} Only the assignee, the stage owner or Admin can change files; you can view and download them.`);
  }, [task, item, nameOf, onAccess]);

  const run = async (label: string, fn: (it: WorkspaceItem) => Promise<WorkspaceItem>) => {
    if (!item) return;
    setDialog(null);
    setBusy(true);
    try {
      const updated = await fn(item);
      toast.success(label);
      void qc.invalidateQueries({ queryKey: chapterTaskQueryKey(chapterId) });
      void qc.invalidateQueries({ queryKey: [DASHBOARD_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: [SCHEDULE_QUERY_KEY] });
      onChanged?.(updated);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "The change could not be saved."));
      void query.refetch();
    } finally {
      setBusy(false);
    }
  };

  if (query.isLoading) return <div className="h-11 animate-pulse border-b border-border bg-surface" aria-hidden="true" />;
  if (query.isError || !task || !item || item.live === false) return null;

  // Hand back is only ever the assignee's button (availableActions checks viewer === assignee).
  const actions = availableActions(item, { viewer: task.is_assignee ? item.assignee_name ?? "" : "", canManage: task.can_manage });
  const expected = item.custody_status;
  const todayKey = toDayKey(new Date());
  const wait = item.custody_status === "in_progress" || !actions.length ? waitingText(item, task, nameOf) : null;
  const note =
    item.custody_status === "in_progress" && item.rework_count > 0 && item.rework_notes
      ? { tone: "border-l-amber-500", who: "Rework", text: item.rework_notes }
      : item.custody_status === "returned_for_review" && item.handback_notes
        ? { tone: "border-l-violet-500", who: nameOf(item.assignee_name), text: item.handback_notes }
        : null;

  return (
    <section aria-label="Chapter workflow" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2">
      <WorkflowStepper status={item.custody_status} />
      <span className="text-xs text-muted">
        Assignee: <b className="text-text">{item.assignee_name ? nameOf(item.assignee_name) : "—"}</b>
        {task.is_assignee ? " (you)" : ""}
      </span>
      {note && (
        <span title={note.text} className={cn("max-w-md truncate rounded border-l-[3px] bg-card px-2 py-0.5 text-xs text-muted", note.tone)}>
          <b className="text-text">{note.who}:</b> {note.text}
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2" aria-busy={busy || undefined}>
        {wait && !(actions.includes("handback")) && <span className="text-xs text-muted italic">{wait}</span>}
        {actions.includes("assign") && <Button size="sm" disabled={busy} onClick={() => setDialog("assign")}>Assign</Button>}
        {actions.includes("handback") && <Button size="sm" disabled={busy} onClick={() => setDialog("handback")}>Hand back to lead</Button>}
        {actions.includes("reassign") && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDialog("assign")}>Reassign</Button>}
        {actions.includes("review") && (
          <>
            <Button size="sm" disabled={busy} onClick={() => setDialog("approve")}>Approve</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDialog("rework")}>Send back for rework</Button>
          </>
        )}
        {actions.includes("move_next") && (
          <Button size="sm" disabled={busy} onClick={() => setDialog("move")}>
            {item.next_stage ? `Move to ${item.next_stage}` : "Mark complete"} →
          </Button>
        )}
        <button
          type="button"
          onClick={() => setDialog("activity")}
          title="Activity"
          aria-label={`Activity for ${chapterOf(item)}`}
          className="grid size-7 place-items-center rounded-lg border border-border bg-card text-muted hover:text-text"
        >
          <Clock className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {dialog === "assign" && (
        <AssignTaskModal
          item={item}
          people={task.people.map((p) => ({ username: p.username, open: p.open, pages: p.pages }))}
          nameOf={nameOf}
          todayKey={todayKey}
          onClose={() => setDialog(null)}
          onSubmit={(body) => void run(`${chapterOf(item)} assigned to ${nameOf(body.assignee)}.`, (it) => workspaceApi.assign(it.id, { ...body, expected_custody_status: expected }))}
        />
      )}
      {dialog === "handback" && (
        <HandbackModal
          item={item}
          ownerName={task.owner_name ?? "the team lead"}
          onClose={() => setDialog(null)}
          onSubmit={(body) => void run(`${chapterOf(item)} handed back for review.`, (it) => workspaceApi.handback(it.id, { ...body, expected_custody_status: expected }))}
        />
      )}
      {(dialog === "approve" || dialog === "rework") && (
        <ReviewModal
          item={item}
          preset={dialog}
          nameOf={nameOf}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            void run(
              body.decision === "approve" ? `${chapterOf(item)} approved — ready to move.` : `${chapterOf(item)} sent back for rework.`,
              (it) => workspaceApi.review(it.id, { ...body, expected_custody_status: expected }),
            )
          }
        />
      )}
      {dialog === "move" && (
        <MoveNextModal
          item={item}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void run(item.next_stage ? `${chapterOf(item)} moved to ${item.next_stage}.` : `${chapterOf(item)} marked complete.`, (it) =>
              workspaceApi.moveNext(it.id, { notify: true, expected_custody_status: expected }),
            )
          }
        />
      )}
      {dialog === "activity" && <ActivityDrawer item={item} nameOf={nameOf} todayKey={todayKey} onClose={() => setDialog(null)} />}
    </section>
  );
}
