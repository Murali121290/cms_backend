import { X } from "lucide-react";

import { useWorkspaceUi } from "../WorkspaceContext";
import type { WorkspaceItem } from "../types";
import { isAssignable } from "../utils/items";
import { AssigneePicker, rankPeople } from "./AssigneePicker";

interface Props {
  selected: WorkspaceItem[];
  onAssign: (username: string | null) => void;
  onApprove: () => void;
  onMoveNext: () => void;
  onClear: () => void;
}

const barBtn = "inline-flex h-7 items-center gap-1 rounded-lg bg-white/15 px-2.5 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-35 dark:bg-black/15 dark:text-black";

export function BulkActionBar({ selected, onAssign, onApprove, onMoveNext, onClear }: Props) {
  const ui = useWorkspaceUi();
  if (!selected.length) return null;
  const assignable = selected.filter(isAssignable);
  const review = selected.filter((i) => i.custody_status === "returned_for_review").length;
  const ready = selected.filter((i) => i.custody_status === "qa_approved").length;
  const stages = [...new Set(assignable.map((i) => i.stage_name))];

  return (
    <div role="region" aria-label="Bulk actions" className="fixed bottom-5 left-1/2 z-[25] flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-2xl bg-slate-900 py-2 pr-2 pl-4 text-white shadow-2xl dark:bg-slate-100 dark:text-black">
      <b className="text-sm">{selected.length} selected</b>
      <AssigneePicker
        people={rankPeople(ui.peopleFor(stages), ui.items)}
        nameOf={ui.nameOf}
        triggerLabel="Assign selected"
        disabled={!assignable.length}
        onChoose={onAssign}
        footnote={stages.length > 1 ? `People from ${stages.length} stages · sorted by workload` : undefined}
        trigger={
          <button type="button" className={barBtn} disabled={!assignable.length} aria-haspopup="menu">
            Assign to…{assignable.length && assignable.length < selected.length ? ` (${assignable.length})` : ""}
          </button>
        }
      />
      <button type="button" className={barBtn} disabled={!review} onClick={onApprove}>Approve{review ? ` (${review})` : ""}</button>
      <button type="button" className={barBtn} disabled={!ready} onClick={onMoveNext}>Move to next stage{ready ? ` (${ready})` : ""}</button>
      <button type="button" className={barBtn} onClick={onClear} aria-label="Clear selection"><X className="size-3.5" /></button>
    </div>
  );
}
