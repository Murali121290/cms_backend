import React from 'react'
import { ArrowLeft, RotateCcw, XCircle, Loader2 } from 'lucide-react'

import { displayCategoryFor } from './findingLabel'

/**
 * Minimal shape the Ignored Terms panel needs from a Finding. The full
 * ``Finding`` interface in ``LanguageReviewPage`` carries many more
 * fields; the panel only reads the ones it renders so the TS contract
 * stays narrow and the component is trivially mountable in unit tests.
 */
export interface IgnoredFinding {
  id: number
  original_text: string
  suggestion: string
  edited_text?: string
  category: string
  rule_id: string
  message: string
  para_index: number
  status: string
  reviewer?: string
  decided_at?: string
  ignore_scope?: 'once' | 'always' | null
  subcategory?: string | null
}

export interface IgnoredTermsPanelProps {
  /** Every ignored finding for the current job, after category + search
   *  filtering by the parent. The panel never re-filters — the parent
   *  owns the search / category-filter state so it survives a tab switch. */
  findings: IgnoredFinding[]
  /** Un-filtered total used for the "Showing X of N" footer so the
   *  reviewer can see filtering is active without re-counting rows. */
  totalCount: number
  /** Distinct category values present in the un-filtered ignored list.
   *  The parent computes this so the dropdown shows only categories
   *  that actually have ignored rows. */
  categoryOptions: string[]
  searchQuery: string
  onSearchChange: (q: string) => void
  categoryFilter: string
  onCategoryFilterChange: (cat: string) => void
  /** Called when the reviewer clicks Restore. The parent decides whether
   *  to confirm (for Ignore Always) or restore immediately (for Ignore
   *  Once) and owns the HTTP round-trip. */
  onRestore: (finding: IgnoredFinding) => void
  /** Predicate: true while a given finding's restore POST is in flight.
   *  Used to disable the Restore button + show a spinner on the clicked
   *  row. */
  isRestoring?: (id: number) => boolean
  /** Dismisses the Ignored Items view and returns the reviewer to
   *  wherever they were before they opened it. When omitted, the Back
   *  button hides — kept optional so standalone tests / embeddings that
   *  don't own a parent tab state can still mount the panel. */
  onBack?: () => void
}

function formatDecidedAt(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString([], {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/**
 * Right-panel view that lists every finding ignored on the current job
 * and exposes a per-row Restore action. Purely presentational — all
 * state (filter inputs, in-flight set, restore HTTP) lives in the
 * parent so a confirmation modal can live alongside the editor's
 * other modals.
 */
export function IgnoredTermsPanel(props: IgnoredTermsPanelProps): React.ReactElement {
  const {
    findings, totalCount, categoryOptions,
    searchQuery, onSearchChange,
    categoryFilter, onCategoryFilterChange,
    onRestore, isRestoring, onBack,
  } = props
  return (
    <div className="space-y-3" data-testid="ignored-terms-panel">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          data-testid="ignored-back"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-[12px] font-semibold text-slate-700 shadow-sm transition-colors"
        >
          <ArrowLeft size={13} />
          Back to suggestions
        </button>
      )}
      <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search ignored…"
            data-testid="ignored-search"
            className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
          <select
            value={categoryFilter}
            onChange={e => onCategoryFilterChange(e.target.value)}
            data-testid="ignored-category-filter"
            className="bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200"
          >
            <option value="all">All categories</option>
            {categoryOptions.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="text-[11px] text-slate-400">
          Showing <strong className="text-slate-700">{findings.length}</strong>
          {' '}of <strong className="text-slate-700">{totalCount}</strong> ignored finding{totalCount === 1 ? '' : 's'}
        </div>
      </div>

      {totalCount === 0 ? (
        <div className="py-12 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <XCircle size={24} className="mx-auto mb-2 text-slate-300" />
          No ignored findings yet. Click <strong className="text-slate-600">Ignore</strong> on any suggestion to move it here.
        </div>
      ) : findings.length === 0 ? (
        <div className="py-8 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          No ignored findings match the current search or category filter.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="ignored-terms-list">
          {findings.map(f => {
            const displayCategory = displayCategoryFor({
              category: f.category,
              subcategory: f.subcategory ?? null,
            })
            const timestamp = formatDecidedAt(f.decided_at)
            const restoring = isRestoring ? isRestoring(f.id) : false
            return (
              <li
                key={f.id}
                data-testid="ignored-term-row"
                data-finding-id={f.id}
                className="rounded-2xl border border-slate-100 bg-white shadow-sm p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span
                      className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-semibold uppercase tracking-wide"
                      data-testid="ignored-category-chip"
                    >
                      {displayCategory}
                    </span>
                    {f.rule_id && (
                      <span className="font-mono text-slate-400">{f.rule_id}</span>
                    )}
                    <span className="text-slate-400">Para {f.para_index}</span>
                  </div>
                  <button
                    type="button"
                    data-testid="action-restore"
                    data-finding-id={f.id}
                    onClick={() => onRestore(f)}
                    disabled={restoring}
                    aria-busy={restoring}
                    className="px-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-[11px] font-semibold text-slate-700 transition-colors flex items-center gap-1"
                  >
                    {restoring
                      ? <Loader2 size={11} className="animate-spin" />
                      : <RotateCcw size={11} />}
                    {restoring ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
                <div className="text-sm text-slate-700">
                  <div>
                    <span className="text-slate-400 text-[11px] uppercase tracking-wide mr-1">Original:</span>
                    <span data-testid="ignored-original">{f.original_text}</span>
                  </div>
                  {f.suggestion && f.suggestion !== f.original_text && (
                    <div>
                      <span className="text-slate-400 text-[11px] uppercase tracking-wide mr-1">Suggestion:</span>
                      <span data-testid="ignored-suggestion">{f.suggestion}</span>
                    </div>
                  )}
                </div>
                {timestamp && (
                  <div className="text-[10px] text-slate-400">
                    Ignored {timestamp}{f.reviewer ? ` by ${f.reviewer}` : ''}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
