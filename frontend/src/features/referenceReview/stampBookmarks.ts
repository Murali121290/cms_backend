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
  manualLinkNames: Iterable<string> = [],
): void {
  if (!editor) return;
  const bookmarkType = editor.schema.marks.bookmark;
  if (!bookmarkType) return;
  if (referenceEntries.length === 0) return; // no References section — nothing to anchor to

  const doc = editor.state.doc;
  const paras = collectParagraphs(doc);
  const paraByIdx = new Map<number, ParaInfo>();
  for (const p of paras) paraByIdx.set(p.idx, p);

  // Any name that is either owned by an in-doc manual bookmark or is
  // persisted in a server-side manual link record is treated as user-claimed
  // and left untouched by the auto-stamper. Prevents re-validate from
  // overwriting a manual mapping.
  const manualNames = collectManualBookmarkNames(doc);
  for (const name of manualLinkNames) manualNames.add(name);

  // Assign ref_{n} names by document order. Entries with an explicit number
  // (Vancouver/AMA) use that; APA entries with number:null get positional
  // numbering after sorting by paragraph index. `ref_N` matches the
  // PPH bookmark scheme used by the backend citation validator, so the DOCX
  // that ships to the copy-editor has one consistent naming convention.
  const sortedEntries = [...referenceEntries]
    .filter((e) => paraByIdx.has(e.para_idx))
    .sort((a, b) => a.para_idx - b.para_idx);

  const entryTextToName = new Map<string, string>();

  const tr = editor.state.tr;
  let changed = false;

  // TARGETS — one bookmark per reference entry
  sortedEntries.forEach((entry, i) => {
    const n = entry.number ?? i + 1;
    const name = `ref_${n}`;
    if (manualNames.has(name)) return; // manual owns this slot
    entryTextToName.set(normalizeRefText(entry.text), name);

    const para = paraByIdx.get(entry.para_idx)!;
    if (rangeHasBookmark(doc, para.from, para.to, name, "target")) return;
    tr.addMark(para.from, para.to, bookmarkType.create({ name, role: "target" }));
    changed = true;
  });

  // SOURCES — in-text citations. Try needles in priority order and stop
  // once a paragraph yields at least one hit for a given citation.
  //
  // Two robustness knobs vs. the original loop:
  //   - Synthetic-name fallback for status="ok" pairs where the validator
  //     matched the citation but neither `ref_number` nor `ref_text` maps
  //     to an entry (fuzzy-matched APA text that doesn't hash-equal the
  //     bibliography entry). We still stamp role="source" so the green
  //     matched-citation highlight lands; the source just points at a
  //     synthetic name with no target counterpart, which is fine since
  //     the highlight is what matters.
  //   - Paragraph fallback: if `pair.para_idx` is set but doesn't resolve
  //     to a doc paragraph (indexing drift between validator and editor),
  //     search every paragraph rather than dropping the pair entirely.
  for (let pairIdx = 0; pairIdx < citationPairs.length; pairIdx++) {
    const pair = citationPairs[pairIdx];
    let name = resolveCitationRefName(pair, entryTextToName, manualNames);
    if (!name && pair.status === "ok") {
      const authorPart = (pair.author ?? "").replace(/[^A-Za-z0-9]/g, "");
      const yearPart = (pair.year ?? "").replace(/[^A-Za-z0-9]/g, "");
      name = `okcite_${pairIdx}_${authorPart || "x"}_${yearPart || "x"}`.slice(0, 40);
    }
    if (!name) continue;

    const needles = buildCitationNeedles(pair);
    if (needles.length === 0) continue;

    let candidates: ParaInfo[];
    if (pair.para_idx != null) {
      const p = paraByIdx.get(pair.para_idx);
      candidates = p ? [p] : paras; // fallback to full-doc search on drift
    } else {
      candidates = paras;
    }

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

  // MISSING — citations that exist in text but don't map to any reference
  // entry (status="missing"). Stamp with role="missing" so the editor can
  // (a) highlight them and (b) locate them at the cursor for Alt+R. The name
  // is deterministic per paragraph+offset so re-stamps are idempotent and
  // don't create duplicate marks. These marks carry no auto-linking meaning;
  // the SOURCE loop above already skipped them because resolveCitationRefName
  // returned null. On successful manual link, the missing mark is removed and
  // the natural SOURCE stamping takes over on the next refetch.
  for (let pairIdx = 0; pairIdx < citationPairs.length; pairIdx++) {
    const pair = citationPairs[pairIdx];
    if (pair.status !== "missing") continue;

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
          const name = `missingcite_${para.idx}_${idx}`;
          if (
            !rangeHasBookmark(doc, from, to, name, "missing") &&
            // Don't stamp missing over a range that's already a linked source —
            // if the auto-linker matched it above, it's not missing anymore.
            !rangeHasSource(doc, from, to)
          ) {
            tr.addMark(from, to, bookmarkType.create({ name, role: "missing" }));
            changed = true;
          }
          searchStart = idx + needle.length;
        }
        if (matchedInThisPara) break;
      }
    }
  }

  if (changed) editor.view.dispatch(tr);
}

// True if any text node in [from, to) already carries a bookmark mark with
// role="source" (regardless of name). Used to avoid tagging a citation as
// "missing" when the auto-linker has already claimed the same range as an
// auto-linked source.
function rangeHasSource(doc: any, from: number, to: number): boolean {
  let has = false;
  doc.nodesBetween(from, to, (node: any) => {
    if (has) return false;
    if (node.isText) {
      for (const m of node.marks) {
        if (m.type.name === "bookmark" && m.attrs?.role === "source") {
          has = true;
          return false;
        }
      }
    }
    return true;
  });
  return has;
}

// Decide which ref_{n} a citation points to. Priority:
//   1. explicit ref_number from validator (numeric style),
//   2. lookup by ref_text against the entry-text map (APA / prose citations).
// Skip if the resolved name was already claimed by a manual bookmark.
function resolveCitationRefName(
  pair: CitationPair,
  entryTextToName: Map<string, string>,
  manualNames: Set<string>,
): string | null {
  if (pair.ref_number != null) {
    const name = `ref_${pair.ref_number}`;
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
//
// Multi-citation blocks in APA — e.g. "(Smith, 2020; Jones, 2021; Lee, 2019)"
// — arrive as one CitationPair per referenced work, but with the SAME full
// `citation` string. Matching on that full string would drop every REF{n}
// bookmark on top of the same range, so we generate a per-work needle first
// using the pair's own `author`+`year`. This makes each individual work in the
// block land on its own text span while still falling back to the whole block
// (and to the bare reference-number form for AMA) if the specific needle
// misses.
function buildCitationNeedles(pair: CitationPair): string[] {
  const out: string[] = [];
  if (pair.ref_number != null) out.push(`[${pair.ref_number}]`);

  const author = (pair.author ?? "").trim();
  const year = (pair.year ?? "").trim();
  if (author && year) {
    out.push(`${author}, ${year}`);
    out.push(`${author} (${year})`);
    // "(Smith, 2020)" as a standalone citation — matches when it's the only
    // work in the parentheses.
    out.push(`(${author}, ${year})`);
  } else if (author) {
    out.push(author);
  }

  if (pair.citation) {
    // Some validators return the citation already surrounded by parens; guard.
    const cleaned = pair.citation.replace(/^\((.*)\)$/, "$1").trim();
    if (cleaned) {
      out.push(`(${cleaned})`);
      out.push(cleaned);
    }
  }
  return dedupePreserveOrder(out);
}

function dedupePreserveOrder<T>(xs: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
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
