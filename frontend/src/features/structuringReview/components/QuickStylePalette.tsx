import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search, X, Check } from "lucide-react";
import { getClientShortcuts } from "../shortcuts/shortcutsStorage";
import type { StyleShortcutItem } from "../shortcuts/types";
import { toast } from "@/store/useToastStore";

interface QuickStylePaletteProps {
  isOpen: boolean;
  onClose: () => void;
  editorRef: React.RefObject<any>;
  clientKey: string;
  allStyles?: string[];
  charStyles?: string[];
}

interface PaletteItem {
  id: string;
  name: string;
  label: string;
  type: "paragraph" | "character";
  shortcut?: string | null;
  itemDef?: StyleShortcutItem;
}

export function QuickStylePalette({
  isOpen,
  onClose,
  editorRef,
  clientKey,
  allStyles = [],
  charStyles = [],
}: QuickStylePaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const clientData = useMemo(() => getClientShortcuts(clientKey), [clientKey]);

  // Combine client shortcut styles with all manuscript styles
  const items = useMemo(() => {
    const list: PaletteItem[] = [];
    const seenPara = new Set<string>();
    const seenChar = new Set<string>();

    // 1. First add client configured shortcuts (high priority)
    clientData.paragraph_shortcuts.forEach((s) => {
      if (s.style && !seenPara.has(s.style.toLowerCase())) {
        seenPara.add(s.style.toLowerCase());
        list.push({
          id: `para-${s.style}`,
          name: s.style,
          label: s.label,
          type: "paragraph",
          shortcut: s.shortcut,
          itemDef: s,
        });
      }
    });

    clientData.character_shortcuts.forEach((s) => {
      const name = s.style || "Clear Character Style";
      if (!seenChar.has(name.toLowerCase())) {
        seenChar.add(name.toLowerCase());
        list.push({
          id: `char-${name}`,
          name: name,
          label: s.label,
          type: "character",
          shortcut: s.shortcut,
          itemDef: s,
        });
      }
    });

    // 2. Add remaining manuscript paragraph styles
    allStyles.forEach((s) => {
      if (s && !seenPara.has(s.toLowerCase())) {
        seenPara.add(s.toLowerCase());
        list.push({
          id: `para-${s}`,
          name: s,
          label: s.startsWith("H") ? `Heading ${s.substring(1)}` : "Paragraph Style",
          type: "paragraph",
          shortcut: null,
        });
      }
    });

    // 3. Add remaining manuscript character styles
    charStyles.forEach((s) => {
      if (s && !seenChar.has(s.toLowerCase())) {
        seenChar.add(s.toLowerCase());
        list.push({
          id: `char-${s}`,
          name: s,
          label: "Character Style",
          type: "character",
          shortcut: null,
        });
      }
    });

    return list;
  }, [clientData, allStyles, charStyles]);

  // Filter items by search query
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        (item.shortcut && item.shortcut.toLowerCase().includes(q))
    );
  }, [items, search]);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Keep selected item visible during arrow navigation
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const applyItem = (item: PaletteItem) => {
    const editor = editorRef.current?.editor;
    if (!editor) {
      onClose();
      return;
    }

    if (item.type === "paragraph") {
      const styleName = item.name;
      const headingMap: Record<string, number> = {
        H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6,
        Head1: 1, Head2: 2, Head3: 3, Head4: 4, Head5: 5, Head6: 6,
      };
      const level =
        headingMap[styleName] ??
        (styleName.toLowerCase().startsWith("head") || styleName.toLowerCase().startsWith("h")
          ? parseInt(styleName.replace(/\D/g, ""), 10) || undefined
          : undefined);

      let chain = editor.chain().focus();
      if (level && level >= 1 && level <= 6) {
        chain = chain
          .setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
          .updateAttributes("heading", { styleLabel: styleName });
      } else {
        if (editor.isActive("heading")) {
          chain = chain.setParagraph();
        }
        chain = chain.updateAttributes("paragraph", { styleLabel: styleName });
      }
      chain.run();
      toast.success(`Applied [${styleName}]`);
    } else {
      // Character style
      if (item.name === "Clear Character Style" || !item.itemDef?.style) {
        editor.chain().focus().unsetMark("charStyle").run();
        toast.success("Cleared Character Style");
      } else {
        editor.chain().focus().toggleMark("charStyle", { class: item.name }).run();
        toast.success(`Applied [${item.name}]`);
      }
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        applyItem(filtered[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-start justify-center pt-24 z-50 p-4 animate-in fade-in duration-100"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col scale-in-95 duration-100"
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="h-12 px-4 border-b border-slate-200 bg-slate-50 flex items-center gap-3 shrink-0">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Type style name in ${clientData.client_label} (e.g. H1, Head1, Fig, CT)...`}
            className="flex-1 bg-transparent border-none outline-none text-xs font-medium text-slate-800 placeholder:text-slate-400"
          />
          <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-white border border-slate-200 text-slate-500 shadow-xs">
            Esc
          </kbd>
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No matching styles found for <span className="font-semibold text-slate-600">"{search}"</span>
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const isPara = item.type === "paragraph";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors cursor-pointer border-none ${
                    isSelected
                      ? "bg-blue-50 text-blue-900"
                      : "bg-transparent text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded font-mono shrink-0 ${
                        isPara
                          ? "bg-purple-100 text-purple-800 border border-purple-200"
                          : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                      }`}
                    >
                      {isPara ? "¶ Para" : "a Char"}
                    </span>
                    <span className="text-xs font-bold font-mono text-slate-900 truncate">
                      {item.name}
                    </span>
                    <span className="text-[11px] text-slate-400 truncate">
                      {item.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {item.shortcut && (
                      <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 border border-slate-200 text-slate-600 shadow-2xs">
                        {item.shortcut}
                      </kbd>
                    )}
                    {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="h-9 px-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
          <div className="flex items-center gap-2">
            <span>Use <kbd className="px-1 py-0.5 rounded bg-white border border-slate-200 text-slate-600">↑</kbd> <kbd className="px-1 py-0.5 rounded bg-white border border-slate-200 text-slate-600">↓</kbd> to navigate</span>
            <span>•</span>
            <span><kbd className="px-1 py-0.5 rounded bg-white border border-slate-200 text-slate-600">Enter</kbd> to apply</span>
          </div>
          <span className="font-semibold text-slate-600">
            Alt + S Quick Apply
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
