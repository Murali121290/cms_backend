import { describe, it, expect } from 'vitest'
import {
  buildAbbreviationGroups,
  isDisplayableGroup,
  type GroupableFinding,
} from './abbreviationGroups'

function f(partial: Partial<GroupableFinding> & { id: number }): GroupableFinding {
  return {
    para_index: 0,
    start_offset: 0,
    rule_id: 'AB01',
    group_key: null,
    abbreviation: null,
    expansion: null,
    ...partial,
  }
}

describe('buildAbbreviationGroups', () => {
  it('coalesces findings that share group_key regardless of rule_id', () => {
    // User's spec: AB01 first-use + two AB02 subsequent-use findings
    // on the same ICU land in the same card.
    const findings = [
      f({ id: 1, para_index: 0, rule_id: 'AB01', group_key: 'ICU|intensive care unit', abbreviation: 'ICU', expansion: 'intensive care unit' }),
      f({ id: 2, para_index: 1, rule_id: 'AB02', group_key: 'ICU|intensive care unit', abbreviation: 'ICU', expansion: 'intensive care unit' }),
      f({ id: 3, para_index: 2, rule_id: 'AB02', group_key: 'ICU|intensive care unit', abbreviation: 'ICU', expansion: 'intensive care unit' }),
    ]
    const groups = buildAbbreviationGroups(findings)
    expect(groups).toHaveLength(1)
    expect(groups[0].abbreviation).toBe('ICU')
    expect(groups[0].expansion).toBe('intensive care unit')
    expect(groups[0].items.map(x => x.id)).toEqual([1, 2, 3])
  })

  it('keeps different expansions in separate groups', () => {
    // AB07 ambiguous meanings: AMA → "American Medical Association"
    // vs AMA → "Against Medical Advice" must NOT coalesce.
    const findings = [
      f({ id: 1, para_index: 0, rule_id: 'AB07', group_key: 'AMA|American Medical Association', abbreviation: 'AMA', expansion: 'American Medical Association' }),
      f({ id: 2, para_index: 1, rule_id: 'AB07', group_key: 'AMA|Against Medical Advice', abbreviation: 'AMA', expansion: 'Against Medical Advice' }),
    ]
    const groups = buildAbbreviationGroups(findings)
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.expansion).sort()).toEqual(['Against Medical Advice', 'American Medical Association'])
  })

  it('preserves per-occurrence rule_id and id (grouping is view-only)', () => {
    // Requirement #3: each occurrence must retain its own rule_id
    // and finding id so Accept/Edit/Highlight/Ignore keep working.
    const findings = [
      f({ id: 42, rule_id: 'AB01', para_index: 0, group_key: 'ICU|x', abbreviation: 'ICU', expansion: 'x' }),
      f({ id: 43, rule_id: 'AB13', para_index: 1, group_key: 'ICU|x', abbreviation: 'ICU', expansion: 'x' }),
    ]
    const [group] = buildAbbreviationGroups(findings)
    expect(group.items[0].id).toBe(42)
    expect(group.items[0].rule_id).toBe('AB01')
    expect(group.items[1].id).toBe(43)
    expect(group.items[1].rule_id).toBe('AB13')
  })

  it('sends findings without group_key to ungrouped singleton buckets', () => {
    // DN rules, grammar, spelling, etc. arrive with group_key=null.
    // Each gets its own bucket so the render layer treats every
    // card uniformly without branching.
    const findings = [
      f({ id: 10, rule_id: 'DN01', para_index: 0 }),
      f({ id: 11, rule_id: 'DN02', para_index: 1 }),
      f({ id: 12, rule_id: 'GV-001', para_index: 2 }),
    ]
    const groups = buildAbbreviationGroups(findings)
    expect(groups).toHaveLength(3)
    for (const g of groups) {
      expect(g.key.startsWith('__ungrouped__')).toBe(true)
      expect(g.items).toHaveLength(1)
    }
  })

  it('sorts groups by document position of earliest member', () => {
    // Even when findings arrive interleaved, groups emerge in
    // document order so the panel scrolls naturally.
    const findings = [
      f({ id: 1, para_index: 10, group_key: 'A|a', abbreviation: 'A', expansion: 'a' }),
      f({ id: 2, para_index: 2,  group_key: 'B|b', abbreviation: 'B', expansion: 'b' }),
      f({ id: 3, para_index: 11, group_key: 'A|a', abbreviation: 'A', expansion: 'a' }),
      f({ id: 4, para_index: 3,  group_key: 'B|b', abbreviation: 'B', expansion: 'b' }),
    ]
    const groups = buildAbbreviationGroups(findings)
    // B first (earliest member at para 2), then A (earliest at para 10).
    expect(groups.map(g => g.abbreviation)).toEqual(['B', 'A'])
    // Within each group, items keep input order.
    expect(groups[0].items.map(x => x.id)).toEqual([2, 4])
    expect(groups[1].items.map(x => x.id)).toEqual([1, 3])
  })

  it('tiebreaks groups with same para_index by start_offset', () => {
    const findings = [
      f({ id: 1, para_index: 5, start_offset: 20, group_key: 'B|b', abbreviation: 'B', expansion: 'b' }),
      f({ id: 2, para_index: 5, start_offset: 10, group_key: 'A|a', abbreviation: 'A', expansion: 'a' }),
    ]
    const groups = buildAbbreviationGroups(findings)
    expect(groups.map(g => g.abbreviation)).toEqual(['A', 'B'])
  })

  it('returns [] for empty input', () => {
    expect(buildAbbreviationGroups([])).toEqual([])
  })
})

describe('isDisplayableGroup', () => {
  it('returns true only for multi-occurrence named groups', () => {
    const multi = buildAbbreviationGroups([
      f({ id: 1, group_key: 'ICU|x', abbreviation: 'ICU', expansion: 'x' }),
      f({ id: 2, group_key: 'ICU|x', abbreviation: 'ICU', expansion: 'x', para_index: 1 }),
    ])[0]
    expect(isDisplayableGroup(multi)).toBe(true)
  })

  it('returns false for singleton AB groups', () => {
    // A single-occurrence AB finding is rendered as a flat card —
    // no redundant header above one row.
    const single = buildAbbreviationGroups([
      f({ id: 1, group_key: 'ICU|x', abbreviation: 'ICU', expansion: 'x' }),
    ])[0]
    expect(isDisplayableGroup(single)).toBe(false)
  })

  it('returns false for ungrouped (non-AB) findings', () => {
    const dn = buildAbbreviationGroups([f({ id: 1, rule_id: 'DN01' })])[0]
    expect(isDisplayableGroup(dn)).toBe(false)
  })
})
