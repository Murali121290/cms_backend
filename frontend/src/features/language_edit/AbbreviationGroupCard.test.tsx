/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react'

import {
  AbbreviationGroupCard,
  type GroupCardFinding,
} from './AbbreviationGroupCard'
import { buildAbbreviationGroups } from './abbreviationGroups'

/**
 * Regression suite for the single-card-with-rows UI.
 *
 * The component under test is the extracted presentational
 * ``AbbreviationGroupCard``. The page component wires it in with
 * real handlers; here we exercise the DOM contract directly so
 * refactors can't silently split a group back into multiple cards.
 */

function mkFinding(partial: Partial<GroupCardFinding> & { id: number; abbreviation: string; expansion: string }): GroupCardFinding {
  const { abbreviation, expansion, ...rest } = partial
  return {
    id: rest.id,
    para_index: rest.para_index ?? 0,
    start_offset: rest.start_offset ?? 0,
    rule_id: rest.rule_id ?? 'AB01',
    original_text: rest.original_text ?? 'intensive care unit',
    suggestion: rest.suggestion ?? 'ICU',
    edited_text: rest.edited_text,
    status: rest.status ?? 'pending',
    problem_label: rest.problem_label ?? null,
    abbreviation,
    expansion,
    group_key: `${abbreviation}|${expansion}`,
  }
}

function buildICUGroup(statuses: Array<GroupCardFinding['status']> = ['pending', 'pending', 'pending']) {
  const findings = statuses.map((status, i) =>
    mkFinding({
      id: 100 + i,
      para_index: 1 + i * 5,
      rule_id: i === 0 ? 'AB01' : 'AB02',
      original_text: i === 0 ? 'intensive care unit' : 'intensive care unit',
      suggestion: i === 0 ? 'intensive care unit (ICU)' : 'ICU',
      problem_label: i === 0 ? 'First use' : 'Repeated expansion',
      status,
      abbreviation: 'ICU',
      expansion: 'intensive care unit',
    }),
  )
  return buildAbbreviationGroups(findings)[0]
}

function defaultHandlers() {
  return {
    onToggleCollapse: vi.fn(),
    selectedFindingId: null as number | null,
    editingFindingId: null as number | null,
    editedInputs: {} as Record<number, string>,
    onSelectFinding: vi.fn(),
    onDecide: vi.fn(),
    onToggleEdit: vi.fn(),
    onEditInputChange: vi.fn(),
  }
}

beforeEach(() => {
  cleanup()
})

