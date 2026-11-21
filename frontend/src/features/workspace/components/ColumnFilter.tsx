import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filter } from "lucide-react";

import { cn } from "@/utils/cn";

import type { ColumnOption } from "../utils/items";

interface Props {
  title: string;
  /** Computed lazily when the list opens (can be expensive on big queues). */
  getOptions: () => ColumnOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}

const WIDTH = 272;

/**
 * Excel-style column filter: a funnel button in the header that opens a searchable checklist of the
 * column's values. Nothing ticked-off = no filter. Rendered in a portal with fixed positioning so the
 * table's rounded/overflow container doesn't clip it.
 */
export function ColumnFilter({ title, getOptions, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const active = selected.length > 0;

  const options = useMemo(() => (open ? getOptions() : []), [open, getOptions]);
  const all = useMemo(() => options.map((o) => o.value), [options]);
  const checked = useMemo(() => new Set(active ? selected : all), [active, selected, all]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  }, [options, q]);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    setPos({ top: r.bottom + 6, left });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    requestAnimationFrame(() => search.current?.focus());
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const commit = (next: Set<string>) => {
    // Everything ticked is the same as no filter.
    onChange(next.size === all.length && all.every((v) => next.has(v)) ? [] : all.filter((v) => next.has(v)));
  };
  const toggle = (value: string) => {
    const next = new Set(checked);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    commit(next);
  };
  const setShown = (on: boolean) => {
    const next = new Set(checked);
    shown.forEach((o) => (on ? next.add(o.value) : next.delete(o.value)));
    commit(next);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={active ? `Filter ${title} (${selected.length} selected)` : `Filter ${title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "ml-1 inline-grid size-5 place-items-center rounded align-middle hover:bg-slate-200 hover:text-text dark:hover:bg-slate-700",
          active ? "bg-primary/15 text-primary" : "text-muted",
        )}
      >
        <Filter className="size-3" aria-hidden="true" fill={active ? "currentColor" : "none"} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={listId}
            role="dialog"
            aria-label={`Filter ${title}`}
            style={{ top: pos.top, left: pos.left, width: WIDTH }}
            className="fixed z-50 rounded-xl border border-border bg-card p-2 text-sm normal-case shadow-xl"
          >
            <input
              ref={search}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
              aria-label={`Search ${title} values`}
              className="mb-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
            />
            <div className="mb-1 flex items-center justify-between px-1 text-xs">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setShown(true)}>
                Select {q ? "shown" : "all"}
              </button>
              <button type="button" className="font-semibold text-muted hover:text-text hover:underline" onClick={() => setShown(false)}>
                Clear {q ? "shown" : "all"}
              </button>
            </div>
            <ul className="max-h-64 overflow-auto" aria-label={`${title} values`}>
              {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted">No values</li>}
              {shown.map((o) => (
                <li key={o.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <input type="checkbox" className="size-4 accent-primary" checked={checked.has(o.value)} onChange={() => toggle(o.value)} />
                    <span className="min-w-0 flex-1 truncate text-text" title={o.label}>{o.label}</span>
                    <span className="text-xs text-muted tabular-nums">{o.count}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-end gap-2 border-t border-border pt-2">
              {active && (
                <button type="button" className="rounded-lg px-2.5 py-1 text-xs font-semibold text-muted hover:text-text" onClick={() => onChange([])}>
                  Remove filter
                </button>
              )}
              <button type="button" className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-white" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
