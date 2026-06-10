import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  Info,
  Maximize2,
  Minimize2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Trash2,
  Check,
  Hash,
  Sparkles,
  Layers,
  Search,
  Eye,
  EyeOff,
  CornerDownRight,
  User,
  Calendar,
  AlignLeft,
  Terminal,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { uiPaths } from "@/utils/appPaths";
import { WysiwygEditor, type WysiwygEditorHandle, ChangesReviewPanel } from "@/features/editor";
import { useSessionStore } from "@/stores/sessionStore";
import { useReferenceReviewQuery } from "@/features/referenceReview/useReferenceReviewQuery";
import { useReferenceSave } from "@/features/referenceReview/useReferenceSave";
import { useReferenceValidateOnly } from "@/features/referenceReview/useReferenceValidateOnly";
import { LinkingPanel, type LinkingSource, MissingReferencesTab } from "@/features/citationLinking";
import { getApiErrorMessage } from "@/api/client";

const CHAR_STYLE_COLOURS: Record<string, string> = {
  bib_alt_year: "#d8b4fe", bib_article: "#bae6fd", bib_base: "#e5e7eb",
  bib_book: "#93c5fd", bib_chapterno: "#e5e7eb", bib_chaptertitle: "#fdba74",
  bib_comment: "#c7d2fe", bib_confacronym: "#f472b6", bib_confdate: "#2dd4bf",
  bib_conference: "#60a5fa", bib_conflocation: "#f87171", bib_confpaper: "#86efac",
  bib_confproceedings: "#fbbf24", bib_day: "#fef08a", bib_deg: "#e5e7eb",
  bib_doi: "#fef08a", bib_ed_etal: "#22d3ee", bib_ed_fname: "#fef08a",
  bib_editionno: "#facc15", bib_ed_organization: "#fbcfe8", bib_ed_suffix: "#a7f3d0",
  bib_ed_surname: "#facc15", bib_etal: "#bef264", bib_extlink: "#5eead4",
  bib_fname: "#fef9c3", bib_fpage: "#fef9c3", bib_institution: "#d1fae5",
  bib_isbn: "#f3f4f6", bib_issue: "#bfdbfe", bib_journal: "#ffedd5",
  bib_location: "#fecdd3", bib_lpage: "#e5e7eb", bib_medline: "#bae6fd",
  bib_month: "#bef264", bib_number: "#c084fc", bib_organization: "#d1fae5",
  bib_pagecount: "#22c55e", bib_papernumber: "#fef08a", bib_patent: "#38bdf8",
  bib_publisher: "#f472b6", bib_reportnum: "#818cf8", bib_school: "#fb923c",
  bib_season: "#ea580c", bib_series: "#ffedd5", bib_seriesno: "#fef08a",
  bib_suffix: "#e5e7eb", bib_suppl: "#fef9c3", bib_surname: "#bef264",
  bib_title: "#fbcfe8", bib_trans: "#bef264", bib_unpubl: "#e5e7eb",
  bib_url: "#d9f99d", bib_volcount: "#22c55e", bib_volume: "#bae6fd",
  bib_year: "#e9d5ff",
  cite_app: "#bef264", cite_base: "#e5e7eb", cite_bib: "#cffafe",
  cite_box: "#e5e7eb", cite_eq: "#fdba74", cite_fig: "#bbf7d0",
  cite_fn: "#fbcfe8", cite_sec: "#fecdd3", cite_tbl: "#fca5a5",
  cite_tfn: "#fed7aa",
};