describe('AbbreviationGroupCard — structure', () => {
  it('renders ONE outer card per group, not one per occurrence', () => {
    const group = buildICUGroup(['pending', 'pending', 'pending'])
    const h = defaultHandlers()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...h} />)

    // Exactly one group card in the DOM.
    const cards = screen.getAllByTestId('abbr-group-card')
    expect(cards).toHaveLength(1)

    // Three occurrence rows INSIDE that single card.
    const rows = within(cards[0]).getAllByTestId('abbr-occurrence-row')
    expect(rows).toHaveLength(3)
  })

  it('renders occurrence rows as <li> inside a <ul> — not as nested card divs', () => {
    const group = buildICUGroup()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)

    const body = screen.getByTestId('abbr-group-body')
    expect(body.tagName).toBe('UL')
    const rows = within(body).getAllByTestId('abbr-occurrence-row')
    for (const row of rows) {
      expect(row.tagName).toBe('LI')
      // No nested card chrome: no rounded-2xl, no shadow, no
      // explicit border wrapper on the row itself.
      expect(row.className).not.toMatch(/rounded-2xl/)
      expect(row.className).not.toMatch(/shadow/)
      expect(row.className).not.toMatch(/border /)
      // And the row must NOT itself render an inner element carrying
      // a card class — the only nesting is content, not containers.
      expect(within(row).queryByTestId('abbr-group-card')).toBeNull()
    }
  })

  it('header shows abbreviation, expansion, and total occurrence count', () => {
    const group = buildICUGroup(['pending', 'pending', 'pending'])
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    const header = screen.getByTestId('abbr-group-header')
    expect(header.textContent).toContain('ICU')
    expect(header.textContent).toContain('intensive care unit')
    expect(screen.getByTestId('abbr-group-count').textContent).toMatch(/3 occurrences/)
  })

  it('header pluralises count correctly for a single occurrence', () => {
    const findings = [mkFinding({ id: 1, abbreviation: 'NP', expansion: 'nurse practitioner' })]
    const group = buildAbbreviationGroups(findings)[0]
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    expect(screen.getByTestId('abbr-group-count').textContent).toMatch(/1 occurrence$/)
  })

  it('each occurrence row shows paragraph number, diff, and problem_label', () => {
    const group = buildICUGroup()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    const rows = screen.getAllByTestId('abbr-occurrence-row')

    // UI displays para_index + 1 (1-based for the reviewer).
    expect(rows[0].textContent).toContain('Para 2')
    expect(rows[1].textContent).toContain('Para 7')
    expect(rows[2].textContent).toContain('Para 12')

    // First-use vs repeated chips derived from problem_label.
    const labels = screen.getAllByTestId('abbr-problem-label').map(e => e.textContent)
    expect(labels).toContain('First use')
    expect(labels).toContain('Repeated expansion')

    // Diff shows original → suggestion in each row.
    const diffs = screen.getAllByTestId('abbr-diff').map(e => e.textContent)
    expect(diffs[0]).toMatch(/intensive care unit\s*→\s*intensive care unit \(ICU\)/)
    expect(diffs[1]).toMatch(/intensive care unit\s*→\s*ICU/)
  })

  it('collapsing hides the row list but keeps the outer card visible', () => {
    const group = buildICUGroup()
    render(<AbbreviationGroupCard group={group} collapsed={true} {...defaultHandlers()} />)
    expect(screen.getByTestId('abbr-group-card')).toBeTruthy()
    expect(screen.queryByTestId('abbr-group-body')).toBeNull()
    expect(screen.queryAllByTestId('abbr-occurrence-row')).toHaveLength(0)
  })

  it('header click invokes onToggleCollapse with the group key', () => {
    const group = buildICUGroup()
    const h = defaultHandlers()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...h} />)
    fireEvent.click(screen.getByTestId('abbr-group-header'))
    expect(h.onToggleCollapse).toHaveBeenCalledTimes(1)
    expect(h.onToggleCollapse).toHaveBeenCalledWith(group.key)
  })
})

