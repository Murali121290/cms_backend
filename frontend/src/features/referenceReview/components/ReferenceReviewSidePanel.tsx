import { useEffect, useMemo, useState } from "react";
import type { ComponentType, RefObject } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Download,
  GitBranch,
  Hash,
  Inbox,
  Minus,
  MinusCircle,
  RefreshCw,
  SearchX,
  Sparkles,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { WysiwygEditorHandle } from "@/features/editor";

import { useReferenceReviewQuery } from "../useReferenceReviewQuery";
import { useReferenceSave } from "../useReferenceSave";
import { useReferenceValidateOnly } from "../useReferenceValidateOnly";
import { stampBookmarks } from "../stampBookmarks";

type PanelTab = "citations" | "references" | "changes" | "issues" | "missing";
type FilterKey = "all" | "matched" | "missing" | "unused";

interface Props {
  fileId: number | null;
  editorRef: RefObject<WysiwygEditorHandle | null>;
}

export function ReferenceReviewSidePanel({ fileId, editorRef }: Props) {
  const [styleOverride, setStyleOverride] = useState<"AUTO" | "AMA" | "APA">("AUTO");
  const [citationFormat, setCitationFormat] =
    useState<"auto" | "superscript" | "bracket" | "paren" | "plain">("auto");
  const [activeTab, setActiveTab] = useState<PanelTab>("citations");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [lastValidatedAt, setLastValidatedAt] = useState<Date | null>(null);

  const reviewQuery = useReferenceReviewQuery(
    fileId,
    styleOverride === "AUTO" ? undefined : styleOverride,
    citationFormat === "auto" ? undefined : citationFormat,
  );
  const saveMutation = useReferenceSave(fileId);
  const validateMutation = useReferenceValidateOnly(fileId ?? 0);

  const logs = reviewQuery.data?.validation_logs;
  const detectedStyle = logs?.detected_style ?? "AMA";
  const citationPairs = logs?.citation_pairs ?? [];
  const referenceEntries = logs?.reference_entries ?? [];
  const issues = logs?.issues ?? [];
  const duplicates = logs?.duplicates ?? [];
  const missing = logs?.missing_references ?? [];
  const unused = logs?.unused_references ?? [];

  const citationCount = citationPairs.length;
  const referenceCount = referenceEntries.length;
  const changesCount = 0;
  const issueCount = issues.length + duplicates.length + (logs?.sequence_issues?.length ?? 0);
  const missingCount = missing.length + unused.length;
  const matchedCount = citationPairs.filter((p) => p.status === "ok").length;

  // Auto-apply Bookmark marks after each validate/refetch so citations and
  // reference entries become clickable REF{n} anchors that also survive the
  // DOCX round-trip. Reuses reference_entries + citation_pairs — no
  // separate detection logic.
  useEffect(() => {
    if (!reviewQuery.data) return;
    const editor = editorRef.current?.editor;
    if (!editor) return;
    stampBookmarks(editor, referenceEntries, citationPairs);
  }, [reviewQuery.data, referenceEntries, citationPairs, editorRef]);

  const flashBlock = (el: HTMLElement | null) => {
    if (!el || !el.scrollIntoView) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("rr-para-flash");
    setTimeout(() => el.classList.remove("rr-para-flash"), 1200);
  };

  // Walk text nodes inside `root` and flash the first one whose textContent
  // contains `needle`. Used as a locate() fallback when paraIdx is missing.
  const flashTextMatch = (root: HTMLElement, needle: string): boolean => {
    if (!needle) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      if ((node.textContent ?? "").includes(needle)) {
        const el = (node.parentElement ?? null) as HTMLElement | null;
        if (el) {
          flashBlock(el);
          return true;
        }
      }
      node = walker.nextNode();
    }
    return false;
  };

  // Try to find a citation reference in the editor. Handles the common
  // renderings: [N], (N), <sup>N</sup>, and grouped forms like [24,25] or
  // [24-27] where N sits inside a comma-list or numeric range.
  const flashCitationRef = (root: HTMLElement, refNumber: number): boolean => {
    if (flashTextMatch(root, `[${refNumber}]`)) return true;
    if (flashTextMatch(root, `(${refNumber})`)) return true;

    const sups = root.querySelectorAll("sup");
    for (const s of Array.from(sups)) {
      const inner = (s.textContent ?? "").trim();
      if (inner === String(refNumber) || refNumberInGroup(inner, refNumber)) {
        flashBlock((s.parentElement ?? s) as HTMLElement);
        return true;
      }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const bracketRe = /\[([\d\s,\-–]+)\]/g;
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      let m: RegExpExecArray | null;
      while ((m = bracketRe.exec(text)) !== null) {
        if (refNumberInGroup(m[1], refNumber)) {
          const el = node.parentElement as HTMLElement | null;
          if (el) {
            flashBlock(el);
            return true;
          }
        }
      }
      bracketRe.lastIndex = 0;
      node = walker.nextNode();
    }
    return false;
  };

  // Locate a paragraph in the SHARED main editor. Tries in order:
  //   1. ProseMirror node-attr lookup (paraIdx)
  //   2. DOM query for [data-para-idx]
  //   3. Citation reference search (handles [N], (N), <sup>N</sup>, [24,25], [24-27])
  //   4. Free-text search (for named citations like "Smith 2020")
  //   5. Index into top-level blocks
  // Returns true iff something was flashed.
  const locate = (paraIdx?: number, refNumber?: number, searchText?: string): boolean => {
    const editor = editorRef.current?.editor;
    if (!editor) return false;
    const root = editor.view.dom as HTMLElement;

    if (paraIdx != null && paraIdx >= 0) {
      let targetPos = -1;
      editor.state.doc.descendants((node: any, pos: number) => {
        if (targetPos !== -1) return false;
        const isBlock =
          node.isBlock && (node.type.name === "paragraph" || String(node.type.name).startsWith("heading"));
        if (isBlock && node.attrs?.paraIdx != null && String(node.attrs.paraIdx) === String(paraIdx)) {
          targetPos = pos;
          return false;
        }
        return true;
      });
      if (targetPos !== -1) {
        editor.commands.focus();
        editor.commands.setTextSelection(targetPos + 1);
        try {
          const info = editor.view.domAtPos(targetPos + 1);
          const el = (info.node.nodeType === Node.TEXT_NODE ? info.node.parentElement : info.node) as HTMLElement | null;
          flashBlock(el);
        } catch {
          /* ignore */
        }
        return true;
      }

      const el = root.querySelector(`[data-para-idx="${paraIdx}"]`) as HTMLElement | null;
      if (el) {
        editor.commands.focus();
        flashBlock(el);
        return true;
      }
    }

    if (refNumber != null && flashCitationRef(root, refNumber)) return true;
    if (searchText && flashTextMatch(root, searchText)) return true;

    if (paraIdx != null && paraIdx >= 0) {
      const blocks = root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li");
      if (paraIdx < blocks.length) {
        flashBlock(blocks[paraIdx] as HTMLElement);
        return true;
      }
    }

    // Nothing worked — leave a breadcrumb in the console so we can see which
    // clue was available and why every strategy missed.
    console.warn("[ReferenceReview] locate failed", {
      paraIdx,
      refNumber,
      searchText,
      firstBrackets: (root.textContent ?? "").match(/\[[\d,\-–\s]+\]/g)?.slice(0, 5),
      hasSups: root.querySelectorAll("sup").length,
      totalBlocks: root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li").length,
    });
    return false;
  };

  const handleValidate = async () => {
    const editor = editorRef.current?.editor;
    if (!editor || !reviewQuery.data) return;
    const html = editor.getHTML();
    try {
      await saveMutation.save(reviewQuery.data.save_endpoint, html);
      await validateMutation.mutateAsync({
        style: styleOverride === "AUTO" ? undefined : styleOverride,
        citationFormat: citationFormat === "auto" ? undefined : citationFormat,
      });
      setLastValidatedAt(new Date());
      await reviewQuery.refetch();
    } catch {
      /* surfaced via saveMutation.errorMessage */
    }
  };

  // Save reference changes, then trigger the export download. Combined so
  // there's exactly one export path from this panel.
  const handleSaveAndExport = async () => {
    const editor = editorRef.current?.editor;
    if (!editor || !reviewQuery.data) return;
    try {
      await saveMutation.save(reviewQuery.data.save_endpoint, editor.getHTML());
      await reviewQuery.refetch();
    } catch {
      return; // error surfaced via saveMutation.errorMessage
    }
    const href = reviewQuery.data.export_href;
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  // Filter is meaningful for the Citations and References tabs. Other tabs
  // (Changes / Issues / Missing) show their own scoped lists regardless.
  const filteredCitations = useMemo(
    () =>
      citationPairs.filter((c) => {
        if (filter === "all") return true;
        if (filter === "matched") return c.status === "ok";
        if (filter === "missing") return c.status === "missing";
        if (filter === "unused") return c.status === "unused";
        return true;
      }),
    [citationPairs, filter],
  );
  const filteredReferences = useMemo(
    () =>
      referenceEntries.filter((r) => {
        if (filter === "all") return true;
        if (filter === "matched") return Boolean(r.is_cited);
        if (filter === "unused") return !r.is_cited;
        if (filter === "missing") return false;
        return true;
      }),
    [referenceEntries, filter],
  );

  if (reviewQuery.isPending) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-navy-500 p-4">
        Loading reference review…
      </div>
    );
  }
  if (reviewQuery.isError || !reviewQuery.data) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
        <AlertCircle className="w-5 h-5 text-error-500" />
        <div className="text-xs text-navy-700 font-semibold">Reference review unavailable</div>
        <Button size="sm" variant="secondary" onClick={() => reviewQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const citationSubtitle = (c: (typeof citationPairs)[number]) => {
    if (c.status === "missing") return "Missing reference entry";
    if (c.status === "unused") return "Unused reference";
    return c.ref_text || "";
  };
  const citationTitle = (c: (typeof citationPairs)[number]) =>
    c.ref_number != null ? `[${c.ref_number}]` : (c.citation ?? "—");

  const renderBody = () => {
    switch (activeTab) {
      case "citations":
        return filteredCitations.length === 0 ? (
          <EmptyState Icon={Hash} message="No citations to display for this filter." />
        ) : (
          <ul className="space-y-2">
            {filteredCitations.map((c, i) => (
              <ItemCard
                key={i}
                title={citationTitle(c)}
                message={citationSubtitle(c)}
                status={c.status}
                onLocate={() =>
                  locate(
                    c.para_idx,
                    c.ref_number ?? refNumberFromCitation(c.citation),
                    c.citation ?? undefined,
                  )
                }
              />
            ))}
          </ul>
        );
      case "references":
        return filteredReferences.length === 0 ? (
          <EmptyState Icon={BookOpen} message="No references to display for this filter." />
        ) : (
          <ul className="space-y-2">
            {filteredReferences.map((r, i) => (
              <ItemCard
                key={i}
                title={r.number != null ? `[${r.number}]` : `#${i + 1}`}
                message={r.text}
                status={r.is_cited ? "ok" : "unused"}
                onLocate={() => locate(r.para_idx, r.number ?? undefined, r.text)}
              />
            ))}
          </ul>
        );
      case "issues":
        return issues.length === 0 && duplicates.length === 0 ? (
          <EmptyState Icon={CheckCircle2} tone="success" message="All clear — no issues." />
        ) : (
          <ul className="space-y-2">
            {issues.map((it, i) => (
              <ItemCard
                key={`iss-${i}`}
                title={it.type.replace(/_/g, " ")}
                message={it.message}
                status="issue"
                onLocate={() =>
                  locate(it.para_idx, refNumberFromCitation(it.citation), it.citation)
                }
              />
            ))}
            {duplicates.map((d, i) => (
              <ItemCard
                key={`dup-${i}`}
                title={`Duplicate ${d.num1 ?? "?"} ↔ ${d.num2 ?? "?"}`}
                message={`${d.text1.slice(0, 80)}… / ${d.text2.slice(0, 80)}…`}
                status="issue"
                onLocate={() => locate(d.para_idx1, d.num1 ?? undefined)}
              />
            ))}
          </ul>
        );
      case "missing":
        return missing.length === 0 && unused.length === 0 ? (
          <EmptyState Icon={CheckCircle2} tone="success" message="No missing or unused references." />
        ) : (
          <ul className="space-y-2">
            {missing.map((m, i) => (
              <ItemCard
                key={`m-${i}`}
                title={m.citation ?? "Missing citation"}
                message={m.message}
                status="missing"
                onLocate={() =>
                  locate(m.para_idx, refNumberFromCitation(m.citation), m.citation)
                }
              />
            ))}
            {unused.map((u, i) => (
              <ItemCard
                key={`u-${i}`}
                title={u.citation ?? "Unused reference"}
                message={u.message}
                status="unused"
                onLocate={() =>
                  locate(u.para_idx, refNumberFromCitation(u.citation), u.citation)
                }
              />
            ))}
          </ul>
        );
      case "changes":
        return (
          <EmptyState
            Icon={Sparkles}
            message={
              <>
                Run <span className="font-semibold text-navy-700">Validate</span> to detect
                auto-corrections. Approved changes will appear here.
              </>
            }
          />
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <style>{`
        .rr-para-flash { animation: rr-para-flash 1.2s ease-out; }
        @keyframes rr-para-flash {
          0% { background-color: rgba(251, 191, 36, 0.35); }
          100% { background-color: transparent; }
        }
        .rr-bookmark { cursor: pointer; text-decoration: none; color: inherit; }
        .rr-bookmark[data-bookmark-role="source"] {
          color: rgb(2 132 199); /* sky-600 */
          text-decoration: underline dotted rgba(2, 132, 199, 0.4);
          text-underline-offset: 2px;
        }
        .rr-bookmark[data-bookmark-role="source"]:hover {
          text-decoration-color: rgb(2 132 199);
        }
      `}</style>

      {/* Header — Style + Format dropdowns, at-a-glance count dots, Validate */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <label className="flex-1 flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-navy-500 shrink-0">
              Style
            </span>
            <select
              value={styleOverride}
              onChange={(e) => setStyleOverride(e.target.value as any)}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md bg-white text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400"
            >
              <option value="AUTO">Auto · {detectedStyle}</option>
              <option value="AMA">AMA</option>
              <option value="APA">APA</option>
            </select>
          </label>
          <label className="flex-1 flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-navy-500 shrink-0">
              Format
            </span>
            <select
              value={citationFormat}
              onChange={(e) => setCitationFormat(e.target.value as any)}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md bg-white text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-400"
            >
              <option value="auto">Auto-detect</option>
              <option value="superscript">Superscript</option>
              <option value="bracket">Bracket</option>
              <option value="paren">Parenthesis</option>
              <option value="plain">Plain</option>
            </select>
          </label>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <CountDot count={issueCount} tone="error" />
          <CountDot count={matchedCount} tone="success" />
          <span
            className="inline-flex items-center gap-1 text-[10px] text-navy-500 tabular-nums"
            title={
              lastValidatedAt
                ? `Last validated at ${lastValidatedAt.toLocaleTimeString()}`
                : "Not yet validated"
            }
          >
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            {lastValidatedAt
              ? lastValidatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "—"}
          </span>
          <Minus className="w-3 h-3 text-slate-300" aria-hidden="true" />
          <button
            type="button"
            onClick={handleValidate}
            disabled={saveMutation.isPending || validateMutation.isPending}
            className="ml-auto inline-flex items-center gap-1.5 h-7 px-3 text-xs font-semibold rounded-md bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-subtle transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${saveMutation.isPending || validateMutation.isPending ? "animate-spin" : ""}`}
            />
            Validate
          </button>
        </div>
      </div>

      {/* Tab strip */}
      <div className="shrink-0 flex border-b border-slate-200 bg-white">
        <TabBtn
          active={activeTab === "citations"}
          count={citationCount}
          label="Citations"
          Icon={Hash}
          onClick={() => setActiveTab("citations")}
          tone="info"
        />
        <TabBtn
          active={activeTab === "references"}
          count={referenceCount}
          label="Refs"
          Icon={BookOpen}
          onClick={() => setActiveTab("references")}
          tone="info"
        />
        <TabBtn
          active={activeTab === "changes"}
          count={changesCount}
          label="Changes"
          Icon={GitBranch}
          onClick={() => setActiveTab("changes")}
          tone="info"
        />
        <TabBtn
          active={activeTab === "issues"}
          count={issueCount}
          label="Issues"
          Icon={AlertTriangle}
          onClick={() => setActiveTab("issues")}
          tone={issueCount > 0 ? "error" : "info"}
        />
        <TabBtn
          active={activeTab === "missing"}
          count={missingCount}
          label="Missing"
          Icon={SearchX}
          onClick={() => setActiveTab("missing")}
          tone={missingCount > 0 ? "warning" : "info"}
        />
      </div>

      {/* Persistent workspace block: 2×2 stat grid, Style Highlight Manager, filter chips */}
      <div className="shrink-0 px-3 pt-3 pb-2 space-y-2.5 bg-white border-b border-slate-100">
        <div className="grid grid-cols-2 gap-2">
          <StatCard Icon={Hash} count={referenceCount} label="References" tone="info" />
          <StatCard Icon={BookOpen} count={citationCount} label="Citations" tone="info" />
          <StatCard
            Icon={CheckCircle2}
            count={matchedCount}
            label="Matched"
            tone={matchedCount > 0 ? "success" : "muted"}
          />
          <StatCard
            Icon={AlertTriangle}
            count={issueCount}
            label="Issues"
            tone={issueCount > 0 ? "error" : "muted"}
          />
        </div>

        <button
          type="button"
          className="w-full flex items-center justify-between text-left px-2.5 py-2 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-100 text-amber-600 shrink-0">
              <Sparkles className="w-3.5 h-3.5" />
            </span>
            <span className="text-xs font-semibold text-navy-800 truncate">
              Style Highlight Manager
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip active={filter === "all"} label="All" onClick={() => setFilter("all")} />
          <FilterChip
            active={filter === "matched"}
            label="Matched"
            dotColor="bg-emerald-500"
            onClick={() => setFilter("matched")}
          />
          <FilterChip
            active={filter === "missing"}
            label="Missing"
            dotColor="bg-rose-500"
            onClick={() => setFilter("missing")}
          />
          <FilterChip
            active={filter === "unused"}
            label="Unused"
            dotColor="bg-amber-500"
            onClick={() => setFilter("unused")}
          />
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5">{renderBody()}</div>

      {/* Status/error banner */}
      {(saveMutation.errorMessage || saveMutation.statusMessage) && (
        <div
          className={`shrink-0 px-3 py-1.5 text-[11px] font-medium border-t ${
            saveMutation.errorMessage
              ? "bg-error-50 text-error-700 border-error-200"
              : "bg-success-50 text-success-700 border-success-200"
          }`}
        >
          {saveMutation.errorMessage ?? saveMutation.statusMessage}
        </div>
      )}

      {/* Footer — single Save & Export flow. Save & Convert to DOCX still
          lives in the editor footer and also saves reference changes first. */}
      <div className="shrink-0 px-3 py-2.5 border-t border-slate-200 bg-white flex items-center gap-2">
        <button
          type="button"
          onClick={handleSaveAndExport}
          disabled={saveMutation.isPending || !reviewQuery.data.export_href}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-subtle transition-colors"
        >
          {saveMutation.isPending ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {saveMutation.isPending ? "Saving…" : "Save & Export"}
        </button>
      </div>
    </div>
  );
}

// Given the inner text of a bracket/superscript group like "24, 25, 26" or
// "24-27", decide whether `refNumber` sits inside it.
function refNumberInGroup(inner: string, refNumber: number): boolean {
  const parts = inner.split(",");
  for (const raw of parts) {
    const p = raw.trim();
    if (/^\d+$/.test(p)) {
      if (Number.parseInt(p, 10) === refNumber) return true;
      continue;
    }
    const rangeMatch = p.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const a = Number.parseInt(rangeMatch[1], 10);
      const b = Number.parseInt(rangeMatch[2], 10);
      if (refNumber >= Math.min(a, b) && refNumber <= Math.max(a, b)) return true;
    }
  }
  return false;
}

// Extract the numeric ref from a citation label like "[25]" or "25" — returns
// undefined if the label isn't purely numeric so we can fall back to text.
function refNumberFromCitation(citation: string | null | undefined): number | undefined {
  if (!citation) return undefined;
  const m = citation.match(/\d+/);
  if (!m) return undefined;
  return Number.parseInt(m[0], 10);
}

/* ─── Presentational helpers ───────────────────────────────────────────── */

type Tone = "error" | "success" | "warning" | "info" | "muted";

// Status metadata keyed by row.status — drives icon, text color, left border
// stripe, and pill color. Kept in one place so palette stays consistent.
const STATUS_META: Record<
  string,
  { Icon: ComponentType<{ className?: string }>; text: string; stripe: string; label: string; numberText: string }
> = {
  ok: {
    Icon: CheckCircle2,
    text: "text-emerald-600",
    stripe: "border-l-emerald-400",
    label: "Matched",
    numberText: "text-emerald-700",
  },
  missing: {
    Icon: XCircle,
    text: "text-rose-600",
    stripe: "border-l-rose-500",
    label: "Missing",
    numberText: "text-rose-700",
  },
  unused: {
    Icon: MinusCircle,
    text: "text-amber-600",
    stripe: "border-l-amber-400",
    label: "Unused",
    numberText: "text-amber-700",
  },
  issue: {
    Icon: AlertTriangle,
    text: "text-rose-600",
    stripe: "border-l-rose-500",
    label: "Issue",
    numberText: "text-rose-700",
  },
  default: {
    Icon: AlertCircle,
    text: "text-slate-500",
    stripe: "border-l-slate-300",
    label: "Info",
    numberText: "text-slate-700",
  },
};

// Prominent 2x2 stat card — big number, small label, watermark icon on the
// right. Tone drives background tint and number color; muted = zero state.
function StatCard({
  Icon,
  count,
  label,
  tone,
}: {
  Icon: ComponentType<{ className?: string }>;
  count: number;
  label: string;
  tone: Tone;
}) {
  const styles: Record<Tone, { bg: string; icon: string; number: string; label: string }> = {
    error: {
      bg: "bg-rose-50 border-rose-200",
      icon: "text-rose-300",
      number: "text-rose-700",
      label: "text-rose-700",
    },
    success: {
      bg: "bg-emerald-50 border-emerald-200",
      icon: "text-emerald-300",
      number: "text-emerald-700",
      label: "text-emerald-700",
    },
    warning: {
      bg: "bg-amber-50 border-amber-200",
      icon: "text-amber-300",
      number: "text-amber-700",
      label: "text-amber-700",
    },
    info: {
      bg: "bg-slate-50 border-slate-200",
      icon: "text-slate-300",
      number: "text-navy-800",
      label: "text-navy-600",
    },
    muted: {
      bg: "bg-slate-50 border-slate-200",
      icon: "text-slate-300",
      number: "text-navy-800",
      label: "text-navy-500",
    },
  };
  const s = styles[tone];
  return (
    <div className={`relative overflow-hidden rounded-lg border ${s.bg} px-3 py-2.5`}>
      <Icon className={`absolute right-2 top-2 w-5 h-5 ${s.icon}`} aria-hidden="true" />
      <div className={`text-2xl font-extrabold tabular-nums leading-none ${s.number}`}>{count}</div>
      <div className={`mt-1 text-[10px] font-bold uppercase tracking-wide ${s.label}`}>{label}</div>
    </div>
  );
}

// Small circular badge next to the Validate button — a compact at-a-glance
// counter for issues / matched / missing without taking up header real estate.
function CountDot({ count, tone }: { count: number; tone: Tone }) {
  const cls: Record<Tone, string> = {
    error: count > 0 ? "bg-rose-500 text-white" : "bg-rose-100 text-rose-500",
    success: count > 0 ? "bg-emerald-500 text-white" : "bg-emerald-100 text-emerald-600",
    warning: count > 0 ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-600",
    info: count > 0 ? "bg-sky-500 text-white" : "bg-sky-100 text-sky-600",
    muted: "bg-slate-100 text-slate-500",
  };
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums ${cls[tone]}`}
    >
      {count}
    </span>
  );
}

function FilterChip({
  active,
  label,
  dotColor,
  onClick,
}: {
  active: boolean;
  label: string;
  dotColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-semibold border transition-colors ${
        active
          ? "bg-navy-800 text-white border-navy-800"
          : "bg-white text-navy-700 border-slate-300 hover:bg-slate-50"
      }`}
    >
      {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} aria-hidden="true" />}
      {label}
    </button>
  );
}

