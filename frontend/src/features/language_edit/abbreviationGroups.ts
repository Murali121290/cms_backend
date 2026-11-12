/**
 * Grouping reducer for the Abbreviations side-panel.
 *
 * Collapses multiple AB findings on the same (abbreviation, expansion)
 * into a single visual group so the reviewer sees one card per
 * unique abbreviation with every occurrence listed inside. The
 * backend emits a stable ``group_key`` of the form
 * ``"<abbr>|<expansion>"`` on each AB row (see
 * ``abbreviations_metadata.grouping_fields_for`` on the server).
 *
 * Non-AB findings arrive with ``group_key: null`` (DN rules,
 * grammar, spelling, hyphenation, …). They land in singleton
 * ``__ungrouped__<id>`` buckets so the render path can treat every
 * entry uniformly — no branching between "grouped" and "flat" at
 * the card level.
 *
 * Exposed separately from ``LanguageReviewPage`` so the reducer
 * can be unit-tested without mounting the full page component.
 */

export interface GroupableFinding {
  id: number
  para_index: number
  start_offset: number
  rule_id: string
  group_key?: string | null
  abbreviation?: string | null
  expansion?: string | null
}

export interface AbbreviationGroup<F extends GroupableFinding> {
  key: string
  abbreviation: string | null
  expansion: string | null
  /** rule_id of the FIRST member in document order — used for the
   *  group header's compact rule-id chip. Group members themselves
   *  retain their own rule_id values and render individual chips. */
  rule_id: string
  firstParaIndex: number
  firstStartOffset: number
  items: F[]
}

/**
 * Bucket an ordered list of findings into (abbreviation, expansion)
 * groups. Members within each group are kept in input order; groups
 * themselves are returned sorted by (earliest para_index, earliest
 * start_offset) so the panel scrolls in document order regardless
 * of input interleaving.
 */
export function buildAbbreviationGroups<F extends GroupableFinding>(
  findings: F[],
): AbbreviationGroup<F>[] {
  const byKey = new Map<string, F[]>()
  for (const f of findings) {
    const key = f.group_key || `__ungrouped__${f.id}`
    const arr = byKey.get(key)
    if (arr) arr.push(f)
    else byKey.set(key, [f])
  }
  const groups: AbbreviationGroup<F>[] = []
  for (const [key, items] of byKey.entries()) {
    groups.push({
      key,
      abbreviation: items[0].abbreviation ?? null,
      expansion: items[0].expansion ?? null,
      rule_id: items[0].rule_id,
      firstParaIndex: items[0].para_index,
      firstStartOffset: items[0].start_offset,
      items,
    })
  }
  groups.sort(
    (a, b) =>
      a.firstParaIndex - b.firstParaIndex ||
      a.firstStartOffset - b.firstStartOffset,
  )
  return groups
}

/**
 * Convenience predicate used by the render layer: only multi-member
 * groups get a collapsible header. Singletons render as flat cards —
 * a header for one occurrence is noise.
 */
export function isDisplayableGroup<F extends GroupableFinding>(
  group: AbbreviationGroup<F>,
): boolean {
  return group.items.length > 1 && !group.key.startsWith('__ungrouped__')
}
