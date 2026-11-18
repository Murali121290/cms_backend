/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react'

import { IgnoredTermsPanel, type IgnoredFinding } from './IgnoredTermsPanel'

/**
 * Presentational tests for the Ignored Terms panel. The parent owns
 * every piece of state (search query, category filter, restore HTTP);
 * this suite just exercises the render + event contract so refactors
 * can't silently break the data-testid hooks the page relies on.
 */

function mkRow(partial: Partial<IgnoredFinding> & { id: number }): IgnoredFinding {
  return {
    id: partial.id,
    original_text: partial.original_text ?? 'The study',
    suggestion: partial.suggestion ?? 'The research',
    category: partial.category ?? 'grammar',
    rule_id: partial.rule_id ?? 'GR001',
    message: partial.message ?? 'Prefer "research"',
    para_index: partial.para_index ?? 0,
    status: partial.status ?? 'rejected',
    reviewer: partial.reviewer ?? 'tester',
    decided_at: partial.decided_at ?? '2026-11-17T10:00:00+00:00',
    ignore_scope: partial.ignore_scope ?? 'once',
    subcategory: partial.subcategory ?? null,
    edited_text: partial.edited_text,
  }
}

function defaults() {
  return {
    searchQuery: '',
    onSearchChange: vi.fn(),
    categoryFilter: 'all',
    onCategoryFilterChange: vi.fn(),
    onRestore: vi.fn(),
    isRestoring: () => false,
  }
}

beforeEach(() => cleanup())

describe('IgnoredTermsPanel — empty state', () => {
  it('shows the "no ignored findings yet" hint when totalCount is 0', () => {
    render(
      <IgnoredTermsPanel
        findings={[]}
        totalCount={0}
        categoryOptions={[]}
        {...defaults()}
      />,
    )
    expect(screen.getByTestId('ignored-terms-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('ignored-terms-list')).toBeNull()
    expect(screen.getByText(/No ignored findings yet/i)).toBeInTheDocument()
  })

  it('shows the "no match" hint when a filter excludes every row', () => {
    render(
      <IgnoredTermsPanel
        findings={[]}
        totalCount={3}
        categoryOptions={['grammar']}
        {...defaults()}
        categoryFilter="spelling"
      />,
    )
    expect(screen.getByText(/No ignored findings match/i)).toBeInTheDocument()
  })
})

describe('IgnoredTermsPanel — rows', () => {
  it('renders one row per finding with the category chip + paragraph + original text', () => {
    const rows = [
      mkRow({ id: 1 }),
      mkRow({
        id: 2, category: 'spelling',
        rule_id: 'SP002', original_text: 'organize', suggestion: 'organise',
      }),
    ]
    render(
      <IgnoredTermsPanel
        findings={rows}
        totalCount={2}
        categoryOptions={['grammar', 'spelling']}
        {...defaults()}
      />,
    )
    const listRows = screen.getAllByTestId('ignored-term-row')
    expect(listRows).toHaveLength(2)
    // Category chip uses displayCategoryFor
    expect(within(listRows[0]).getByTestId('ignored-category-chip')).toHaveTextContent(/grammar/i)
    expect(within(listRows[1]).getByTestId('ignored-category-chip')).toHaveTextContent(/spelling/i)
    // Required per-row fields
    expect(within(listRows[0]).getByTestId('ignored-original')).toHaveTextContent('The study')
    expect(within(listRows[1]).getByTestId('ignored-original')).toHaveTextContent('organize')
    // No Ignore Once / Ignore Always chip surfaces anywhere on the panel.
    expect(screen.queryAllByTestId('ignored-scope-chip')).toHaveLength(0)
  })

  it('Restore button fires onRestore with the row\'s finding, not any other row', () => {
    const rows = [mkRow({ id: 1 }), mkRow({ id: 2 }), mkRow({ id: 3 })]
    const d = defaults()
    render(
      <IgnoredTermsPanel findings={rows} totalCount={3} categoryOptions={['grammar']} {...d} />,
    )
    const row2 = screen.getAllByTestId('ignored-term-row')[1]
    fireEvent.click(within(row2).getByTestId('action-restore'))
    expect(d.onRestore).toHaveBeenCalledTimes(1)
    expect(d.onRestore).toHaveBeenCalledWith(rows[1])
  })

  it('disables the Restore button and shows Restoring… when isRestoring reports true', () => {
    const rows = [mkRow({ id: 1 }), mkRow({ id: 2 })]
    render(
      <IgnoredTermsPanel
        findings={rows}
        totalCount={2}
        categoryOptions={['grammar']}
        {...defaults()}
        isRestoring={(id) => id === 2}
      />,
    )
    const row2 = screen.getAllByTestId('ignored-term-row')[1]
    const btn = within(row2).getByTestId('action-restore') as HTMLButtonElement
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent(/Restoring/)
  })
})

describe('IgnoredTermsPanel — Back affordance', () => {
  it('renders a Back button that fires onBack when onBack is provided', () => {
    const onBack = vi.fn()
    render(
      <IgnoredTermsPanel
        findings={[]}
        totalCount={0}
        categoryOptions={[]}
        {...defaults()}
        onBack={onBack}
      />,
    )
    const back = screen.getByTestId('ignored-back')
    expect(back).toHaveTextContent(/Back to suggestions/i)
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('omits the Back button when onBack is not provided', () => {
    render(
      <IgnoredTermsPanel
        findings={[]}
        totalCount={0}
        categoryOptions={[]}
        {...defaults()}
      />,
    )
    expect(screen.queryByTestId('ignored-back')).toBeNull()
  })
})

describe('IgnoredTermsPanel — filters', () => {
  it('search input forwards every keystroke to onSearchChange', () => {
    const d = defaults()
    render(
      <IgnoredTermsPanel
        findings={[mkRow({ id: 1 })]}
        totalCount={1}
        categoryOptions={['grammar']}
        {...d}
      />,
    )
    fireEvent.change(screen.getByTestId('ignored-search'), { target: { value: 'study' } })
    expect(d.onSearchChange).toHaveBeenCalledWith('study')
  })

  it('category dropdown only lists the categories actually present in the ignored set', () => {
    render(
      <IgnoredTermsPanel
        findings={[mkRow({ id: 1 })]}
        totalCount={1}
        categoryOptions={['abbreviations', 'grammar']}
        {...defaults()}
      />,
    )
    const select = screen.getByTestId('ignored-category-filter') as HTMLSelectElement
    const options = Array.from(select.options).map(o => o.value)
    expect(options).toEqual(['all', 'abbreviations', 'grammar'])
  })

  it('selecting a category option forwards it to onCategoryFilterChange', () => {
    const d = defaults()
    render(
      <IgnoredTermsPanel
        findings={[mkRow({ id: 1 })]}
        totalCount={1}
        categoryOptions={['grammar', 'spelling']}
        {...d}
      />,
    )
    fireEvent.change(screen.getByTestId('ignored-category-filter'), { target: { value: 'spelling' } })
    expect(d.onCategoryFilterChange).toHaveBeenCalledWith('spelling')
  })
})