function TabBtn({
  active,
  count,
  label,
  Icon,
  onClick,
  tone = "info",
}: {
  active: boolean;
  count: number;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  tone?: Tone;
}) {
  const toneAccent: Record<Tone, { underline: string; icon: string; badge: string }> = {
    error: {
      underline: "border-rose-500",
      icon: "text-rose-600",
      badge: "bg-rose-500 text-white",
    },
    warning: {
      underline: "border-amber-500",
      icon: "text-amber-600",
      badge: "bg-amber-500 text-white",
    },
    success: {
      underline: "border-emerald-500",
      icon: "text-emerald-600",
      badge: "bg-emerald-500 text-white",
    },
    info: {
      underline: "border-navy-700",
      icon: "text-navy-700",
      badge: "bg-slate-200 text-slate-700",
    },
    muted: {
      underline: "border-slate-400",
      icon: "text-slate-500",
      badge: "bg-slate-100 text-slate-400",
    },
  };
  const t = toneAccent[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-0 py-2 px-1 text-[11px] font-semibold flex items-center justify-center gap-1 border-b-2 transition-colors cursor-pointer ${
        active
          ? `${t.underline} bg-white`
          : "border-transparent text-navy-500 hover:text-navy-800 hover:bg-slate-50"
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${active ? t.icon : count > 0 ? t.icon : "text-slate-400"}`} />
      <span className={active ? "text-navy-900" : ""}>{label}</span>
      {count > 0 && (
        <span
          className={`inline-flex items-center justify-center min-w-[16px] px-1 h-4 rounded-full text-[9px] font-bold tabular-nums ${t.badge}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ItemCard({
  title,
  message,
  status,
  onLocate,
}: {
  title: string;
  message: string;
  status: string;
  onLocate: () => boolean;
}) {
  const meta = STATUS_META[status] ?? STATUS_META.default;
  const [notFound, setNotFound] = useState(false);
  const handleLocate = () => {
    const ok = onLocate();
    if (!ok) {
      setNotFound(true);
      setTimeout(() => setNotFound(false), 1500);
    }
  };
  return (
    <li
      className={`bg-white rounded-md border border-slate-200 border-l-[3px] ${meta.stripe} px-3 py-2 flex items-center gap-3 hover:shadow-sm transition-shadow`}
    >
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-bold tabular-nums ${meta.numberText}`}>{title}</div>
        {message && (
          <div className="text-[11px] text-navy-500 mt-0.5 line-clamp-2 leading-snug">{message}</div>
        )}
      </div>
      <button
        type="button"
        onClick={handleLocate}
        className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold transition-colors ${
          notFound
            ? "text-rose-500"
            : "text-sky-600 hover:text-sky-700 hover:underline"
        }`}
      >
        {notFound ? "Not found" : "Locate"}
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </li>
  );
}

function EmptyState({
  Icon = Inbox,
  message,
  tone = "muted",
}: {
  Icon?: ComponentType<{ className?: string }>;
  message: React.ReactNode;
  tone?: "muted" | "success";
}) {
  const iconCls = tone === "success" ? "text-emerald-400" : "text-slate-300";
  return (
    <div className="px-4 py-10 flex flex-col items-center gap-2 text-center">
      <Icon className={`w-8 h-8 ${iconCls}`} />
      <div className="text-xs text-navy-500 max-w-[240px] leading-relaxed">{message}</div>
    </div>
  );
}
