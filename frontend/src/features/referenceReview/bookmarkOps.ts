import type { Editor } from "@tiptap/react";

import type { ManualLink, ReferenceValidationReviewResponse } from "@/api/referenceReview";

export type BookmarkRole = "target" | "source" | "manual" | "existing";

export interface BookmarkInfo {
  name: string;
  role: BookmarkRole;
  from: number;
  to: number;
  snippet: string;
}

// Word-style validation for bookmark names. Word requires: starts with a
// letter, then letters/digits/underscore only, max 40 chars. We keep the same
// rule so anything we accept round-trips through DOCX cleanly.
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export function isValidBookmarkName(name: string): boolean {
  return NAME_RE.test(name);
}

/**
 * Enumerate every Bookmark mark in the doc. Multiple contiguous text nodes
 * carrying the same (name, role) mark are collapsed into one entry with a
 * combined range and a snippet of the text they cover.
 */
export function listBookmarks(editor: Editor | null | undefined): BookmarkInfo[] {
  if (!editor) return [];
  const doc = editor.state.doc;
  const buckets = new Map<string, BookmarkInfo>();

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name !== "bookmark") continue;
      const name = m.attrs?.name;
      const role = m.attrs?.role as BookmarkRole | undefined;
      if (!name || !role) continue;
      const key = `${name}::${role}`;
      const existing = buckets.get(key);
      const from = pos;
      const to = pos + node.nodeSize;
      const text = node.textContent as string;
      if (existing) {
        existing.from = Math.min(existing.from, from);
        existing.to = Math.max(existing.to, to);
        if (existing.snippet.length < 60) {
          existing.snippet = (existing.snippet + text).slice(0, 60);
        }
      } else {
        buckets.set(key, {
          name,
          role,
          from,
          to,
          snippet: text.slice(0, 60),
        });
      }
    }
    return true;
  });

  return Array.from(buckets.values());
}

/**
 * Whether `name` is already claimed by any bookmark in the doc (any role).
 * Used to reject duplicate names on manual add.
 */
export function bookmarkNameExists(
  editor: Editor | null | undefined,
  name: string,
): boolean {
  return listBookmarks(editor).some((b) => b.name === name);
}

export interface AddManualBookmarkResult {
  ok: boolean;
  error?: string;
}

/**
 * Apply a Bookmark mark with role="manual" to the given range (defaults to
 * the current editor selection). Rejects duplicates and invalid names.
 */
export function addManualBookmark(
  editor: Editor | null | undefined,
  name: string,
  range?: { from: number; to: number },
): AddManualBookmarkResult {
  if (!editor) return { ok: false, error: "Editor not ready." };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Enter a bookmark name." };
  if (!isValidBookmarkName(trimmed)) {
    return {
      ok: false,
      error:
        "Name must start with a letter and contain only letters, digits, or underscores (max 40 chars).",
    };
  }
  if (bookmarkNameExists(editor, trimmed)) {
    return { ok: false, error: `A bookmark named "${trimmed}" already exists.` };
  }

  const bookmarkType = editor.schema.marks.bookmark;
  if (!bookmarkType) return { ok: false, error: "Bookmark schema missing." };

  const { from, to } = range ?? editor.state.selection;
  if (from === to) {
    return { ok: false, error: "Select some text in the editor first." };
  }

  editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .setMark("bookmark", { name: trimmed, role: "manual" })
    .run();
  return { ok: true };
}

/**
 * Remove every Bookmark mark whose (name, role) matches. If `role` is not
 * given, removes every bookmark with that name (any role) — used for cleaning
 * up manual bookmarks the user explicitly deletes.
 */
