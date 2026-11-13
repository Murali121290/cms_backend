import React from 'react'
import { ChevronRight } from 'lucide-react'

import type { AbbreviationGroup, GroupableFinding } from './abbreviationGroups'

/**
 * Minimal shape the group card needs from a Finding. The parent
 * ``Finding`` interface in LanguageReviewPage carries many more
 * fields; the card only reads what it renders so the TS contract
 * stays narrow and the component is trivially mountable in tests.
 */
export interface GroupCardFinding extends GroupableFinding {
  original_text: string
  suggestion: string
  edited_text?: string
  status: 'pending' | 'accepted' | 'edited' | 'rejected' | 'highlighted'
  problem_label?: string | null
}

export type DecideStatus = 'accepted' | 'edited' | 'rejected' | 'highlighted'

export interface AbbreviationGroupCardProps {
  group: AbbreviationGroup<GroupCardFinding>
  collapsed: boolean
  onToggleCollapse: (key: string) => void
  selectedFindingId: number | null
  editingFindingId: number | null
  editedInputs: Record<number, string>
  onSelectFinding: (id: number) => void
  onDecide: (id: number, status: DecideStatus) => void
  onToggleEdit: (id: number) => void
  onEditInputChange: (id: number, value: string) => void
  /** Optional: callback refs for scroll-into-view. */
  onRowMount?: (id: number, el: HTMLElement | null) => void
  /** Predicate returning ``true`` while this row's decide POST is
   *  in flight. The card uses it to disable Accept / Edit / Highlight
   *  / Ignore so repeated clicks don't fire duplicate requests. */
  isFindingSaving?: (id: number) => boolean
}

