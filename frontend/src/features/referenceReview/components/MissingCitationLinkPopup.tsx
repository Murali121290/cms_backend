import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { CheckCircle2, Link2, Loader2, MessageSquarePlus, Search } from "lucide-react";

import type { CitationCandidate, ReferenceValidationReviewResponse } from "@/api/referenceReview";

type Logs = ReferenceValidationReviewResponse["validation_logs"];
type ReferenceEntry = NonNullable<Logs["reference_entries"]>[number];

export interface MissingCitationLinkSubmit {
  ref_number: number | null;
  ref_text: string;
  // Present only when the user picked a server-matched candidate.
  candidate?: CitationCandidate;
}

interface Props {
  fileId: number;
  // "missing":  citation exists in text with no matching reference — offers
  //             candidate linking + Query (adds "cited but not listed" AQ).
  // "unused":   reference exists in list but not cited — offers Query only
  //             (adds "given but not cited" AQ at the reference location).
  mode?: "missing" | "unused";
  // In missing mode this is the citation text; in unused mode it's a short
  // "First-author et al., year" style subject for the reference.
  citationText: string;
  author?: string;
  year?: string;
  referenceEntries: ReferenceEntry[];
  isSubmitting?: boolean;
  isQuerying?: boolean;
  error?: string;
  onSubmit: (values: MissingCitationLinkSubmit) => void;
  // Fires when the user clicks Query. The parent attaches an AQ comment at
  // the citation's location in the editor — the popup only initiates the
  // action and closes on success.
  onQuery: () => void;
  onCancel: () => void;
}

type Mode = "candidates" | "all";

/**
 * Popup shown by the Alt+R shortcut for a missing citation. Primary path
 * hits POST /citation-candidates so the shown list is scoped to the picked
 * citation only (author/year candidates). When the server returns nothing
 * — or the user just wants to browse — the "All references" mode lets the
 * user filter the full bibliography and link manually. Both paths route
 * through the same manual-links persistence, so the resulting green
 * matched-citation highlight is identical.
 */