export function ReferenceValidationReviewPage() {
  const navigate = useNavigate();
  const { projectId, chapterId, fileId } = useParams();
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const parsedChapterId = Number.parseInt(chapterId ?? "", 10);
  const parsedFileId = Number.parseInt(fileId ?? "", 10);

  const normalizedProjectId =
    Number.isInteger(parsedProjectId) && parsedProjectId > 0 ? parsedProjectId : null;
  const normalizedChapterId =
    Number.isInteger(parsedChapterId) && parsedChapterId > 0 ? parsedChapterId : null;
  const normalizedFileId =
    Number.isInteger(parsedFileId) && parsedFileId > 0 ? parsedFileId : null;

  const editorRef = useRef<WysiwygEditorHandle>(null);
  const [styleOverride, setStyleOverride] = useState<"AUTO" | "AMA" | "APA">("AUTO");
  const reviewQuery = useReferenceReviewQuery(normalizedFileId, styleOverride === "AUTO" ? undefined : styleOverride);
  const saveMutation = useReferenceSave(normalizedFileId);
  const validateOnlyMutation = useReferenceValidateOnly(normalizedFileId ?? 0);

  // Tab
  const [activeTab, setActiveTab] = useState<"citations" | "structuring" | "logs" | "trackedChanges" | "issues" | "missing">("citations");
  const viewer = useSessionStore((s) => s.viewer);

  // Tab 1 — Citations
  const [expandedCitationIdx, setExpandedCitationIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [citationFilter, setCitationFilter] = useState<"all" | "ok" | "missing" | "unused">("all");
  const [styleManagerOpen, setStyleManagerOpen] = useState(false);

  // Tab 2 — Structuring
  const [refFilter, setRefFilter] = useState("");
  const [showUncitedOnly, setShowUncitedOnly] = useState(false);
  const [editingEntryIdx, setEditingEntryIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  // Tab 3 — Logs
  const [logViewMode, setLogViewMode] = useState<"dashboard" | "raw">("dashboard");

  // Phase 2 — Citation Linking
  const [linkingSource, setLinkingSource] = useState<LinkingSource | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false);
  const [selectedCitationText, setSelectedCitationText] = useState<string | null>(null);
  const [isRefetching, setIsRefetching] = useState(false);
  const [lastValidatedAt, setLastValidatedAt] = useState<Date | null>(null);
  const [localValidationLogs, setLocalValidationLogs] = useState<any>(null);
  const [localCitationPairs, setLocalCitationPairs] = useState<any[] | null>(null);
  const [activeCitationIdx, setActiveCitationIdx] = useState<number | null>(null);
  const rescanTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Hidden styles filter state
  const [hiddenStyles, setHiddenStyles] = useState<string[]>([]);
  const [styleFilterQuery, setStyleFilterQuery] = useState("");

  // Highlight active style under cursor
  const [activeStyleUnderCursor, setActiveStyleUnderCursor] = useState<string | null>(null);

  // Listen to cursor updates in editor
  const editorInstance = editorRef.current?.editor;
  useEffect(() => {
    if (!editorInstance) return;

    const handleSelectionUpdate = () => {
      const charStyleAttrs = editorInstance.getAttributes("charStyle");
      if (charStyleAttrs && charStyleAttrs.class) {
        setActiveStyleUnderCursor(charStyleAttrs.class);

        // If cursor is on cite_bib, highlight matching citation card in sidebar
        if (charStyleAttrs.class === "cite_bib") {
          const { from } = editorInstance.state.selection;
          const resolvedNode = editorInstance.state.doc.nodeAt(from);
          const citText = resolvedNode?.text?.trim();
          if (citText) {
            const pairs = localCitationPairs ?? reviewQuery.data?.validation_logs?.citation_pairs ?? [];
            const idx = pairs.findIndex(
              (p: any) =>
                p.citation?.trim() === citText ||
                `[${p.citation?.trim()}]` === citText
            );
            if (idx >= 0) {
              setActiveCitationIdx(idx);
              // Auto-scroll sidebar to the matching card
              setTimeout(() => {
                document
                  .getElementById(`citation-card-${idx}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }, 50);
            } else {
              setActiveCitationIdx(null);
            }
          }
        } else {
          setActiveCitationIdx(null);
        }
      } else {
        setActiveStyleUnderCursor(null);
        setActiveCitationIdx(null);
      }
    };

    editorInstance.on("selectionUpdate", handleSelectionUpdate);
    editorInstance.on("update", handleSelectionUpdate);

    return () => {
      editorInstance.off("selectionUpdate", handleSelectionUpdate);
      editorInstance.off("update", handleSelectionUpdate);
    };
  }, [editorInstance]);

  // Compute stats on paragraph styles inside the HTML content
  const styleStats = useMemo(() => {
    if (!reviewQuery.data?.content) return {};
    const html = reviewQuery.data.content;
    const stats: Record<string, number> = {};

    // Simple regex scanner for style classes
    const classRegex = /class="([^"]+)"/g;
    let match;
    while ((match = classRegex.exec(html)) !== null) {
      const classes = match[1].split(" ");
      classes.forEach((c) => {
        if (c.startsWith("bib_") || c.startsWith("cite_")) {
          stats[c] = (stats[c] || 0) + 1;
        }
      });
    }
    return stats;
  }, [reviewQuery.data?.content]);

  const detectedStyle = styleOverride === "AUTO"
    ? (reviewQuery.data?.validation_logs?.detected_style ?? "AMA")
    : styleOverride;

  // Hover highlighting in editor for citations
  const highlightInEditor = (text: string | null, isHover: boolean) => {
    if (!text) return;
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const clean = (s: string) => s.replace(/[\[\]()\s,.-]/g, "").toLowerCase();
    const targetClean = clean(text);
    if (!targetClean) return;

    const spans = editor.view.dom.querySelectorAll('span.cite_bib, [class*="cite_bib"]');
    spans.forEach((span: any) => {
      const spanText = clean(span.textContent || "");
      if (spanText === targetClean || spanText.includes(targetClean) || targetClean.includes(spanText)) {
        if (isHover) {
          span.classList.add("flash-highlight");
          span.style.outline = "2px solid #C9821A";
          span.style.boxShadow = "0 0 8px #C9821A";
          span.style.borderRadius = "2px";
          span.style.transition = "all 0.15s ease";
        } else {
          span.classList.remove("flash-highlight");
          span.style.outline = "";
          span.style.boxShadow = "";
          span.style.borderRadius = "";
        }
      }
    });
  };

  // Hover highlighting in editor for references
  const highlightRefInEditor = (paraIdx: number, isHover: boolean) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const el = editor.view.dom.querySelector(`[data-para-idx="${paraIdx}"]`) as HTMLElement;
    if (el) {
      if (isHover) {
        el.style.backgroundColor = "rgba(251, 191, 36, 0.15)";
        el.style.borderLeft = "3px solid #C9821A";
        el.style.paddingLeft = "8px";
        el.style.transition = "all 0.2s ease";
      } else {
        el.style.backgroundColor = "";
        el.style.borderLeft = "";
        el.style.paddingLeft = "";
      }
      return;
    }

    const paragraphs = editor.view.dom.querySelectorAll('p, h1, h2, h3, h4, h5, h6');
    const targetEl = paragraphs[paraIdx] as HTMLElement;
    if (targetEl) {
      if (isHover) {
        targetEl.style.backgroundColor = "rgba(251, 191, 36, 0.15)";
        targetEl.style.borderLeft = "3px solid #C9821A";
        targetEl.style.paddingLeft = "8px";
        targetEl.style.transition = "all 0.2s ease";
      } else {
        targetEl.style.backgroundColor = "";
        targetEl.style.borderLeft = "";
        targetEl.style.paddingLeft = "";
      }
    }
  };

  // Direct paragraph style application
  const applyStyleToPara = (paraIdx: number, newStyle: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    let targetPos = -1;
    let count = 0;
    
    editor.state.doc.descendants((node: any, pos: number) => {
      if (targetPos !== -1) return false;
      if (isTextBlock(node)) {
        if (count === paraIdx) {
          targetPos = pos;
          return false;
        }
        count++;
      }
      return true;
    });

    if (targetPos !== -1) {
      const headingMap: Record<string, number> = {
        "H1": 1, "H2": 2, "H3": 3, "H4": 4, "H5": 5, "H6": 6,
      };
      const headingLevel = headingMap[newStyle];
      
      editor.chain()
        .focus()
        .setTextSelection(targetPos + 1)
        .run();

      let chain = editor.chain();
      if (headingLevel) {
        chain = chain
          .setHeading({ level: headingLevel as any })
          .updateAttributes("heading", { styleLabel: newStyle });
      } else {
        const label = (newStyle === "Normal" || newStyle === "Body Text") ? "Normal" : newStyle;
        if (editor.isActive("heading")) {
          chain = chain.setParagraph();
        }
        chain = chain.updateAttributes("paragraph", { styleLabel: label });
      }
      chain.run();
    }
  };

  // Direct paragraph text replacement
  const updateParaText = (paraIdx: number, newText: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    let targetPos = -1;
    let targetEnd = -1;
    let count = 0;
    
    editor.state.doc.descendants((node: any, pos: number) => {
      if (targetPos !== -1) return false;
      if (isTextBlock(node)) {
        if (count === paraIdx) {
          targetPos = pos;
          targetEnd = pos + node.nodeSize;
          return false;
        }
        count++;
      }
      return true;
    });

    if (targetPos !== -1 && targetEnd !== -1) {
      editor.chain()
        .focus()
        .deleteRange(targetPos + 1, targetEnd - 1)
        .insertContentAt(targetPos + 1, newText)
        .run();
    }
  };

  // Structured bibliography parser
  const parseRefText = (text: string) => {
    if (!text) return null;
    const doiMatch = text.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
    const doi = doiMatch ? doiMatch[0] : null;

    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : null;

    let title = "";
    let journal = "";
    
    if (text.includes("). ")) {
      const parts = text.split("). ");
      if (parts[1]) {
        const titleAndJournal = parts[1].split(". ");
        title = titleAndJournal[0] || "";
        journal = titleAndJournal.slice(1).join(". ") || "";
      }
    } else {
      title = text.slice(0, 100) + "...";
    }

    return { doi, year, title, journal };
  };

  // Log report dynamic parser
  const parseLogText = useCallback((rawLog: string) => {
    if (!rawLog) return null;

    const lines = rawLog.split("\n");
    const stats: Record<string, string> = {};
    const items: Array<{ category: string; para?: number; message: string; id?: string; from?: string; to?: string; status?: string; type?: string }> = [];
    let currentCategory = "";

    const isConversionLog = rawLog.includes("--- CONVERSION ---") || rawLog.includes("Reference Conversion Log");

    if (isConversionLog) {
      let currentItem: any = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const itemHeaderMatch = line.match(/^\[(\d+)\]$/);
        
        if (itemHeaderMatch) {
          if (currentItem) {
            items.push(currentItem);
          }
          currentItem = { id: itemHeaderMatch[1], category: "Conversions", message: "" };
          continue;
        }

        if (!currentItem) {
          if (line.includes("Total references found:") || line.includes("Successfully converted:") || line.includes("Errors:")) {
            const parts = line.split(":");
            if (parts[0] && parts[1]) {
              stats[parts[0].trim()] = parts[1].trim();
            }
          }
          continue;
        }

        if (line.startsWith("TYPE:")) {
          currentItem.type = line.replace("TYPE:", "").trim();
        } else if (line.startsWith("FROM:")) {
          currentItem.from = line.replace("FROM:", "").trim();
        } else if (line.startsWith("TO:")) {
          currentItem.to = line.replace("TO:", "").trim();
          currentItem.status = currentItem.to.includes("[FAILED]") ? "error" : "success";
        } else if (line.startsWith("NOTES:")) {
          currentItem.message = line.replace("NOTES:", "").trim();
        } else if (line.startsWith("ERROR:")) {
          currentItem.message = line.replace("ERROR:", "").trim();
          currentItem.status = "error";
        }
      }
      if (currentItem) {
        items.push(currentItem);
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.match(/^[A-Z\s👥🏢🔤&]+$/) && lines[i + 1] && lines[i + 1].trim().startsWith("----")) {
          currentCategory = line.trim();
          i++; 
          continue;
        }

        if (line.includes(":") && (currentCategory === "" || line.startsWith("Total ") || line.startsWith("Matched "))) {
          const parts = line.split(":");
          if (parts[0] && parts[1] && parts[0].trim().length < 40) {
            stats[parts[0].trim()] = parts[1].trim();
            continue;
          }
        }

        const paraMatch = line.match(/^Para\s+(\d+):\s*(.*)$/);
        if (paraMatch) {
          items.push({
            category: currentCategory || "General Issues",
            para: parseInt(paraMatch[1], 10),
            message: paraMatch[2].trim(),
          });
        } else if (!line.startsWith("Step ") && !line.startsWith("Result:") && !line.startsWith("Before Stats:") && !line.startsWith("===") && !line.startsWith("---")) {
          if (currentCategory && line.length > 8) {
            items.push({
              category: currentCategory,
              message: line,
            });
          }
        }
      }
    }

    return { isConversionLog, stats, items };
  }, []);

  const review = reviewQuery.data;
  // Effective logs: local override takes precedence after validation
  const logs = localValidationLogs ?? review?.validation_logs;

  // Effective citation pairs: local override after editor edits takes precedence
  const citationPairs = localCitationPairs ?? (logs?.citation_pairs ?? []);

  // Derived stats for sidebar header
  const matchedCount = citationPairs.filter((p: any) => p.status === "ok").length;
  const issueCount = citationPairs.filter((p: any) => p.status !== "ok").length;

  // Scan for cite_bib spans and update citation pair status in real-time
  const rescanCitationLinks = useCallback(() => {
    const editor = editorRef.current?.editor;
    if (!editor || !logs?.reference_entries) return;

    const html = editor.getHTML();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const citeBibSpans = doc.querySelectorAll('span.cite_bib, [class*="cite_bib"]');

    // Build a set of citation texts currently present in editor
    const editorCitations = new Set<string>();
    citeBibSpans.forEach((span) => {
      editorCitations.add(span.textContent?.trim() ?? "");
    });

    // Rebuild citation_pairs: for each pair, check if the citation text exists in editor
    const base = logs?.citation_pairs ?? [];
    const updated = base.map((pair: any) => {
      const citationText = pair.citation?.trim();
      if (!citationText) return pair;

      if (detectedStyle === "AMA") {
        // AMA: match bare number or [N]
        const num = citationText.replace(/[\[\]]/g, "").trim();
        const found = [...editorCitations].some(
          (t) =>
            t === num ||
            t === `[${num}]` ||
            t.replace(/[\[\]]/g, "") === num
        );
        return { ...pair, status: found ? "ok" : "missing" };
      } else {
        // APA: match (Author, Year) substring
        const found = [...editorCitations].some((t) =>
          t
            .toLowerCase()
            .includes(
              citationText
                .toLowerCase()
                .replace(/[()]/g, "")
                .trim()
            )
        );
        return { ...pair, status: found ? "ok" : "missing" };
      }
    });

    setLocalCitationPairs(updated);
  }, [logs, detectedStyle]);

  // Wire rescan to editor updates
  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const handleUpdate = () => {
      clearTimeout(rescanTimerRef.current);
      rescanTimerRef.current = setTimeout(rescanCitationLinks, 400);
    };

    editor.on("update", handleUpdate);

    return () => {
      editor.off("update", handleUpdate);
      clearTimeout(rescanTimerRef.current);
    };
  }, [rescanCitationLinks]);

  // Clear local citation pairs when validation logs change (after Validate click)
  useEffect(() => {
    if (localValidationLogs) {
      setLocalCitationPairs(null);
    }
  }, [localValidationLogs]);

  // Escape key to exit fullscreen
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isFullscreen]);


  // ── Route Params Verification ─────────────────────────────────────────────
  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Invalid reference review route"
            description="The selected project, chapter, or file identifier is not valid."
          />
          <Link to={uiPaths.projects}>
            <Button variant="primary">Back to Projects</Button>
          </Link>
        </div>
      </main>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (reviewQuery.isPending) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="h-14 skeleton-shimmer rounded-md" aria-hidden="true" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (reviewQuery.isError) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Reference Review Loading Failed"
            description={getApiErrorMessage(
              reviewQuery.error,
              "Could not load reference validation review workspace."
            )}
          />
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" onClick={() => void reviewQuery.refetch()}>
              Try Again
            </Button>
            <Link to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
              <Button variant="secondary">Back to Chapter</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!review) return null;

  // Toggle style visibility
  const toggleStyleVisibility = (styleName: string) => {
    setHiddenStyles((prev) =>
      prev.includes(styleName) ? prev.filter((s) => s !== styleName) : [...prev, styleName]
    );
  };

  const toggleAllStylesVisibility = (visible: boolean) => {
    if (visible) {
      setHiddenStyles([]);
    } else {
      setHiddenStyles(review.styles);
    }
  };

  // Scroll a block element into view and flash it for visual feedback
  const flashBlock = (el: HTMLElement | null) => {
    if (!el || !el.scrollIntoView) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("para-flash");
    setTimeout(() => el.classList.remove("para-flash"), 1200);
  };

  // Is this node a top-level text block we navigate to?
  const isTextBlock = (node: any) =>
    node.isBlock && (node.type.name === "paragraph" || node.type.name.startsWith("heading"));

  // Navigate to document paragraph using data-para-idx attribute, then text, then index.
  const navigateToDocPara = (paraIdx: number, highlight?: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    // 1. Direct DOM query using the data attribute (if the exporter emitted it)
    const el = editor.view.dom.querySelector(`[data-para-idx="${paraIdx}"]`) as HTMLElement;
    if (el) {
      editor.commands.setTextSelection(editor.view.posAtDOM(el, 0));
      flashBlock(el);
      return;
    }

    // 2. Block-aware text search (handles references split across many char-style spans)
    if (highlight && navigateByText(editor, highlight)) return;

    // 3. Index-based fallback: select the Nth text block in document order
    if (paraIdx >= 0) {
      let count = 0;
      let targetPos = -1;
      editor.state.doc.descendants((node: any, pos: number) => {
        if (targetPos !== -1) return false;
        if (isTextBlock(node)) {
          if (count === paraIdx) {
            targetPos = pos;
            return false;
          }
          count++;
        }
        return true;
      });
      if (targetPos !== -1) {
        editor.commands.setTextSelection(targetPos + 1);
        flashBlock(editor.view.nodeDOM(targetPos) as HTMLElement | null);
      }
    }
  };

  // Block-aware text search: matches against each block's combined text so that
  // references fragmented across bib_*/cite_* spans still resolve. Returns true on hit.
  const navigateByText = (editor: any, searchTerm: string): boolean => {
    if (!editor) return false;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const needle = norm(searchTerm);
    if (!needle) return false;

    let targetPos = -1;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (targetPos !== -1) return false;
      if (isTextBlock(node)) {
        const blockText = norm(node.textContent || "");
        if (
          blockText &&
          (blockText.includes(needle) ||
            (needle.length > 12 && blockText.length > 12 && needle.includes(blockText)))
        ) {
          targetPos = pos;
          return false;
        }
      }
      return true;
    });

    if (targetPos === -1) return false;
    editor.commands.setTextSelection(targetPos + 1);
    flashBlock(editor.view.nodeDOM(targetPos) as HTMLElement | null);
    return true;
  };

  // Navigate to the in-text citation matching the citation text (e.g., "[1]" or "(Author, Year)")
  const navigateToCitation = (citationText: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    // Normalizations for matching: remove brackets, parentheses, spaces, commas, periods, hyphens
    const cleanStr = (s: string) => s.replace(/[\[\]()\s,.-]/g, "").toLowerCase();
    const targetClean = cleanStr(citationText);
    if (!targetClean) return;

    let resolvedPos = -1;
    let resolvedLength = 0;

    // Pass 1 (precise): a text node carrying the cite_bib character style that
    // matches exactly. Exact-only here avoids "1" landing inside "12".
    editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node: any, pos: number) => {
      if (resolvedPos !== -1) return false;
      if (node.isText) {
        const hasCiteBib = node.marks?.some(
          (m: any) => m.type.name === "charStyle" && m.attrs?.class === "cite_bib"
        );
        if (hasCiteBib && cleanStr(node.text || "") === targetClean) {
          resolvedPos = pos;
          resolvedLength = (node.text || "").length;
          return false;
        }
      }
    });

    // Pass 2 (block-aware): search each block's combined text. Numeric citations
    // use a word-boundary token regex (matches "1", "[1]", "(1)") so unmarked
    // numbers resolve to the first in-text occurrence rather than a stray digit.
    if (resolvedPos === -1) {
      const isNumeric = /^\d+$/.test(targetClean);
      const tokenRe = isNumeric ? new RegExp(`[\\[(]?\\b${targetClean}\\b[\\])]?`) : null;
      editor.state.doc.descendants((node: any, pos: number) => {
        if (resolvedPos !== -1) return false;
        if (isTextBlock(node)) {
          const text = node.textContent || "";
          if (tokenRe) {
            const m = tokenRe.exec(text);
            if (m && m.index !== undefined) {
              resolvedPos = pos + 1 + m.index;
              resolvedLength = m[0].length;
              return false;
            }
          } else {
            const idx = text.toLowerCase().indexOf(citationText.toLowerCase());
            if (idx !== -1) {
              resolvedPos = pos + 1 + idx;
              resolvedLength = citationText.length;
              return false;
            }
          }
        }
        return true;
      });
    }

    if (resolvedPos !== -1) {
      editor.commands.setTextSelection({ from: resolvedPos, to: resolvedPos + Math.max(1, resolvedLength) });
      try {
        const domPos = editor.view.domAtPos(resolvedPos);
        const parentEl = (domPos.node.nodeType === Node.TEXT_NODE
          ? domPos.node.parentElement
          : (domPos.node as Element)) as HTMLElement | null;
        flashBlock(parentEl);
      } catch {
        /* ignore */
      }
    }
  };

  // Apply character style command
  const applyCharStyle = (styleClass: string | null) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    if (!styleClass || styleClass === "CLEAR") {
      editor.commands.unsetMark("charStyle");
    } else {
      editor.commands.setMark("charStyle", { class: styleClass });
    }
  };

  // Apply cite_bib style to a citation after successful linking
  const applyCiteBibStyle = (citationText: string, linkId: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    // Find the citation in the document
    const { doc, state } = editor.state;
    let found = false;

    doc.nodesBetween(0, doc.content.size, (node: any, pos: number) => {
      if (found) return false;

      if (node.isText && node.text?.includes(citationText)) {
        const startOffset = node.text.indexOf(citationText);
        const startPos = pos + startOffset;
        const endPos = startPos + citationText.length;

        // Apply cite_bib style
        editor.chain()
          .focus()
          .setSelection(startPos, endPos)
          .setMark("charStyle", { class: `cite_bib_${linkId}` })
          .run();

        found = true;
        return false;
      }
    });
  };



  // Quick Fix: Year mismatch correction (text matches bibliography)
  const quickFixYear = (paraIdx: number, message: string, correctYear: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    // Find the paragraph text at given index
    let paraPos = -1;
    let idxCounter = 0;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === "paragraph" || node.type.name.startsWith("heading")) {
        if (idxCounter === paraIdx) {
          paraPos = pos;
          return false;
        }
        idxCounter++;
      }
    });

    if (paraPos !== -1) {
      // Find the year inside that paragraph's text content and replace it
      const $pos = editor.state.doc.resolve(paraPos);
      const nodeText = $pos.nodeAfter?.textContent || "";
      // Extract numeric 4 digit year
      const yearMatch = nodeText.match(/\b\d{4}[a-z]?\b/);
      if (yearMatch) {
        const yearIndex = nodeText.indexOf(yearMatch[0]);
        const startPos = paraPos + 1 + yearIndex;
        editor.commands.setTextSelection({ from: startPos, to: startPos + yearMatch[0].length });

        // Tracked insertion/deletion if TC is ON
        editor.commands.insertContent(correctYear);
      }
    }
  };

  // Quick action: Add bibliography placeholder
  const addBibliographyPlaceholder = (missingCitation: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const citationText = missingCitation.replace(/[\[\]()]/g, "").trim();
    const cleanName = citationText.split(",")[0] || citationText;
    const cleanYear = citationText.match(/\b\d{4}\b/)?.[0] || "2026";

    const placeholderHTML = `<p class="Normal" data-style-label="Normal"><span class="bib_surname">${cleanName}</span>, <span class="bib_fname">F. M.</span> (<span class="bib_year">${cleanYear}</span>). <span class="bib_title">Title of the article</span>. <span class="bib_journal">Journal Name</span>, <span class="bib_volume">10</span>(<span class="bib_issue">2</span>), <span class="bib_fpage">100</span>–<span class="bib_lpage">110</span>. <span class="bib_doi">https://doi.org/10.1000/xyz123</span></p>`;

    // Insert at the end of document
    const docSize = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: docSize - 1, to: docSize - 1 });
    editor.commands.insertContent(placeholderHTML);

    setTimeout(() => {
      const scrollPos = editor.state.doc.content.size - 5;
      const dom = editor.view.domAtPos(scrollPos);
      const el = dom.node.nodeType === Node.TEXT_NODE ? dom.node.parentElement : (dom.node as Element);
      el?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 100);
  };

  // Merge duplicate references
  const mergeDuplicateReferences = (dup: typeof logs.duplicates[0]) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const num1 = dup.num1;
    const num2 = dup.num2;

    if (num1 === undefined || num2 === undefined) return;

    // 1. Replace all citations matching num2 with num1
    // We scan paragraphs for inline <span class="cite_bib">num2</span>
    // For numerical validation, we will perform a text search & replace in the editor
    const htmlContent = editor.getHTML();

    // Create regexp that matches the specific reference tag
    const searchString = `<span class="cite_bib">${num2}</span>`;
    const replacementString = `<span class="cite_bib">${num1}</span>`;

    let updatedHtml = htmlContent;
    // Replace citations
    updatedHtml = updatedHtml.replaceAll(searchString, replacementString);

    // 2. Remove the second duplicate paragraph from the bibliography
    // We can parse the document blocks, find the paragraph styled as Reference or normal starting with the number, and delete it.
    const parser = new DOMParser();
    const doc = parser.parseFromString(updatedHtml, "text/html");
    const paragraphs = Array.from(doc.querySelectorAll("p"));

    paragraphs.forEach((p) => {
      const text = p.textContent?.trim() || "";
      if (text.startsWith(`[${num2}]`) || text.startsWith(`${num2}.`)) {
        p.remove();
      }
    });

    editor.commands.setContent(doc.body.innerHTML);
  };

  // Reorder / sort bibliography alphabetically (APA style)
  const sortBibliographyAlphabetically = () => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const htmlContent = editor.getHTML();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");
    const paragraphs = Array.from(doc.querySelectorAll("p"));

    // Filter reference paragraphs (often containing bib_* classes or inside reference section)
    const refParas = paragraphs.filter((p) => {
      return p.querySelector('span[class^="bib_"]') !== null;
    });

    if (refParas.length <= 1) return;

    // Sort based on text content (author name)
    const sortedRefParas = [...refParas].sort((a, b) => {
      const textA = a.textContent?.trim().toLowerCase() || "";
      const textB = b.textContent?.trim().toLowerCase() || "";
      return textA.localeCompare(textB);
    });

    // Re-insert sorted paragraphs back to doc in order
    const parent = refParas[0].parentNode;
    if (parent) {
      const insertBeforeNode = refParas[0];
      sortedRefParas.forEach((node) => {
        parent.insertBefore(node, insertBeforeNode);
      });
    }

    editor.commands.setContent(doc.body.innerHTML);
  };

  // Filtered list of character styles for style manager
  const filteredStyles = review.styles.filter((s) =>
    s.toLowerCase().includes(styleFilterQuery.toLowerCase())
  );

  const referenceEntries = logs.reference_entries || [];

  const filteredCitationPairs = citationPairs.filter((pair: any) => {
    if (citationFilter === "all") return true;
    return pair.status === citationFilter;
  });

  const filteredEntries = referenceEntries.filter((entry: any) => {
    const matchesSearch = entry.text.toLowerCase().includes(refFilter.toLowerCase());
    if (showUncitedOnly) return matchesSearch && !entry.is_cited;
    return matchesSearch;
  });

  return (
    <main className={`page-enter min-h-screen bg-surface-100 flex flex-col ${isFullscreen ? "p-2" : "p-6"}`}>
      {isFullscreen && (
        <button
          onClick={() => setIsFullscreen(false)}
          className="fixed top-3 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-navy-900/90 hover:bg-navy-800 text-white text-[11px] font-bold rounded-lg shadow-lg backdrop-blur-sm border border-navy-700/60 transition-all"
          title="Exit Fullscreen (Esc)"
        >
          <Minimize2 className="w-3.5 h-3.5" />
          Exit Fullscreen
        </button>
      )}
      <div className={`w-full flex-1 flex flex-col ${isFullscreen ? "max-w-none px-0" : "max-w-[1650px] mx-auto px-2 space-y-6"}`}>

        {/* Style Overlay injection filter */}
        <style>{`
          ${hiddenStyles
            .map(
              (s) => `
            .ProseMirror span.${s} {
              background-color: transparent !important;
              box-shadow: none !important;
            }
          `
            )
            .join("\n")}
            
          .flash-highlight {
            animation: temp-glow 1.5s ease-out;
          }

          @keyframes temp-glow {
            0% {
              outline: 2px solid #ef4444;
              box-shadow: 0 0 12px #ef4444;
              background-color: rgba(239, 68, 68, 0.2) !important;
            }
            100% {
              outline: 2px solid transparent;
              box-shadow: 0 0 0px transparent;
            }
          }

          .para-flash {
            animation: para-flash-anim 1.2s ease-out;
          }

          @keyframes para-flash-anim {
            0% {
              background-color: rgba(251, 191, 36, 0.35);
            }
            100% {
              background-color: transparent;
            }
          }
        `}</style>

        {/* Page Header */}
        {!isFullscreen && (
          <PageHeader
            breadcrumb={
              <span className="flex items-center gap-1.5 text-sm text-navy-400">
                <Link className="hover:text-navy-700 transition-colors" to={uiPaths.projects}>
                  Projects
                </Link>
                <span>/</span>
                <Link
                  className="hover:text-navy-700 transition-colors"
                  to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}
                >
                  Chapter
                </Link>
                <span>/</span>
                <span className="text-navy-700">Reference Validation Workspace</span>
              </span>
            }
            title="Reference Validation & Styling Review"
            subtitle={review.file.filename}
            secondaryActions={[
              <a key="export" href={review.export_href} className="no-underline" download>
                <Button variant="secondary" leftIcon={<Download className="w-4 h-4" />}>
                  Export Final DOCX
                </Button>
              </a>,
              <Button
                key="fullscreen"
                variant="secondary"
                leftIcon={<Maximize2 className="w-4 h-4" />}
                onClick={() => setIsFullscreen(true)}
              >
                Fullscreen
              </Button>,
              <Button
                key="back"
                variant="secondary"
                leftIcon={<ArrowLeft />}
                onClick={() => navigate(-1)}
              >
                Back
              </Button>,
            ]}
          />
        )}

        {/* Status / feedback banners */}
        {saveMutation.statusMessage && (
          <div className="px-4 py-3 rounded-lg text-sm font-semibold border bg-success-50 border-success-200 text-success-700 flex items-center gap-2 shadow-sm animate-pulse">
            <CheckCircle2 className="w-4 h-4 text-success-600" />
            {saveMutation.statusMessage}
          </div>
        )}
        {saveMutation.errorMessage && (
          <div className="px-4 py-3 rounded-lg text-sm font-semibold border bg-error-50 border-error-200 text-error-700 flex items-center gap-2 shadow-sm">
            <AlertCircle className="w-4 h-4 text-error-600" />
            {saveMutation.errorMessage}
          </div>
        )}

        {/* Two-Column split workspace */}
        <div
          className="flex gap-6 overflow-hidden min-h-0"
          style={{ height: isFullscreen ? "calc(100vh - 20px)" : "calc(100vh - 260px)" }}
        >

          <div className="flex-[2] flex flex-col bg-white rounded-xl shadow-card border border-navy-100 overflow-hidden min-h-0 min-w-0">
            {/* WYSIWYG Editor wrapper */}
            <div className="flex-1 min-h-0 bg-white">
              <WysiwygEditor
                ref={editorRef}
                key={`ref-editor-${normalizedFileId}-${review.file.version}`}
                initialContent={review.content}
                onSave={async (html) => {
                  await saveMutation.save(review.save_endpoint, html);
                }}
                isSaving={saveMutation.isPending}
                saveLabel="Save Reference Changes"
                documentTitle={review.file.filename}
                exportHref={review.export_href}
                trackChangesEnabled={trackChangesEnabled}
                onTrackChangesToggle={setTrackChangesEnabled}
                height="100%"
                styles={review.styles}
                charStyles={review.styles}
                onActiveCharStyleChange={setActiveStyleUnderCursor}
                currentUser={viewer?.username}
                fileId={normalizedFileId?.toString()}
              />
            </div>
          </div>

          {/* Right Panel: Three-Tab Sidebar */}
          <div className="w-[380px] shrink-0 flex flex-col bg-white rounded-xl shadow-card border border-navy-100 overflow-hidden min-h-0">

            {/* Sidebar Header - 3 rows */}
            <div className="px-4 pt-3 pb-2 bg-surface-50 border-b border-navy-100">
              {/* Row 1: File info + style badge */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-3.5 h-3.5 text-navy-500 shrink-0" />
                  <span className="text-[11px] font-semibold text-navy-800 truncate max-w-[180px]" title={review.file.filename}>
                    {review.file.filename}
                  </span>
                  <span className="text-[9px] text-navy-400 bg-surface-200 px-1.5 py-0.5 rounded font-mono shrink-0">
                    v{review.file.version}
                  </span>
                </div>
                <select
                  value={styleOverride}
                  onChange={(e) => setStyleOverride(e.target.value as any)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 border focus:outline-none focus:ring-1 focus:ring-navy-400 cursor-pointer ${detectedStyle === "AMA"
                      ? "bg-purple-50 text-purple-700 border-purple-200"
                      : "bg-teal-50 text-teal-700 border-teal-200"
                    }`}
                  title="Override validation style"
                >
                  <option value="AUTO">Auto ({reviewQuery.data?.validation_logs?.detected_style ?? "AMA"})</option>
                  <option value="AMA">AMA (Numbered)</option>
                  <option value="APA">APA (Name-Year)</option>
                </select>
              </div>

              {/* Row 2: Issue count chips */}
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <span className="flex items-center gap-1 text-[10px] font-bold text-error-600">
                  <AlertCircle className="w-3 h-3" />
                  {issueCount} issues
                </span>
                <span className="flex items-center gap-1 text-[10px] font-bold text-success-600">
                  <CheckCircle2 className="w-3 h-3" />
                  {matchedCount} matched
                </span>
              </div>

              {/* Row 3: Timestamp + Validate button */}
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-navy-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {lastValidatedAt ? lastValidatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Not yet validated"}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  className="text-[11px] px-3 py-1 bg-[#C9821A] border-[#C9821A] hover:bg-[#B3711A] text-white"
                  onClick={async () => {
                    if (editorRef.current?.editor) {
                      const html = editorRef.current.editor.getHTML();
                      await saveMutation.save(review.save_endpoint, html);
                      const result = await validateOnlyMutation.mutateAsync(styleOverride === "AUTO" ? undefined : styleOverride);
                      setLocalValidationLogs(result.validation_logs);
                      setLastValidatedAt(new Date());
                      setActiveTab("citations");
                    }
                  }}
                  isLoading={saveMutation.isPending || validateOnlyMutation.isPending}
                  leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                >
                  {validateOnlyMutation.isPending ? "Validating…" : "Validate"}
                </Button>
              </div>
            </div>

            {/* Sidebar Tabs */}
            <div className="flex border-b border-navy-200 bg-surface-100 px-1 pt-1 gap-0.5">
              <button
                onClick={() => setActiveTab("citations")}
                className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 rounded-t-md ${activeTab === "citations"
                    ? "border-navy-800 text-navy-800 bg-white shadow-sm -mb-px"
                    : "border-transparent text-navy-400 hover:text-navy-600 hover:bg-white/60"
                  }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Citations & References
                {(logs.citation_pairs?.filter((p: any) => p.status !== "ok").length || 0) > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] bg-error-100 text-error-600 border border-error-100 font-bold leading-none">
                    {logs.citation_pairs?.filter((p: any) => p.status !== "ok").length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("structuring")}
                className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 rounded-t-md ${activeTab === "structuring"
                    ? "border-navy-800 text-navy-800 bg-white shadow-sm -mb-px"
                    : "border-transparent text-navy-400 hover:text-navy-600 hover:bg-white/60"
                  }`}
              >
                <Hash className="w-3.5 h-3.5" />
                Structuring Review
                {(logs.reference_entries?.filter((e: any) => !e.is_cited).length || 0) > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] bg-warning-100 text-warning-600 border border-warning-100 font-bold leading-none">
                    {logs.reference_entries?.filter((e: any) => !e.is_cited).length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("trackedChanges")}
                className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 rounded-t-md ${activeTab === "trackedChanges"
                    ? "border-navy-800 text-navy-800 bg-white shadow-sm -mb-px"
                    : "border-transparent text-navy-400 hover:text-navy-600 hover:bg-white/60"
                  }`}
              >
                Tracked Changes
              </button>
              {(logs.duplicates?.length || 0) > 0 || (logs.sequence_issues?.length || 0) > 0 ? (
                <button
                  onClick={() => setActiveTab("issues")}
                  className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 rounded-t-md ${activeTab === "issues"
                      ? "border-navy-800 text-navy-800 bg-white shadow-sm -mb-px"
                      : "border-transparent text-navy-400 hover:text-navy-600 hover:bg-white/60"
                    }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Issues
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] bg-warning-100 text-warning-600 border border-warning-100 font-bold leading-none">
                    {(logs.duplicates?.length || 0) + (logs.sequence_issues?.length || 0)}
                  </span>
                </button>
              ) : null}
              <button
                onClick={() => setActiveTab("missing")}
                className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 rounded-t-md ${activeTab === "missing"
                    ? "border-navy-800 text-navy-800 bg-white shadow-sm -mb-px"
                    : "border-transparent text-navy-400 hover:text-navy-600 hover:bg-white/60"
                  }`}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                Missing Refs
              </button>
              {logs.raw_log && (
                <button
                  onClick={() => setActiveTab("logs")}
                  className={`flex-grow-0 px-4 py-3 text-center text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 rounded-t-md ${activeTab === "logs"
                      ? "border-navy-800 text-navy-800 bg-white shadow-sm -mb-px"
                      : "border-transparent text-navy-400 hover:text-navy-600 hover:bg-white/60"
                    }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Logs
                </button>
              )}
            </div>

            {/* Sidebar Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 bg-surface-50/20">

              {/* ─── TAB 1: CITATIONS & REFERENCES ─── */}
              {activeTab === "citations" && (
                <div className="space-y-4 page-enter">

                  {/* Summary Stats Bar */}
                  <div className="grid grid-cols-2 gap-2 bg-white p-3 border border-navy-100 rounded-lg shadow-sm">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase font-bold text-navy-400 tracking-wider">Total Refs</span>
                      <span className="text-base font-extrabold text-navy-900">{logs.total_refs || 0}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase font-bold text-navy-400 tracking-wider">Citations</span>
                      <span className="text-base font-extrabold text-navy-900">{logs.total_cites || 0}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase font-bold text-success-600 tracking-wider">Matched</span>
                      <span className="text-base font-extrabold text-success-700">{matchedCount} / {logs.total_refs || 0}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase font-bold text-error-600 tracking-wider">Issues</span>
                      <span className="text-base font-extrabold text-error-700">{issueCount}</span>
                    </div>
                  </div>

                  {detectedStyle === "APA" && (
                    <div className="flex justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<RefreshCw className="w-3 h-3" />}
                        className="text-[10px] px-2 py-1 h-auto"
                        onClick={sortBibliographyAlphabetically}
                        title="Sorts references alphabetically and preserves track changes"
                      >
                        A-Z Sort
                      </Button>
                    </div>
                  )}

                  {/* Style Highlighting Manager (Collapsible) */}
                  <div className="bg-white border border-navy-100 rounded-lg shadow-sm overflow-hidden">
                    <button
                      onClick={() => setStyleManagerOpen(!styleManagerOpen)}
                      className="w-full px-3 py-2 text-left text-[11px] font-bold text-navy-800 bg-surface-50 hover:bg-navy-50/50 flex items-center justify-between transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                        Style Highlight Manager
                      </span>
                      <ChevronRight className={`w-3.5 h-3.5 text-navy-500 transition-transform duration-200 ${styleManagerOpen ? "rotate-90" : ""}`} />
                    </button>

                    {styleManagerOpen && (
                      <div className="p-3 border-t border-navy-50">
                        <div className="flex items-center justify-between pb-3.5 border-b border-navy-50 mb-3 flex-wrap gap-2">
                          <div className="relative max-w-[200px] w-full">
                            <Search className="w-3.5 h-3.5 text-navy-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              placeholder="Filter character styles..."
                              value={styleFilterQuery}
                              onChange={(e) => setStyleFilterQuery(e.target.value)}
                              className="w-full pl-8 pr-3 py-1 bg-surface-50 text-[11px] rounded border border-navy-200 focus:outline-none focus:border-navy-500"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleAllStylesVisibility(true)}
                              className="text-[10px] font-bold text-navy-600 hover:text-navy-800 hover:underline"
                            >
                              Show All
                            </button>
                            <span className="text-navy-300">|</span>
                            <button
                              onClick={() => toggleAllStylesVisibility(false)}
                              className="text-[10px] font-bold text-navy-600 hover:text-navy-800 hover:underline"
                            >
                              Hide All
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2 max-h-[calc(40vh-2rem)] overflow-y-auto pr-1">
                          {filteredStyles.length === 0 ? (
                            <div className="text-center py-6 text-navy-400 text-xs">
                              No styles match search filter.
                            </div>
                          ) : (
                            filteredStyles.map((style) => {
                              const count = styleStats[style] || 0;
                              const isHidden = hiddenStyles.includes(style);
                              return (
                                <div
                                  key={style}
                                  className="flex items-center justify-between p-2 rounded hover:bg-surface-50 border border-navy-50/50 bg-white transition-colors"
                                >
                                  <label className="flex items-center gap-2 cursor-pointer flex-1 select-none">
                                    <button
                                      type="button"
                                      onClick={() => toggleStyleVisibility(style)}
                                      className="text-navy-500 hover:text-navy-700"
                                    >
                                      {isHidden ? (
                                        <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                                      ) : (
                                        <Eye className="w-3.5 h-3.5 text-navy-600" />
                                      )}
                                    </button>
                                    <span className={`font-mono text-[10px] ${isHidden ? "text-slate-400 line-through" : "text-slate-800"}`}>
                                      {style}
                                    </span>
                                  </label>

                                  <div className="flex items-center gap-3">
                                    <span className="text-[9px] font-bold text-slate-400">
                                      {count} run{count === 1 ? "" : "s"}
                                    </span>
                                    <span
                                      className="w-3 h-3 rounded-full border border-slate-300/40"
                                      style={{ backgroundColor: CHAR_STYLE_COLOURS[style] ?? "#e5e7eb" }}
                                    />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Filter Pills */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "all", label: "All" },
                      { id: "ok", label: "✅ Matched" },
                      { id: "missing", label: "🔴 Missing" },
                      { id: "unused", label: "🟡 Unused" }
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setCitationFilter(f.id as any)}
                        className={`px-3 py-1 text-[11px] font-bold rounded-full border transition-colors ${citationFilter === f.id
                            ? "bg-navy-800 text-white border-navy-800 shadow-sm"
                            : "bg-white text-navy-600 border-navy-200 hover:bg-navy-50"
                          }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Cards List */}
                  <div className="space-y-3">
                    {filteredCitationPairs.length === 0 ? (
                      <div className="text-center py-10 bg-white rounded-lg border border-navy-100 p-6 text-navy-400 text-xs font-semibold">
                        No citations match the current filter.
                      </div>
                    ) : (
                      filteredCitationPairs.map((pair: any, idx: number) => {
                        const isExpanded = expandedCitationIdx === idx;
                        const isMissing = pair.status === "missing";
                        const isUnused = pair.status === "unused";
                        const isOk = pair.status === "ok";

                        const parsed = parseRefText(pair.ref_text);
                        const cardIssues = (logs.issues || []).filter((issue: any) => {
                          return issue.citation === pair.citation || 
                                 (pair.citation && issue.message.includes(pair.citation)) ||
                                 (issue.para_idx === pair.para_idx && issue.para_idx !== -1);
                        });

                        return (
                          <div
                            key={idx}
                            id={`citation-card-${idx}`}
                            onMouseEnter={() => pair.citation ? highlightInEditor(pair.citation, true) : highlightRefInEditor(pair.para_idx, true)}
                            onMouseLeave={() => pair.citation ? highlightInEditor(pair.citation, false) : highlightRefInEditor(pair.para_idx, false)}
                            className={`rounded-lg border bg-white overflow-hidden border-l-[3.5px] transition-all hover:shadow-hover ${isMissing ? "border-l-error-500 bg-error-50/30 border-error-100" :
                                isUnused ? "border-l-warning-500 bg-warning-50/30 border-warning-100" :
                                  "border-l-success-500 bg-white border-navy-100"
                              } ${activeCitationIdx === idx ? "ring-2 ring-navy-400 ring-offset-1" : ""}`}
                          >
                            {/* Card Header (Collapsed view) */}
                            <button
                              onClick={() => {
                                setExpandedCitationIdx(isExpanded ? null : idx);
                                if (!isExpanded) {
                                  if (pair.citation) {
                                    navigateToCitation(pair.citation);
                                  } else if (pair.para_idx !== undefined && pair.para_idx >= 0) {
                                    navigateToDocPara(pair.para_idx, pair.ref_text);
                                  }
                                }
                              }}
                              className="w-full p-3 flex flex-col gap-2 hover:bg-surface-50/50 text-left transition-colors"
                            >
                              <div className="flex items-start justify-between gap-3 w-full">
                                <div className="flex items-start gap-2 flex-1 min-w-0">
                                  {isMissing ? <AlertCircle className="w-3.5 h-3.5 text-error-500 shrink-0 mt-0.5" /> :
                                    isUnused ? <AlertTriangle className="w-3.5 h-3.5 text-warning-500 shrink-0 mt-0.5" /> :
                                      <CheckCircle2 className="w-3.5 h-3.5 text-success-500 shrink-0 mt-0.5" />}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-extrabold text-navy-900 break-words leading-tight">
                                      {pair.citation ? (
                                        detectedStyle === "AMA" && !pair.citation.includes("[") ? `[${pair.citation}]` : pair.citation
                                      ) : (
                                        <span className="text-navy-400 italic">No in-text citation</span>
                                      )}
                                    </p>
                                    <p className="text-[10px] text-navy-500 mt-1 truncate">
                                      {isMissing ? "Missing reference entry" :
                                        isUnused ? "Unused reference entry" :
                                          pair.ref_text.slice(0, 60) + (pair.ref_text.length > 60 ? "..." : "")}
                                    </p>
                                  </div>
                                </div>
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (pair.citation) {
                                      navigateToCitation(pair.citation);
                                      // Open linking panel for missing citations
                                      if (pair.status === "missing") {
                                        setLinkingSource({
                                          type: "citation",
                                          key: `cite_${idx}`,
                                          text: pair.citation,
                                          paraIdx: pair.para_idx,
                                          author: pair.author,
                                          year: pair.year,
                                        });
                                      }
                                    } else if (pair.para_idx !== undefined && pair.para_idx >= 0) {
                                      navigateToDocPara(pair.para_idx, pair.ref_text);
                                    }
                                  }}
                                  className="flex items-center gap-1 text-[10px] font-bold text-navy-400 hover:text-navy-600 bg-surface-50 px-2 py-1 rounded shrink-0 cursor-pointer"
                                >
                                  Locate <CornerDownRight className="w-3 h-3" />
                                </div>
                              </div>
                            </button>

                            {/* Card Body (Expanded view) */}
                            {isExpanded && (
                              <div className="p-3 bg-surface-50/30 border-t border-navy-100/60 space-y-3">
                                {cardIssues.length > 0 && (
                                  <div className="space-y-1.5">
                                    {cardIssues.map((issue: any, issueIdx: number) => {
                                      const isYearMismatch = issue.message.toLowerCase().includes("year") || issue.message.toLowerCase().includes("date") || issue.message.toLowerCase().includes("changed to");
                                      const yearMatches = issue.message.match(/\b(19|20)\d{2}\b/g);
                                      const expectedYear = yearMatches && yearMatches.length > 0 ? yearMatches[yearMatches.length - 1] : null;

                                      return (
                                        <div key={issueIdx} className="text-[10px] font-medium p-2 bg-red-50 text-red-800 rounded border border-red-100 flex flex-col gap-1.5">
                                          <span>⚠️ {issue.message}</span>
                                          {isYearMismatch && expectedYear && (
                                            <button
                                              onClick={() => {
                                                quickFixYear(pair.para_idx !== undefined && pair.para_idx >= 0 ? pair.para_idx : issue.para_idx, issue.message, expectedYear);
                                              }}
                                              className="w-fit px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-900 border border-red-300 rounded text-[9px] font-bold transition-all cursor-pointer"
                                            >
                                              Quick Fix: Update year to {expectedYear}
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {isMissing ? (
                                  <div className="text-[11px] text-navy-800 font-semibold p-2 bg-red-50 rounded border border-red-100">
                                    ⚠️ Citation found in text but no matching bibliography entry.
                                    {pair.citation && (
                                      <button
                                        onClick={() => addBibliographyPlaceholder(detectedStyle === "AMA" && !pair.citation.includes("[") ? `[${pair.citation}]` : pair.citation)}
                                        className="mt-2 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 hover:underline bg-transparent border-none cursor-pointer"
                                      >
                                        <PlusIcon className="w-3 h-3" />
                                        Add Placeholder Reference
                                      </button>
                                    )}
                                  </div>
                                ) : isUnused ? (
                                  <div className="space-y-2">
                                    <div className="text-[11px] text-navy-800 font-semibold p-2 bg-amber-50 rounded border border-amber-100">
                                      ⚠️ This reference is in the bibliography, but it is never cited in the text.
                                    </div>
                                    <div className="p-2.5 bg-white rounded border border-navy-100 text-[11px] leading-relaxed text-navy-800">
                                      {pair.ref_text}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[9px] uppercase font-bold text-navy-400 tracking-wider">Reference Text</span>
                                      <button
                                        onClick={() => {
                                          navigator.clipboard.writeText(pair.ref_text);
                                          setCopiedIdx(idx);
                                          setTimeout(() => setCopiedIdx(null), 1500);
                                        }}
                                        className="text-[9px] font-bold text-navy-500 hover:text-navy-800 bg-transparent border-none cursor-pointer"
                                      >
                                        {copiedIdx === idx ? "Copied!" : "Copy"}
                                      </button>
                                    </div>
                                    <div className="p-2.5 bg-white rounded border border-navy-100 text-[11px] leading-relaxed text-navy-800 selection:bg-blue-100">
                                      {pair.ref_text}
                                    </div>

                                    {parsed && (
                                      <div className="bg-white rounded border border-navy-100 p-2 space-y-1 text-[10px] text-navy-700">
                                        {parsed.title && (
                                          <p className="line-clamp-2"><strong>Title:</strong> {parsed.title}</p>
                                        )}
                                        {parsed.journal && (
                                          <p><strong>Journal:</strong> {parsed.journal}</p>
                                        )}
                                        <div className="flex gap-4">
                                          {parsed.year && <p><strong>Year:</strong> {parsed.year}</p>}
                                          {parsed.doi && <p><strong>DOI:</strong> {parsed.doi}</p>}
                                        </div>
                                      </div>
                                    )}

                                    <div className="flex items-center gap-3 pt-1">
                                      <a
                                        href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(parsed?.title || pair.ref_text)}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] text-blue-600 font-bold hover:underline"
                                      >
                                        PubMed ↗
                                      </a>
                                      <span className="text-navy-200">|</span>
                                      <a
                                        href={`https://search.crossref.org/?q=${encodeURIComponent(parsed?.title || pair.ref_text)}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] text-blue-600 font-bold hover:underline"
                                      >
                                        CrossRef ↗
                                      </a>
                                      {parsed?.doi && (
                                        <>
                                          <span className="text-navy-200">|</span>
                                          <a
                                            href={`https://doi.org/${parsed.doi}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-[10px] text-purple-600 font-bold hover:underline"
                                          >
                                            DOI Link ↗
                                          </a>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ─── TAB 2: STRUCTURING REVIEW ─── */}
              {activeTab === "structuring" && (
                <div className="space-y-4 page-enter">
                  {/* Header Stat Bar & Search */}
                  <div className="bg-white p-3 border border-navy-100 rounded-lg shadow-sm space-y-3">
                    <div className="flex gap-4 text-[11px] font-bold text-navy-800 flex-wrap">
                      <span>{referenceEntries.length} references</span>
                      <span className="text-navy-300">|</span>
                      <span className="text-emerald-600">✅ {referenceEntries.filter((e: any) => e.is_cited).length} cited</span>
                      <span className="text-navy-300">|</span>
                      <span className="text-amber-600">🟡 {referenceEntries.filter((e: any) => !e.is_cited).length} uncited</span>
                    </div>

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-navy-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Search references..."
                          value={refFilter}
                          onChange={(e) => setRefFilter(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 bg-surface-50 text-[11px] rounded border border-navy-200 focus:outline-none focus:border-navy-500"
                        />
                      </div>
                      <button
                        onClick={() => setShowUncitedOnly(!showUncitedOnly)}
                        className={`px-3 text-[10px] font-bold rounded border whitespace-nowrap transition-colors ${showUncitedOnly
                            ? "bg-amber-100 text-amber-800 border-amber-300"
                            : "bg-surface-50 text-navy-600 border-navy-200 hover:bg-navy-50"
                          }`}
                      >
                        Uncited Only
                      </button>
                    </div>
                  </div>

                  {/* Reference Index Cards */}
                  <div className="space-y-3">
                    {filteredEntries.length === 0 ? (
                      <div className="text-center py-10 bg-white rounded-lg border border-navy-100 p-6 text-navy-400 text-xs font-semibold">
                        No references match the filter.
                      </div>
                    ) : (
                      filteredEntries.map((entry: any, idx: number) => (
                        <div
                          key={idx}
                          onMouseEnter={() => highlightRefInEditor(entry.para_idx, true)}
                          onMouseLeave={() => highlightRefInEditor(entry.para_idx, false)}
                          className="bg-white rounded-lg border border-navy-100 shadow-sm p-3.5 space-y-3 hover:border-navy-300 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-black text-navy-900 bg-surface-100 px-1.5 py-0.5 rounded">
                                {entry.number ? `#${entry.number}` : `Ref ${idx + 1}`}
                              </span>
                              <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide ${entry.is_cited ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                                }`}>
                                {entry.is_cited ? "Cited" : "Not Cited"}
                              </span>
                            </div>
                            <select
                              value={entry.style || (detectedStyle === "AMA" ? "REF-N" : "REF-U")}
                              onChange={(e) => applyStyleToPara(entry.para_idx, e.target.value)}
                              className="text-[9px] bg-slate-100 hover:bg-slate-200 text-navy-700 font-bold px-1.5 py-0.5 rounded border border-slate-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-navy-400"
                              title="Change paragraph style"
                            >
                              {(review.styles || []).map((style: string) => (
                                <option key={style} value={style}>
                                  {style}
                                </option>
                              ))}
                            </select>
                          </div>

                          {editingEntryIdx === idx ? (
                            <div className="space-y-2">
                              <textarea
                                className="w-full text-xs p-2 border rounded text-navy-800 bg-white focus:outline-none focus:ring-1 focus:ring-navy-400"
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                rows={3}
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => setEditingEntryIdx(null)}
                                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded text-[10px] cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={async () => {
                                    updateParaText(entry.para_idx, editingText);
                                    setEditingEntryIdx(null);
                                    if (editorRef.current?.editor) {
                                      const html = editorRef.current.editor.getHTML();
                                      await saveMutation.save(review.save_endpoint, html);
                                    }
                                  }}
                                  className="px-2 py-1 bg-[#C9821A] hover:bg-[#B3711A] text-white font-bold rounded text-[10px] cursor-pointer"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[11px] text-navy-800 leading-relaxed font-medium line-clamp-3">
                              {entry.text}
                            </p>
                          )}

                          <div className="flex justify-between items-center pt-1 border-t border-navy-50">
                            {editingEntryIdx !== idx && (
                              <button
                                onClick={() => {
                                  setEditingEntryIdx(idx);
                                  setEditingText(entry.text);
                                }}
                                className="text-[10px] font-bold text-navy-500 hover:text-navy-700 bg-transparent border-none cursor-pointer"
                              >
                                Edit Text
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (entry.para_idx !== undefined && entry.para_idx >= 0) {
                                  navigateToDocPara(entry.para_idx, entry.text.slice(0, 40));
                                } else {
                                  navigateByText(editorRef.current?.editor, entry.text.slice(0, 40));
                                }
                              }}
                              className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors cursor-pointer"
                            >
                              Jump to reference <CornerDownRight className="w-3 h-3 ml-0.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ─── TAB 3: ISSUES ─── */}
              {activeTab === "issues" && (
                <div className="space-y-3 page-enter">
                  {/* Duplicates Section */}
                  {(logs.duplicates?.length || 0) > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[10px] uppercase font-extrabold text-navy-500 tracking-wider px-1">
                        Duplicate References ({logs.duplicates.length})
                      </h4>
                      {logs.duplicates.map((dup: any, idx: number) => (
                        <div key={idx} className="bg-white rounded-lg border border-warning-200 border-l-[3px] border-l-warning-500 p-3 space-y-2 shadow-sm">
                          <div className="text-[10px] font-bold text-warning-700 flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3" />
                            {Math.round((dup.similarity || 0) * 100)}% similarity
                          </div>
                          <p className="text-[10px] text-navy-700 line-clamp-2 leading-relaxed">{dup.text1}</p>
                          <button
                            onClick={() => mergeDuplicateReferences(dup)}
                            className="text-[10px] font-bold text-navy-700 hover:text-navy-900 bg-surface-100 hover:bg-navy-100 px-2.5 py-1 rounded border border-navy-200 flex items-center gap-1 transition-colors"
                          >
                            <Layers className="w-3 h-3" />
                            Merge References
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Sequence Issues Section */}
                  {(logs.sequence_issues?.length || 0) > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-[10px] uppercase font-extrabold text-navy-500 tracking-wider px-1">
                        Sequence Issues ({logs.sequence_issues.length})
                      </h4>
                      {logs.sequence_issues.map((issue: any, idx: number) => (
                        <div key={idx} className="bg-white rounded-lg border border-error-100 border-l-[3px] border-l-error-500 p-3 space-y-1.5 shadow-sm">
                          <p className="text-[11px] font-semibold text-navy-800">{issue.message}</p>
                          <button
                            onClick={() => issue.para_idx !== undefined && navigateToDocPara(issue.para_idx)}
                            className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <CornerDownRight className="w-3 h-3" />
                            Locate in editor
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ─── TAB: MISSING REFERENCES ─── */}
              {activeTab === "missing" && (
                <div className="page-enter h-full">
                  <MissingReferencesTab fileId={normalizedFileId || 0} />
                </div>
              )}

              {/* ─── TAB 4: RAW LOGS ─── */}
              {activeTab === "logs" && logs.raw_log && (() => {
                const parsed = parseLogText(logs.raw_log);
                if (!parsed) {
                  return (
                    <div className="page-enter bg-slate-950 rounded-lg p-3 shadow-inner border border-slate-900 max-h-[600px] overflow-y-auto">
                      <pre className="text-[10px] text-emerald-400 font-mono whitespace-pre-wrap leading-relaxed select-text">
                        {logs.raw_log}
                      </pre>
                    </div>
                  );
                }

                const categories = Array.from(new Set(parsed.items.map(item => item.category)));

                return (
                  <div className="space-y-4 page-enter">
                    {/* View mode toggle */}
                    <div className="flex bg-surface-100 p-0.5 rounded-lg border border-navy-100 w-fit">
                      <button
                        onClick={() => setLogViewMode("dashboard")}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all border-none cursor-pointer ${
                          logViewMode === "dashboard"
                            ? "bg-white text-navy-800 shadow-sm"
                            : "text-navy-400 hover:text-navy-600 bg-transparent"
                        }`}
                      >
                        Dashboard View
                      </button>
                      <button
                        onClick={() => setLogViewMode("raw")}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all border-none cursor-pointer ${
                          logViewMode === "raw"
                            ? "bg-white text-navy-800 shadow-sm"
                            : "text-navy-400 hover:text-navy-600 bg-transparent"
                        }`}
                      >
                        Raw Log Text
                      </button>
                    </div>

                    {logViewMode === "raw" ? (
                      <div className="bg-slate-950 rounded-lg p-3 shadow-inner border border-slate-900 max-h-[600px] overflow-y-auto">
                        <pre className="text-[10px] text-emerald-400 font-mono whitespace-pre-wrap leading-relaxed select-text">
                          {logs.raw_log}
                        </pre>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Stats Dashboard Row */}
                        <div className="grid grid-cols-2 gap-2 bg-white p-3 border border-navy-100 rounded-lg shadow-sm">
                          {Object.entries(parsed.stats).slice(0, 6).map(([key, val]) => (
                            <div key={key} className="flex flex-col gap-0.5 border-b border-navy-50 pb-1.5 last:border-b-0">
                              <span className="text-[9px] uppercase font-bold text-navy-400 tracking-wider truncate" title={key}>
                                {key}
                              </span>
                              <span className="text-xs font-extrabold text-navy-800">{val}</span>
                            </div>
                          ))}
                          {Object.keys(parsed.stats).length === 0 && (
                            <div className="col-span-2 text-center text-[10px] text-navy-400 font-bold py-2">
                              No summary statistics parsed
                            </div>
                          )}
                        </div>

                        {/* List grouped by category */}
                        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                          {categories.length === 0 ? (
                            <div className="text-center py-8 bg-white border border-navy-100 rounded-lg text-xs text-navy-400 font-semibold">
                              No log issues or conversions detected.
                            </div>
                          ) : (
                            categories.map((cat: string) => {
                              const catItems = parsed.items.filter(item => item.category === cat);
                              return (
                                <div key={cat} className="space-y-1.5">
                                  <h4 className="text-[10px] uppercase font-extrabold text-navy-500 tracking-wider px-1">
                                    {cat} ({catItems.length})
                                  </h4>
                                  <div className="space-y-2">
                                    {catItems.map((item, itemIdx) => {
                                      const isSuccess = item.status === "success";
                                      const isError = item.status === "error" || cat.toLowerCase().includes("error") || cat.toLowerCase().includes("mismatch") || cat.toLowerCase().includes("missing");
                                      const isWarning = !isSuccess && !isError;
                                      
                                      return (
                                        <div
                                          key={itemIdx}
                                          className={`p-2.5 rounded-lg border bg-white shadow-sm flex flex-col gap-1.5 border-l-[3.5px] ${
                                            isError
                                              ? "border-l-error-500 bg-error-50/20 border-error-100"
                                              : isWarning
                                                ? "border-l-warning-500 bg-warning-50/20 border-warning-100"
                                                : "border-l-success-500 bg-success-50/20 border-success-100"
                                          }`}
                                        >
                                          <div className="flex justify-between items-start gap-2 w-full text-[10px]">
                                            <div className="flex-1 font-semibold text-navy-800 leading-relaxed break-words">
                                              {item.id && (
                                                <span className="font-mono bg-navy-100 text-navy-800 px-1 py-0.5 rounded text-[9px] mr-1.5">
                                                  [{item.id}]
                                                </span>
                                              )}
                                              {item.message || (item.from && `Converted from: "${item.from}"`)}
                                            </div>
                                            {item.para !== undefined && (
                                              <button
                                                onClick={() => navigateToDocPara(item.para || 0)}
                                                className="text-[9px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-0.5 bg-blue-50 px-1.5 py-0.5 rounded cursor-pointer border-none whitespace-nowrap shrink-0 font-mono"
                                              >
                                                Locate <CornerDownRight className="w-2.5 h-2.5" />
                                              </button>
                                            )}
                                          </div>

                                          {/* For conversions, show changes diff */}
                                          {item.from && item.to && (
                                            <div className="text-[9px] bg-slate-900 text-slate-100 rounded p-1.5 font-mono space-y-1">
                                              <div className="text-red-300 break-words line-through"><span className="text-slate-400 select-none">- </span>{item.from}</div>
                                              <div className="text-green-300 break-words"><span className="text-slate-400 select-none">+ </span>{item.to}</div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ─── TAB 4: TRACKED CHANGES ─── */}
              {activeTab === "trackedChanges" && (
                <div className="page-enter h-full">
                  <ChangesReviewPanel editor={editorRef.current?.editor} />
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Phase 2: Citation Linking Panel */}
        <LinkingPanel
          fileId={normalizedFileId || 0}
          linkingSource={linkingSource}
          onClose={() => setLinkingSource(null)}
          onLinkSuccess={(linkId) => {
            // Apply cite_bib style to the citation
            if (linkingSource?.text) {
              applyCiteBibStyle(linkingSource.text, linkId);
            }
            // Trigger refresh of citation comments when link is successful
            setActiveTab("missing");
            setLinkingSource(null);
          }}
        />
      </div>
    </main>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      className={className}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}
