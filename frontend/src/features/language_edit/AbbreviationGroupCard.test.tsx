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
    end_offset: rest.end_offset ?? ((rest.start_offset ?? 0) + (rest.original_text ?? 'x').length),
    rule_id: rest.rule_id ?? 'AB01',
    original_text: rest.original_text ?? 'intensive care unit',
    suggestion: rest.suggestion ?? 'ICU',
    edited_text: rest.edited_text,
    status: rest.status ?? 'pending',
    problem_label: rest.problem_label ?? null,
    first_definition: rest.first_definition ?? null,
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

  it('a pending row whose decide POST is in flight shows a saving state and disables every action', () => {
    // Regression for the duplicate-click bug: the nginx access log
    // showed five POSTs to the same finding id within 18 seconds
    // because the UI didn't give immediate feedback. The ``isFindingSaving``
    // predicate now reports the in-flight status and the card must
    // disable Accept / Edit / Highlight / Ignore until it clears.
    const group = buildICUGroup(['pending', 'pending', 'pending'])
    const savingId = group.items[1].id
    render(
      <AbbreviationGroupCard
        group={group}
        collapsed={false}
        {...defaultHandlers()}
        isFindingSaving={(id) => id === savingId}
      />,
    )
    const rows = screen.getAllByTestId('abbr-occurrence-row')
    // Row 1 (the one in flight) — every action disabled, Accept
    // shows "Saving…".
    expect(within(rows[1]).getByTestId('action-accept')).toBeDisabled()
    expect(within(rows[1]).getByTestId('action-edit')).toBeDisabled()
    expect(within(rows[1]).getByTestId('action-highlight')).toBeDisabled()
    expect(within(rows[1]).getByTestId('action-ignore')).toBeDisabled()
    expect(within(rows[1]).getByTestId('action-accept').getAttribute('aria-busy')).toBe('true')
    expect(within(rows[1]).getByTestId('action-accept').textContent).toContain('Saving')
    // Row 0 and Row 2 remain enabled — the lock is per-finding, not per-group.
    expect(within(rows[0]).getByTestId('action-accept')).not.toBeDisabled()
    expect(within(rows[2]).getByTestId('action-accept')).not.toBeDisabled()
  })

  it('clicking Accept on an in-flight row does NOT fire onDecide a second time', () => {
    const group = buildICUGroup()
    const h = defaultHandlers()
    const savingId = group.items[0].id
    render(
      <AbbreviationGroupCard
        group={group}
        collapsed={false}
        {...h}
        isFindingSaving={(id) => id === savingId}
      />,
    )
    const row = screen.getAllByTestId('abbr-occurrence-row')[0]
    fireEvent.click(within(row).getByTestId('action-accept'))
    // Button was disabled → React fires no click handler → onDecide
    // is never invoked for that row.
    expect(h.onDecide).not.toHaveBeenCalled()
  })
})

// ─── Selection checkboxes + Select All / Clear ──────────────────────

