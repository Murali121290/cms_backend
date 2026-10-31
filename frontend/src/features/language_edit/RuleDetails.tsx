/**
 * Reusable per-rule display + controls for the Rules Picker (Scope C).
 *
 * One component renders every rule type the engine knows about:
 *   • regex          — pattern + replacement + flags
 *   • dictionary     — house-style lookup (no pattern)
 *   • function       — function name + params JSON
 *   • builtin        — meta-toggle (gates a manuscript_core family)
 *   • phrase_lookup  — source + suggestions (hyphenation workbook)
 *
 * Unknown types fall back to a graceful "No preview" block so future
 * categories (Abbreviations, Acronyms, Punctuation) that reuse the five
 * existing types render for free, and genuinely-new types don't crash
 * the page while the sub-renderer is being written.
 *
 * Visual rules:
 *   • The rule's category is NEVER shown as a chip — the surrounding
 *     category card already provides that context. Showing it on every
 *     row is noise.
 *   • Severity is a 6-px colored dot before the rule ID, not a chip.
 *   • The FLAG | AUTO-REPLACE pill is compact; helper text lives in a
 *     tooltip, not inline, so rows stay the same height regardless of
 *     the chosen behaviour.
 */
import { Trash2 } from 'lucide-react'
import type { LanguageRule, ToolBehaviour } from '@/api/rulesApi'

export interface RuleDetailsProps {
  rule: LanguageRule
  canEdit: boolean
  onToggle: () => void
  onBehaviourChange?: (next: ToolBehaviour) => void
  /** Hide the type-specific detail block (compact mode for very dense lists). */
  compact?: boolean
  /** When provided, renders a trash icon on the row. Used by the Custom
   *  category to let the author remove a user-defined regex rule. The
   *  icon doesn't appear when ``canEdit`` is false. */
  onDelete?: () => void
}

const SEVERITY_DOT: Record<string, { cls: string; label: string }> = {
  error:      { cls: 'bg-rose-500',  label: 'Error' },
  warning:    { cls: 'bg-amber-500', label: 'Warning' },
  suggestion: { cls: 'bg-sky-500',   label: 'Suggestion' },
}

/** Human-friendly name for the three MC_* meta-toggles so the ``builtin``
 *  renderer can describe what each one gates. */
const META_GATES: Record<string, string> = {
  MC_UK_US:     'UK ↔ US spelling pairs',
  MC_BIAS:      'Inclusive-language / bias terms',
  MC_COMPOUNDS: 'LWW curated compound list',
}

