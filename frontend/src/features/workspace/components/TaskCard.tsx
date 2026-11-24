import type { DragEvent } from "react";
import { Link } from "react-router-dom";
import { Clock, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { uiPaths } from "@/utils/appPaths";
import { cn } from "@/utils/cn";

import { useWorkspaceUi } from "../WorkspaceContext";
import type { WorkspaceItem } from "../types";
import { dueInfo, isLate, isOpen } from "../utils/dates";
import { chapterOf, clientOf, pagesOf } from "../utils/items";
import { availableActions } from "../utils/moves";
import { Avatar, DueLabel, PriorityBadge, ToneBadge } from "./Primitives";

interface Props {
  item: WorkspaceItem;
  showStage?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>, item: WorkspaceItem) => void;
  onDragEnd?: () => void;
}

export function TaskCard({ item, showStage, onDragStart, onDragEnd }: Props) {
  const ui = useWorkspaceUi();
  const canManage = ui.canManage(item.stage_name, item);
  const pending = ui.pending.has(item.id);
  const actions = availableActions(item, { viewer: ui.viewer, canManage });
  const draggable = canManage && isOpen(item) && !pending && Boolean(onDragStart);
  const needsRework = item.custody_status === "in_progress" && item.rework_count > 0 && item.rework_notes;
  const mine = item.assignee_name === ui.viewer;

  return (
    <article
      aria-label={chapterOf(item)}
      aria-busy={pending || undefined}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart?.(e, item) : undefined}
      onDragEnd={onDragEnd}
      className={cn(
        "relative rounded-xl border border-border bg-card p-3 shadow-sm",
        draggable && "cursor-grab",
        isLate(item) && "border-l-[3px] border-l-red-500",
        pending && "pointer-events-none opacity-60",
      )}
    >
      {pending && <span className="absolute top-3 right-3 size-3.5 animate-spin rounded-full border-2 border-blue-500 border-r-transparent motion-reduce:animate-none" aria-hidden="true" />}
      <div className="pr-5 font-semibold text-text">{chapterOf(item)}</div>
      <div className="text-xs text-muted">
        {item.project} · {clientOf(item)}
        {showStage ? ` · ${item.stage_name}` : ""}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={item.priority} />
        {item.rework_count > 0 && <ToneBadge tone="warn">Rework ×{item.rework_count}</ToneBadge>}
        <DueLabel info={dueInfo(item, ui.todayKey)} />
        <span className="text-xs text-muted">· {pagesOf(item)} pp</span>
      </div>
      {item.assignee_name && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <Avatar username={item.assignee_name} name={ui.nameOf(item.assignee_name)} />
          {ui.nameOf(item.assignee_name)}
        </div>
      )}
      {needsRework && (
        <p className="mt-2 rounded-lg border-l-[3px] border-l-amber-500 bg-background px-2 py-1.5 text-xs text-muted">
          <b className="text-text">Rework requested:</b> {item.rework_notes}
        </p>
      )}
      {item.custody_status === "returned_for_review" && item.handback_notes && (
        <p className="mt-2 rounded-lg border-l-[3px] border-l-violet-500 bg-background px-2 py-1.5 text-xs text-muted">
          <b className="text-text">{ui.nameOf(item.assignee_name).split(" ")[0]}:</b> {item.handback_notes}
        </p>
      )}
      {item.assignment_notes && item.custody_status === "in_progress" && mine && (
        <p className="mt-2 rounded-lg border-l-[3px] border-l-blue-500 bg-background px-2 py-1.5 text-xs text-muted">
          <b className="text-text">Instructions:</b> {item.assignment_notes}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {actions.includes("assign") && <Button size="sm" onClick={() => ui.open.assign(item)}>Assign</Button>}
        {actions.includes("handback") && (
          <Button size="sm" variant={mine ? "primary" : "secondary"} onClick={() => ui.open.handback(item)}>Hand back</Button>
        )}
        {actions.includes("reassign") && <Button size="sm" variant="ghost" onClick={() => ui.open.assign(item)}>Reassign</Button>}
        {actions.includes("review") && <Button size="sm" onClick={() => ui.open.review(item)}>Review</Button>}
        {item.custody_status === "returned_for_review" && !canManage && (
          <span className="text-xs text-muted">Waiting for the stage owner&apos;s review</span>
        )}
        {actions.includes("move_next") && (
          <Button size="sm" onClick={() => ui.open.moveNext(item)}>
            {item.next_stage ? `Move to ${item.next_stage}` : "Mark complete"} →
          </Button>
        )}
        {item.project_id && item.chapter_id ? (
          <Link
            to={uiPaths.chapterDetail(item.project_id, item.chapter_id)}
            aria-label={`Open chapter folder for ${chapterOf(item)}`}
            title="Open chapter folder"
            className="ml-auto grid size-7 place-items-center rounded-lg border border-border text-muted hover:text-text"
          >
            <FolderOpen className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => ui.open.activity(item)}
          aria-label={`Activity for ${chapterOf(item)}`}
          title="Activity"
          className={cn(!(item.project_id && item.chapter_id) && "ml-auto", "grid size-7 place-items-center rounded-lg border border-border text-muted hover:text-text")}
        >
          <Clock className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
