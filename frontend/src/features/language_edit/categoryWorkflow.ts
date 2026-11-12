/**
 * Sequential category-unlock workflow.
 *
 * The Language Review sidebar reveals finding-category chips one at
 * a time so reviewers work through them in order. When the document
 * is first loaded, only the first unresolved category is visible;
 * as its findings are resolved, the next category appears.
 *
 * This module is a pure function over the live findings list — no
 * separate workflow state is stored. That means refresh, reopen,
 * and re-analysis "just work": re-computing against the authoritative
 * finding statuses always yields the correct visible / completed /
 * next-unlocked set. If a re-analysis makes an earlier finding
 * pending again, subsequent categories lock back up automatically.
 *
 * Non-finding sidebar tabs (``all``, ``comments``, ``rules``) are
 * NOT part of this workflow — they stay always visible. The spec's
 * "resolved" definition (Accept / Edit / Ignore) only applies to AI
 * findings; reviewer comments and the settings panel have different
 * lifecycles.
 */

/**
 * Chip-order unlock sequence. Matches the visual chip order in
 * ``LanguageReviewPage``: Abbreviations → Medical Terms → Hyphenated
 * Words → Inclusive → Grammar → Punctuation and Capitalization →
 * Spelling → Spell Check. Comments (position 9 in the UI) is
 * excluded because comments aren't AI findings; Spell Check (typo)
 * is therefore the eighth and last chip in the chain.
 */
export const CATEGORY_UNLOCK_ORDER = [
  'abbreviations',
  'medical_terms',
  'hyphenation',
  'bias',
  'grammar',
  'sentence',
  'spelling',
  'typo',
] as const

export type UnlockCategory = typeof CATEGORY_UNLOCK_ORDER[number]

/**
 * Narrowed finding shape — the workflow only reads what it needs so
 * callers can pass either the full page Finding or a lightweight
 * test fixture.
 */
export interface WorkflowFinding {
  category: string
  status: string
  source?: string | null
}

/**
 * Per-spec: "A finding is resolved only when the user performs one
 * of these actions: Accept, Edit, Ignore."
 *
 * Highlight does NOT resolve; neither does pending.
 */
export const RESOLVED_STATUSES = new Set(['accepted', 'edited', 'rejected'])

export function isResolvedStatus(status: string): boolean {
  return RESOLVED_STATUSES.has(status)
}

/**
 * Map a finding to the unlock category it belongs to. Mirrors the
 * ``pendingFindings`` filter predicates in ``LanguageReviewPage`` so
 * a finding counted toward the ``Inclusive`` chip (bias / article /
 * term source) completes the ``bias`` slot; a finding counted toward
 * the ``Hyphenated Words`` chip (hyphenation / compounds / compound)
 * completes the ``hyphenation`` slot.
 */
export function categoryMatches(f: WorkflowFinding, cat: UnlockCategory): boolean {
  if (cat === 'bias') {
    return (
      f.category === 'bias' ||
      f.category === 'article' ||
      f.category === 'term' ||
      f.source === 'term'
    )
  }
  if (cat === 'hyphenation') {
    return (
      f.category === 'hyphenation' ||
      f.category === 'compounds' ||
      f.category === 'compound'
    )
  }
  return f.category === cat
}

export interface WorkflowState {
  /**
   * Categories the reviewer has fully resolved. Empty-finding
   * categories are auto-skipped (not placed in completed because
   * the reviewer didn't resolve anything — they simply have
   * nothing to resolve).
   */
  completed: Set<UnlockCategory>
  /**
   * The current category the reviewer is expected to work on.
   * ``null`` once every non-empty category has been resolved.
   */
  nextUnlocked: UnlockCategory | null
  /**
   * The set of category chips to render. Always a subset of
   * ``CATEGORY_UNLOCK_ORDER``. Empty categories do NOT appear
   * (per spec rule 3: zero-finding categories are skipped,
   * not revealed). Previously-completed categories stay visible
   * so the reviewer can return to them.
   */
  visible: Set<UnlockCategory>
}

/**
 * Compute the visible / completed / next-unlocked state for the
 * current findings list. Pure function — call from a useMemo keyed
 * on the findings array and the result is stable across renders.
 *
 * Algorithm:
 *   1. Walk ``CATEGORY_UNLOCK_ORDER`` from first to last.
 *   2. For each category:
 *      a. Collect its findings via ``categoryMatches``.
 *      b. If empty → skip (not visible, not completed; auto-skip
 *         per rule 3 so the next non-empty category becomes
 *         the sequential target).
 *      c. If every finding is in ``RESOLVED_STATUSES`` → add to
 *         completed and visible; continue walking so the next
 *         non-empty category becomes the new target.
 *      d. Otherwise (at least one pending or highlighted) → add
 *         to visible, mark as ``nextUnlocked``, and STOP walking.
 *         Later categories stay hidden until this one completes.
 *   3. Return the accumulated sets.
 */
export function computeCategoryWorkflow(findings: WorkflowFinding[]): WorkflowState {
  const completed = new Set<UnlockCategory>()
  const visible = new Set<UnlockCategory>()
  let nextUnlocked: UnlockCategory | null = null
  for (const cat of CATEGORY_UNLOCK_ORDER) {
    const members = findings.filter(f => categoryMatches(f, cat))
    if (members.length === 0) {
      // Rule 3: zero-finding categories are skipped automatically.
      // Not visible, not placed in completed — they never enter the
      // user-facing workflow.
      continue
    }
    if (members.every(f => isResolvedStatus(f.status))) {
      completed.add(cat)
      visible.add(cat)
      continue
    }
    // First non-empty category with any unresolved (pending or
    // highlighted) finding: this is the active unlock target.
    visible.add(cat)
    nextUnlocked = cat
    break
  }
  return { completed, nextUnlocked, visible }
}
