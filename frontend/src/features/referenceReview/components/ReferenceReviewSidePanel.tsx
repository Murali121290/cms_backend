import { useEffect, useMemo, useState } from "react";
import type { ComponentType, RefObject } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bookmark as BookmarkIcon,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Download,
  GitBranch,
  Hash,
  Inbox,
  Link2,
  Minus,
  MinusCircle,
  Plus,
  RefreshCw,
  SearchX,
  Sparkles,
  Trash2,
  Unlink,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { WysiwygEditorHandle } from "@/features/editor";

import { useReferenceReviewQuery } from "../useReferenceReviewQuery";
import { useReferenceSave } from "../useReferenceSave";
import { useReferenceValidateOnly } from "../useReferenceValidateOnly";
import { stampBookmarks } from "../stampBookmarks";
import { useUpsertManualLink } from "../useManualLinks";
import { ReferenceCard } from "./ReferenceCard";
import { LinkBookmarkModal, type LinkBookmarkFormValues } from "./LinkBookmarkModal";
import {
  addManualBookmark,
  getUnlinkedBookmarks,
  listBookmarks,
  markBookmarkLinked,
  markBookmarksLinked,
  removeBookmark,
  goToBookmark,
  type BookmarkInfo,
} from "../bookmarkOps";

type PanelTab = "citations" | "references" | "changes" | "issues" | "missing" | "bookmarks";
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
  const [bookmarks, setBookmarks] = useState<BookmarkInfo[]>([]);
  const [bookmarkSort, setBookmarkSort] = useState<"name" | "location">("name");
  const [addModal, setAddModal] = useState<
    | { open: false }
    | { open: true; range: { from: number; to: number }; snippet: string; error?: string }
  >({ open: false });
  const [linkModal, setLinkModal] = useState<
    | { open: false }
    | { open: true; bookmark: BookmarkInfo; error?: string }
  >({ open: false });

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

  const manualLinks = logs?.manual_links ?? [];

  // Bookmarks the auto-linker (and any persisted manual link) can't resolve to a
  // reference. Computed from the live editor state so newly-added bookmarks show
  // up without a round-trip.
  const unlinkedBookmarks = useMemo(
    () =>
      getUnlinkedBookmarks(
        editorRef.current?.editor,
        citationPairs,
        referenceEntries,
        manualLinks,
      ),
    // Depend on `bookmarks` (which is refreshed on every editor transaction) so
    // the derived list stays in sync with editor edits without re-running on
    // every render.
    [bookmarks, citationPairs, referenceEntries, manualLinks, editorRef],
  );

  const citationCount = citationPairs.length;
  const referenceCount = referenceEntries.length;
  const changesCount = 0;
  const issueCount = issues.length + duplicates.length + (logs?.sequence_issues?.length ?? 0);
  const missingCount = missing.length + unused.length + unlinkedBookmarks.length;
  // Matched = auto-linked citations + every manually-linked bookmark. Exclude
  // citation_pairs the merge already flipped (marked `manual_linked`) so they
  // aren't counted twice — once from the pair, once from the manual link.
  // Each user-created link contributes exactly +1 regardless of whether the
  // target reference was previously unused, missing, or already cited.
  const autoMatchedCount = citationPairs.filter(
    (p) => p.status === "ok" && !p.manual_linked,
  ).length;
  const matchedCount = autoMatchedCount + manualLinks.length;

  const upsertLinkMutation = useUpsertManualLink(fileId);

  // Auto-apply Bookmark marks after each validate/refetch so citations and
  // reference entries become clickable REF{n} anchors that also survive the
  // DOCX round-trip. Reuses reference_entries + citation_pairs — no
  // separate detection logic.
  useEffect(() => {
    if (!reviewQuery.data) return;
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const manualLinkNames = (logs?.manual_links ?? []).map((lnk) => lnk.bookmark_name);
    stampBookmarks(editor, referenceEntries, citationPairs, manualLinkNames);
    // Rehydrate the linked visual state from persisted manual_links so the
    // style survives reloads and any external refetch.
    markBookmarksLinked(editor, manualLinkNames);
    setBookmarks(listBookmarks(editor));
  }, [reviewQuery.data, referenceEntries, citationPairs, editorRef, logs]);

  // Keep the panel's bookmark list in sync with editor edits (manual add,
  // delete, or edits that split marks). Subscribes on mount and refreshes
  // on every doc transaction — the read is O(doc) but only runs while the
  // panel is mounted, and the list length is small.
  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const refresh = () => setBookmarks(listBookmarks(editor));
    refresh();
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editorRef, reviewQuery.data]);

  const openAddBookmarkModal = () => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      setAddModal({
        open: true,
        range: { from, to },
        snippet: "",
        error: "Select some text in the editor first, then click Add Bookmark.",
      });
      return;
    }
    const snippet = editor.state.doc.textBetween(from, to, " ").slice(0, 80);
    setAddModal({ open: true, range: { from, to }, snippet });
  };

  const submitAddBookmark = (rawName: string) => {
    const editor = editorRef.current?.editor;
    if (!editor || !addModal.open) return;
    const res = addManualBookmark(editor, rawName, addModal.range);
    if (!res.ok) {
      setAddModal({ ...addModal, error: res.error });
      return;
    }
    setBookmarks(listBookmarks(editor));
    setAddModal({ open: false });
  };

  const handleDeleteBookmark = (bm: BookmarkInfo) => {
    if (bm.role !== "manual") return; // auto-bookmarks come back on next validate
    const editor = editorRef.current?.editor;
    if (!editor) return;
    if (!window.confirm(`Delete bookmark "${bm.name}"?`)) return;
    removeBookmark(editor, bm.name, "manual");
    setBookmarks(listBookmarks(editor));
  };

  const handleGoToBookmark = (bm: BookmarkInfo) => {
    goToBookmark(editorRef.current?.editor, bm.name);
  };

  const openLinkModal = (bm: BookmarkInfo) => {
    setLinkModal({ open: true, bookmark: bm });
  };

  const submitLinkBookmark = async (values: LinkBookmarkFormValues) => {
    if (!linkModal.open) return;
    try {
      await upsertLinkMutation.mutateAsync({
        bookmark_name: values.bookmark_name,
        ref_number: values.ref_number,
        ref_text: values.ref_text,
        citation_text: values.citation_text,
      });
      // Immediate visual feedback — flip the linked flag on the bookmark
      // mark in the editor so the user sees the linked style right now,
      // without waiting for the refetch to resolve.
      markBookmarkLinked(editorRef.current?.editor, values.bookmark_name);
      // Close immediately — the mutation's onSuccess invalidates the
      // reference-review query, so React Query will refetch in the background
      // and recompute counts / statuses. Awaiting the refetch here made the
      // modal appear to "do nothing" if the refetch itself hiccuped.
      setLinkModal({ open: false });
      reviewQuery.refetch().catch(() => {
        /* invalidation already scheduled a refetch; a stray failure here is
           non-fatal for the link itself */
      });
    } catch (err: any) {
      const message = err?.response?.data?.detail || err?.message || "Failed to save link.";
      setLinkModal({ ...linkModal, error: String(message) });
    }
  };

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

  // Validate ONLY — hits the validate-only endpoint against whatever HTML
  // was last saved. Does not persist current editor edits; the user must
  // click Save & Export first if they want fresh edits validated.
  const handleValidate = async () => {
    if (fileId == null) return;
    try {
      await validateMutation.mutateAsync({
        style: styleOverride === "AUTO" ? undefined : styleOverride,
        citationFormat: citationFormat === "auto" ? undefined : citationFormat,
      });
      setLastValidatedAt(new Date());
      await reviewQuery.refetch();
    } catch {
      /* surfaced via validateMutation error state */
    }
  };

  // Save ONLY, then trigger the export download. No implicit validate/refetch:
  // the save endpoint already refreshes server-side state and the export URL
  // is stable, so refetching would just cause the panel counts to churn.
  const handleSaveAndExport = async () => {
    const editor = editorRef.current?.editor;
    if (!editor || !reviewQuery.data) return;
    try {
      await saveMutation.save(reviewQuery.data.save_endpoint, editor.getHTML());
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
              <ReferenceCard
                key={i}
                fileId={fileId}
                index={i}
                entry={{
                  number: r.number,
                  text: r.text,
                  para_idx: r.para_idx,
                  is_cited: r.is_cited,
                }}
                onLocate={() => locate(r.para_idx, r.number ?? undefined, r.text)}
                onSaved={() => reviewQuery.refetch()}
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
        return missing.length === 0 && unused.length === 0 && unlinkedBookmarks.length === 0 ? (
          <EmptyState
            Icon={CheckCircle2}
            tone="success"
            message="No missing references, unused references, or unlinked bookmarks."
          />
        ) : (
          <div className="space-y-4">
            {(missing.length > 0 || unused.length > 0) && (
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
            )}
            {unlinkedBookmarks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <Unlink className="w-3.5 h-3.5 text-sky-600" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-navy-600">
                    Unlinked Bookmarks
                  </span>
                  <span className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full text-[9px] font-bold tabular-nums bg-sky-100 text-sky-700">
                    {unlinkedBookmarks.length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {unlinkedBookmarks.map((bm) => (
                    <UnlinkedBookmarkCard
                      key={`ub-${bm.name}`}
                      bookmark={bm}
                      onGoTo={() => handleGoToBookmark(bm)}
                      onLink={() => openLinkModal(bm)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
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
      case "bookmarks":
        return renderBookmarksTab();
    }
  };

  const renderBookmarksTab = () => {
    const sorted = [...bookmarks].sort((a, b) => {
      if (bookmarkSort === "location") return a.from - b.from;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openAddBookmarkModal}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-semibold rounded-md bg-navy-800 text-white hover:bg-navy-900 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Bookmark
          </button>
          <div className="ml-auto flex items-center gap-1 text-[10px] text-navy-500">
            <span className="uppercase tracking-wide font-semibold">Sort</span>
            <button
              type="button"
              onClick={() => setBookmarkSort("name")}
              className={`px-1.5 py-0.5 rounded ${bookmarkSort === "name" ? "bg-navy-100 text-navy-800 font-semibold" : "text-navy-500 hover:text-navy-700"}`}
            >
              Name
            </button>
            <button
              type="button"
              onClick={() => setBookmarkSort("location")}
              className={`px-1.5 py-0.5 rounded ${bookmarkSort === "location" ? "bg-navy-100 text-navy-800 font-semibold" : "text-navy-500 hover:text-navy-700"}`}
            >
              Location
            </button>
          </div>
        </div>
        {sorted.length === 0 ? (
          <EmptyState
            Icon={BookmarkIcon}
            message={
              <>
                No bookmarks yet. Click <span className="font-semibold">Validate</span> to
                generate <span className="font-mono text-[10px]">REF{"{n}"}</span> anchors,
                or select text and click <span className="font-semibold">Add Bookmark</span>.
              </>
            }
          />
        ) : (
          <ul className="space-y-1.5">
            {sorted.map((bm) => (
              <BookmarkRow
                key={`${bm.name}::${bm.role}`}
                bm={bm}
                onGoTo={() => handleGoToBookmark(bm)}
                onDelete={bm.role === "manual" ? () => handleDeleteBookmark(bm) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    );
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
        .rr-bookmark[data-bookmark-role="source"],
        .rr-bookmark[data-bookmark-linked="true"] {
          color: rgb(2 132 199); /* sky-600 */
          text-decoration: underline dotted rgba(2, 132, 199, 0.4);
          text-underline-offset: 2px;
        }
        .rr-bookmark[data-bookmark-role="source"]:hover,
        .rr-bookmark[data-bookmark-linked="true"]:hover {
          text-decoration-color: rgb(2 132 199);
        }
        /* Bookmark start/end indicators — purely a visual affordance on the
           existing <a class="rr-bookmark"> that the Bookmark mark already
           renders. No new bookmark, no schema change. Applied to any linked
           in-text citation (auto-linked source, or manual-linked bookmark);
           skipped for target-role marks because those span whole reference
           entries and brackets around a paragraph would be noise. */
        .rr-bookmark[data-bookmark-role="source"]::before,
        .rr-bookmark[data-bookmark-linked="true"]:not([data-bookmark-role="target"])::before {
          content: "⌈";
          color: rgb(2 132 199);
          font-size: 0.9em;
          margin-right: 1px;
          text-decoration: none;
          user-select: none;
          opacity: 0.75;
        }
        .rr-bookmark[data-bookmark-role="source"]::after,
        .rr-bookmark[data-bookmark-linked="true"]:not([data-bookmark-role="target"])::after {
          content: "⌉";
          color: rgb(2 132 199);
          font-size: 0.9em;
          margin-left: 1px;
          text-decoration: none;
          user-select: none;
          opacity: 0.75;
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
            disabled={validateMutation.isPending}
            className="ml-auto inline-flex items-center gap-1.5 h-7 px-3 text-xs font-semibold rounded-md bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-subtle transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${validateMutation.isPending ? "animate-spin" : ""}`}
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
        <TabBtn
          active={activeTab === "bookmarks"}
          count={bookmarks.length}
          label="Marks"
          Icon={BookmarkIcon}
          onClick={() => setActiveTab("bookmarks")}
          tone="info"
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

      {addModal.open && (
        <AddBookmarkModal
          snippet={addModal.snippet}
          error={addModal.error}
          onSubmit={submitAddBookmark}
          onCancel={() => setAddModal({ open: false })}
        />
      )}

      {linkModal.open && (
        <LinkBookmarkModal
          bookmarkName={linkModal.bookmark.name}
          bookmarkSnippet={linkModal.bookmark.snippet}
          referenceEntries={referenceEntries}
          isSubmitting={upsertLinkMutation.isPending}
          error={linkModal.error}
          onSubmit={submitLinkBookmark}
          onCancel={() => {
            if (upsertLinkMutation.isPending) return;
            setLinkModal({ open: false });
          }}
        />
      )}
    </div>
  );
}

function UnlinkedBookmarkCard({
  bookmark,
  onGoTo,
  onLink,
}: {
  bookmark: BookmarkInfo;
  onGoTo: () => void;
  onLink: () => void;
}) {
  return (
    <li className="bg-white rounded-md border border-slate-200 border-l-[3px] border-l-sky-400 px-3 py-2 flex items-center gap-3 hover:shadow-sm transition-shadow">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <BookmarkIcon className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          <span className="text-sm font-semibold text-navy-800 truncate font-mono">
            {bookmark.name}
          </span>
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200">
            {bookmark.role}
          </span>
        </div>
        {bookmark.snippet && (
          <div className="text-[11px] text-navy-500 mt-0.5 line-clamp-1 leading-snug">
            {bookmark.snippet}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onGoTo}
        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:text-sky-700 hover:underline"
      >
        Go To
        <ArrowUpRight className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={onLink}
        className="shrink-0 inline-flex items-center gap-1 h-6 px-2 text-[11px] font-semibold rounded-md bg-emerald-500 text-white hover:bg-emerald-600"
      >
        <Link2 className="w-3 h-3" />
        Link Reference
      </button>
    </li>
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

function BookmarkRow({
  bm,
  onGoTo,
  onDelete,
}: {
  bm: BookmarkInfo;
  onGoTo: () => void;
  onDelete?: () => void;
}) {
  const rolePill =
    bm.role === "manual"
      ? "bg-sky-50 text-sky-700 border-sky-200"
      : bm.role === "target"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <li className="bg-white rounded-md border border-slate-200 px-3 py-2 flex items-center gap-3">
      <BookmarkIcon
        className={`w-4 h-4 shrink-0 ${bm.role === "manual" ? "text-sky-500" : "text-slate-400"}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-navy-800 truncate">{bm.name}</span>
          <span
            className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${rolePill}`}
          >
            {bm.role}
          </span>
        </div>
        {bm.snippet && (
          <div className="text-[11px] text-navy-500 mt-0.5 line-clamp-1 leading-snug">
            {bm.snippet}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onGoTo}
        className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:text-sky-700 hover:underline"
      >
        Go To
        <ArrowUpRight className="w-3 h-3" />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="Delete bookmark"
          className="shrink-0 p-1 rounded text-rose-500 hover:bg-rose-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  );
}

function AddBookmarkModal({
  snippet,
  error,
  onSubmit,
  onCancel,
}: {
  snippet: string;
  error?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const disabled = !snippet; // no selection was captured
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[360px] max-w-[90vw] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <BookmarkIcon className="w-4 h-4 text-navy-700" />
          <h3 className="text-sm font-bold text-navy-800">Add Bookmark</h3>
        </div>
        {snippet && (
          <div className="mb-3 p-2 rounded-md bg-slate-50 border border-slate-200">
            <div className="text-[10px] uppercase font-bold tracking-wide text-navy-500 mb-1">
              Selected text
            </div>
            <div className="text-xs text-navy-800 line-clamp-2 italic">"{snippet}"</div>
          </div>
        )}
        <label className="block">
          <span className="text-[10px] uppercase font-bold tracking-wide text-navy-500">
            Bookmark name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !disabled) onSubmit(name);
              if (e.key === "Escape") onCancel();
            }}
            autoFocus
            disabled={disabled}
            placeholder="e.g. ChapterIntro"
            className="mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-navy-400 disabled:bg-slate-100"
          />
        </label>
        <div className="mt-1 text-[10px] text-navy-500">
          Letters, digits, or underscore; must start with a letter; max 40 chars.
        </div>
        {error && (
          <div className="mt-2 text-[11px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1">
            {error}
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 h-8 text-xs font-semibold rounded-md text-navy-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(name)}
            disabled={disabled}
            className="px-3 h-8 text-xs font-semibold rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
