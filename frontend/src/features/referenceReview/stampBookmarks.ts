import type { Editor } from "@tiptap/react";

import type { ReferenceValidationReviewResponse } from "@/api/referenceReview";

type Logs = ReferenceValidationReviewResponse["validation_logs"];
type ReferenceEntry = NonNullable<Logs["reference_entries"]>[number];
type CitationPair = NonNullable<Logs["citation_pairs"]>[number];

interface ParaInfo {
  from: number;
  to: number;
  idx: number;
  text: string;
}

/**
 * Apply Bookmark marks derived from Reference Validator output so citations
 * and reference entries become clickable cross-anchors.
 *
 * - Each reference_entry with a `number` becomes a `REF{n}` target on its
 *   paragraph range (para_idx).
 * - Each citation_pair with a `ref_number` gets a `REF{n}` source mark on
 *   the literal "[N]" substring within its paragraph (falls back to a
 *   whole-doc scan if para_idx is missing).
 *
 * Idempotent: skips any (from, to) range that already carries the same
 * (name, role) pair, so re-running after a validate refetch is safe.
 *
 * The Bookmark mark renders as <a data-bookmark="REF25"
 * data-bookmark-role="target|source"> which the backend already round-trips
 * to <w:bookmarkStart/> on DOCX export.
 */
export function stampBookmarks(
  editor: Editor | null | undefined,
  referenceEntries: ReferenceEntry[],
  citationPairs: CitationPair[],
): void {
  if (!editor) return;
  const bookmarkType = editor.schema.marks.bookmark;
  if (!bookmarkType) return;

  const doc = editor.state.doc;
  const paras = collectParagraphs(doc);
  const paraByIdx = new Map<number, ParaInfo>();
  for (const p of paras) paraByIdx.set(p.idx, p);

  const tr = editor.state.tr;
  let changed = false;

  // TARGETS — reference entries
  for (const entry of referenceEntries) {
    if (entry.number == null) continue;
    const para = paraByIdx.get(entry.para_idx);
    if (!para) continue;
    const name = `REF${entry.number}`;
    if (rangeHasBookmark(doc, para.from, para.to, name, "target")) continue;
    tr.addMark(
      para.from,
      para.to,
      bookmarkType.create({ name, role: "target" }),
    );
    changed = true;
  }

  // SOURCES — in-text citations. Prefer explicit para_idx; if the pair
  // doesn't have one (missing/unmatched citations often don't), scan every
  // paragraph and mark every "[N]" occurrence.
  for (const pair of citationPairs) {
    if (pair.ref_number == null) continue;
    const name = `REF${pair.ref_number}`;
    const needle = `[${pair.ref_number}]`;
    const candidates: ParaInfo[] =
      pair.para_idx != null
        ? [paraByIdx.get(pair.para_idx)].filter((p): p is ParaInfo => Boolean(p))
        : paras;

    for (const para of candidates) {
      let searchStart = 0;
      while (true) {
        const idx = para.text.indexOf(needle, searchStart);
        if (idx === -1) break;
        const from = para.from + idx;
        const to = from + needle.length;
        if (!rangeHasBookmark(doc, from, to, name, "source")) {
          tr.addMark(
            from,
            to,
            bookmarkType.create({ name, role: "source" }),
          );
          changed = true;
        }
        searchStart = idx + needle.length;
      }
    }
  }

  if (changed) editor.view.dispatch(tr);
}

// Walk the top-level block nodes and record their position ranges + a
// stable index (preferring the paraIdx attribute set by the XHTML importer,
// falling back to document order).
function collectParagraphs(doc: any): ParaInfo[] {
  const paras: ParaInfo[] = [];
  let fallback = 0;
  doc.descendants((node: any, pos: number) => {
    if (
      node.isBlock &&
      (node.type.name === "paragraph" || String(node.type.name).startsWith("heading"))
    ) {
      const raw = node.attrs?.paraIdx;
      const attrIdx = raw != null ? Number.parseInt(String(raw), 10) : NaN;
      const idx = Number.isFinite(attrIdx) ? attrIdx : fallback;
      paras.push({
        from: pos + 1,
        to: pos + 1 + node.content.size,
        idx,
        text: node.textContent,
      });
      fallback += 1;
      return false; // don't descend into block content
    }
    return true;
  });
  return paras;
}

function rangeHasBookmark(
  doc: any,
  from: number,
  to: number,
  name: string,
  role: string,
): boolean {
  let has = false;
  doc.nodesBetween(from, to, (node: any) => {
    if (has) return false;
    if (node.isText) {
      for (const m of node.marks) {
        if (
          m.type.name === "bookmark" &&
          m.attrs?.name === name &&
          m.attrs?.role === role
        ) {
          has = true;
          return false;
        }
      }
    }
    return true;
  });
  return has;
}