describe('AbbreviationGroupCard — selection checkboxes', () => {
  it('does NOT render per-row checkboxes when onToggleSelect is not provided (back-compat)', () => {
    const group = buildICUGroup()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    expect(screen.queryAllByTestId('abbr-row-select')).toHaveLength(0)
    expect(screen.queryByTestId('abbr-group-selection-bar')).toBeNull()
  })

  it('renders a checkbox for every pending row when onToggleSelect is provided', () => {
    const group = buildICUGroup(['pending', 'pending', 'pending'])
    render(
      <AbbreviationGroupCard
        group={group}
        collapsed={false}
        {...defaultHandlers()}
        selectedFindingIds={new Set<number>()}
        onToggleSelect={vi.fn()}
      />,
    )
    const checkboxes = screen.getAllByTestId('abbr-row-select')
    expect(checkboxes).toHaveLength(3)
    for (const cb of checkboxes) {
      expect((cb as HTMLInputElement).checked).toBe(false)
    }
  })

  it('decided rows DO NOT show a checkbox — only pending rows do', () => {
    const group = buildICUGroup(['accepted', 'pending', 'rejected'])
    render(
      <AbbreviationGroupCard
        group={group}
        collapsed={false}
        {...defaultHandlers()}
        selectedFindingIds={new Set<number>()}
        onToggleSelect={vi.fn()}
      />,
    )
    expect(screen.getAllByTestId('abbr-row-select')).toHaveLength(1)
  })

  it('reflects selected ids in the checkbox state', () => {
    const group = buildICUGroup()
    const selected = new Set<number>([group.items[1].id])
    render(
      <AbbreviationGroupCard
        group={group}
        collapsed={false}
        {...defaultHandlers()}
        selectedFindingIds={selected}
        onToggleSelect={vi.fn()}
      />,
    )
    const rowCheckboxes = screen.getAllByTestId('abbr-row-select')
    expect((rowCheckboxes[0] as HTMLInputElement).checked).toBe(false)
    expect((rowCheckboxes[1] as HTMLInputElement).checked).toBe(true)
    expect((rowCheckboxes[2] as HTMLInputElement).checked).toBe(false)
  })

  it('toggling a row checkbox invokes onToggleSelect with the row finding id — NOT the group key', () => {
    const group = buildICUGroup()
    const onToggleSelect = vi.fn()
    render(
      <AbbreviationGroupCard
        group={group}
        collapsed={false}
        {...defaultHandlers()}
        selectedFindingIds={new Set<number>()}
        onToggleSelect={onToggleSelect}
      />,
    )
    fireEvent.click(screen.getAllByTestId('abbr-row-select')[1])
    expect(onToggleSelect).toHaveBeenCalledWith(group.items[1].id)
    // The group's abstract key never leaks into onToggleSelect args.
    for (const call of onToggleSelect.mock.calls) {
      expect(typeof call[0]).toBe('number')
    }
  })

  it('Select All in the header invokes onSelectAllInGroup with every PENDING id', () => {
    const group = buildICUGroup(['pending', 'accepted', 'pending'])
    const onSelectAllInGroup = vi.fn()
    render(
      <AbbreviationGroupCard
        group={group}
        collapsed={false}
        {...defaultHandlers()}
        selectedFindingIds={new Set<number>()}
        onToggleSelect={vi.fn()}
        onSelectAllInGroup={onSelectAllInGroup}
      />,
    )
    fireEvent.click(screen.getByTestId('abbr-group-select-all'))
    // Only the two pending ids make it into the Select All call.
    expect(onSelectAllInGroup).toHaveBeenCalledTimes(1)
    const [ids] = onSelectAllInGroup.mock.calls[0]
    expect((ids as number[]).sort()).toEqual([group.items[0].id, group.items[2].id].sort())
  })

  it('when all pending rows are selected, Select All toggles to Clear', () => {
    const group = buildICUGroup()
    const allIds = new Set<number>(group.items.map(i => i.id))
    const onClearSelectionInGroup = vi.fn()
    render(
      <AbbreviationGroupCard
        group={group}
        collapsed={false}
        {...defaultHandlers()}
        selectedFindingIds={allIds}
        onToggleSelect={vi.fn()}
        onClearSelectionInGroup={onClearSelectionInGroup}
      />,
    )
    fireEvent.click(screen.getByTestId('abbr-group-select-all'))
    expect(onClearSelectionInGroup).toHaveBeenCalledTimes(1)
  })
})

// ─── First-occurrence marker ────────────────────────────────────────

