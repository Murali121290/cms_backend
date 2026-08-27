import type { Editor } from "@tiptap/react";

export type BookmarkRole = "target" | "source" | "manual";

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
