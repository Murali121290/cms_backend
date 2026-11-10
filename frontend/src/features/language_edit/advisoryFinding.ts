/**
 * Predicate for the Language Editor's two-mode finding card UI.
 *
 * The review panel renders findings in two distinct layouts:
 *   * **Case 1** — Actual replacement finding (``original.trim() !==
 *     suggestion.trim()``). Shows the red-strikethrough → green-
 *     highlighted diff pair plus Accept / Edit / Highlight / Ignore.
 *   * **Case 2** — Advisory finding with no text change (``advisory ===
 *     true`` AND ``original.trim() === suggestion.trim()``). Suppresses
 *     the diff + arrow + Accept + Edit; keeps the rule message, an
 *     Advisory badge, the referenced phrase shown once, and the
 *     Highlight + Ignore actions only.
 *
 * ``isAdvisoryIdentity`` captures the condition that triggers Case 2.
 * It intentionally requires BOTH the backend-supplied ``advisory`` flag
 * AND the trim-aware identity check — plain identity alone (which
 * would also be a UI bug if it slipped past the backend filter) is NOT
 * classified as advisory. Advisory findings that ever ship a real
 * replacement would correctly fall into Case 1.
 */

export interface AdvisoryCandidate {
  /** Backend-supplied flag. Advisory rule IDs (passive_voice,
   *  max_sentence_length) and advisory categories (term) set this to
   *  true in the GET findings serializer. Clients MUST NOT infer it
   *  from identity alone. */
  advisory?: boolean
  original_text: string
  /** Current proposed text — the user may have edited it inline. */
  suggestion: string
  /** Set when the reviewer typed a custom replacement. Wins over
   *  ``suggestion`` when present (same precedence the diff view uses). */
  edited_text?: string | null
}

/** Return the active suggestion string (edited wins over original
 *  suggestion) with whitespace trimmed, for identity comparison. */
function activeSuggestionTrimmed(f: AdvisoryCandidate): string {
  const sug = f.edited_text ?? f.suggestion ?? ''
  return sug.trim()
}

/** True when the finding should render in Case-2 advisory layout:
 *  backend-flagged advisory AND original/suggestion trim-equal. */
export function isAdvisoryIdentity(f: AdvisoryCandidate): boolean {
  if (!f.advisory) return false
  return (f.original_text ?? '').trim() === activeSuggestionTrimmed(f)
}
