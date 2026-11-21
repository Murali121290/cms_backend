import { useMemo, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";

import { cn } from "@/utils/cn";

import type { WorkspaceItem } from "../types";
import { workloadOf, type NameOf } from "../utils/items";
import { Avatar, LoadBar } from "./Primitives";

export interface PickerPerson {
  username: string;
  open: number;
  pages: number;
}

/** Candidates for a set of stages, lightest workload first. */
export function rankPeople(usernames: string[], items: WorkspaceItem[]): PickerPerson[] {
  return [...new Set(usernames)]
    .map((u) => ({ username: u, ...workloadOf(items, u) }))
    .sort((a, b) => a.open - b.open || a.pages - b.pages || a.username.localeCompare(b.username));
}

interface Props {
  people: PickerPerson[];
  current?: string | null; // undefined = bulk (no current)
  nameOf: NameOf;
  onChoose: (username: string | null) => void;
  trigger?: ReactNode;
  triggerLabel: string;
  disabled?: boolean;
  allowUnassign?: boolean;
  footnote?: string;
}

/** Keyboard-accessible assignee menu (Radix): type to filter, arrows to move, Enter to choose, Esc to close. */
export function AssigneePicker({ people, current, nameOf, onChoose, trigger, triggerLabel, disabled, allowUnassign = true, footnote }: Props) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? people.filter((p) => `${p.username} ${nameOf(p.username)}`.toLowerCase().includes(n)) : people;
  }, [people, q, nameOf]);

  return (
    <DropdownMenu.Root onOpenChange={(o) => !o && setQ("")}>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        {trigger ?? (
          <button
            type="button"
            aria-label={triggerLabel}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-transparent py-0.5 pr-1.5 pl-0.5 text-sm hover:border-border hover:bg-card focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          >
            <Avatar username={current} name={current ? nameOf(current) : undefined} />
            <span className="truncate">{nameOf(current)}</span>
            <ChevronDown className="size-3 text-muted" aria-hidden="true" />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-[40] w-72 max-w-[calc(100vw-32px)] rounded-xl border border-border bg-card p-2 shadow-xl"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(e.key)) e.stopPropagation();
            }}
            placeholder="Search people"
            aria-label="Search people"
            autoComplete="off"
            className="mb-1.5 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
          />
          <div className="max-h-72 overflow-auto" role="presentation">
            {shown.map((p, i) => (
              <DropdownMenu.Item
                key={p.username}
                onSelect={() => onChoose(p.username)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-background",
                  current === p.username && "bg-blue-50 dark:bg-blue-950/40",
                )}
              >
                <Avatar username={p.username} name={nameOf(p.username)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-text">{nameOf(p.username)}</span>
                  <span className="text-[11.5px] text-muted">
                    {p.open} open · {p.pages} pages{i === 0 && !q ? " · lightest" : ""}
                  </span>
                </span>
                <LoadBar open={p.open} className="max-w-16" />
              </DropdownMenu.Item>
            ))}
            {shown.length === 0 && <p className="px-2 py-3 text-xs text-muted">No one matches.</p>}
            {allowUnassign && (
              <DropdownMenu.Item
                onSelect={() => onChoose(null)}
                className={cn("mt-1 flex cursor-pointer items-center gap-2.5 rounded-lg border-t border-border px-2 py-1.5 outline-none data-[highlighted]:bg-background", current === null && "bg-blue-50 dark:bg-blue-950/40")}
              >
                <Avatar username={null} />
                <span>
                  <span className="block text-[13px] font-semibold text-text">Unassigned</span>
                  <span className="text-[11.5px] text-muted">Send back to Inbound</span>
                </span>
              </DropdownMenu.Item>
            )}
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-muted">{footnote ?? "Sorted by current workload"}</p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