const STATUS_CHIPS: Record<DecideStatus | 'pending', { label: string; cls: string } | null> = {
  accepted: { label: 'Accepted', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  edited: { label: 'Edited', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  rejected: { label: 'Ignored', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  highlighted: { label: 'Highlighted', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  pending: null,
}

/**
 * ONE outer card per (abbreviation, expansion) group. Header carries
 * the abbreviation / expansion / occurrence count. Body is an
 * unordered list of compact rows separated by ``divide-y`` — NOT
 * nested cards.
 *
 * Per-row Accept / Edit / Highlight / Ignore invoke ``onDecide`` with
 * the row's own finding id so individual actions never cascade to
 * other occurrences (requirement: ignoring one occurrence must not
 * silently ignore the others).
 */
export function AbbreviationGroupCard(props: AbbreviationGroupCardProps): React.ReactElement {
  const {
    group,
    collapsed,
    onToggleCollapse,
    selectedFindingId,
    editingFindingId,
    editedInputs,
    onSelectFinding,
    onDecide,
    onToggleEdit,
    onEditInputChange,
    onRowMount,
    isFindingSaving,
  } = props
  const isSaving = (id: number): boolean => isFindingSaving ? isFindingSaving(id) : false

  const abbrLabel = group.abbreviation || 'Abbreviation'
  const expansionLabel = group.expansion || ''
  const count = group.items.length

  return (
    <div
      data-testid="abbr-group-card"
      data-group-key={group.key}
      className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden border-l-4 border-l-indigo-400"
    >
      <button
        type="button"
        onClick={() => onToggleCollapse(group.key)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-indigo-50/40 hover:bg-indigo-50/70 transition-colors text-left"
        aria-expanded={!collapsed}
        aria-controls={`abbr-group-body-${group.key}`}
        data-testid="abbr-group-header"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ChevronRight
            className={`w-4 h-4 text-indigo-500 flex-none transition-transform ${collapsed ? '' : 'rotate-90'}`}
          />
          <span className="text-sm font-bold text-indigo-900 truncate">
            {abbrLabel}
            {expansionLabel ? (
              <span className="font-medium text-indigo-700"> – {expansionLabel}</span>
            ) : null}
          </span>
        </span>
        <span
          className="inline-flex items-center justify-center min-w-[2rem] h-5 px-2 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex-none"
          data-testid="abbr-group-count"
        >
          {count} {count === 1 ? 'occurrence' : 'occurrences'}
        </span>
      </button>
      {!collapsed && (
        <ul
          id={`abbr-group-body-${group.key}`}
          data-testid="abbr-group-body"
          className="divide-y divide-slate-100"
        >
          {group.items.map((f) => {
            const isSelected = f.id === selectedFindingId
            const isAccepted = f.status === 'accepted'
            const isEdited = f.status === 'edited'
            const isRejected = f.status === 'rejected'
            const isHighlighted = f.status === 'highlighted'
            const isDecided = isAccepted || isEdited || isRejected || isHighlighted
            const isEditingThis = editingFindingId === f.id
            const rowSaving = isSaving(f.id)
            const actionDisabled = isDecided || rowSaving
            const inputValue = editedInputs[f.id] ?? f.suggestion ?? ''
            const displayText = isEdited ? (f.edited_text || f.suggestion) : f.suggestion
            const statusChip = STATUS_CHIPS[f.status] || null
            return (
              <li
                key={f.id}
                ref={(el) => onRowMount?.(f.id, el)}
                data-testid="abbr-occurrence-row"
                data-finding-id={f.id}
                onClick={() => onSelectFinding(f.id)}
                className={`px-4 py-3 cursor-pointer transition-colors ${
                  isSelected ? 'bg-violet-50/60' : 'hover:bg-slate-50/60'
                } ${isRejected ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Para {f.para_index + 1}
                    </span>
                    {f.problem_label ? (
                      <span
                        data-testid="abbr-problem-label"
                        className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-indigo-50 text-indigo-700 border border-indigo-200"
                      >
                        {f.problem_label}
                      </span>
                    ) : null}
                    <span className="text-[10px] text-slate-400 font-mono">{f.rule_id}</span>
                  </div>
                  {statusChip ? (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border ${statusChip.cls}`}>
                      {statusChip.label}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm leading-snug mb-2" data-testid="abbr-diff">
                  <span className="diff-old">{f.original_text}</span>
                  {' → '}
                  <span className="diff-new">{displayText}</span>
                </div>
                {isEditingThis ? (
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={inputValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onEditInputChange(f.id, e.target.value)}
                      className="flex-1 text-xs border border-violet-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-violet-200 bg-white"
                      placeholder="Custom replacement text"
                      data-testid="action-edit-input"
                      data-finding-id={f.id}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); onDecide(f.id, 'edited') }}
                      className="px-2.5 py-1 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold"
                      data-testid="action-save-edit"
                      data-finding-id={f.id}
                    >
                      Save
                    </button>
                  </div>
                ) : null}
                <div className="flex items-center gap-1.5 flex-wrap" data-testid="row-actions">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDecide(f.id, 'accepted') }}
                    disabled={actionDisabled}
                    aria-busy={rowSaving}
                    title={rowSaving ? 'Saving…' : undefined}
                    className="px-2.5 py-1 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
                    data-testid="action-accept"
                    data-finding-id={f.id}
                  >
                    {rowSaving ? (
                      <span className="inline-block w-2.5 h-2.5 border border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                    ) : null}
                    {rowSaving ? 'Saving…' : 'Accept'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleEdit(f.id) }}
                    disabled={actionDisabled}
                    aria-busy={rowSaving}
                    className="px-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-semibold text-slate-600 transition-colors"
                    data-testid="action-edit"
                    data-finding-id={f.id}
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDecide(f.id, 'highlighted') }}
                    disabled={actionDisabled}
                    aria-busy={rowSaving}
                    className="px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-semibold text-amber-700 transition-colors"
                    data-testid="action-highlight"
                    data-finding-id={f.id}
                  >
                    Highlight
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDecide(f.id, 'rejected') }}
                    disabled={actionDisabled}
                    aria-busy={rowSaving}
                    className="px-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-semibold text-slate-600 transition-colors"
                    data-testid="action-ignore"
                    data-finding-id={f.id}
                  >
                    Ignore
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
