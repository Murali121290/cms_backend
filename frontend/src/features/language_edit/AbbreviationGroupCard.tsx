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
  end_offset: number
  original_text: string
  suggestion: string
  edited_text?: string
  status: 'pending' | 'accepted' | 'edited' | 'rejected' | 'highlighted'
  problem_label?: string | null
  /** Only populated by the backend on AB04 (repeated definition)
   *  findings — identifies the document-first valid definition so
   *  the card can prepend a non-interactive reference row. */
  first_definition?: {
    para_index: number
    start_offset: number
    end_offset: number
    text: string
  } | null
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
  /** Ids currently checked in the review's bulk selection (page-level
   *  state). Only a row's own ``f.id`` membership matters here. */
  selectedFindingIds?: Set<number>
  /** Toggle a single row's checkbox. Noop when selection is disabled. */
  onToggleSelect?: (id: number) => void
  /** Select every PENDING occurrence in this group (row-level IDs,
   *  not the group key). */
  onSelectAllInGroup?: (ids: number[]) => void
  /** Clear this group's selection (page-level handler decides whether
   *  to also clear other groups' selection). */
  onClearSelectionInGroup?: (ids: number[]) => void
  /** Jump the editor to a specific DOCX paragraph / character range.
   *  Called when the reviewer clicks the "First Definition · Reference"
   *  row at the top of the card. Falls through silently when no
   *  handler is wired (older tests / callers). */
  onJumpToDocPosition?: (paraIndex: number, startOffset?: number) => void
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
    selectedFindingIds,
    onToggleSelect,
    onSelectAllInGroup,
    onClearSelectionInGroup,
    onJumpToDocPosition,
  } = props
  const isSaving = (id: number): boolean => isFindingSaving ? isFindingSaving(id) : false
  const isSelected = (id: number): boolean => selectedFindingIds ? selectedFindingIds.has(id) : false

  // Reference occurrence — prepended non-interactive row showing the
  // document-first valid definition for the abbreviation. Taken from
  // whichever group item carries ``first_definition`` (backend
  // attaches it to AB04 findings when a valid earlier definition
  // exists). Suppressed when:
  //   * no item has first_definition (no valid earlier def exists —
  //     spec: "do not fabricate a reference occurrence"), or
  //   * an existing item in the group is ALREADY that occurrence
  //     (same para_index + span) — in which case the card's regular
  //     row doubles as the first-definition display.
  const refSource = group.items.find(f => !!f.first_definition)
  const referenceOccurrence = (() => {
    const info = refSource?.first_definition
    if (!info) return null
    const covered = group.items.some(
      f =>
        f.para_index === info.para_index &&
        f.start_offset === info.start_offset &&
        f.end_offset === info.end_offset,
    )
    if (covered) return null
    return info
  })()

  // Pending occurrences only — bulk Select All should never pick up
  // already-decided rows (spec: bulk actions apply only to pending).
  // The reference row is never part of the Select All set either —
  // it isn't a finding.
  const pendingIds = group.items
    .filter(f => f.status !== 'accepted' && f.status !== 'edited' && f.status !== 'rejected')
    .map(f => f.id)
  const selectedInGroup = pendingIds.filter(id => isSelected(id))
  const allGroupSelected = pendingIds.length > 0 && selectedInGroup.length === pendingIds.length
  const anyGroupSelected = selectedInGroup.length > 0

  // First occurrence in document order — used for the "First
  // occurrence" marker. ``items`` is already sorted by
  // (para_index, start_offset) when buildAbbreviationGroups
  // produces it.
  const firstId = group.items[0]?.id
  const firstIsValidDefinition = !!group.items[0]?.problem_label && (
    /first\s*use/i.test(group.items[0].problem_label!)
  )

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
        <>
          {onToggleSelect && pendingIds.length > 0 && (
            <div
              className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2"
              data-testid="abbr-group-selection-bar"
            >
              <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-600 select-none cursor-pointer">
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  checked={allGroupSelected}
                  ref={(el) => { if (el) el.indeterminate = anyGroupSelected && !allGroupSelected }}
                  onChange={() => {
                    if (allGroupSelected) {
                      onClearSelectionInGroup?.(pendingIds)
                    } else {
                      onSelectAllInGroup?.(pendingIds)
                    }
                  }}
                  data-testid="abbr-group-select-all"
                />
                {allGroupSelected
                  ? `${selectedInGroup.length} of ${pendingIds.length} selected`
                  : anyGroupSelected
                    ? `${selectedInGroup.length} of ${pendingIds.length} selected`
                    : `Select all pending (${pendingIds.length})`}
              </label>
              {anyGroupSelected && (
                <button
                  type="button"
                  onClick={() => onClearSelectionInGroup?.(pendingIds)}
                  className="text-[11px] text-slate-500 hover:text-slate-800 underline decoration-dotted"
                  data-testid="abbr-group-clear-selection"
                >
                  Clear
                </button>
              )}
            </div>
          )}
          <ul
            id={`abbr-group-body-${group.key}`}
            data-testid="abbr-group-body"
            className="divide-y divide-slate-100"
          >
          {referenceOccurrence ? (() => {
            const ref = referenceOccurrence
            const canJump = !!onJumpToDocPosition
            const jump = (e: React.MouseEvent | React.KeyboardEvent) => {
              e.stopPropagation()
              onJumpToDocPosition?.(ref.para_index, ref.start_offset)
            }
            return (
              <li
                className={`px-4 py-3 bg-emerald-50/40 ${canJump ? 'hover:bg-emerald-50/70 cursor-pointer transition-colors' : ''}`}
                data-testid="abbr-reference-row"
                data-ref-para={ref.para_index}
                onClick={canJump ? jump : undefined}
                onKeyDown={canJump ? (e) => { if (e.key === 'Enter' || e.key === ' ') jump(e) } : undefined}
                role={canJump ? 'button' : undefined}
                tabIndex={canJump ? 0 : undefined}
                title={canJump ? `Click to jump to the first definition in paragraph ${ref.para_index + 1}` : undefined}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Para {ref.para_index + 1}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200">
                      ★ First Definition · Reference
                    </span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-500 border border-slate-200">
                    View only
                  </span>
                </div>
                <div
                  className={`text-sm leading-snug text-slate-700 ${canJump ? 'underline decoration-emerald-300 decoration-dotted underline-offset-2' : ''}`}
                  data-testid="abbr-reference-text"
                >
                  {ref.text}
                </div>
              </li>
            )
          })() : null}
          {group.items.map((f) => {
            const isFocused = f.id === selectedFindingId
            const isAccepted = f.status === 'accepted'
            const isEdited = f.status === 'edited'
            const isRejected = f.status === 'rejected'
            const isHighlighted = f.status === 'highlighted'
            const isDecided = isAccepted || isEdited || isRejected || isHighlighted
            const isEditingThis = editingFindingId === f.id
            const rowSaving = isSaving(f.id)
            const checked = isSelected(f.id)
            const isFirstOccurrence = f.id === firstId
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
                  isFocused ? 'bg-violet-50/60' : 'hover:bg-slate-50/60'
                } ${isRejected ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {onToggleSelect && !isDecided ? (
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        checked={checked}
                        onChange={() => onToggleSelect(f.id)}
                        onClick={(e) => e.stopPropagation()}
                        data-testid="abbr-row-select"
                        data-finding-id={f.id}
                        aria-label={`Select occurrence in paragraph ${f.para_index + 1}`}
                      />
                    ) : null}
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Para {f.para_index + 1}
                    </span>
                    {isFirstOccurrence && group.items.length > 1 ? (
                      <span
                        data-testid="abbr-first-occurrence"
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border ${
                          firstIsValidDefinition
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                        title={
                          firstIsValidDefinition
                            ? 'First occurrence introduces the abbreviation — treat as the definition reference'
                            : 'First occurrence is NOT a workbook-recognised first-use definition — review context'
                        }
                      >
                        {firstIsValidDefinition ? '★ First · Valid definition' : '★ First occurrence'}
                      </span>
                    ) : null}
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
        </>
      )}
    </div>
  )
}
