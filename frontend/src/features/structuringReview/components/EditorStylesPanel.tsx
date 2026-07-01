import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { BookOpen, Plus, Search, X, Play, FileText, ChevronDown, ChevronRight, Folder, Tag, Layers, Table2, Check, Loader2, CircleAlert, GripVertical } from "lucide-react";
import type { Node as PmNode, Mark as PmMark } from "@tiptap/pm/model";
import type { WysiwygEditorHandle } from "@/features/editor";
import { NewStyleDialog } from "./NewStyleDialog";

// ── Pipeline progress types ───────────────────────────────────────────────────

type StepStatus = "pending" | "running" | "ok" | "skip" | "fail";

interface PipelineStepState {
  n: number;
  title: string;
  status: StepStatus;
  detail?: string;
  startedAt?: number;
  durationMs?: number;
}

const PIPELINE_STEPS: { n: number; title: string }[] = [
  { n: 0,  title: "Preconversion" },
  { n: 1,  title: "Cleanup" },
  { n: 2,  title: "Remove Unused Styles" },
  { n: 3,  title: "Remove Bold" },
  { n: 4,  title: "Heading Validation" },
  { n: 5,  title: "Text Flush" },
  { n: 6,  title: "Remove Tags" },
  { n: 7,  title: "Character Styles" },
  { n: 8,  title: "Content Controls" },
  { n: 9,  title: "Symbol & Math" },
  { n: 10, title: "Math Symbol Styles" },
];

