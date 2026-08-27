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
 * Numbering: uses `entry.number` when present (Vancouver/AMA); falls back to
 * document-order position (APA), so each reference_entries[i] becomes REF{i+1}
 * whether or not the original doc numbered them.
 *
 * Sources: for each citation_pair we try multiple needles — `[N]`, `(citation)`,
 * and the bare `citation` — so both numeric and APA in-text renderings match.
 * Citations are linked to entries via `citation_pair.ref_text` string equality
 * with `reference_entry.text`, reusing the validator's own pairing.
 *
 * Manual bookmarks (data-bookmark-role="manual") are protected: any name
 * already used by a manual mark is skipped for auto-stamping, so manuals
 * survive re-validate. Idempotent otherwise.
 *
 * The Bookmark mark renders as <a data-bookmark="REF25"
 * data-bookmark-role="target|source|manual"> which the backend
 * xhtml_to_docx_delta pipeline round-trips to <w:bookmarkStart/> on export.
 */
export function stampBookmarks(
  editor: Editor | null | undefined,
  referenceEntries: ReferenceEntry[],
  citationPairs: CitationPair[],
): void {
  if (!editor) return;
  const bookmarkType = editor.schema.marks.bookmark;
  if (!bookmarkType) return;
  if (referenceEntries.length === 0) return; // no References section — nothing to anchor to

  const doc = editor.state.doc;
  const paras = collectParagraphs(doc);
  const paraByIdx = new Map<number, ParaInfo>();
  for (const p of paras) paraByIdx.set(p.idx, p);

  const manualNames = collectManualBookmarkNames(doc);

  // Assign REF{n} names by document order. Entries with an explicit number
  // (Vancouver/AMA) use that; APA entries with number:null get positional
  // numbering after sorting by paragraph index.
  const sortedEntries = [...referenceEntries]
    .filter((e) => paraByIdx.has(e.para_idx))
    .sort((a, b) => a.para_idx - b.para_idx);

  const entryTextToName = new Map<string, string>();

  const tr = editor.state.tr;
  let changed = false;

  // TARGETS — one bookmark per reference entry
  sortedEntries.forEach((entry, i) => {
    const n = entry.number ?? i + 1;
    const name = `REF${n}`;
    if (manualNames.has(name)) return; // manual owns this slot
    entryTextToName.set(normalizeRefText(entry.text), name);

    const para = paraByIdx.get(entry.para_idx)!;
    if (rangeHasBookmark(doc, para.from, para.to, name, "target")) return;
    tr.addMark(para.from, para.to, bookmarkType.create({ name, role: "target" }));
    changed = true;
  });

  // SOURCES — in-text citations. Try needles in priority order and stop
  // once a paragraph yields at least one hit for a given citation.
  for (const pair of citationPairs) {
    const name = resolveCitationRefName(pair, entryTextToName, manualNames);
    if (!name) continue;

    const needles = buildCitationNeedles(pair);
    if (needles.length === 0) continue;

    const candidates: ParaInfo[] =
      pair.para_idx != null
        ? [paraByIdx.get(pair.para_idx)].filter((p): p is ParaInfo => Boolean(p))
        : paras;

    for (const para of candidates) {
      let matchedInThisPara = false;
      for (const needle of needles) {
        let searchStart = 0;
        while (true) {
          const idx = para.text.indexOf(needle, searchStart);
          if (idx === -1) break;
          matchedInThisPara = true;
          const from = para.from + idx;
          const to = from + needle.length;
          if (!rangeHasBookmark(doc, from, to, name, "source")) {
            tr.addMark(from, to, bookmarkType.create({ name, role: "source" }));
            changed = true;
          }
          searchStart = idx + needle.length;
        }
        if (matchedInThisPara) break; // don't re-match with weaker needles
      }
    }
  }

  if (changed) editor.view.dispatch(tr);
}

// Decide which REF{n} a citation points to. Priority:
//   1. explicit ref_number from validator (numeric style),
//   2. lookup by ref_text against the entry-text map (APA / prose citations).
// Skip if the resolved name was already claimed by a manual bookmark.
function resolveCitationRefName(
  pair: CitationPair,
  entryTextToName: Map<string, string>,
  manualNames: Set<string>,
): string | null {
  if (pair.ref_number != null) {
    const name = `REF${pair.ref_number}`;
    if (!manualNames.has(name)) return name;
  }
  if (pair.ref_text) {
    const looked = entryTextToName.get(normalizeRefText(pair.ref_text));
    if (looked && !manualNames.has(looked)) return looked;
  }
  return null;
}

// Build the strings to search for in the paragraph, ordered
// most-specific → least-specific.
function buildCitationNeedles(pair: CitationPair): string[] {
  const out: string[] = [];
  if (pair.ref_number != null) out.push(`[${pair.ref_number}]`);
  if (pair.citation) {
    // Some validators return the citation already surrounded by parens; guard.
    const cleaned = pair.citation.replace(/^\((.*)\)$/, "$1").trim();
    if (cleaned) {
      out.push(`(${cleaned})`);
      out.push(cleaned);
    }
  }
  return out;
}

function normalizeRefText(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
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

function collectManualBookmarkNames(doc: any): Set<string> {
  const names = new Set<string>();
  doc.descendants((node: any) => {
    if (node.isText) {
      for (const m of node.marks) {
        if (
          m.type.name === "bookmark" &&
          m.attrs?.role === "manual" &&
          typeof m.attrs?.name === "string"
        ) {
          names.add(m.attrs.name);
        }
      }
    }
    return true;
  });
  return names;
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