describe('AbbreviationGroupCard — first-occurrence marker', () => {
  function mkFirstUseGroup() {
    const findings = [
      mkFinding({ id: 1, rule_id: 'AB01', para_index: 0, problem_label: 'First use', abbreviation: 'ICU', expansion: 'intensive care unit', suggestion: 'intensive care unit (ICU)' }),
      mkFinding({ id: 2, rule_id: 'AB02', para_index: 5, problem_label: 'Repeated expansion', abbreviation: 'ICU', expansion: 'intensive care unit' }),
      mkFinding({ id: 3, rule_id: 'AB02', para_index: 10, problem_label: 'Repeated expansion', abbreviation: 'ICU', expansion: 'intensive care unit' }),
    ]
    return buildAbbreviationGroups(findings)[0]
  }

  it('marks the first occurrence with a visible badge', () => {
    const group = mkFirstUseGroup()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    const rows = screen.getAllByTestId('abbr-occurrence-row')
    // Only the first row carries the first-occurrence badge.
    expect(within(rows[0]).queryByTestId('abbr-first-occurrence')).not.toBeNull()
    expect(within(rows[1]).queryByTestId('abbr-first-occurrence')).toBeNull()
    expect(within(rows[2]).queryByTestId('abbr-first-occurrence')).toBeNull()
  })

  it('shows the "Valid definition" style when the first occurrence problem_label is "First use"', () => {
    const group = mkFirstUseGroup()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    const badge = screen.getByTestId('abbr-first-occurrence')
    expect(badge.textContent).toContain('Valid definition')
    expect(badge.className).toContain('emerald')
  })

  it('shows a cautionary style when the first occurrence is NOT a workbook first-use', () => {
    // A group where every row is AB02 "Repeated expansion" (no
    // AB01 was emitted — the engine didn't recognise a first use).
    const findings = [
      mkFinding({ id: 1, rule_id: 'AB02', para_index: 0, problem_label: 'Repeated expansion', abbreviation: 'ICU', expansion: 'intensive care unit' }),
      mkFinding({ id: 2, rule_id: 'AB02', para_index: 5, problem_label: 'Repeated expansion', abbreviation: 'ICU', expansion: 'intensive care unit' }),
    ]
    const group = buildAbbreviationGroups(findings)[0]
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    const badge = screen.getByTestId('abbr-first-occurrence')
    expect(badge.textContent).not.toContain('Valid definition')
    expect(badge.className).toContain('amber')
  })

  it('singleton groups (one occurrence) do not show the first-occurrence marker', () => {
    const findings = [mkFinding({ id: 1, rule_id: 'AB02', para_index: 0, abbreviation: 'ICU', expansion: 'intensive care unit', problem_label: 'Repeated expansion' })]
    const group = buildAbbreviationGroups(findings)[0]
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    expect(screen.queryByTestId('abbr-first-occurrence')).toBeNull()
  })

  it('does not render a reference row when no item carries first_definition', () => {
    const group = mkFirstUseGroup()
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    expect(screen.queryByTestId('abbr-reference-row')).toBeNull()
  })

  it('renders a non-interactive reference row when an AB04 finding carries first_definition', () => {
    const findings = [
      mkFinding({
        id: 1, rule_id: 'AB04', para_index: 9,
        original_text: 'chronic kidney disease (CKD)', suggestion: 'CKD',
        problem_label: 'Repeated definition',
        abbreviation: 'CKD', expansion: 'chronic kidney disease',
        first_definition: {
          para_index: 2, start_offset: 4, end_offset: 32,
          text: 'chronic kidney disease (CKD)',
        },
      }),
      mkFinding({
        id: 2, rule_id: 'AB04', para_index: 15,
        original_text: 'chronic kidney disease (CKD)', suggestion: 'CKD',
        problem_label: 'Repeated definition',
        abbreviation: 'CKD', expansion: 'chronic kidney disease',
        first_definition: {
          para_index: 2, start_offset: 4, end_offset: 32,
          text: 'chronic kidney disease (CKD)',
        },
      }),
    ]
    const group = buildAbbreviationGroups(findings)[0]
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    const ref = screen.getByTestId('abbr-reference-row')
    expect(ref).toBeTruthy()
    // Shows Para 3 (para_index 2 + 1) label
    expect(ref.textContent).toContain('Para 3')
    // Shows the first-definition surface text
    expect(screen.getByTestId('abbr-reference-text').textContent).toContain(
      'chronic kidney disease (CKD)',
    )
    // Reference row carries NO interactive controls — no checkbox,
    // no Accept / Edit / Highlight / Ignore button.
    expect(within(ref).queryByTestId('abbr-row-select')).toBeNull()
    expect(within(ref).queryByTestId('action-accept')).toBeNull()
    expect(within(ref).queryByTestId('action-edit')).toBeNull()
    expect(within(ref).queryByTestId('action-highlight')).toBeNull()
    expect(within(ref).queryByTestId('action-ignore')).toBeNull()
  })

  it('reference row is excluded from Select All (Select All targets only real pending findings)', () => {
    const findings = [
      mkFinding({
        id: 1, rule_id: 'AB04', para_index: 9,
        original_text: 'chronic kidney disease (CKD)', suggestion: 'CKD',
        problem_label: 'Repeated definition',
        abbreviation: 'CKD', expansion: 'chronic kidney disease',
        first_definition: {
          para_index: 2, start_offset: 4, end_offset: 32,
          text: 'chronic kidney disease (CKD)',
        },
      }),
      mkFinding({
        id: 2, rule_id: 'AB04', para_index: 15,
        original_text: 'chronic kidney disease (CKD)', suggestion: 'CKD',
        problem_label: 'Repeated definition',
        abbreviation: 'CKD', expansion: 'chronic kidney disease',
      }),
    ]
    const group = buildAbbreviationGroups(findings)[0]
    const onSelectAllInGroup = vi.fn()
    render(
      <AbbreviationGroupCard
        group={group}
        collapsed={false}
        {...defaultHandlers()}
        selectedFindingIds={new Set<number>()}
        onToggleSelect={vi.fn()}
        onSelectAllInGroup={onSelectAllInGroup}
      />,
    )
    fireEvent.click(screen.getByTestId('abbr-group-select-all'))
    const [ids] = onSelectAllInGroup.mock.calls[0]
    // Only the two AB04 finding ids — the reference pseudo-row has
    // no id and never enters the selection set.
    expect((ids as number[]).sort()).toEqual([1, 2])
  })

  it('suppresses the reference row when an existing group item already covers that span', () => {
    // An AB04 item whose first_definition's span EQUALS one of the
    // group's own rows (the engine would normally skip this case,
    // but the guard protects the UI from double-showing the same
    // occurrence).
    const findings = [
      mkFinding({
        id: 1, rule_id: 'AB04', para_index: 2, start_offset: 4,
        end_offset: 32,
        original_text: 'chronic kidney disease (CKD)', suggestion: 'CKD',
        problem_label: 'Repeated definition',
        abbreviation: 'CKD', expansion: 'chronic kidney disease',
        first_definition: {
          para_index: 2, start_offset: 4, end_offset: 32,
          text: 'chronic kidney disease (CKD)',
        },
      }),
      mkFinding({
        id: 2, rule_id: 'AB04', para_index: 15, start_offset: 0,
        end_offset: 28,
        original_text: 'chronic kidney disease (CKD)', suggestion: 'CKD',
        problem_label: 'Repeated definition',
        abbreviation: 'CKD', expansion: 'chronic kidney disease',
      }),
    ]
    const group = buildAbbreviationGroups(findings)[0]
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    expect(screen.queryByTestId('abbr-reference-row')).toBeNull()
  })

  it('first-occurrence badge appears on the DOCUMENT-ORDER first row even when occurrences arrive unsorted', () => {
    // Unsorted input: para 10 first, para 2 second, para 0 third.
    const findings = [
      mkFinding({ id: 10, rule_id: 'AB02', para_index: 10, abbreviation: 'ICU', expansion: 'intensive care unit', problem_label: 'Repeated expansion' }),
      mkFinding({ id: 20, rule_id: 'AB02', para_index: 2,  abbreviation: 'ICU', expansion: 'intensive care unit', problem_label: 'Repeated expansion' }),
      mkFinding({ id: 30, rule_id: 'AB01', para_index: 0,  abbreviation: 'ICU', expansion: 'intensive care unit', problem_label: 'First use', suggestion: 'intensive care unit (ICU)' }),
    ]
    const group = buildAbbreviationGroups(findings)[0]
    render(<AbbreviationGroupCard group={group} collapsed={false} {...defaultHandlers()} />)
    const rows = screen.getAllByTestId('abbr-occurrence-row')
    // Row that corresponds to document position para 0 (id=30) gets the badge.
    expect(within(rows[0]).getByTestId('abbr-first-occurrence')).toBeTruthy()
    // Its finding id is 30 (lowest para_index).
    expect(rows[0].getAttribute('data-finding-id')).toBe('30')
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