export function MissingCitationLinkPopup({
  fileId,
  mode = "missing",
  citationText,
  author,
  year,
  referenceEntries,
  isSubmitting = false,
  isQuerying = false,
  error,
  onSubmit,
  onQuery,
  onCancel,
}: Props) {
  const isUnused = mode === "unused";
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [browseMode, setBrowseMode] = useState<Mode>("candidates");
  const [allSelectedIdx, setAllSelectedIdx] = useState<number | null>(null);
  const [allSearch, setAllSearch] = useState("");

  // Match candidates fully client-side against the reference list we already
  // have from the panel's reference-review query. The equivalent server
  // endpoint (POST /citation-candidates) re-runs the full document
  // validator on every request, which is why the popup used to sit on
  // "Finding matching references…" for seconds. Locally we already know the
  // reference entries, so we can score matches synchronously and render on
  // the first frame.
  const candidates: CitationCandidate[] = useMemo(() => {
    const { author: parsedAuthor, year: parsedYear } = deriveAuthorYear(
      citationText,
      author,
      year,
    );
    return findLocalCandidates(parsedAuthor, parsedYear, referenceEntries);
  }, [citationText, author, year, referenceEntries]);

  // Kept as `false` so downstream UI branches that read `isLoading` remain
  // syntactically valid — no waiting state is needed now that matching is
  // synchronous. Removing the variable would require touching every mode
  // switch below; leaving it a constant keeps this diff surgical.
  const isLoading = false;
  const fetchError: unknown = null;

  // Auto-switch to "all references" once we know there are zero candidates,
  // so the user isn't stuck on an empty state screen with nothing to pick.
  // Only auto-switch when the fetch has settled; leave manual mode overrides
  // alone.
  const effectiveMode: Mode =
    browseMode === "all"
      ? "all"
      : !isLoading && !fetchError && candidates.length === 0
        ? "all"
        : "candidates";

  const filteredAllRefs = useMemo(() => {
    const q = allSearch.trim().toLowerCase();
    const withIndex = referenceEntries.map((entry, i) => ({ entry, i }));
    if (!q) return withIndex;
    return withIndex.filter(({ entry }) => {
      const text = (entry.text ?? "").toLowerCase();
      const num = entry.number != null ? String(entry.number) : "";
      return text.includes(q) || num.includes(q);
    });
  }, [referenceEntries, allSearch]);

  const handleLinkCandidate = (idx: number) => {
    if (isSubmitting) return;
    const candidate = candidates[idx];
    if (!candidate) return;
    const rn =
      typeof candidate.ref_key === "number"
        ? candidate.ref_key
        : Number.parseInt(String(candidate.ref_key), 10);
    onSubmit({
      ref_number: Number.isFinite(rn) ? rn : null,
      ref_text: candidate.ref_text,
      candidate,
    });
  };

  const handleLinkAllRef = (entryIdx: number) => {
    if (isSubmitting) return;
    const entry = referenceEntries[entryIdx];
    if (!entry) return;
    onSubmit({
      ref_number: entry.number ?? null,
      ref_text: entry.text,
    });
  };

  const handlePrimary = () => {
    if (effectiveMode === "candidates" && selectedIdx != null) {
      handleLinkCandidate(selectedIdx);
    } else if (effectiveMode === "all" && allSelectedIdx != null) {
      handleLinkAllRef(allSelectedIdx);
    }
  };

  const primaryDisabled =
    isSubmitting ||
    (effectiveMode === "candidates"
      ? selectedIdx == null || candidates.length === 0
      : allSelectedIdx == null);

  return createPortal(
    <div
      style={{ zIndex: 2147483647 }}
      className="fixed inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[560px] max-w-[92vw] max-h-[85vh] p-5 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Link2 className="w-4 h-4 text-navy-700" />
          <h3 className="text-sm font-bold text-navy-800">
            {isUnused ? "Query Unused Reference" : "Link Missing Citation"}
          </h3>
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Alt + R
          </span>
        </div>

        <div className="mb-3 p-2 rounded-md bg-slate-50 border border-slate-200">
          <div className="text-[10px] uppercase font-bold tracking-wide text-navy-500 mb-1">
            {isUnused ? "Unused reference" : "Missing citation"}
          </div>
          <div className="text-xs text-navy-800 italic">"{citationText}"</div>
          {(author || year) && (
            <div className="text-[10px] text-navy-500 mt-1">
              {author && <span>Author: <strong>{author}</strong></span>}
              {author && year && <span> · </span>}
              {year && <span>Year: <strong>{year}</strong></span>}
            </div>
          )}
        </div>

        {/* Unused mode: skip the candidate browser entirely — there's no
            citation in the text to link the reference back to, so the
            only meaningful action is Query (an AQ comment on the
            reference paragraph). Show a short info hint so the user
            understands why the browser is hidden. */}
        {isUnused && (
          <div className="mb-3 p-2.5 rounded-md border border-amber-200 bg-amber-50 text-[11px] text-amber-900 leading-snug">
            This reference is in the bibliography but never cited in the text. Use
            <span className="font-bold"> Query </span>
            to add an AQ comment for the copy-editor at the reference entry, or Cancel to leave it as-is.
          </div>
        )}

        {/* Mode toggle — visible whenever we have both candidates AND a
            reference list, so the user can flip to browse-all even when
            the server did return matches. Hidden when there are no
            references at all (nothing to browse). Hidden entirely in
            unused mode (linking isn't applicable). */}
        {!isUnused && referenceEntries.length > 0 && (
          <div className="mb-3 flex items-center gap-1 p-0.5 bg-slate-100 rounded-md border border-slate-200 shrink-0">
            <button
              type="button"
              onClick={() => {
                setBrowseMode("candidates");
                setAllSelectedIdx(null);
              }}
              disabled={candidates.length === 0 && !isLoading}
              className={`flex-1 py-1 rounded text-[11px] font-bold transition-colors ${
                effectiveMode === "candidates"
                  ? "bg-white text-navy-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700 disabled:opacity-50"
              }`}
            >
              Suggested{candidates.length > 0 ? ` (${candidates.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => {
                setBrowseMode("all");
                setSelectedIdx(null);
              }}
              className={`flex-1 py-1 rounded text-[11px] font-bold transition-colors ${
                effectiveMode === "all"
                  ? "bg-white text-navy-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              All references ({referenceEntries.length})
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {!isUnused && isLoading && (
            <div className="flex items-center justify-center py-6 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Finding matching references…
            </div>
          )}

          {!isUnused && fetchError && effectiveMode === "candidates" && (
            <div className="p-2.5 rounded border border-rose-200 bg-rose-50 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-[11px] text-rose-700">
                Failed to load candidates: {String((fetchError as any)?.message ?? fetchError)}
              </div>
            </div>
          )}

          {/* CANDIDATES MODE */}
          {!isUnused && !isLoading && !fetchError && effectiveMode === "candidates" && candidates.length > 0 && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wider text-navy-500 mb-2">
                {candidates.length} candidate{candidates.length === 1 ? "" : "s"} matched to this citation
              </div>
              <ul className="space-y-2">
                {candidates.map((c, i) => (
                  <CandidateRow
                    key={i}
                    candidate={c}
                    selected={selectedIdx === i}
                    onSelect={() => setSelectedIdx(i)}
                    onLink={() => handleLinkCandidate(i)}
                    disabled={isSubmitting}
                  />
                ))}
              </ul>
            </>
          )}

          {/* ALL-REFERENCES MODE (also the fallback when there are no candidates) */}
          {!isUnused && !isLoading && effectiveMode === "all" && (
            <>
              {referenceEntries.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Search className="w-6 h-6 text-slate-300" />
                  <div className="text-xs text-navy-600 font-semibold">No references in this file</div>
                  <div className="text-[11px] text-navy-500 max-w-[340px]">
                    Add the reference to the bibliography, then run Validate again.
                  </div>
                </div>
              ) : (
                <>
                  {candidates.length === 0 && !fetchError && (
                    <div className="mb-3 p-2 rounded-md border border-amber-200 bg-amber-50 text-[11px] text-amber-800">
                      No candidate matched <em>{citationText}</em> automatically. Pick a reference
                      from the list below to link this citation manually.
                    </div>
                  )}
                  <div className="relative mb-2">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={allSearch}
                      onChange={(e) => setAllSearch(e.target.value)}
                      placeholder="Search references by text or number…"
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-navy-400"
                      autoFocus
                    />
                  </div>
                  <ul className="space-y-1.5">
                    {filteredAllRefs.length === 0 ? (
                      <li className="text-center py-6 text-[11px] text-slate-500">
                        No references match "{allSearch}".
                      </li>
                    ) : (
                      filteredAllRefs.map(({ entry, i }) => (
                        <ReferenceRow
                          key={i}
                          entry={entry}
                          selected={allSelectedIdx === i}
                          onSelect={() => setAllSelectedIdx(i)}
                          onLink={() => handleLinkAllRef(i)}
                          disabled={isSubmitting}
                        />
                      ))
                    )}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        {error && (
          <div className="mt-3 text-[11px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 shrink-0">
          {/* Left-aligned Query: attaches an AQ comment at the citation's
              location without creating a reference link. Reuses the editor's
              existing comment mark + persistence — no separate storage. */}
          <button
            type="button"
            onClick={onQuery}
            disabled={isSubmitting || isQuerying}
            title="Add an AQ comment at this citation without linking"
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-bold rounded-md text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:from-amber-700 active:to-orange-700 shadow-sm shadow-amber-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isQuerying ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <MessageSquarePlus className="w-3.5 h-3.5" />
                Query
              </>
            )}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting || isQuerying}
              className="px-3 h-8 text-xs font-semibold rounded-md text-navy-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Cancel
            </button>
            {!isUnused && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePrimary();
                }}
                disabled={primaryDisabled || isQuerying}
                className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Linking…
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5" />
                    Link Selected
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
  onLink,
  disabled,
}: {
  candidate: CitationCandidate;
  selected: boolean;
  onSelect: () => void;
  onLink: () => void;
  disabled: boolean;
}) {
  const confidencePct = Math.round(candidate.confidence * 100);
  return (
    <li
      onClick={onSelect}
      className={`rounded-md border px-3 py-2 cursor-pointer transition-all ${
        selected
          ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-400"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="radio"
          checked={selected}
          onChange={onSelect}
          className="mt-1 w-3.5 h-3.5 shrink-0 accent-emerald-500 cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2
              className={`w-3.5 h-3.5 shrink-0 ${
                candidate.match_type === "exact"
                  ? "text-emerald-600"
                  : candidate.match_type === "smart"
                    ? "text-sky-600"
                    : "text-amber-500"
              }`}
            />
            <span className="text-[10px] font-bold uppercase tracking-wide text-navy-600">
              {candidate.match_type.replace(/_/g, " ")}
            </span>
            <span className="ml-auto text-[10px] font-semibold text-navy-500 tabular-nums">
              {confidencePct}%
            </span>
          </div>
          <p className="text-xs text-navy-800 leading-snug break-words">
            <span className="inline-block text-[10px] font-bold text-navy-500 mr-1.5 align-baseline">
              Ref {String(candidate.ref_key)}
            </span>
            {candidate.ref_text}
          </p>
          {candidate.reason && (
            <p className="text-[10px] text-navy-500 mt-1 italic">{candidate.reason}</p>
          )}
          {selected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onLink();
              }}
              disabled={disabled}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline disabled:opacity-60"
            >
              <Link2 className="w-3 h-3" />
              Link to this reference
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Pull author + year out of the citation. Uses the pre-parsed props when the
 * validator populated them; falls back to a simple "(Author, Year)" /
 * "Author, Year" split so abbreviation matching still works for missing
 * citations where the validator recorded only the raw string.
 */
function deriveAuthorYear(
  citationText: string,
  author?: string,
  year?: string,
): { author: string; year: string } {
  const a = (author ?? "").trim();
  const y = (year ?? "").trim();
  if (a && y) return { author: a, year: y };

  const cleaned = citationText
    .replace(/^\s*[([]+/, "")
    .replace(/[)\]]+\s*$/, "")
    .trim();
  const yearMatch = cleaned.match(/\b((?:19|20)\d{2}[a-z]?|n\.d\.?)\b/i);
  const yr = y || (yearMatch ? yearMatch[1] : "");
  let au = a;
  if (!au) {
    // Everything before the year (or before the last comma) is the author.
    // Then strip stray punctuation from both ends so parenthesised forms
    // like "IOM (2003)" — where the pre-year slice is "IOM (" — still reduce
    // to a clean "IOM" token that isAbbreviation() can accept.
    if (yearMatch && yearMatch.index != null) {
      au = cleaned.slice(0, yearMatch.index);
    } else {
      const parts = cleaned.split(",");
      au = parts[0];
    }
    au = au.replace(/^[^A-Za-z0-9&]+/, "").replace(/[^A-Za-z0-9&.]+$/, "").trim();
  }
  return { author: au, year: yr };
}

/**
 * True when `s` looks like an author abbreviation — a short, all-caps token
 * like IOM, CDC, AACN, WHO. Rejects normal author names (which have lower
 * case letters or spaces) and rejects years / numeric tokens.
 */
function isAbbreviation(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 2 || trimmed.length > 8) return false;
  // Must be all letters (uppercase) — no spaces, digits or punctuation.
  return /^[A-Z]{2,8}$/.test(trimmed);
}

/**
 * True when the reference text contains `year` on a word boundary. Handles
 * "(2001)", "2001;", "2001." and bare "2001" equally.
 */
function refHasYear(refText: string, year: string): boolean {
  if (!year) return true; // no year to check — accept
  const y = year.replace(/[^0-9a-zA-Z]/g, "");
  if (!y) return true;
  return new RegExp(`\\b${y}\\b`).test(refText);
}

/**
 * Score how well the ref text realises the abbreviation. Returns 0 when
 * there's no plausible match, otherwise a confidence in (0, 1].
 *
 * Two matching modes, first-hit wins:
 *   1. Ref text contains the abbreviation itself as a whole word
 *      (e.g. "Institute of Medicine [IOM]") — highest confidence.
 *   2. Abbreviation letters appear as a subsequence of the first letters of
 *      the first ~15 words of the ref (e.g. "AACN" ↔ American Association
 *      of Colleges of Nursing). Score decays with how far into the ref the
 *      match starts and how spread out the letters are.
 */
function abbreviationScore(abbr: string, refText: string): number {
  const upper = abbr.toUpperCase();
  const wordRe = new RegExp(`\\b${upper}\\b`);
  if (wordRe.test(refText)) return 0.95;

  const words = refText.split(/[\s.,;()[\]&/]+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length === 0) return 0;
  const front = words.slice(0, 15).map((w) => w[0].toUpperCase());

  let ai = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < front.length && ai < upper.length; i++) {
    if (front[i] === upper[ai]) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
      ai += 1;
    }
  }
  if (ai < upper.length) return 0;

  // Compact matches at the start of the reference are more likely correct.
  const startPenalty = firstIdx * 0.04;
  const spanPenalty = (lastIdx - firstIdx + 1 - upper.length) * 0.03;
  return Math.max(0.5, 0.9 - startPenalty - spanPenalty);
}

/**
 * Combined client-side matcher: tries abbreviation matching first, falls
 * through to surname/organization word matching. Runs synchronously against
 * the reference list the panel already has, so the popup can render on the
 * first frame without waiting on the backend citation-candidates endpoint
 * (which re-runs full document validation per request — see the api_v2
 * handler for citation-candidates).
 */
function findLocalCandidates(
  author: string,
  year: string,
  refs: ReferenceEntry[],
): CitationCandidate[] {
  const abbrev = findAbbreviationCandidates(author, year, refs);
  const nameMatches = findAuthorNameCandidates(author, year, refs);

  const seen = new Set<string>();
  const out: CitationCandidate[] = [];
  for (const c of [...abbrev, ...nameMatches].sort(
    (a, b) => b.confidence - a.confidence,
  )) {
    const key = String(c.ref_key);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Tokenise the citation author into surname-like words. Handles common
 * multi-author forms:
 *   - "Smith"                     → ["Smith"]
 *   - "Hickey & Giardino"         → ["Hickey", "Giardino"]
 *   - "Smith, Jones, & Lee"       → ["Smith", "Jones", "Lee"]
 *   - "Smith et al."              → ["Smith"]
 *   - "American Nurses Association [ANA]" → ["American", "Nurses", "Association"]
 * Drops obvious non-name tokens ("et al", initials, single letters) so a
 * downstream substring test doesn't false-match on "A." or "et".
 */
function extractAuthorTokens(author: string): string[] {
  if (!author) return [];
  // Strip trailing "et al" and any bracketed abbreviation like "[ANA]" so
  // they don't turn into stray tokens.
  const cleaned = author
    .replace(/\bet\s+al\.?/gi, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "");
  const parts = cleaned.split(/[,&;]|\band\b/gi);
  const out: string[] = [];
  for (const part of parts) {
    const words = part.trim().split(/\s+/);
    for (const w of words) {
      // Keep words starting with an uppercase letter and at least 2 letters.
      // Skips initials ("J."), stray punctuation, and lowercase glue words.
      if (/^[A-Z][A-Za-z'’-]{1,}$/.test(w)) out.push(w.replace(/[.,;]$/, ""));
    }
  }
  return out;
}

/**
 * Score a reference on how well it matches an author-name citation.
 * Requires at least one surname/word to appear as a whole-word substring
 * in the ref; scores up with hit-rate and rewards matches near the start.
 */
function authorNameScore(tokens: string[], refText: string): number {
  if (tokens.length === 0) return 0;
  let hits = 0;
  let firstIdx = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    const re = new RegExp(`\\b${escapeRegex(token)}\\b`, "i");
    const m = refText.match(re);
    if (m && m.index != null) {
      hits += 1;
      if (m.index < firstIdx) firstIdx = m.index;
    }
  }
  if (hits === 0) return 0;
  const hitRate = hits / tokens.length;
  // Author names usually appear in the first ~40 characters of a reference
  // entry, so reward that. Deep matches (mid-title) score lower.
  const positionBoost = firstIdx < 40 ? 0.1 : firstIdx < 120 ? 0.03 : 0;
  return Math.min(0.98, 0.55 + hitRate * 0.35 + positionBoost);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findAuthorNameCandidates(
  author: string,
  year: string,
  refs: ReferenceEntry[],
): CitationCandidate[] {
  const tokens = extractAuthorTokens(author);
  if (tokens.length === 0) return [];

  const scored: Array<{ entry: ReferenceEntry; idx: number; score: number }> = [];
  refs.forEach((entry, idx) => {
    const text = entry.text || "";
    if (!refHasYear(text, year)) return;
    const s = authorNameScore(tokens, text);
    if (s > 0.6) scored.push({ entry, idx, score: s });
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map(({ entry, idx, score }) => {
    const matchType: CitationCandidate["match_type"] =
      score > 0.85 ? "exact" : score > 0.72 ? "smart" : "fuzzy";
    const yearHint = year ? ` and year ${year}` : "";
    const authorHint = tokens.slice(0, 3).join(", ");
    return {
      ref_key: entry.number ?? idx,
      ref_text: entry.text,
      match_type: matchType,
      confidence: score,
      reason: `Matches ${authorHint}${yearHint}`,
    };
  });
}

/**
 * Produce CitationCandidate rows for reference entries whose organization
 * name is plausibly abbreviated by `author`. Empty result when `author`
 * isn't abbreviation-shaped, so a normal author-name citation falls through
 * to the browse-all fallback unchanged.
 */
function findAbbreviationCandidates(
  author: string,
  year: string,
  refs: ReferenceEntry[],
): CitationCandidate[] {
  const abbr = author.trim();
  if (!isAbbreviation(abbr)) return [];

  const scored: Array<{ entry: ReferenceEntry; idx: number; score: number }> = [];
  refs.forEach((entry, idx) => {
    const text = entry.text || "";
    if (!refHasYear(text, year)) return;
    const s = abbreviationScore(abbr, text);
    if (s > 0) scored.push({ entry, idx, score: s });
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map(({ entry, idx, score }) => {
    const yearHint = year ? ` and year ${year}` : "";
    return {
      ref_key: entry.number ?? idx,
      ref_text: entry.text,
      match_type: "smart",
      confidence: score,
      reason: `"${abbr}" matches organization initials${yearHint}`,
    };
  });
}

function ReferenceRow({
  entry,
  selected,
  onSelect,
  onLink,
  disabled,
}: {
  entry: ReferenceEntry;
  selected: boolean;
  onSelect: () => void;
  onLink: () => void;
  disabled: boolean;
}) {
  return (
    <li
      onClick={onSelect}
      className={`rounded-md border px-3 py-2 cursor-pointer transition-all ${
        selected
          ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-400"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="radio"
          checked={selected}
          onChange={onSelect}
          className="mt-1 w-3.5 h-3.5 shrink-0 accent-emerald-500 cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-navy-800 leading-snug break-words">
            {entry.number != null && (
              <span className="inline-block text-[10px] font-bold text-navy-500 mr-1.5 align-baseline">
                Ref {entry.number}
              </span>
            )}
            {entry.text}
          </p>
          {selected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onLink();
              }}
              disabled={disabled}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline disabled:opacity-60"
            >
              <Link2 className="w-3 h-3" />
              Link to this reference
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
