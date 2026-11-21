import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

import { cn } from "@/utils/cn";

import type { WorkspaceStageInfo } from "../types";

interface Props {
  id?: string;
  stages: WorkspaceStageInfo[];
  value: string;
  onChange: (stage: string) => void;
  /** Open chapters per stage, shown next to each name and used by "With work only". */
  counts?: ReadonlyMap<string, number>;
}

const byName = (a: WorkspaceStageInfo, b: WorkspaceStageInfo) =>
  a.stage_name.localeCompare(b.stage_name, undefined, { sensitivity: "base", numeric: true });

/**
 * Searchable stage selector: stages in alphabetical order, type to filter, optional "with work only".
 * Keyboard: ↑/↓ to move, Enter to choose, Esc to close.
 */
export function StagePicker({ id, stages, value, onChange, counts }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [workOnly, setWorkOnly] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 300 });
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const sorted = useMemo(() => [...stages].sort(byName), [stages]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sorted.filter((s) => (!needle || s.stage_name.toLowerCase().includes(needle)) && (!workOnly || (counts?.get(s.stage_name) ?? 0) > 0 || s.stage_name === value));
  }, [sorted, q, workOnly, counts, value]);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(300, r.width);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(Math.max(0, sorted.findIndex((s) => s.stage_name === value)));
    requestAnimationFrame(() => input.current?.focus());
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, sorted, value]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  useEffect(() => {
    if (open) (panel.current?.querySelector(`[data-index="${active}"]`) as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    btn.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = shown[active];
      if (s) choose(s.stage_name);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    }
  };

  const current = stages.find((s) => s.stage_name === value);

  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-w-56 items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1 text-left font-semibold text-text hover:border-slate-400"
      >
        <span className="truncate">{value}{current && !current.can_manage ? " (view only)" : ""}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-50 rounded-xl border border-border bg-card p-2 text-sm shadow-xl"
            onKeyDown={onKey}
          >
            <div className="relative mb-2">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                ref={input}
                type="search"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                aria-label="Search stages"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                placeholder={`Search ${stages.length} stages`}
                className="w-full rounded-lg border border-border bg-background py-1.5 pr-2 pl-8 text-sm"
              />
            </div>
            {counts && (
              <label className="mb-1.5 flex cursor-pointer items-center gap-2 px-1 text-xs text-muted">
                <input type="checkbox" className="size-3.5 accent-primary" checked={workOnly} onChange={(e) => setWorkOnly(e.target.checked)} />
                Only stages with open work
              </label>
            )}
            <ul id={listId} role="listbox" aria-label="Stages" className="max-h-72 overflow-auto">
              {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted">No stage matches “{q}”</li>}
              {shown.map((s, i) => {
                const n = counts?.get(s.stage_name) ?? 0;
                const selected = s.stage_name === value;
                return (
                  <li
                    key={s.stage_name}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(s.stage_name)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                      i === active && "bg-slate-100 dark:bg-slate-800",
                      selected && "font-semibold",
                    )}
                  >
                    <Check className={cn("size-3.5 shrink-0 text-primary", !selected && "invisible")} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-text">{s.stage_name}</span>
                    {!s.can_manage && <span className="text-[11px] text-muted">view only</span>}
                    {counts && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", n ? "bg-primary/10 text-primary" : "text-muted")}>{n}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 px-1 text-[11px] text-muted">{shown.length} of {stages.length} stages · A–Z</p>
          </div>,
          document.body,
        )}
    </>
  );
}
