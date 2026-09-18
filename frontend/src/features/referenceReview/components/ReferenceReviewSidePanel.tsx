import { useEffect, useMemo, useState } from "react";
import type { ComponentType, RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bookmark as BookmarkIcon,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
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
  MissingCitationLinkPopup,
  type MissingCitationLinkSubmit,
} from "./MissingCitationLinkPopup";
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
import { useCommentMutations } from "@/features/editor/useComments";

type PanelTab = "citations" | "references" | "changes" | "issues" | "missing" | "bookmarks";

/**
 * Collapse a citation string down to a stable comparison key so
 * `(AACN, 2015)`, `AACN, 2015`, and `"AACN,  2015"` all match. Used to
 * correlate manual_links back to the missing_references / citation_pairs
 * entries they resolve.
 */
function normalizeCiteKey(s: string): string {
  return (s || "")
    .replace(/[()[\]"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Author-query templates used by the Query button in the missing-citation
 * popup and (via `buildUnusedAqComment`) any future unused-reference flow.
 * Kept together so wording stays consistent with the copy-editor style
 * guide.
 */
function buildMissingAqComment(citation: string): string {
  return `AQ: The reference "${citation}" is cited in the text but not given in the list. Please provide complete publication details of this reference in the list or delete the citation from the text.`;
}
function buildUnusedAqComment(reference: string): string {
  return `AQ: The reference "${reference}" is given in the list but not cited in the text. Please cite the reference in the text or delete from the list.`;
}
type FilterKey = "all" | "matched" | "missing" | "unused";

interface Props {
  fileId: number | null;
  editorRef: RefObject<WysiwygEditorHandle | null>;
}

export function ReferenceReviewSidePanel({ fileId, editorRef }: Props) {
  const queryClient = useQueryClient();
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
  // Alt+R popup — opens for either:
  //   mode="missing":  the caret is on a missing citation (rose highlight,
  //                    role="missing" bookmark). The linking flow is shown
  //                    so the user can pick a candidate reference; Query
  //                    attaches the "cited but not listed" AQ.
  //   mode="unused":   the caret is on a reference-list entry that is not
  //                    cited (target-role bookmark whose reference_entry
  //                    has is_cited=false). Only Query is available — the
  //                    "given but not cited" AQ attaches to the reference
  //                    paragraph. No candidate linking (there's no citation
  //                    to link).
  // `citationText` doubles as reference text in unused mode; kept as one
  // field so the popup and comment plumbing don't fork.
  const [missingCiteModal, setMissingCiteModal] = useState<
    | { open: false }
    | {
        open: true;
        mode: "missing" | "unused";
        markName: string;
        markRole: "missing" | "target";
        citationText: string;
        author?: string;
        year?: string;
        paraIdx?: number;
        error?: string;
      }
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

  // Correlate manual links back to their originating missing-citation
  // entry so the entry drops out of the Missing tab / count once linked.
  //
  // Two correlation keys:
  //   1. Normalised citation text (`(AACN, 2015)` and `AACN, 2015` collapse
  //      to the same key), matched against both missing_references[].citation
  //      and citation_pairs[].citation.
  //   2. The paraIdx encoded in the manual-link's bookmark_name for links
  //      the Alt+R flow persisted — `missingcite_{paraIdx}_{offset}` — so a
  //      duplicate citation string on another paragraph doesn't get filtered
  //      by mistake.
  //
  // The server's merge_manual_links_into_logs keys on ref_number/ref_text
  // which are empty on a missing citation_pair, so it can't do this itself;
  // the merge still runs for other cases and this only augments it.
  const linkedCitationTexts = useMemo(() => {
    const s = new Set<string>();
    for (const lnk of manualLinks) {
      if (lnk.citation_text) s.add(normalizeCiteKey(lnk.citation_text));
    }
    return s;
  }, [manualLinks]);
  const linkedMissingParaIdxs = useMemo(() => {
    const s = new Set<number>();
    for (const lnk of manualLinks) {
      const m = /^missingcite_(-?\d+)_\d+$/.exec(lnk.bookmark_name);
      if (m) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n)) s.add(n);
      }
    }
    return s;
  }, [manualLinks]);

  const isManuallyLinkedMissing = (
    citation: string | null | undefined,
    para_idx: number | null | undefined,
  ): boolean => {
    const key = normalizeCiteKey(citation ?? "");
    if (key && linkedCitationTexts.has(key)) return true;
    if (para_idx != null && linkedMissingParaIdxs.has(para_idx)) return true;
    return false;
  };

  // Missing entries with a corresponding manual link are now Matched — drop
  // them from the Missing list so they can't appear in both places.
  const filteredMissing = useMemo(
    () => missing.filter((m) => !isManuallyLinkedMissing(m.citation, m.para_idx)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [missing, linkedCitationTexts, linkedMissingParaIdxs],
  );

  const citationCount = citationPairs.length;
  const referenceCount = referenceEntries.length;
  const changesCount = 0;
  const issueCount = issues.length + duplicates.length + (logs?.sequence_issues?.length ?? 0);
  const missingCount = filteredMissing.length + unused.length + unlinkedBookmarks.length;
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
  const commentMutations = useCommentMutations(fileId);

  // Auto-apply Bookmark marks after each validate/refetch so citations and
  // reference entries become clickable REF{n} anchors that also survive the
  // DOCX round-trip. Reuses reference_entries + citation_pairs — no
  // separate detection logic.
  //
  // WysiwygEditor populates `editorRef.current.editor` via useImperativeHandle
  // asynchronously after mount, so this effect may run before the ref is
  // ready. When that happens we retry a handful of animation frames so the
  // matched-citation stamps land on the first paint after the editor
  // initializes, rather than getting lost because deps never change again.
  useEffect(() => {
    if (!reviewQuery.data) return;

    const attempt = () => {
      const editor = editorRef.current?.editor;
      if (!editor) return false;
      const manualLinkNames = (logs?.manual_links ?? []).map((lnk) => lnk.bookmark_name);
      stampBookmarks(editor, referenceEntries, citationPairs, manualLinkNames);
      // Rehydrate the linked visual state from persisted manual_links so the
      // style survives reloads and any external refetch.
      markBookmarksLinked(editor, manualLinkNames);
      setBookmarks(listBookmarks(editor));
      return true;
    };

    if (attempt()) return;

    let cancelled = false;
    let attemptsLeft = 30; // ~500ms at 60fps — plenty for TipTap to init
    const retry = () => {
      if (cancelled) return;
      if (attempt() || attemptsLeft <= 0) return;
      attemptsLeft -= 1;
      requestAnimationFrame(retry);
    };
    requestAnimationFrame(retry);
    return () => {
      cancelled = true;
    };
  }, [reviewQuery.data, referenceEntries, citationPairs, editorRef, logs]);

  // Keep the panel's bookmark list in sync with editor edits (manual add,
  // delete, or edits that split marks). Subscribes on mount and refreshes
  // on every doc transaction — the read is O(doc) but only runs while the
  // panel is mounted, and the list length is small.
  //
  // Also re-applies stampBookmarks whenever the editor's doc content is
  // replaced (WysiwygEditor calls editor.commands.setContent on every
  // initialContent-prop change, which wipes previously stamped marks). We
  // watch the "update" event, compare doc sizes to detect a real content
  // swap vs. a keystroke, and re-run stampBookmarks so matched citations
  // regain their green highlight. Idempotent — extra runs are cheap.
  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const refresh = () => setBookmarks(listBookmarks(editor));
    refresh();
    editor.on("transaction", refresh);

    let lastDocSize = editor.state.doc.content.size;
    const onUpdate = () => {
      const size = editor.state.doc.content.size;
      // Small deltas = user edits; large deltas indicate a setContent replace.
      // Threshold picked loosely — any bulk change > 100 chars re-stamps.
      const delta = Math.abs(size - lastDocSize);
      lastDocSize = size;
      if (delta < 100) return;
      if (!reviewQuery.data) return;
      const manualLinkNames = (logs?.manual_links ?? []).map((lnk) => lnk.bookmark_name);
      stampBookmarks(editor, referenceEntries, citationPairs, manualLinkNames);
      markBookmarksLinked(editor, manualLinkNames);
      setBookmarks(listBookmarks(editor));
    };
    editor.on("update", onUpdate);

    return () => {
      editor.off("transaction", refresh);
      editor.off("update", onUpdate);
    };
  }, [editorRef, reviewQuery.data, referenceEntries, citationPairs, logs]);

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

  // ── Alt+R: missing citation → filtered candidates ──────────────────────
  // At the caret, find the innermost bookmark mark with role="missing" that
  // stampBookmarks stamped over the citation text. Look up its citation_pair
  // by (paraIdx, needle location) so we can populate the popup with the
  // right author/year and route candidate matching through the existing
  // POST /citation-candidates endpoint.
  const findMissingAtCursor = (): {
    mode: "missing" | "unused";
    markName: string;
    markRole: "missing" | "target";
    citationText: string;
    author?: string;
    year?: string;
    paraIdx?: number;
  } | null => {
    const editor = editorRef.current?.editor;
    if (!editor) return null;
    const { from, to } = editor.state.selection;

    // Prefer a mark that overlaps the caret or selection. Look for either
    // a missing-citation mark (highest priority: user explicitly wants to
    // link a missing citation) or a target mark whose corresponding
    // reference_entry is uncited (the "unused" case).
    type Hit = {
      role: "missing" | "target";
      name: string;
      from: number;
      to: number;
    };
    let missingHit: Hit | null = null;
    let targetHit: Hit | null = null;
    editor.state.doc.nodesBetween(
      Math.max(0, from - 1),
      Math.max(to, from + 1),
      (node: any, pos: number) => {
        if (missingHit) return false;
        if (!node.isText) return true;
        for (const m of node.marks) {
          if (m.type.name !== "bookmark" || !m.attrs?.name) continue;
          const role = m.attrs.role;
          if (role === "missing" && !missingHit) {
            missingHit = { role, name: m.attrs.name, from: pos, to: pos + node.nodeSize };
          } else if (role === "target" && !targetHit) {
            targetHit = { role, name: m.attrs.name, from: pos, to: pos + node.nodeSize };
          }
        }
        return true;
      },
    );

    if (missingHit) {
      const foundMark = missingHit as Hit;
      const citationText = editor.state.doc
        .textBetween(foundMark.from, foundMark.to, " ")
        .trim();
      let author: string | undefined;
      let year: string | undefined;
      let paraIdx: number | undefined;
      const m = /^missingcite_(-?\d+)_(\d+)$/.exec(foundMark.name);
      if (m) {
        const pIdx = Number.parseInt(m[1], 10);
        if (Number.isFinite(pIdx)) paraIdx = pIdx;
      }
      for (const p of citationPairs) {
        if (p.status !== "missing") continue;
        if (paraIdx != null && p.para_idx !== paraIdx) continue;
        const cleaned = (p.citation ?? "").replace(/^\((.*)\)$/, "$1").trim();
        if (
          (p.author && citationText.includes(p.author)) ||
          (cleaned && citationText.includes(cleaned)) ||
          (p.citation && citationText === p.citation)
        ) {
          author = p.author ?? undefined;
          year = p.year ?? undefined;
          break;
        }
      }
      return {
        mode: "missing",
        markRole: "missing",
        markName: foundMark.name,
        citationText,
        author,
        year,
        paraIdx,
      };
    }

    if (targetHit) {
      const foundMark = targetHit as Hit;
      // Resolve the target mark to a reference_entry. Names are `ref_{N}`
      // (positional or Vancouver number). is_cited=false means it's an
      // unused reference — the case we want to open the Query popup for.
      const nameMatch = /^ref_(\d+)$/.exec(foundMark.name);
      const n = nameMatch ? Number.parseInt(nameMatch[1], 10) : NaN;
      let refEntry: (typeof referenceEntries)[number] | undefined;
      if (Number.isFinite(n)) {
        refEntry = referenceEntries.find((e) => e.number === n);
      }
      if (!refEntry) {
        // Positional fallback: names emitted by stampBookmarks for entries
        // without a numeric label are indexed by document order.
        const sorted = [...referenceEntries].sort((a, b) => a.para_idx - b.para_idx);
        if (Number.isFinite(n) && n >= 1 && n <= sorted.length) {
          refEntry = sorted[n - 1];
        }
      }
      if (!refEntry || refEntry.is_cited) return null;

      // Compose a short subject for the popup header. Prefer a compact
      // "First-author et al., year" style so the AQ template reads
      // naturally when we substitute {citationText} into it.
      const refText = refEntry.text || "";
      const yearMatch = refText.match(/\b(19|20)\d{2}\b/);
      const yr = yearMatch ? yearMatch[0] : "";
      const firstSurname = (refText.split(/[,\.]/)[0] || "").trim();
      const hasEtAl = /,\s*[A-Z][a-z]+/.test(refText);
      const subject = firstSurname
        ? `${firstSurname}${hasEtAl ? " et al." : ""}${yr ? `, ${yr}` : ""}`
        : refText.slice(0, 80);

      return {
        mode: "unused",
        markRole: "target",
        markName: foundMark.name,
        citationText: subject,
        year: yr || undefined,
        paraIdx: refEntry.para_idx,
      };
    }

    return null;
  };

  // Alt+R / Option+R — open the missing-citation candidates popup for the
  // citation under the caret.
  //
  // macOS wrinkle: Option+letter produces a "special" character on the US
  // layout (Option+R = "®", Option+T = "†", …). If we don't preventDefault
  // early, the ® lands in the doc as text before our handler even decides
  // whether to open the popup. Two things make this robust:
  //   1. Detect the physical key with `e.code === "KeyR"` — `e.key` is "®"
  //      on macOS, "r"/"R" on Windows, and Firefox/Linux may give either.
  //   2. Attach in capture phase and preventDefault the moment we see the
  //      combo, whether or not a missing citation is under the caret. That
  //      wins the race against TipTap's own keydown → beforeinput pipeline
  //      that would otherwise insert the character.
  //
  // Also guard `beforeinput` so that if a Mac browser somehow tries to
  // synthesize the ® text-insert (e.g. via a queued IME event), the
  // insertion is still cancelled while an Option+R keydown is pending.
  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;

    // True from the moment we see Alt+R keydown until keyup. Used to swallow
    // any beforeinput that fires between them on macOS.
    let altRPending = false;

    const isAltR = (e: KeyboardEvent): boolean => {
      // Any Ctrl/Cmd/Shift held → not our shortcut; let native shortcuts win.
      if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
      if (!e.altKey) return false;
      // Physical key first (layout-independent, ignores Option-modified char).
      if (e.code === "KeyR") return true;
      // Fallbacks for keyboards / layouts where `code` is unset.
      const k = e.key;
      return k === "r" || k === "R" || k === "®";
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isAltR(e)) return;
      // Whether or not there's a missing citation to act on, we must cancel
      // the default so macOS doesn't type "®" into the doc. Auto-repeat
      // (holding the keys) is treated the same as a single press.
      e.preventDefault();
      e.stopPropagation();
      altRPending = true;
      if (e.repeat) return; // don't reopen the popup while the key is held
      const hit = findMissingAtCursor();
      if (!hit) return; // no missing citation under caret — silent no-op
      setMissingCiteModal({ open: true, ...hit });
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Clear the pending flag on the corresponding keyup, or when Alt is
      // released (whichever comes first — some layouts fire keyup for the
      // modifier but not the letter under composition).
      if (isAltR(e) || e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight") {
        altRPending = false;
      }
    };

    const onBeforeInput = (e: Event) => {
      // Belt-and-suspenders for macOS: if a `beforeinput` sneaks in with the
      // Option-modified glyph while our Alt+R is being handled, cancel it
      // too. Prevents the ® / ™ / … slipping past a preventDefault race.
      if (!altRPending) return;
      const data = (e as InputEvent).data;
      if (data === "®" || data === "r" || data === "R") {
        e.preventDefault();
        (e as InputEvent).stopPropagation?.();
      }
    };

    // Capture phase so we run before TipTap's ProseMirror keymap /
    // beforeinput handler, which would otherwise insert the character.
    dom.addEventListener("keydown", onKeyDown, true);
    dom.addEventListener("keyup", onKeyUp, true);
    dom.addEventListener("beforeinput", onBeforeInput, true);
    return () => {
      dom.removeEventListener("keydown", onKeyDown, true);
      dom.removeEventListener("keyup", onKeyUp, true);
      dom.removeEventListener("beforeinput", onBeforeInput, true);
    };
    // Re-attach when the citation_pairs change so findMissingAtCursor reads
    // the latest validator output.
  }, [editorRef, citationPairs]);

  // Persist the picked candidate through the existing manual-links flow
  // and flip the mark's visual state to linked=true. Notes on why the
  // missing-role mark is kept in place rather than deleted-and-restamped:
  //
  //   The server-side merge_manual_links_into_logs keys on ref_number or
  //   ref_text of each citation_pair to flip status to "ok". A missing
  //   citation_pair carries ref_number=None and ref_text="" (see
  //   citation_link_finalizer._harvest_apa_results), so the merge can't
  //   find it. After refetch the pair stays status="missing" and
  //   stampBookmarks would re-stamp a fresh role="missing" mark on the
  //   same range if we'd already removed the linked one — reverting the
  //   green highlight back to rose.
  //
  //   Leaving the mark as role="missing" + linked=true is idempotent:
  //   stampBookmarks sees the existing missing mark by (name, "missing")
  //   and skips, and markBookmarksLinked (called from the stamp effect)
  //   sees the manual-link name in `manualLinkNames` and re-asserts
  //   linked=true on every refetch — so the CSS rule for
  //   [data-bookmark-linked="true"] keeps rendering it green, matching
  //   the auto-linked source-role highlight.
  const submitMissingCiteLink = async (values: MissingCitationLinkSubmit) => {
    if (!missingCiteModal.open) return;
    const editor = editorRef.current?.editor;
    try {
      await upsertLinkMutation.mutateAsync({
        bookmark_name: missingCiteModal.markName,
        ref_number: values.ref_number,
        ref_text: values.ref_text,
        citation_text: missingCiteModal.citationText,
      });
      // Immediate visual feedback: flip linked=true so the mark flips from
      // rose (missing) to green (linked) instantly — the CSS rule for
      // [data-bookmark-linked="true"] wins over the missing rule.
      markBookmarkLinked(editor, missingCiteModal.markName);
      setMissingCiteModal({ open: false });
      // Refetch so the server-persisted manual_link lands in the query
      // cache. The stamp effect will re-run, and markBookmarksLinked
      // there will re-assert linked=true from the manual_links list so
      // the green highlight survives the refetch.
      reviewQuery.refetch().catch(() => {
        /* invalidation already scheduled a refetch; a stray failure here is
           non-fatal for the link itself */
      });
    } catch (err: any) {
      const message = err?.response?.data?.detail || err?.message || "Failed to link citation.";
      setMissingCiteModal({ ...missingCiteModal, error: String(message) });
    }
  };

  // Query action from the popup — attaches an AQ comment at the missing
  // citation's location without creating a reference link. Reuses the
  // editor's existing Comment mark (addComment command applies a
  // <span class="tc-comment" data-comment-id="…">) and the standard
  // useCommentMutations.create hook that CommentDialog uses, so the AQ
  // appears in the same comments panel/reader as any hand-typed comment
  // and round-trips through the DOCX pipeline identically. Does NOT
  // create a manual_link, does NOT touch citation_pairs, so the
  // Matched/Missing/Unused counts are unchanged.
  const submitMissingCiteQuery = async () => {
    if (!missingCiteModal.open) return;
    const editor = editorRef.current?.editor;
    if (!editor) return;
    // Locate the target range via the bookmark mark that opened the popup:
    //   missing mode → role="missing" (the citation's author-year needle)
    //   unused mode  → role="target"  (the reference-list paragraph)
    // The comment mark attaches to that range so Word places the balloon
    // at the citation for missing, or at the reference entry for unused —
    // matching where each AQ is meant to sit for the copy-editor.
    const modalRole = missingCiteModal.markRole;
    const modalMode = missingCiteModal.mode;
    const bm = listBookmarks(editor).find(
      (b) => b.name === missingCiteModal.markName && b.role === modalRole,
    );
    if (!bm) {
      setMissingCiteModal({
        ...missingCiteModal,
        error:
          modalMode === "missing"
            ? "Couldn't locate the citation in the document. Try clicking Locate on the missing entry first."
            : "Couldn't locate the reference in the document. Try clicking Locate on the unused entry first.",
      });
      return;
    }
    const aqText =
      modalMode === "unused"
        ? buildUnusedAqComment(missingCiteModal.citationText)
        : buildMissingAqComment(missingCiteModal.citationText);
    const uuid = crypto.randomUUID();
    try {
      editor
        .chain()
        .focus()
        .setTextSelection({ from: bm.from, to: bm.to })
        .addComment(uuid)
        .run();
      await commentMutations.create.mutateAsync({ commentUuid: uuid, text: aqText });
      setMissingCiteModal({ open: false });
    } catch (err: any) {
      // If the persist call failed, roll back the mark so the doc doesn't
      // carry an orphan tc-comment span pointing at nothing.
      editor.chain().focus().removeComment(uuid).run();
      const message = err?.response?.data?.detail || err?.message || "Failed to add comment.";
      setMissingCiteModal({ ...missingCiteModal, error: String(message) });
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


  // Filter is meaningful for the Citations and References tabs. Other tabs
  // (Changes / Issues / Missing) show their own scoped lists regardless.
  const filteredCitations = useMemo(
    () =>
      citationPairs.filter((c) => {
        const manuallyLinked = isManuallyLinkedMissing(c.citation, c.para_idx);
        if (filter === "all") return true;
        if (filter === "matched") return c.status === "ok" || manuallyLinked;
        if (filter === "missing") return c.status === "missing" && !manuallyLinked;
        if (filter === "unused") return c.status === "unused";
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [citationPairs, filter, linkedCitationTexts, linkedMissingParaIdxs],
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
                onSaved={() => {
                  void reviewQuery.refetch();
                  if (fileId != null) {
                    void queryClient.invalidateQueries({ queryKey: ["file-xhtml-runs", fileId] });
                    void queryClient.invalidateQueries({ queryKey: ["file-xhtml-runs", Number(fileId)] });
                  }
                }}
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
        return filteredMissing.length === 0 && unused.length === 0 && unlinkedBookmarks.length === 0 ? (
          <EmptyState
            Icon={CheckCircle2}
            tone="success"
            message="No missing references, unused references, or unlinked bookmarks."
          />
        ) : (
          <div className="space-y-4">
            {(filteredMissing.length > 0 || unused.length > 0) && (
              <ul className="space-y-2">
                {filteredMissing.map((m, i) => (
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
    // Missing-citation marks aren't user bookmarks — they're just visual
    // highlights for the missing-citation flow, so hide them here.
    const sorted = [...bookmarks]
      .filter((b) => b.role !== "missing")
      .sort((a, b) => {
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
        /* Matched citation highlight — applies to auto-linked citations
           (role="source") and any bookmark flipped to linked=true by the manual
           link flow. Green background only over the citation text; padding is
           kept minimal so the highlight hugs the citation, not the paragraph. */
        .rr-bookmark[data-bookmark-role="source"],
        .rr-bookmark[data-bookmark-linked="true"] {
          background-color: rgba(16, 185, 129, 0.18); /* emerald-500 @ 18% */
          box-shadow: inset 0 -1px 0 rgba(5, 150, 105, 0.55); /* emerald-600 baseline */
          border-radius: 2px;
          padding: 0 1px;
          color: rgb(6 78 59); /* emerald-900 */
        }
        .rr-bookmark[data-bookmark-role="source"]:hover,
        .rr-bookmark[data-bookmark-linked="true"]:hover {
          background-color: rgba(16, 185, 129, 0.28);
        }
        /* Citation ranges are typically also wrapped in a CharStyle span
           (cite_bib / cite_fig / …) whose CSS in WysiwygEditor sets its own
           background-color with !important. That inner background paints on
           top of our outer bookmark background, hiding the green highlight.
           Clear inner element backgrounds inside a matched/linked bookmark
           so the green shows through. Text color, weight and dotted
           border-bottom from CharStyle are preserved — only the background
           is neutralised, and only inside a linked citation. */
        .rr-bookmark[data-bookmark-role="source"] *,
        .rr-bookmark[data-bookmark-linked="true"] * {
          background-color: transparent !important;
        }
        /* Missing citation highlight — citation exists in text but no matching
           reference. Rose background only, no baseline stripe / underline /
           pointer cursor / hover treatment — a missing citation is NOT a link
           until it's been resolved (linked=true, which then falls under the
           source-style rule above and gets the full green + interactive
           treatment). Alt+R still opens the linking popup because the mark's
           presence is what the keydown handler looks for; nothing here needs
           to be clickable. */
        .rr-bookmark[data-bookmark-role="missing"]:not([data-bookmark-linked="true"]) {
          background-color: rgba(244, 63, 94, 0.15); /* rose-500 @ 15% */
          border-radius: 2px;
          padding: 0 1px;
          color: rgb(136 19 55); /* rose-900 */
          /* Neutral I-beam so the mark reads as regular editable text, not
             a hyperlink. !important is needed to beat the .rr-bookmark base
             rule (cursor: pointer) regardless of stylesheet order. */
          cursor: text !important;
          text-decoration: none !important;
          box-shadow: none;
        }
        /* Also strip the underline/pointer that would otherwise cascade from
           the shared .rr-bookmark base rule via any :hover / :focus /
           :active state on the anchor element. */
        .rr-bookmark[data-bookmark-role="missing"]:not([data-bookmark-linked="true"]):hover,
        .rr-bookmark[data-bookmark-role="missing"]:not([data-bookmark-linked="true"]):focus,
        .rr-bookmark[data-bookmark-role="missing"]:not([data-bookmark-linked="true"]):active {
          background-color: rgba(244, 63, 94, 0.15);
          text-decoration: none !important;
          cursor: text !important;
          box-shadow: none;
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
          count={bookmarks.filter((b) => b.role !== "missing").length}
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

      {missingCiteModal.open && fileId != null && (
        <MissingCitationLinkPopup
          fileId={fileId}
          mode={missingCiteModal.mode}
          citationText={missingCiteModal.citationText}
          author={missingCiteModal.author}
          year={missingCiteModal.year}
          referenceEntries={referenceEntries}
          isSubmitting={upsertLinkMutation.isPending}
          isQuerying={commentMutations.create.isPending}
          error={missingCiteModal.error}
          onSubmit={submitMissingCiteLink}
          onQuery={submitMissingCiteQuery}
          onCancel={() => {
            if (upsertLinkMutation.isPending || commentMutations.create.isPending) return;
            setMissingCiteModal({ open: false });
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
