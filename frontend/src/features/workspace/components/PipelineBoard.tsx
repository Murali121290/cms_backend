import { useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { cn } from "@/utils/cn";

import { BOARD_COLUMNS, CUSTODY, TONE_CLASSES } from "../constants";
import { useWorkspaceUi } from "../WorkspaceContext";
import type { CustodyStatus, WorkspaceItem } from "../types";
import { isOpen } from "../utils/dates";
import { byUrgency } from "../utils/items";
import { boardMove } from "../utils/moves";
import { EmptyBox } from "./Primitives";
import { TaskCard } from "./TaskCard";

interface Props {
  items: WorkspaceItem[]; // already filtered to the selected stage
  filtered: boolean;
  readOnly: boolean;
}

const EMPTY_TEXT: Partial<Record<CustodyStatus, string>> = {
  returned_for_review: "Nothing waiting for review",
  qa_approved: "Nothing approved yet",
};

export function PipelineBoard({ items, filtered, readOnly }: Props) {
  const ui = useWorkspaceUi();
  const [drag, setDrag] = useState<WorkspaceItem | null>(null);
  const [over, setOver] = useState<CustodyStatus | null>(null);

  const columns = useMemo(
    () => BOARD_COLUMNS.map((c) => ({ status: c, items: items.filter((i) => isOpen(i) && i.custody_status === c).sort(byUrgency) })),
    [items],
  );

  const onDragStart = (e: DragEvent<HTMLElement>, item: WorkspaceItem) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(item.id));
    setDrag(item);
  };
  const onDragEnd = () => {
    setDrag(null);
    setOver(null);
  };

  const drop = (to: CustodyStatus) => {
    const item = drag;
    onDragEnd();
    if (!item || item.custody_status === to) return;
    const move = boardMove(item.custody_status, to);
    if (!move) {
      toast.warning(`Can't move from ${CUSTODY[item.custody_status].label} to ${CUSTODY[to].label}. Chapters go Inbound → In progress → Review → Ready.`);
      return;
    }
    if (move === "assign") ui.open.assign(item);
    else if (move === "handback") ui.open.handback(item);
    else ui.open.review(item, move === "rework" ? "rework" : "approve");
  };

  return (
    <>
      <p className="mb-2 text-xs text-muted">{readOnly ? "Read only — you don't manage this stage." : "Drag a card to the next column, or use its buttons."}</p>
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
        {columns.map(({ status, items: colItems }) => {
          const allowed = drag ? Boolean(boardMove(drag.custody_status, status)) : false;
          const m = CUSTODY[status];
          return (
            <section
              key={status}
              aria-label={`${m.label}, ${colItems.length} items`}
              onDragOver={(e) => {
                if (!allowed) return;
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((o) => (o === status ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(status);
              }}
              className={cn(
                "min-h-56 rounded-2xl border border-border bg-background/60 p-2.5 transition-colors motion-reduce:transition-none",
                drag && drag.custody_status !== status && (allowed ? "border-dashed border-blue-500 bg-blue-50/60 dark:bg-blue-950/30" : "opacity-50"),
                over === status && "ring-2 ring-blue-500",
              )}
            >
              <header className="flex items-center gap-2 px-1 font-semibold text-text">
                <span className={cn("size-2.5 rounded-full", TONE_CLASSES[m.tone].dot)} aria-hidden="true" />
                {m.label}
                <span className="rounded-full bg-slate-200 px-2 text-[11px] font-semibold text-muted tabular-nums dark:bg-slate-700">{colItems.length}</span>
              </header>
              <p className="mx-1 mt-0.5 mb-2.5 text-xs text-muted">{m.hint}</p>
              <div className="flex flex-col gap-2">
                {colItems.length ? (
                  colItems.map((i) => <TaskCard key={i.id} item={i} onDragStart={readOnly ? undefined : onDragStart} onDragEnd={onDragEnd} />)
                ) : (
                  <EmptyBox>{filtered ? "Nothing matches your filters" : EMPTY_TEXT[status] ?? "Empty"}</EmptyBox>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
