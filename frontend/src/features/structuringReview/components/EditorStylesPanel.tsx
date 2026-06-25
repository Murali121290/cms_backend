import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { BookOpen, Plus, Search, X, Play, FileText, ChevronDown, ChevronRight, Folder, Tag, Layers, Table2 } from "lucide-react";
import type { Node as PmNode, Mark as PmMark } from "@tiptap/pm/model";
import type { WysiwygEditorHandle } from "@/features/editor";
import { NewStyleDialog } from "./NewStyleDialog";

// ── Types ──────────────────────────────────────────────────────────────────────

type PanelTab = "paragraph" | "character" | "group";

interface SdtNode {
  type: "block" | "inline";
  alias: string;
  tag: string;
}

interface ScannedElement {
  id: string;
  type: "sdtBlock" | "sdtInline" | "table" | "bulletList" | "orderedList" | "blockquote" | "paragraph" | "heading";
  // `styleLabel` (e.g. "CT", "TXNI") and `preview` (first ~50 chars of body
  // text) are only populated for paragraph/heading rows so the Group panel
  // can render an outline-like view. `name` remains the canonical label used
  // by every other element type.
  name: string;
  styleLabel?: string;
  preview?: string;
  pos: number;
  nodeSize: number;
  checked: boolean;
  children?: ScannedElement[];
  inlineSdts?: ScannedElement[];
}

interface StylesPanelProps {
  styles: string[];
  editorRef: React.RefObject<WysiwygEditorHandle>;
  onAddStyle?: (newStyle: string) => void;
  fileId?: number | null;
  charStyles?: string[];
  visibleTabs?: PanelTab[];
}