export function removeBookmark(
  editor: Editor | null | undefined,
  name: string,
  role?: BookmarkRole,
): boolean {
  if (!editor) return false;
  const bookmarkType = editor.schema.marks.bookmark;
  if (!bookmarkType) return false;

  const doc = editor.state.doc;
  const ranges: Array<{ from: number; to: number; mark: any }> = [];
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (
        m.type.name === "bookmark" &&
        m.attrs?.name === name &&
        (!role || m.attrs?.role === role)
      ) {
        ranges.push({ from: pos, to: pos + node.nodeSize, mark: m });
      }
    }
    return true;
  });
  if (ranges.length === 0) return false;
  const tr = editor.state.tr;
  for (const r of ranges) tr.removeMark(r.from, r.to, r.mark);
  editor.view.dispatch(tr);
  return true;
}

type Logs = ReferenceValidationReviewResponse["validation_logs"];
type CitationPair = NonNullable<Logs["citation_pairs"]>[number];
type ReferenceEntry = NonNullable<Logs["reference_entries"]>[number];

/**
 * Identify bookmarks that have no citation/reference mapping — either manual
 * bookmarks the user added without linking, or Word-native bookmarks that
 * survived DOCX import but weren't recognized by the auto-linker.
 *
 * A bookmark is considered LINKED when any of the following holds:
 *   - a `target` role sibling exists with the same name (auto-linked reference)
 *   - a `source` role sibling exists with the same name (auto-linked citation)
 *   - the name matches `REF{n}` where n appears in citation_pairs (numeric style)
 *   - a persisted manual_link exists for that name
 *
 * Everything else is unlinked.
 */
export function getUnlinkedBookmarks(
  editor: Editor | null | undefined,
  citationPairs: CitationPair[],
  referenceEntries: ReferenceEntry[],
  manualLinks: ManualLink[],
): BookmarkInfo[] {
  const all = listBookmarks(editor);
  if (all.length === 0) return [];

  const linkedNames = new Set<string>();

  // Auto-linked: any bookmark that has an auto-generated target or source
  // sibling in the doc is linked.
  const rolesByName = new Map<string, Set<BookmarkRole>>();
  for (const bm of all) {
    let roles = rolesByName.get(bm.name);
    if (!roles) {
      roles = new Set();
      rolesByName.set(bm.name, roles);
    }
    roles.add(bm.role);
  }
  for (const [name, roles] of rolesByName) {
    if (roles.has("target") || roles.has("source")) linkedNames.add(name);
  }

  // Validator-derived: any REF{n} whose n appears in citation_pairs with a
  // non-null ref_number counts as resolvable.
  for (const p of citationPairs) {
    if (p.ref_number != null) linkedNames.add(`REF${p.ref_number}`);
  }
  for (const e of referenceEntries) {
    if (e.number != null) linkedNames.add(`REF${e.number}`);
  }

  // Manually linked (persisted server-side).
  for (const lnk of manualLinks) {
    if (lnk.bookmark_name) linkedNames.add(lnk.bookmark_name);
  }

  // Word-native reference anchors: role="existing" is emitted by the DOCX
  // importer (docx_to_xhtml_runs.py) for every pre-existing w:bookmarkStart
  // whose name passes _is_user_visible_bookmark_name. Word's own convention
  // uses `bib_N` for bibliography destinations and `ref_N` for reference
  // destinations (with cite-again variants like `bib_14_2`, `bib_15_10`
  // that alias into the base reference).
  //
  // Trust one of these as already-linked only when its leading numeric
  // suffix N maps to a real reference — either an entry with number=N or
  // a citation citing N. That way orphan anchors like `bib_99` on a doc
  // that only defines refs 1..50 stay in the Unlinked list so the user
  // can still act on them. Non-numeric or non-bib/ref names (`Bookmark1`,
  // custom Word names) also remain unlinked.
  if (referenceEntries.length > 0) {
    const validRefNumbers = new Set<number>();
    for (const e of referenceEntries) {
      if (e.number != null) validRefNumbers.add(e.number);
    }
    for (const p of citationPairs) {
      if (p.ref_number != null) validRefNumbers.add(p.ref_number);
    }
    const bibRefPattern = /^(?:bib|ref)_(\d+)(?:_\d+)*$/;
    for (const bm of all) {
      if (bm.role !== "existing") continue;
      const m = bibRefPattern.exec(bm.name);
      if (!m) continue;
      const n = Number.parseInt(m[1], 10);
      if (validRefNumbers.has(n)) linkedNames.add(bm.name);
    }
  }

  // Emit at most one row per bookmark name so users see each unlinked
  // bookmark once regardless of how many roles the mark carries. Prefer the
  // "manual" role for display when both exist.
  const seen = new Set<string>();
  const out: BookmarkInfo[] = [];
  const sorted = [...all].sort((a, b) => (a.role === "manual" ? -1 : b.role === "manual" ? 1 : 0));
  for (const bm of sorted) {
    if (linkedNames.has(bm.name)) continue;
    if (seen.has(bm.name)) continue;
    seen.add(bm.name);
    out.push(bm);
  }
  return out;
}