describe('AbbreviationGroupCard — per-occurrence actions', () => {
  it('Accept on row 2 fires onDecide with THAT row\'s finding id, not the group', () => {
    const group = buildICUGroup()
    const h = defaultHandlers()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...h} />)

    const row = screen.getAllByTestId('abbr-occurrence-row')[1]
    const accept = within(row).getByTestId('action-accept')
    fireEvent.click(accept)

    expect(h.onDecide).toHaveBeenCalledTimes(1)
    expect(h.onDecide).toHaveBeenCalledWith(group.items[1].id, 'accepted')
  })

  it('Ignore on row 1 only decides row 1 — other rows untouched', () => {
    const group = buildICUGroup()
    const h = defaultHandlers()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...h} />)

    const row = screen.getAllByTestId('abbr-occurrence-row')[0]
    fireEvent.click(within(row).getByTestId('action-ignore'))

    expect(h.onDecide).toHaveBeenCalledTimes(1)
    expect(h.onDecide).toHaveBeenCalledWith(group.items[0].id, 'rejected')
    // No other row's action fired.
    const otherIds = group.items.slice(1).map(i => i.id)
    for (const callArgs of h.onDecide.mock.calls) {
      expect(otherIds).not.toContain(callArgs[0])
    }
  })

  it('every row\'s action buttons carry that row\'s finding id (data attribute)', () => {
    const group = buildICUGroup()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)

    for (const [i, item] of group.items.entries()) {
      const row = screen.getAllByTestId('abbr-occurrence-row')[i]
      const accept = within(row).getByTestId('action-accept')
      const edit = within(row).getByTestId('action-edit')
      const highlight = within(row).getByTestId('action-highlight')
      const ignore = within(row).getByTestId('action-ignore')
      expect(accept.getAttribute('data-finding-id')).toBe(String(item.id))
      expect(edit.getAttribute('data-finding-id')).toBe(String(item.id))
      expect(highlight.getAttribute('data-finding-id')).toBe(String(item.id))
      expect(ignore.getAttribute('data-finding-id')).toBe(String(item.id))
    }
  })

  it('Edit toggles editingFindingId per-row; Save Edit emits "edited" with correct id', () => {
    const group = buildICUGroup()
    const h = {
      ...defaultHandlers(),
      editingFindingId: group.items[1].id,
      editedInputs: { [group.items[1].id]: 'ICU (ed)' },
    }
    render(<AbbreviationGroupCard group={group} collapsed={false} {...h} />)

    const row = screen.getAllByTestId('abbr-occurrence-row')[1]
    const input = within(row).getByTestId('action-edit-input')
    expect((input as HTMLInputElement).value).toBe('ICU (ed)')

    fireEvent.click(within(row).getByTestId('action-save-edit'))
    expect(h.onDecide).toHaveBeenCalledWith(group.items[1].id, 'edited')
  })

  it('Decided (accepted/edited/rejected/highlighted) rows have their action buttons disabled', () => {
    const group = buildICUGroup(['accepted', 'pending', 'rejected'])
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)

    const rows = screen.getAllByTestId('abbr-occurrence-row')
    // Row 0: accepted → disabled
    expect(within(rows[0]).getByTestId('action-accept')).toBeDisabled()
    // Row 1: pending → enabled
    expect(within(rows[1]).getByTestId('action-accept')).not.toBeDisabled()
    // Row 2: rejected → disabled
    expect(within(rows[2]).getByTestId('action-accept')).toBeDisabled()
  })
})

describe('AbbreviationGroupCard — grouping invariants', () => {
  it('different expansions produce different groups (AB07 ambiguous abbreviations)', () => {
    const findings = [
      mkFinding({ id: 1, abbreviation: 'AMA', expansion: 'American Medical Association', rule_id: 'AB07' }),
      mkFinding({ id: 2, abbreviation: 'AMA', expansion: 'Against Medical Advice', rule_id: 'AB07' }),
    ]
    const groups = buildAbbreviationGroups(findings)
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.expansion).sort()).toEqual([
      'Against Medical Advice',
      'American Medical Association',
    ])
  })

  it('AB01 + AB02 on the same (abbreviation, expansion) coalesce into ONE group', () => {
    const findings = [
      mkFinding({ id: 1, rule_id: 'AB01', abbreviation: 'ICU', expansion: 'intensive care unit', problem_label: 'First use' }),
      mkFinding({ id: 2, rule_id: 'AB02', abbreviation: 'ICU', expansion: 'intensive care unit', para_index: 5, problem_label: 'Repeated expansion' }),
      mkFinding({ id: 3, rule_id: 'AB02', abbreviation: 'ICU', expansion: 'intensive care unit', para_index: 10, problem_label: 'Repeated expansion' }),
    ]
    const groups = buildAbbreviationGroups(findings)
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map(i => i.rule_id)).toEqual(['AB01', 'AB02', 'AB02'])

    // And the UI renders all three inside one card.
    render(<AbbreviationGroupCard group={groups[0]} collapsed={false} {...defaultHandlers()} />)
    expect(screen.getAllByTestId('abbr-group-card')).toHaveLength(1)
    expect(screen.getAllByTestId('abbr-occurrence-row')).toHaveLength(3)
  })
})