function cls(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ')
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange() }}
      disabled={disabled}
      className={cls(
        'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border transition-colors',
        checked ? 'bg-emerald-500 border-emerald-500' : 'bg-slate-200 border-slate-300',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cls(
          'inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform mt-[1px]',
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

function BehaviourPill({
  value, onChange, disabled,
}: { value: ToolBehaviour; onChange: (next: ToolBehaviour) => void; disabled?: boolean }) {
  const base = 'px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide transition-colors'
  return (
    <div
      className={cls(
        'inline-flex rounded-full border border-slate-200 overflow-hidden bg-white',
        disabled && 'opacity-50',
      )}
      role="radiogroup"
      aria-label="Rule action behaviour"
      onClick={(e) => e.stopPropagation()}
      title={value === 'auto_replace'
        ? 'Auto-replace: one-click acceptance. Never silently modifies text.'
        : 'Flag: produces a reviewable finding for manual decision.'}
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === 'flag'}
        onClick={() => !disabled && value !== 'flag' && onChange('flag')}
        disabled={disabled}
        className={cls(base, value === 'flag' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-100')}
      >
        Flag
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'auto_replace'}
        onClick={() => !disabled && value !== 'auto_replace' && onChange('auto_replace')}
        disabled={disabled}
        className={cls(base, value === 'auto_replace' ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:bg-slate-100')}
      >
        Auto
      </button>
    </div>
  )
}

/* ─── Type-specific detail renderers ─────────────────────────────────── */

function DetailRegex({ rule }: { rule: LanguageRule }) {
  if (!rule.pattern && !rule.replacement) return null
  const flagsSuffix = (rule.flags || []).map(f => f[0].toLowerCase()).join('')
  const prettyPattern = `/${rule.pattern}/${flagsSuffix}`
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-slate-600 min-w-0">
      {rule.pattern && (
        <code
          className="bg-slate-100 border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded truncate min-w-0 max-w-[55%]"
          title={prettyPattern}
        >
          /{rule.pattern}/{flagsSuffix}
        </code>
      )}
      {rule.replacement !== undefined && rule.replacement !== null && (
        <>
          <span className="text-slate-300">→</span>
          <code
            className="bg-violet-50 border border-violet-200 text-violet-700 px-1.5 py-0.5 rounded truncate min-w-0 max-w-[45%]"
            title={String(rule.replacement) || '(remove)'}
          >
            {String(rule.replacement) || '(remove)'}
          </code>
        </>
      )}
    </div>
  )
}

function DetailPhraseLookup({ rule }: { rule: LanguageRule }) {
  const sugs = rule.suggestions && rule.suggestions.length > 0
    ? rule.suggestions
    : (rule.replacement ? [rule.replacement] : [])
  if (!rule.source && sugs.length === 0) return null
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-slate-600 min-w-0 flex-wrap">
      {rule.source && (
        <code className="bg-slate-100 border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded truncate min-w-0 max-w-[50%]" title={rule.source}>
          {rule.source}
        </code>
      )}
      {sugs.length > 0 && <span className="text-slate-300">→</span>}
      {sugs.slice(0, 1).map((s, i) => (
        <code key={i} className="bg-violet-50 border border-violet-200 text-violet-700 px-1.5 py-0.5 rounded truncate min-w-0 max-w-[45%]" title={s}>
          {s}
        </code>
      ))}
      {sugs.slice(1).map((s, i) => (
        <code
          key={`alt-${i}`}
          className="bg-teal-50 border border-teal-200 text-teal-700 px-1.5 py-0.5 rounded truncate min-w-0 max-w-[40%]"
          title={`Alternate: ${s}`}
        >
          {s}
        </code>
      ))}
    </div>
  )
}

function DetailFunction({ rule }: { rule: LanguageRule }) {
  if (!rule.function && !rule.params) return null
  const paramKeys = rule.params ? Object.keys(rule.params) : []
  const paramStr = paramKeys.length
    ? paramKeys.map(k => `${k}=${JSON.stringify((rule.params as any)[k])}`).join(' · ')
    : ''
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-slate-600 min-w-0">
      <code
        className="bg-slate-100 border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded truncate min-w-0"
        title={`${rule.function}(${paramStr})`}
      >
        {rule.function || 'function'}()
      </code>
      {paramStr && (
        <span className="text-[10px] text-slate-400 truncate min-w-0" title={paramStr}>
          {paramStr}
        </span>
      )}
    </div>
  )
}

function DetailDictionary() {
  return (
    <div className="mt-1 text-[11px] text-slate-400 italic">
      Looks up the project's variant → canonical dictionary.
    </div>
  )
}

function DetailBuiltin({ rule }: { rule: LanguageRule }) {
  const gates = META_GATES[rule.id]
  return (
    <div className="mt-1 text-[11px] text-slate-400 italic">
      Meta-toggle{gates ? ` · gates ${gates}` : ''}.
    </div>
  )
}

function DetailFallback({ rule }: { rule: LanguageRule }) {
  return (
    <div className="mt-1 text-[11px] text-slate-400">
      No preview for type <code className="font-mono text-slate-500">{rule.type || 'unknown'}</code>.
    </div>
  )
}

const TYPE_RENDERERS: Record<string, (p: { rule: LanguageRule }) => any> = {
  regex: DetailRegex,
  phrase_lookup: DetailPhraseLookup,
  function: DetailFunction,
  dictionary: DetailDictionary,
  builtin: DetailBuiltin,
}

/* ─── Main component ─────────────────────────────────────────────────── */

export function RuleDetails({ rule, canEdit, onToggle, onBehaviourChange, compact, onDelete }: RuleDetailsProps) {
  const checked = rule.enabled !== false
  const sev = (rule.severity || '').toLowerCase()
  const sevDot = SEVERITY_DOT[sev]
  const behaviour: ToolBehaviour = rule.tool_behaviour === 'auto_replace' ? 'auto_replace' : 'flag'
  const Detail = TYPE_RENDERERS[rule.type || ''] || DetailFallback

  return (
    <li
      onClick={() => canEdit && onToggle()}
      className={cls(
        'group flex items-start gap-2.5 px-3.5 py-2',
        checked ? 'bg-white' : 'bg-slate-50/60',
        canEdit ? 'cursor-pointer hover:bg-violet-50/40' : 'cursor-default',
        'transition-colors',
      )}
    >
      <div className="pt-[3px] shrink-0">
        <ToggleSwitch checked={checked} onChange={onToggle} disabled={!canEdit} />
      </div>
      <div className="flex-1 min-w-0">
        {/* Header: dot · id · type · [override] | behaviour pill | OFF */}
        <div className="flex items-center gap-1.5 min-w-0">
          {sevDot && (
            <span
              className={cls('inline-block w-1.5 h-1.5 rounded-full shrink-0', sevDot.cls)}
              title={sevDot.label}
            />
          )}
          <span className="font-mono text-[11px] font-bold text-slate-900 shrink-0">
            {rule.id}
          </span>
          {rule.type && (
            <span className="text-[9px] uppercase tracking-wide font-medium text-slate-400 shrink-0">
              {rule.type}
            </span>
          )}
          {rule.source_badge && (
            <span
              className="text-[9px] uppercase tracking-wide font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-1 py-[1px] rounded shrink-0"
              title={rule.source_raw ? `Source: ${rule.source_raw}` : rule.source_badge}
            >
              {rule.source_badge}
            </span>
          )}
          {rule.is_overridden && (
            <span
              className="text-[9px] uppercase tracking-wide font-semibold text-violet-600 bg-violet-50 border border-violet-200 px-1 py-[1px] rounded shrink-0"
              title="Project-specific override applied"
            >
              Override
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <BehaviourPill
              value={behaviour}
              onChange={(next) => onBehaviourChange?.(next)}
              disabled={!canEdit || !checked || !onBehaviourChange}
            />
            {!checked && (
              <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-400">
                OFF
              </span>
            )}
            {onDelete && canEdit && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                title="Delete this custom rule"
                aria-label="Delete rule"
                className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Message */}
        {rule.message && (
          <p
            className={cls('text-[13px] mt-0.5 truncate', checked ? 'text-slate-800' : 'text-slate-500')}
            title={rule.message}
          >
            {rule.message}
          </p>
        )}

        {/* Type-dispatched detail */}
        {!compact && <Detail rule={rule} />}
      </div>
    </li>
  )
}

export default RuleDetails
