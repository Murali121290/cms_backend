/**
 * Category-chip visibility for the Language Review sidebar.
 *
 * Current behaviour (reverted from the earlier sequential-unlock
 * experiment): every actionable category chip is visible as soon as
 * the document loads. Reviewers choose which category to work on,
 * not the UI. The Inclusive + Comments view-only chips also show
 * immediately — the sidebar no longer gates them behind an "all
 * actionable categories complete" milestone.
 *
 * This module remains a pure function over the live findings list so
 * downstream consumers can introspect resolution progress without
 * tracking separate state:
 *
 *   * ``visible`` — every entry in ``CATEGORY_UNLOCK_ORDER``. The
 *     Language Review page uses this via ``isChipVisible`` and the
 *     snap-back ``useEffect`` as a safe no-op; its membership check
 *     always returns true. Kept as a Set (rather than removing the
 *     field) so call sites that already type against ``WorkflowState``
 *     don't need to change.
 *   * ``completed`` — categories whose findings are ALL resolved
 *     (Accept / Edit / Ignore). Not consumed by the chip bar anymore
 *     but still accurate for tooling / telemetry.
 *   * ``nextUnlocked`` — first non-empty, not-fully-resolved category
 *     in ``CATEGORY_UNLOCK_ORDER``. The chip bar no longer reads this
 *     either, but a ``null`` value is a useful "the reviewer has
 *     cleared everything" signal.
 *   * ``allActionableCategoriesComplete`` — always ``true`` so the
 *     Inclusive + Comments JSX gates let them through from the start.
 *     The name is a historical artefact; "complete" here just means
 *     "unblocked".
 *
 * Non-finding sidebar tabs (``all``, ``comments``, ``rules``) have
 * always rendered unconditionally and continue to.
 */

/**
 * Chip-order unlock sequence — the SEVEN actionable finding
 * categories whose findings the reviewer must Accept, Edit, or
 * Ignore before the next chip unlocks:
 *
 *   1. Abbreviations
 *   2. Medical Terms
 *   3. Hyphenation
 *   4. Grammar
 *   5. Spelling
 *   6. Punctuation and Capitalization  (internal id ``sentence``)
 *   7. Spell Check                     (internal id ``typo``)
 *
 * ``Inclusive`` (internal id ``bias``) is NOT part of this chain —
 * it is view-only and appears only after every actionable category
 * is complete. ``Comments`` is also view-only and surfaces alongside
 * Inclusive. See ``allActionableCategoriesComplete`` below.
 */
export const CATEGORY_UNLOCK_ORDER = [
  'abbreviations',
  'medical_terms',
  'hyphenation',
  'grammar',
  'spelling',
  'sentence',
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
 * a finding counted toward the ``Hyphenated Words`` chip (hyphenation
 * / compounds / compound) completes the ``hyphenation`` slot.
 *
 * ``Inclusive`` findings (category ``bias`` / ``article`` / ``term``
 * / source ``term``) are NOT part of this map — Inclusive is view-
 * only and sits outside the actionable unlock chain. The
 * ``isInclusiveFinding`` predicate below handles the view-only tab's
 * own filter.
 */
export function categoryMatches(f: WorkflowFinding, cat: UnlockCategory): boolean {
  if (cat === 'hyphenation') {
    return (
      f.category === 'hyphenation' ||
      f.category === 'compounds' ||
      f.category === 'compound'
    )
  }
  return f.category === cat
}

/**
 * True when a finding belongs to the view-only Inclusive tab
 * (``bias`` / ``article`` category, or any term-matcher highlight).
 * These findings are visible once the seven actionable categories
 * finish; they never require Accept / Edit / Ignore themselves.
 */
export function isInclusiveFinding(f: WorkflowFinding): boolean {
  return (
    f.category === 'bias' ||
    f.category === 'article' ||
    f.category === 'term' ||
    f.source === 'term'
  )
}

export interface WorkflowState {
  /**
   * Categories the reviewer has fully resolved. Empty-finding
   * categories are not included (there was nothing to resolve).
   * Not consumed by the chip bar anymore; retained for telemetry
   * and any future "all done" UX.
   */
  completed: Set<UnlockCategory>
  /**
   * The first non-empty, not-fully-resolved category in
   * ``CATEGORY_UNLOCK_ORDER``. ``null`` once every non-empty
   * category is resolved. Not used for chip gating in the current
   * UI but still a useful "is there any work left?" signal.
   */
  nextUnlocked: UnlockCategory | null
  /**
   * The set of category chips to render. ALWAYS the full
   * ``CATEGORY_UNLOCK_ORDER`` — every actionable chip shows from
   * the moment the document loads. ``isChipVisible`` and the
   * snap-back ``useEffect`` in the page remain correct no-ops.
   */
  visible: Set<UnlockCategory>
  /**
   * Always ``true`` now that the sidebar no longer gates Inclusive
   * + Comments behind a progress milestone. Kept as a field so the
   * ``WorkflowState`` type and existing JSX gates don't need to
   * change at the call sites.
   */
  allActionableCategoriesComplete: boolean
}

/**
 * Compute the visible / completed / next-unlocked state for the
 * current findings list. Pure function — call from a useMemo keyed
 * on the findings array and the result is stable across renders.
 *
 * Current algorithm (post-revert):
 *   1. Walk ``CATEGORY_UNLOCK_ORDER`` from first to last.
 *   2. For each category:
 *      a. Collect its findings via ``categoryMatches``.
 *      b. If every finding is in ``RESOLVED_STATUSES`` AND there
 *         is at least one finding → add to ``completed``.
 *      c. Otherwise, if any finding is unresolved and
 *         ``nextUnlocked`` is still ``null``, record this category
 *         as the first outstanding one.
 *   3. ``visible`` is populated with every category in the order,
 *      regardless of resolution state — the chip bar shows them all.
 *   4. ``allActionableCategoriesComplete`` is hard-coded ``true``
 *      so Inclusive + Comments show immediately.
 */
export function computeCategoryWorkflow(findings: WorkflowFinding[]): WorkflowState {
  const completed = new Set<UnlockCategory>()
  const visible = new Set<UnlockCategory>(CATEGORY_UNLOCK_ORDER)
  let nextUnlocked: UnlockCategory | null = null
  for (const cat of CATEGORY_UNLOCK_ORDER) {
    const members = findings.filter(f => categoryMatches(f, cat))
    if (members.length === 0) continue
    if (members.every(f => isResolvedStatus(f.status))) {
      completed.add(cat)
      continue
    }
    if (nextUnlocked === null) {
      nextUnlocked = cat
    }
  }
  return {
    completed,
    nextUnlocked,
    visible,
    allActionableCategoriesComplete: true,
  }
}
