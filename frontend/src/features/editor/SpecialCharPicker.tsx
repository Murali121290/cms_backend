import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import {
  GREEK,
  MATH,
  PUNCTUATION,
  SPACES,
  SPECIAL_CHAR_BY_CHAR,
  searchSpecialChars,
  type SpecialChar,
} from "./specialCharacters";

const RECENT_KEY = "editor.recentSpecialChars";
const RECENT_MAX = 16;

type TabKey = "recent" | "spaces" | "punctuation" | "math" | "greek";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "recent", label: "Recent" },
  { key: "spaces", label: "Spaces" },
  { key: "punctuation", label: "Punctuation" },
  { key: "math", label: "Math" },
  { key: "greek", label: "Greek" },
];

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((c) => typeof c === "string" && SPECIAL_CHAR_BY_CHAR[c]) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — recent list just won't persist */
  }
}

/** Insert one character as literal text (never parsed as HTML). */
export function insertSpecialChar(editor: Editor | null | undefined, char: string): boolean {
  if (!editor) return false;
  return editor.chain().focus().insertContent({ type: "text", text: char }).run();
}

export function SpecialCharPicker({
  editor,
  open,
  onClose,
  anchorRef,
}: {
  editor: Editor | null;
  open: boolean;
  onClose: () => void;
  /** Element the popover hangs under (the Ω toolbar button wrapper). */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const [tab, setTab] = useState<TabKey>("spaces");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // The toolbar is overflow-x:auto, which clips anything hanging below it,
  // so the popover is portalled to <body> and positioned from the button.
  useLayoutEffect(() => {
    if (!open) return;
    const WIDTH = 340;
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
      setPos({ top: r.bottom + 8, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root || root.contains(e.target as Node)) return;
      // Clicks on the Ω toggle button are handled by the toggle itself.
      if ((e.target as HTMLElement)?.closest?.("[data-special-char-toggle]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        editor?.commands.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, editor]);

  // Default to Recent when there is history.
  useEffect(() => {
    if (open) {
      setQuery("");
      setTab(readRecent().length ? "recent" : "spaces");
      setRecent(readRecent());
    }
  }, [open]);

  const items: SpecialChar[] = useMemo(() => {
    if (query.trim()) return searchSpecialChars(query);
    switch (tab) {
      case "recent":
        return recent.map((c) => SPECIAL_CHAR_BY_CHAR[c]).filter(Boolean);
      case "spaces":
        return SPACES;
      case "punctuation":
        return PUNCTUATION;
      case "math":
        return MATH;
      case "greek":
        return GREEK;
    }
  }, [tab, query, recent]);

  if (!open) return null;

  const pick = (c: SpecialChar) => {
    insertSpecialChar(editor, c.char);
    const next = [c.char, ...recent.filter((r) => r !== c.char)].slice(0, RECENT_MAX);
    setRecent(next);
    writeRecent(next);
  };

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Insert symbol"
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="z-[1000] w-[340px] rounded-lg border border-slate-700 bg-slate-900 shadow-xl p-2 text-slate-200"
    >
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search symbols (e.g. em space, less than)…"
        className="w-full mb-2 px-2 py-1 text-xs rounded bg-slate-800 border border-slate-700 focus:outline-none focus:border-amber-500 placeholder:text-slate-500"
      />
      {!query.trim() && (
        <div className="flex gap-1 mb-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab(t.key)}
              className={`px-2 py-0.5 text-[11px] rounded ${tab === t.key
                ? "bg-amber-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">
          {tab === "recent" && !query.trim() ? "No recent symbols yet." : "No symbols match."}
        </p>
      ) : (
        <div className="grid grid-cols-8 gap-1 max-h-56 overflow-y-auto">
          {items.map((c) => (
            <button
              key={c.char}
              type="button"
              // Keep the editor's cursor/selection: don't steal focus.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
              title={`${c.name} — ${c.code}`}
              aria-label={c.name}
              className={`h-8 rounded border border-slate-800 hover:border-amber-500 hover:bg-slate-800 flex items-center justify-center ${c.label ? "text-[9px] font-semibold tracking-tight text-amber-300 col-span-2" : "text-base"
                }`}
            >
              {c.label ?? c.char}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