// Default character styles derived from the pipeline's bib/cite style map
const DEFAULT_CHAR_STYLES: { group: string; styles: string[] }[] = [
  {
    group: "Bibliography",
    styles: [
      "bib_article", "bib_book", "bib_chapterno", "bib_chaptertitle",
      "bib_doi", "bib_journal", "bib_publisher", "bib_title",
      "bib_volume", "bib_year", "bib_fname", "bib_surname", "bib_url",
    ],
  },
  {
    group: "Citation",
    styles: [
      "cite_app", "cite_bib", "cite_eq", "cite_fig",
      "cite_fn", "cite_sec", "cite_tbl", "cite_tfn", "cite_box",
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight.trim()) return <span>{text}</span>;
  const regex = new RegExp(`(${highlight.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, idx) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={idx} className="bg-amber-200 text-amber-950 font-bold px-0.5 rounded">{part}</mark>
        ) : (
          <span key={idx}>{part}</span>
        )
      )}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function StylesPanel({
  styles,
  editorRef,
  onAddStyle,
  fileId,
  charStyles,
  visibleTabs,
}: StylesPanelProps) {

  // ── Shared ────────────────────────────────────────────────────────────────
  const allowedTabs: PanelTab[] = visibleTabs && visibleTabs.length > 0 ? visibleTabs : ["group", "paragraph", "character"];
  const [activeTab, setActiveTab] = useState<PanelTab>(allowedTabs[0]);

  // ── Paragraph tab ─────────────────────────────────────────────────────────
  const [currentStyle, setCurrentStyle] = useState("Normal");
  const [allStyles, setAllStyles] = useState<string[]>(styles);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => { setAllStyles(styles); }, [styles]);

  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const update = () => {
      if (editor.isActive("heading")) {
        setCurrentStyle(editor.getAttributes("heading").styleLabel || "H1");
      } else if (editor.isActive("paragraph")) {
        setCurrentStyle(editor.getAttributes("paragraph").styleLabel || "Normal");
      } else {
        setCurrentStyle("Normal");
      }
    };
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    update();
    return () => { editor.off("selectionUpdate", update); editor.off("update", update); };
  }, [editorRef]);

  const applyStyle = (styleName: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const checkedNodes = getCheckedNodesList();
    if (checkedNodes.length > 0) {
      let chain = editor.chain().focus();
      const headingMap: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
      const level = headingMap[styleName];

      const sortedNodes = [...checkedNodes].sort((a, b) => b.pos - a.pos);
      sortedNodes.forEach((node) => {
        if (node.type === "sdtInline") return;
        
        chain = chain.setTextSelection({ from: node.pos, to: node.pos });
        if (level) {
          chain = chain.setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
            .updateAttributes("heading", { styleLabel: styleName });
        } else {
          const $pos = editor.state.doc.resolve(node.pos);
          const isHeading = $pos.parent && $pos.parent.type.name === "heading";
          if (isHeading) {
            chain = chain.setParagraph();
          }
          chain = chain.updateAttributes("paragraph", { styleLabel: styleName });
        }
      });
      chain.run();
      setCheckedIds(new Set());
    } else {
      const headingMap: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
      const level = headingMap[styleName];
      let chain = editor.chain().focus();
      if (level) {
        chain = chain.setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
          .updateAttributes("heading", { styleLabel: styleName });
      } else {
        if (editor.isActive("heading")) chain = chain.setParagraph();
        chain = chain.updateAttributes("paragraph", { styleLabel: styleName });
      }
      chain.run();
    }
    onAddStyle?.(styleName);
  };

  const filteredStyles = allStyles.filter((s) =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ── Character tab ─────────────────────────────────────────────────────────
  const [activeCharStyle, setActiveCharStyle] = useState<string | null>(null);

  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const update = () => {
      const attrs = editor.getAttributes("charStyle");
      setActiveCharStyle((attrs?.class as string) || null);
    };
    editor.on("selectionUpdate", update);
    update();
    return () => { editor.off("selectionUpdate", update); };
  }, [editorRef]);

  // Group char styles from API into logical categories, or fall back to defaults
  const charStyleGroups = charStyles && charStyles.length > 0
    ? [
        { group: "Formatting", styles: charStyles.filter(s => /^[a-z]+$/.test(s)) },
        { group: "Bibliography", styles: charStyles.filter(s => s.startsWith("bib_")) },
        { group: "Citation", styles: charStyles.filter(s => s.startsWith("cite_")) },
        { group: "Caption", styles: charStyles.filter(s => !/^[a-z]+$/.test(s) && !s.startsWith("bib_") && !s.startsWith("cite_")) },
      ].filter(g => g.styles.length > 0)
    : DEFAULT_CHAR_STYLES;

  const applyCharStyle = (cls: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const checkedNodes = getCheckedNodesList();
    if (checkedNodes.length > 0) {
      let chain = editor.chain().focus();
      const sortedNodes = [...checkedNodes].sort((a, b) => b.pos - a.pos);

      sortedNodes.forEach((node) => {
        const from = node.pos;
        const to = node.pos + node.nodeSize;
        chain = chain.setTextSelection({ from, to }).toggleMark("charStyle", { class: cls });
      });
      chain.run();
      setCheckedIds(new Set());
    } else {
      editor.chain().focus().toggleMark("charStyle", { class: cls }).run();
    }
  };

  // ── Group tab (Scanning & Bulk Actions) ───────────────────────────────────
  const [scannedTree, setScannedTree] = useState<ScannedElement[]>([]);
  const [flatNodes, setFlatNodes] = useState<ScannedElement[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isRunningPipeline, setIsRunningPipeline] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [showWrapModal, setShowWrapModal] = useState(false);
  const [wrapAlias, setWrapAlias] = useState("");
  const [wrapTag, setWrapTag] = useState("");
  const [wrapType, setWrapType] = useState<"block" | "inline">("block");
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getCheckedNodesList = (): ScannedElement[] => {
    return flatNodes.filter(n => checkedIds.has(n.id));
  };

  const handleToggleChecked = (el: ScannedElement, checked: boolean) => {
    const newChecked = new Set(checkedIds);

    const toggleNodeAndChildren = (node: ScannedElement) => {
      if (checked) {
        newChecked.add(node.id);
      } else {
        newChecked.delete(node.id);
      }
      if (node.children) {
        node.children.forEach(toggleNodeAndChildren);
      }
      if (node.inlineSdts) {
        node.inlineSdts.forEach(toggleNodeAndChildren);
      }
    };

    toggleNodeAndChildren(el);
    setCheckedIds(newChecked);
  };

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const scanDocument = useCallback(() => {
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => {
      const editor = editorRef.current?.editor;
      if (!editor) return;

      const targets: { pos: number; end: number; node: PmNode; type: string; markAttrs?: any }[] = [];
      const flat: ScannedElement[] = [];

      let lastInlineSdtKey = "";
      editor.state.doc.descendants((node: PmNode, pos: number) => {
        const type = node.type.name;

        if (["sdtBlock", "table", "bulletList", "orderedList", "blockquote", "paragraph", "heading"].includes(type)) {
          targets.push({ pos, end: pos + node.nodeSize, node, type });
        }

        node.marks.forEach((mark: PmMark) => {
          if (mark.type.name === "sdtInline") {
            const key = `${mark.attrs.alias}-${pos}`;
            if (key !== lastInlineSdtKey) {
              targets.push({
                pos,
                end: pos + node.nodeSize,
                node,
                type: "sdtInline",
                markAttrs: mark.attrs
              });
              lastInlineSdtKey = key;
            }
          }
        });
      });

      targets.sort((a, b) => {
        if (a.pos !== b.pos) return a.pos - b.pos;
        return (b.end - b.pos) - (a.end - a.pos);
      });

      const rootElements: ScannedElement[] = [];

      targets.forEach((t) => {
        let id = `${t.type}-${t.pos}`;
        let name = "";
        let styleLabel: string | undefined;
        let preview: string | undefined;

        if (t.type === "sdtBlock") {
          name = `Block SDT: ${t.node.attrs.alias || "unnamed"}`;
        } else if (t.type === "sdtInline") {
          name = `Inline SDT: ${t.markAttrs?.alias || "unnamed"}`;
          id = `sdtInline-${t.pos}`;
        } else if (t.type === "table") {
          name = "Table";
        } else if (t.type === "bulletList") {
          name = "Bullet List";
        } else if (t.type === "orderedList") {
          name = "Numbered List";
        } else if (t.type === "blockquote") {
          name = "Blockquote";
        } else if (t.type === "heading") {
          styleLabel = t.node.attrs.styleLabel || `H${t.node.attrs.level}`;
          name = `Heading (${styleLabel})`;
        } else if (t.type === "paragraph") {
          styleLabel = t.node.attrs.styleLabel || "Normal";
          name = `Paragraph (${styleLabel})`;
        }

        if (t.type === "paragraph" || t.type === "heading") {
          const words = (t.node.textContent || "").split(/\s+/).filter(Boolean);
          if (words.length === 0) {
            preview = "";
          } else {
            const first = words.slice(0, 6).join(" ");
            preview = words.length > 6 ? first + "…" : first;
          }
        }

        const el: ScannedElement = {
          id,
          type: t.type as any,
          name,
          styleLabel,
          preview,
          pos: t.pos,
          nodeSize: t.end - t.pos,
          checked: false
        };

        flat.push(el);

        let parent: ScannedElement | null = null;
        
        const checkParent = (candidate: ScannedElement): ScannedElement | null => {
          if (candidate.pos <= el.pos && el.pos + el.nodeSize <= candidate.pos + candidate.nodeSize && candidate.id !== el.id) {
            if (candidate.children) {
              for (const child of candidate.children) {
                const sub = checkParent(child);
                if (sub) return sub;
              }
            }
            if (candidate.inlineSdts) {
              for (const child of candidate.inlineSdts) {
                const sub = checkParent(child);
                if (sub) return sub;
              }
            }
            return candidate;
          }
          return null;
        };

        for (let i = rootElements.length - 1; i >= 0; i--) {
          const found = checkParent(rootElements[i]);
          if (found) {
            parent = found;
            break;
          }
        }

        if (parent) {
          if (el.type === "sdtInline") {
            if (!parent.inlineSdts) parent.inlineSdts = [];
            parent.inlineSdts.push(el);
          } else {
            if (!parent.children) parent.children = [];
            parent.children.push(el);
          }
        } else {
          rootElements.push(el);
        }
      });

      setScannedTree(rootElements);
      setFlatNodes(flat);
    }, 200);
  }, [editorRef]);

  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    editor.on("update", scanDocument);
    scanDocument();
    return () => { editor.off("update", scanDocument); };
  }, [editorRef, scanDocument]);

  const handleRunPipeline = async () => {
    const editor = editorRef.current?.editor;
    if (!editor || !fileId) return;
    setIsRunningPipeline(true);
    setPipelineError(null);
    try {
      const res = await fetch(`/api/v1/files/${fileId}/structuring/run-pipeline`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, string>;
        throw new Error(err.detail || `Pipeline failed (${res.status})`);
      }
      const data = await res.json() as { content?: string };
      if (data.content) {
        editor.commands.setContent(data.content);
        scanDocument();
      }
    } catch (e) {
      setPipelineError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRunningPipeline(false);
    }
  };

  const handleWrap = () => {
    const editor = editorRef.current?.editor;
    if (!editor || !wrapAlias.trim()) return;
    if (wrapType === "block") {
      editor.chain().focus().wrapInSdtBlock(wrapAlias.trim(), wrapTag.trim()).run();
    } else {
      editor.chain().focus().toggleSdtInline(wrapAlias.trim(), wrapTag.trim()).run();
    }
    setShowWrapModal(false);
    setWrapAlias("");
    setWrapTag("");
    setWrapType("block");
  };

  const scrollToElement = (el: ScannedElement) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    try {
      const dom = editor.view.nodeDOM(el.pos) as HTMLElement | null;
      if (!dom || !(dom instanceof HTMLElement)) {
        editor.commands.setTextSelection(el.pos);
        editor.commands.scrollIntoView();
        return;
      }
      dom.scrollIntoView({ behavior: "smooth", block: "center" });

      // After the smooth-scroll settles, flash *just the first word*. We
      // overlay a transparent positioned div on top — no edits to the editor's
      // own DOM, so ProseMirror's view state stays untouched.
      window.setTimeout(() => {
        const firstText = findFirstTextNode(dom);
        if (!firstText) return;
        const text = firstText.nodeValue || "";
        const match = text.match(/^(\s*)(\S+)/);
        if (!match) return;
        const start = match[1].length;
        const end = start + match[2].length;

        let rect: DOMRect;
        try {
          const range = document.createRange();
          range.setStart(firstText, start);
          range.setEnd(firstText, end);
          rect = range.getBoundingClientRect();
          range.detach?.();
        } catch {
          return;
        }
        if (rect.width === 0 && rect.height === 0) return;

        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.left = `${rect.left - 2}px`;
        overlay.style.top = `${rect.top - 2}px`;
        overlay.style.width = `${rect.width + 4}px`;
        overlay.style.height = `${rect.height + 4}px`;
        overlay.style.backgroundColor = "rgba(254, 215, 170, 0.7)";
        overlay.style.outline = "2px solid #f97316";
        overlay.style.borderRadius = "3px";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "9999";
        overlay.style.transition = "opacity 0.4s ease";
        document.body.appendChild(overlay);

        window.setTimeout(() => {
          overlay.style.opacity = "0";
          window.setTimeout(() => overlay.remove(), 420);
        }, 800);
      }, 380);
    } catch {
      /* scroll/flash is best-effort */
    }
  };

  const findFirstTextNode = (root: Node): Text | null => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      if ((node.nodeValue || "").trim().length > 0) return node;
      node = walker.nextNode() as Text | null;
    }
    return null;
  };

  const renderTreeNode = (el: ScannedElement, depth = 0) => {
    const isExpanded = expandedIds.has(el.id);
    const hasChildren = (el.children && el.children.length > 0) || (el.inlineSdts && el.inlineSdts.length > 0);
    const isChecked = checkedIds.has(el.id);
    const isOutlineRow = (el.type === "paragraph" || el.type === "heading") && (el.preview !== undefined);

    return (
      <div key={el.id} className="flex flex-col">
        <div
          className="flex items-center gap-1.5 py-1 px-1.5 hover:bg-slate-50 rounded transition-colors text-xs select-none"
          style={{ paddingLeft: `${Math.max(4, depth * 12)}px` }}
        >
          <button
            onClick={() => toggleExpanded(el.id)}
            className={`p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 border-none bg-transparent cursor-pointer shrink-0 w-4.5 h-4.5 flex items-center justify-center
              ${hasChildren ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => handleToggleChecked(el, e.target.checked)}
            className="w-3.5 h-3.5 border-slate-300 rounded text-primary focus:ring-primary cursor-pointer shrink-0"
          />

          {isOutlineRow ? (
            <button
              type="button"
              onClick={() => scrollToElement(el)}
              className="flex-1 min-w-0 text-left inline-flex items-baseline gap-1.5 truncate cursor-pointer border-none bg-transparent p-0 hover:text-sky-700"
              title={`${el.styleLabel} – ${el.preview || "(empty)"}`}
            >
              <span className="font-bold text-amber-700 font-mono text-[10px] shrink-0">
                {el.styleLabel}
              </span>
              <span className="text-slate-400">–</span>
              <span className="font-normal text-slate-700 truncate text-[11px]">
                {el.preview || <span className="italic text-slate-400">(empty)</span>}
              </span>
            </button>
          ) : (
            <span className="font-medium text-slate-700 truncate flex-1 font-mono text-[10px]" title={el.name}>
              {el.name}
            </span>
          )}
        </div>

        {hasChildren && isExpanded && (
          <div className="flex flex-col">
            {el.children && el.children.map(child => renderTreeNode(child, depth + 1))}
            {el.inlineSdts && el.inlineSdts.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-lg shadow-card border border-border flex h-full min-h-0">

      {/* ── Left Sidebar Vertical Icon Tabs Row ────────────────────────────── */}
      {allowedTabs.length > 1 && (
      <div className="flex flex-col border-r border-border bg-slate-900 w-14 shrink-0 py-3 gap-2 items-center">
        {(["group", "paragraph", "character"] as PanelTab[]).filter(t => allowedTabs.includes(t)).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              title={tab.toUpperCase()}
              className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center transition-all cursor-pointer border-none bg-transparent gap-0.5
                ${isActive
                  ? "text-amber-500 bg-slate-800/80 font-bold shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"}`}
            >
              {tab === "paragraph" ? (
                <>
                  <FileText className="w-4 h-4" />
                  <span className="text-[7.5px] uppercase tracking-wide">Para</span>
                </>
              ) : tab === "character" ? (
                <>
                  <BookOpen className="w-4 h-4" />
                  <span className="text-[7.5px] uppercase tracking-wide">Char</span>
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4" />
                  <span className="text-[7.5px] uppercase tracking-wide">Group</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      )}

      {/* ── Right Content Panel ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 bg-white">

        {/* ── Paragraph Tab ──────────────────────────────────────────────────── */}
        {activeTab === "paragraph" && (
          <>
            <div className="px-3 py-2 border-b border-border bg-sidebar/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted">Current:</span>
                <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[10px] font-semibold">
                  {currentStyle}
                </span>
              </div>
              {checkedIds.size > 0 && (
                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-900 rounded text-[8px] font-semibold">
                  Bulk apply active
                </span>
              )}
            </div>

            <div className="px-3 py-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted" />
                <input
                  type="text"
                  placeholder="Search or add style..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && searchQuery.trim()) {
                      const clean = searchQuery.trim();
                      const matched = filteredStyles.find(
                        (s) => s.toLowerCase() === clean.toLowerCase()
                      );
                      if (matched) {
                        applyStyle(matched);
                      } else {
                        if (!allStyles.includes(clean)) setAllStyles((prev) => [...prev, clean].sort());
                        applyStyle(clean);
                      }
                      setSearchQuery("");
                    }
                  }}
                  className="w-full pl-8 pr-7 py-1.5 text-xs border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary bg-white text-text font-medium"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-2 p-0.5 hover:bg-slate-100 rounded text-muted hover:text-text cursor-pointer border-none bg-transparent"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto styles-scrollbar pr-1 p-3 space-y-2">
              {searchQuery && !allStyles.some((s) => s.toLowerCase() === searchQuery.toLowerCase().trim()) && (
                <button
                  onClick={() => {
                    const clean = searchQuery.trim();
                    if (clean) {
                      if (!allStyles.includes(clean)) setAllStyles((prev) => [...prev, clean].sort());
                      applyStyle(clean);
                      setSearchQuery("");
                    }
                  }}
                  className="w-full text-left px-3 py-2.5 bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Create & Apply "{searchQuery.trim()}"</span>
                </button>
              )}
              {filteredStyles.length === 0 ? (
                <div className="text-center py-6 text-muted text-xs">
                  {searchQuery ? "No matching styles found" : "No styles available"}
                </div>
              ) : (
                filteredStyles.map((style) => (
                  <button
                    key={style}
                    onClick={() => applyStyle(style)}
                    className={`group w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-all border relative cursor-pointer
                      ${currentStyle === style
                        ? "bg-emerald-100 border-emerald-400 text-emerald-900 ring-2 ring-emerald-300"
                        : "bg-background border-border text-text hover:bg-sidebar/5 hover:border-border"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <span className="font-mono text-[10px] uppercase tracking-wide">
                          <HighlightedText text={style} highlight={searchQuery} />
                        </span>
                        <p className="text-[10px] text-muted mt-0.5">
                          {style === "Normal" || style === "Body Text"
                            ? "Regular paragraph"
                            : style.startsWith("H")
                              ? `Heading ${style.substring(1)}`
                              : "Custom style"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        {currentStyle === style && (
                          <span className="w-2 h-2 rounded-full bg-emerald-600" />
                        )}
                        {currentStyle !== style && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 bg-text/10 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            Apply
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-border p-3">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="w-3 h-3" />}
                className="w-full text-[11px]"
                onClick={() => setIsDialogOpen(true)}
              >
                New Style
              </Button>
            </div>

            <NewStyleDialog
              isOpen={isDialogOpen}
              onClose={() => setIsDialogOpen(false)}
              onAdd={(styleName) => {
                if (!allStyles.includes(styleName)) setAllStyles([...allStyles, styleName]);
                applyStyle(styleName);
              }}
            />
          </>
        )}

        {/* ── Character Tab ──────────────────────────────────────────────────── */}
        {activeTab === "character" && (
          <>
            <div className="px-3 py-2 border-b border-border bg-sidebar/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted">Active:</span>
                {activeCharStyle ? (
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 border border-indigo-300 rounded text-[10px] font-mono font-semibold truncate max-w-[140px]">
                    {activeCharStyle}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted italic">none</span>
                )}
              </div>
              {checkedIds.size > 0 && (
                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-900 rounded text-[8px] font-semibold">
                  Bulk apply active
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto styles-scrollbar p-3 space-y-3">
              {charStyleGroups.map(({ group, styles: groupStyles }) => (
                <div key={group}>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted mb-1.5 px-1">
                    {group}
                  </p>
                  <div className="space-y-1">
                    {groupStyles.map((cls) => (
                      <button
                        key={cls}
                        onClick={() => applyCharStyle(cls)}
                        className={`w-full text-left px-3 py-1.5 rounded-md text-[11px] font-mono border transition-all cursor-pointer
                          flex items-center justify-between
                          ${activeCharStyle === cls
                            ? "bg-emerald-100 border-emerald-400 text-emerald-900 ring-2 ring-emerald-300"
                            : "bg-background border-border text-text hover:bg-sidebar/5"}`}
                      >
                        <span>{cls}</span>
                        {activeCharStyle === cls && (
                          <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {activeCharStyle && (
              <div className="border-t border-border p-3">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full text-[11px] border-rose-200 text-rose-700 hover:bg-rose-50"
                  onClick={() => {
                    editorRef.current?.editor?.chain().focus().unsetMark("charStyle").run();
                  }}
                >
                  Remove Character Style
                </Button>
              </div>
            )}
          </>
        )}

        {/* ── Group Tab ──────────────────────────────────────────────────────── */}
        {activeTab === "group" && (
          <>
            <div className="px-3 pt-3 pb-1 border-b border-border bg-slate-50 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
                Document Elements ({flatNodes.length})
              </p>
              {checkedIds.size > 0 && (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[9px] font-semibold">
                  {checkedIds.size} checked
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto styles-scrollbar p-3 space-y-1">
              {scannedTree.length === 0 ? (
                <p className="text-xs text-muted text-center py-4 italic">
                  No elements detected in document
                </p>
              ) : (
                scannedTree.map(el => renderTreeNode(el, 0))
              )}
            </div>

            <div className="border-t border-border p-3 space-y-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="w-3 h-3" />}
                className="w-full text-[11px]"
                onClick={() => setShowWrapModal(true)}
              >
                Wrap Selection
              </Button>

              <Button
                variant="primary"
                size="sm"
                leftIcon={
                  isRunningPipeline ? (
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )
                }
                className="w-full text-[11px]"
                onClick={handleRunPipeline}
                disabled={isRunningPipeline || !fileId}
                title={!fileId ? "No file selected" : undefined}
              >
                {isRunningPipeline ? "Running Pipeline…" : "Run Pipeline"}
              </Button>

              {pipelineError && (
                <p className="text-[10px] text-rose-600 px-1 break-words">{pipelineError}</p>
              )}
            </div>
          </>
        )}

      </div>

      {/* ── Wrap Selection Modal ──────────────────────────────────────────── */}
      {showWrapModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowWrapModal(false); }}
        >
          <div className="bg-white rounded-lg shadow-xl p-5 w-72 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">Wrap Selection in SDT</h2>
              <button
                onClick={() => setShowWrapModal(false)}
                className="text-muted hover:text-text border-none bg-transparent cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-text block mb-1">Type</label>
                <div className="flex gap-2">
                  {(["block", "inline"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setWrapType(t)}
                      className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold border transition-all cursor-pointer
                        ${wrapType === t
                          ? "bg-primary text-white border-primary"
                          : "bg-white text-text border-border hover:bg-sidebar/5"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-text block mb-1">Alias</label>
                <input
                  value={wrapAlias}
                  onChange={(e) => setWrapAlias(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleWrap(); }}
                  placeholder="e.g. TableGroup"
                  className="w-full px-3 py-1.5 border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-text block mb-1">Tag</label>
                <input
                  value={wrapTag}
                  onChange={(e) => setWrapTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleWrap(); }}
                  placeholder="e.g. TableGroup"
                  className="w-full px-3 py-1.5 border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => setShowWrapModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="flex-1"
                disabled={!wrapAlias.trim()}
                onClick={handleWrap}
              >
                Wrap
              </Button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .styles-scrollbar::-webkit-scrollbar { width: 5px; }
        .styles-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .styles-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .styles-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
}