/**
 * Flip the `linked` attribute to true on every Bookmark mark carrying `name`
 * (any role). Preserves the mark's identity — same range, same name, same
 * role — so the `id="bookmark-{name}"` / `data-bookmark` anchors and any
 * auto-linker book-keeping are untouched. Returns true if any mark changed.
 */
export function markBookmarkLinked(
  editor: Editor | null | undefined,
  name: string,
): boolean {
  if (!editor) return false;
  const bookmarkType = editor.schema.marks.bookmark;
  if (!bookmarkType) return false;

  const doc = editor.state.doc;
  const targets: Array<{ from: number; to: number; role: BookmarkRole }> = [];
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (
        m.type.name === "bookmark" &&
        m.attrs?.name === name &&
        !m.attrs?.linked
      ) {
        targets.push({
          from: pos,
          to: pos + node.nodeSize,
          role: m.attrs.role as BookmarkRole,
        });
      }
    }
    return true;
  });
  if (targets.length === 0) return false;

  const tr = editor.state.tr;
  for (const t of targets) {
    tr.addMark(
      t.from,
      t.to,
      bookmarkType.create({ name, role: t.role, linked: true }),
    );
  }
  editor.view.dispatch(tr);
  return true;
}

/**
 * Batch variant — flips `linked=true` on every mark whose name appears in
 * `names`. Used after each validate refetch so persisted manual_links stay
 * visually linked across reloads.
 */
export function markBookmarksLinked(
  editor: Editor | null | undefined,
  names: Iterable<string>,
): boolean {
  if (!editor) return false;
  const wanted = new Set<string>();
  for (const n of names) if (n) wanted.add(n);
  if (wanted.size === 0) return false;

  const bookmarkType = editor.schema.marks.bookmark;
  if (!bookmarkType) return false;

  const doc = editor.state.doc;
  const targets: Array<{ from: number; to: number; name: string; role: BookmarkRole }> = [];
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (
        m.type.name === "bookmark" &&
        typeof m.attrs?.name === "string" &&
        wanted.has(m.attrs.name) &&
        !m.attrs?.linked
      ) {
        targets.push({
          from: pos,
          to: pos + node.nodeSize,
          name: m.attrs.name,
          role: m.attrs.role as BookmarkRole,
        });
      }
    }
    return true;
  });
  if (targets.length === 0) return false;

  const tr = editor.state.tr;
  for (const t of targets) {
    tr.addMark(
      t.from,
      t.to,
      bookmarkType.create({ name: t.name, role: t.role, linked: true }),
    );
  }
  editor.view.dispatch(tr);
  return true;
}

/**
 * Scroll to the first occurrence of a bookmark and flash it. Returns true
 * if we found something.
 */
export function goToBookmark(
  editor: Editor | null | undefined,
  name: string,
): boolean {
  if (!editor) return false;
  const el = editor.view.dom.querySelector(
    `[data-bookmark="${CSS.escape(name)}"]`,
  ) as HTMLElement | null;
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("rr-para-flash");
  window.setTimeout(() => el.classList.remove("rr-para-flash"), 1200);
  return true;
}