function initialPipelineSteps(): PipelineStepState[] {
  return PIPELINE_STEPS.map(s => ({ ...s, status: "pending" as StepStatus }));
}

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
  depth?: number;
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
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStepState[]>(() => initialPipelineSteps());
  const [pipelineDone, setPipelineDone] = useState(false);
  const [showWrapModal, setShowWrapModal] = useState(false);
  const [wrapAlias, setWrapAlias] = useState("");
  const [wrapTag, setWrapTag] = useState("");
  const [wrapType, setWrapType] = useState<"block" | "inline">("block");
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Drag & drop group reordering ──────────────────────────────────────────
  // Dragging a style-group header onto another rearranges only the display
  // order of groups inside the Document Elements panel. The document itself
  // (paragraphs, headings, their content and position) is never touched.
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null);
  const [groupDragOver, setGroupDragOver] = useState<{ label: string; pos: "before" | "after" } | null>(null);
  const [groupOrder, setGroupOrder] = useState<string[]>([]);

  const reorderGroup = (source: string, target: string, where: "before" | "after") => {
    if (source === target) return;
    const currentLabels = groupedNodes.map(g => g.label);
    setGroupOrder(prev => {
      const base = prev.filter(l => currentLabels.includes(l));
      for (const l of currentLabels) {
        if (!base.includes(l)) base.push(l);
      }
      const srcIdx = base.indexOf(source);
      if (srcIdx === -1) return prev;
      base.splice(srcIdx, 1);
      let tgtIdx = base.indexOf(target);
      if (tgtIdx === -1) { base.push(source); return base; }
      if (where === "after") tgtIdx += 1;
      base.splice(tgtIdx, 0, source);
      return base;
    });
  };

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

        {
          const text = (t.node.textContent || "").trim();
          const words = text.split(/\s+/).filter(Boolean);
          if (words.length === 0) {
            preview = "";
          } else {
            const first = words.slice(0, 6).join(" ");
            preview = words.length > 6 ? first + "…" : first;
          }
        }

        let nodeDepth = 0;
        try { nodeDepth = editor.state.doc.resolve(t.pos).depth; } catch { nodeDepth = 0; }

        const el: ScannedElement = {
          id,
          type: t.type as any,
          name,
          styleLabel,
          preview,
          pos: t.pos,
          nodeSize: t.end - t.pos,
          checked: false,
          depth: nodeDepth,
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
    let cancelled = false;
    let pollHandle: number | undefined;
    let attachedEditor: any = null;

    const attach = () => {
      if (cancelled) return;
      const editor = editorRef.current?.editor;
      if (!editor) {
        pollHandle = window.setTimeout(attach, 120);
        return;
      }
      attachedEditor = editor;
      editor.on("update", scanDocument);
      scanDocument();
    };

    attach();

    return () => {
      cancelled = true;
      if (pollHandle !== undefined) window.clearTimeout(pollHandle);
      if (attachedEditor) {
        attachedEditor.off("update", scanDocument);
      }
    };
  }, [editorRef, scanDocument]);

  const handleRunPipeline = async () => {
    const editor = editorRef.current?.editor;
    if (!editor || !fileId) return;
    setIsRunningPipeline(true);
    setPipelineError(null);
    setPipelineSteps(initialPipelineSteps());
    setPipelineDone(false);

    // Minimum visible time each step spends in "Processing…" before the UI
    // applies its completion status, plus a tiny gap before the next step's
    // "start" event is applied. Backend keeps running at full speed — these
    // numbers only smooth the UI transitions.
    const MIN_RUNNING_MS = 600;
    const MIN_GAP_MS = 100;
    const sleep = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));

    type Event =
      | { type: "step"; step: number; status: "start" | "ok" | "skip" | "fail"; reason?: string; error?: string }
      | { type: "summary"; status: "ok" | "error" }
      | { type: "result"; status: "ok"; content?: string; file_id?: number }
      | { type: "result"; status: "error"; error?: string };

    const queue: Event[] = [];
    let streamDone = false;
    const startAppliedAt = new Map<number, number>();
    let finalContent: string | undefined;
    let finalError: string | undefined;

    const processor = (async () => {
      while (true) {
        if (queue.length === 0) {
          if (streamDone) break;
          await sleep(40);
          continue;
        }
        const ev = queue.shift()!;
        if (ev.type === "step") {
          if (ev.status === "start") {
            const now = performance.now();
            startAppliedAt.set(ev.step, now);
            setPipelineSteps(prev =>
              prev.map(s =>
                s.n === ev.step
                  ? { ...s, status: "running", startedAt: now, durationMs: undefined, detail: undefined }
                  : s
              )
            );
          } else {
            const startedAt = startAppliedAt.get(ev.step) ?? performance.now();
            const elapsed = performance.now() - startedAt;
            const remaining = MIN_RUNNING_MS - elapsed;
            if (remaining > 0) await sleep(remaining);
            const dur = performance.now() - startedAt;
            const finalStatus: StepStatus =
              ev.status === "ok" ? "ok" : ev.status === "skip" ? "skip" : "fail";
            setPipelineSteps(prev =>
              prev.map(s =>
                s.n === ev.step
                  ? { ...s, status: finalStatus, durationMs: dur, detail: ev.reason ?? ev.error }
                  : s
              )
            );
            await sleep(MIN_GAP_MS);
          }
        } else if (ev.type === "result") {
          if (ev.status === "ok" && typeof ev.content === "string") {
            finalContent = ev.content;
          } else if (ev.status === "error") {
            finalError = ev.error || "Pipeline failed";
          }
        }
        // summary events drive the header in the overlay; no extra state needed.
      }

      if (finalError) {
        setPipelineError(finalError);
        setPipelineSteps(prev =>
          prev.map(s => (s.status === "running" ? { ...s, status: "fail" as StepStatus } : s))
        );
      } else if (finalContent) {
        editor.commands.setContent(finalContent);
        scanDocument();
      }
      setIsRunningPipeline(false);
      setPipelineDone(true);
    })();

    try {
      const res = await fetch(`/api/v1/files/${fileId}/structuring/run-pipeline`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/x-ndjson" },
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({})) as Record<string, string>;
        throw new Error(err.detail || `Pipeline failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            queue.push(JSON.parse(line) as Event);
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (e) {
      queue.push({
        type: "result",
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      streamDone = true;
      await processor;
    }
  };

  const dismissPipelineOverlay = () => {
    setPipelineDone(false);
    setPipelineError(null);
    setPipelineSteps(initialPipelineSteps());
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
        overlay.style.backgroundColor = "rgba(191, 219, 254, 0.7)";
        overlay.style.outline = "2px solid #3b82f6";
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

  const groupLabelFor = (el: ScannedElement): string => {
    switch (el.type) {
      case "heading":
      case "paragraph":
        return el.styleLabel || (el.type === "heading" ? "Heading" : "Normal");
      case "table": return "Table";
      case "bulletList": return "Bullet List";
      case "orderedList": return "Numbered List";
      case "blockquote": return "Blockquote";
      case "sdtBlock": {
        const after = el.name.replace(/^Block SDT:\s*/, "").trim();
        return after && after !== "unnamed" ? after : "Block SDT";
      }
      case "sdtInline": {
        const after = el.name.replace(/^Inline SDT:\s*/, "").trim();
        return after && after !== "unnamed" ? after : "Inline SDT";
      }
      default: return el.name;
    }
  };

  const groupedNodes = useMemo(() => {
    const map = new Map<string, ScannedElement[]>();
    for (const n of flatNodes) {
      const key = groupLabelFor(n);
      let arr = map.get(key);
      if (!arr) { arr = []; map.set(key, arr); }
      arr.push(n);
    }
    // Merge the user-defined groupOrder with scan-order for any labels the
    // user hasn't touched yet. Existing user ordering wins; new labels append.
    const scanOrder = Array.from(map.keys());
    const seen = new Set<string>();
    const finalOrder: string[] = [];
    for (const label of groupOrder) {
      if (map.has(label) && !seen.has(label)) {
        finalOrder.push(label);
        seen.add(label);
      }
    }
    for (const label of scanOrder) {
      if (!seen.has(label)) {
        finalOrder.push(label);
        seen.add(label);
      }
    }
    return finalOrder.map(label => ({ label, items: map.get(label) || [] }));
  }, [flatNodes, groupOrder]);

  const renderGroup = ({ label, items }: { label: string; items: ScannedElement[] }) => {
    const groupKey = `group:${label}`;
    const isExpanded = expandedIds.has(groupKey);
    const isDraggingGroup = draggedGroup === label;
    const showTopMarker = groupDragOver?.label === label && groupDragOver.pos === "before";
    const showBottomMarker = groupDragOver?.label === label && groupDragOver.pos === "after";
    return (
      <div key={groupKey} className="flex flex-col">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", label); } catch { /* ignore */ }
            setDraggedGroup(label);
          }}
          onDragEnd={() => {
            setDraggedGroup(null);
            setGroupDragOver(null);
          }}
          onDragOver={(e) => {
            if (!draggedGroup || draggedGroup === label) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = (e.clientY - rect.top) < rect.height / 2 ? "before" : "after";
            if (!groupDragOver || groupDragOver.label !== label || groupDragOver.pos !== pos) {
              setGroupDragOver({ label, pos });
            }
          }}
          onDragLeave={(e) => {
            const next = e.relatedTarget as Node | null;
            if (!next || !e.currentTarget.contains(next)) {
              if (groupDragOver?.label === label) setGroupDragOver(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const src = draggedGroup;
            const over = groupDragOver;
            setDraggedGroup(null);
            setGroupDragOver(null);
            if (src && over && over.label === label) {
              reorderGroup(src, label, over.pos);
            }
          }}
          onClick={() => toggleExpanded(groupKey)}
          className={`relative flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-slate-50 text-xs select-none cursor-grab active:cursor-grabbing border-none bg-transparent text-left
            ${isDraggingGroup ? "opacity-40" : ""}`}
        >
          {showTopMarker && (
            <div className="absolute left-0 right-0 -top-px h-0.5 bg-blue-500 rounded-full pointer-events-none" />
          )}
          {showBottomMarker && (
            <div className="absolute left-0 right-0 -bottom-px h-0.5 bg-blue-500 rounded-full pointer-events-none" />
          )}
          <GripVertical className="w-3 h-3 text-slate-300 shrink-0" aria-hidden />
          {isExpanded
            ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
          <span className="font-bold text-blue-700 font-mono text-[11px] shrink-0">{label}</span>
          <span className="text-slate-400 text-[10px]">({items.length})</span>
        </button>
        {isExpanded && (
          <div className="flex flex-col pl-5">
            {items.map(el => {
              const isChecked = checkedIds.has(el.id);
              return (
                <div
                  key={el.id}
                  className="relative flex items-center gap-1.5 py-0.5 px-1.5 hover:bg-slate-50 rounded text-xs select-none"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => handleToggleChecked(el, e.target.checked)}
                    className="w-3.5 h-3.5 border-slate-300 rounded text-primary focus:ring-primary cursor-pointer shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() => scrollToElement(el)}
                    className="flex-1 min-w-0 text-left truncate cursor-pointer border-none bg-transparent p-0 text-[11px] text-slate-700 hover:text-blue-700"
                    title={el.preview || el.name}
                  >
                    {el.preview
                      ? el.preview
                      : <span className="italic text-slate-400">(empty)</span>}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
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

            <div className="flex-1 overflow-y-auto styles-scrollbar p-3 space-y-0.5">
              {groupedNodes.length === 0 ? (
                <p className="text-xs text-muted text-center py-4 italic">
                  No elements detected in document
                </p>
              ) : (
                groupedNodes.map(renderGroup)
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

      {(isRunningPipeline || pipelineDone) && typeof document !== "undefined" && createPortal(
        <PipelineProgressOverlay
          steps={pipelineSteps}
          running={isRunningPipeline}
          error={pipelineError}
          onDismiss={dismissPipelineOverlay}
        />,
        document.body
      )}
    </div>
  );
}

// ── Pipeline progress overlay ─────────────────────────────────────────────────

function formatDuration(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function PipelineProgressOverlay({
  steps,
  running,
  error,
  onDismiss,
}: {
  steps: PipelineStepState[];
  running: boolean;
  error: string | null;
  onDismiss: () => void;
}) {
  const total = steps.length;
  const completedCount = steps.filter(s => s.status === "ok" || s.status === "skip").length;
  const failedCount = steps.filter(s => s.status === "fail").length;
  const percent = Math.round(((completedCount + failedCount) / total) * 100);
  const currentStep = steps.find(s => s.status === "running");
  const lastCompleted = [...steps].reverse().find(s => s.status === "ok" || s.status === "skip");
  const headerStep = currentStep ?? lastCompleted;

  const headerTitle = running
    ? headerStep
      ? `Running Step ${headerStep.n + 1} of ${total} — ${headerStep.title}`
      : "Starting pipeline…"
    : error
    ? "Pipeline failed"
    : "Pipeline completed successfully.";

  // Brand colors: #1B5C9E (blue) → #F5822A (orange). The gradient is used for
  // both the in-progress and completed states; failures fall back to rose so
  // the error remains visually distinct.
  const barStyle: React.CSSProperties = error
    ? { backgroundColor: "#e11d48" }
    : { backgroundImage: "linear-gradient(90deg, #1B5C9E 0%, #F5822A 100%)" };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pipeline progress"
      className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (running) e.preventDefault(); }}
    >
      <div className="w-[460px] max-w-[92vw] bg-white rounded-lg shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            {running ? (
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#1B5C9E" }} />
            ) : error ? (
              <CircleAlert className="w-5 h-5 text-rose-600" />
            ) : (
              <Check className="w-5 h-5 text-emerald-600" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">
                {headerTitle}
              </div>
              <div className="text-[11px] text-slate-500">
                {completedCount}/{total} steps · {percent}%
                {running ? " — please don't close this window" : ""}
              </div>
            </div>
          </div>

          <div className="mt-3 h-2 w-full rounded bg-slate-100 overflow-hidden">
            <div
              className="h-full transition-[width] duration-200 ease-out"
              style={{ width: `${percent}%`, ...barStyle }}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              role="progressbar"
            />
          </div>
        </div>

        <ul className="max-h-[60vh] overflow-y-auto styles-scrollbar divide-y divide-slate-100">
          {steps.map(s => (
            <li
              key={s.n}
              className={`px-5 py-2.5 flex items-center gap-3 ${
                s.status === "fail" ? "bg-rose-50" : ""
              }`}
              style={
                s.status === "ok"
                  ? { animation: "pipeline-step-complete 0.5s ease-out 1 both" }
                  : s.status === "fail"
                  ? { animation: "pipeline-step-fail 0.5s ease-out 1 both" }
                  : undefined
              }
            >
              <StepIcon status={s.status} />
              <div className="flex-1 min-w-0">
                <div className={`text-[12px] truncate ${
                  s.status === "fail" ? "text-rose-700 font-semibold" : "text-slate-700"
                }`}>
                  Step {s.n} — {s.title}
                </div>
                {s.detail ? (
                  <div className={`text-[10px] truncate ${
                    s.status === "fail" ? "text-rose-600" : "text-slate-500"
                  }`}>
                    {s.detail}
                  </div>
                ) : s.status === "ok" && s.durationMs != null ? (
                  <div className="text-[10px] text-slate-500">
                    Completed in {formatDuration(s.durationMs)}
                  </div>
                ) : s.status === "skip" && s.durationMs != null ? (
                  <div className="text-[10px] text-amber-700">
                    Skipped after {formatDuration(s.durationMs)}
                  </div>
                ) : s.status === "running" ? (
                  <div className="text-[10px]" style={{ color: "#1B5C9E" }}>Processing…</div>
                ) : null}
              </div>
              <StepBadge status={s.status} />
            </li>
          ))}
        </ul>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
          {error && (
            <div className="flex-1 text-[11px] text-rose-700 truncate" title={error}>
              {error}
            </div>
          )}
          {!running && (
            <Button variant="primary" size="sm" onClick={onDismiss}>
              Close
            </Button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pipeline-step-complete {
          0%   { background-color: rgba(16,185,129,0.22); }
          100% { background-color: transparent; }
        }
        @keyframes pipeline-step-fail {
          0%   { background-color: rgba(244,63,94,0.30); }
          100% { background-color: rgb(255,241,242); }
        }
        @keyframes pipeline-icon-pop {
          0%   { transform: scale(0.6); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  const popStyle = { animation: "pipeline-icon-pop 0.32s ease-out 1 both" };
  if (status === "running") return <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#1B5C9E" }} />;
  if (status === "ok")      return <Check     className="w-4 h-4 text-emerald-600" style={popStyle} />;
  if (status === "skip")    return <span      className="w-4 h-4 inline-block text-amber-600 text-[14px] leading-none" style={popStyle}>⏭</span>;
  if (status === "fail")    return <CircleAlert className="w-4 h-4 text-rose-600" style={popStyle} />;
  return <span className="w-4 h-4 rounded-full border border-slate-300 inline-block" />;
}

function StepBadge({ status }: { status: StepStatus }) {
  const map: Record<StepStatus, { label: string; cls: string; style?: React.CSSProperties }> = {
    pending: { label: "Pending",     cls: "bg-slate-100 text-slate-500" },
    running: {
      label: "Processing…",
      cls: "",
      style: { backgroundColor: "rgba(27,92,158,0.12)", color: "#1B5C9E" },
    },
    ok:      { label: "Completed",   cls: "bg-emerald-100 text-emerald-700" },
    skip:    { label: "Skipped",     cls: "bg-amber-100 text-amber-800" },
    fail:    { label: "Failed",      cls: "bg-rose-100 text-rose-700" },
  };
  const cur = map[status];
  return (
    <span
      className={`text-[9.5px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${cur.cls}`}
      style={cur.style}
    >
      {cur.label}
    </span>
  );
}
