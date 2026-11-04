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


/* ─── Profile Applicability (LWW-NE only) ───────────────────────────── */

// Workbook-tagged profiles shown in the applicability grid. UK, US,
// Canadian, and Chicago are intentionally omitted — the LWW-NE workbook
// does not tag any row for those project types, so the display would
// have been all-✕ for every non-Generic rule. Showing only the three
// tags that actually appear in the workbook data gives reviewers a
// cleaner signal. Runtime execution is unchanged (projects of other
// types continue to receive Generic rows via the engine's short-circuit).
const PROFILE_APPLICABILITY_ORDER = ['APA', 'AMA', 'NE'] as const
type ApplicabilityProfile = typeof PROFILE_APPLICABILITY_ORDER[number]

/**
 * Mirrors ``lww_ne._row_applies_to_project`` + ``lww_ne.compute_active_tags``.
 * Single source of truth: the runtime module. This function must stay in
 * lockstep with the backend filter logic.
 *   - Generic rows fire in every project (short-circuit) — all three
 *     shown chips are ✓ for Generic.
 *   - Non-Generic rows fire only when the project's active tag set
 *     intersects the row's non-empty Rule Runs.
 *   - Eponym is a classification tag; it is NOT in the active tag set,
 *     so it never counts as an applicability match. Rows tagged
 *     ``[AMA, NE, Eponym]`` fire in AMA / NE only, not via Eponym.
 */
function lwwNeProfileApplies(
  rule: LanguageRule, profile: ApplicabilityProfile,
): boolean {
  if (rule.is_generic) return true
  const tags = Array.isArray(rule.rule_runs_raw) ? rule.rule_runs_raw : []
  return tags.includes(profile)
}

function ProfileApplicability({ rule }: { rule: LanguageRule }) {
  // Only render for LWW-NE workbook rules. Other workbook categories
  // (hyphenation / abbreviations / medical_terms / uk_us_spelling /
  // custom) use different applicability models and are out of scope
  // for this block.
  if (rule.source_badge !== 'LWW-NE') return null
  // Defensive: if the surface payload is missing both fields we can't
  // compute applicability, so skip rendering rather than showing a
  // misleading all-✕ row.
  if (!Array.isArray(rule.rule_runs_raw) && rule.is_generic === undefined) {
    return null
  }

  const hasEponymTag = Array.isArray(rule.rule_runs_raw) && rule.rule_runs_raw.includes('Eponym')
  const isGeneric = Boolean(rule.is_generic)

  return (
    <div className="mt-1.5 flex items-center gap-1 flex-wrap text-[10px]" role="group" aria-label="Profile applicability">
      <span className="text-slate-400 font-semibold uppercase tracking-wide mr-0.5">
        Runs in:
      </span>
      {PROFILE_APPLICABILITY_ORDER.map((profile) => {
        const applies = lwwNeProfileApplies(rule, profile)
        // Tooltip precedence:
        // 1. Generic → explain why every profile is ✓
        // 2. Applicable → brief affirmative (special wording for NE
        //    since it's a term-list signal, not a profile_key)
        // 3. Non-applicable → brief negative
        let title: string
        if (isGeneric) {
          title = `Generic rule — runs in ${profile} (and every other project)`
        } else if (applies) {
          title = profile === 'NE'
            ? 'Runs when the LWW_NE term list is assigned to the project'
            : `Runs in ${profile} projects`
        } else {
          title = `Does not run in ${profile} projects — rule is not tagged for ${profile}`
        }
        return (
          <span
            key={profile}
            title={title}
            className={cls(
              'inline-flex items-center gap-0.5 px-1.5 py-[2px] rounded border font-medium',
              applies
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-50 text-slate-400 border-slate-200',
            )}
          >
            <span>{profile}</span>
            <span aria-hidden="true" className="font-bold">
              {applies ? '✓' : '✕'}
            </span>
          </span>
        )
      })}
      {hasEponymTag && (
        <span
          title="Eponym is a classification tag only. It does not act as an independent profile at runtime — Eponym-tagged rules fire via their other tags (APA / AMA / NE) or via the Generic short-circuit."
          className="inline-flex items-center gap-0.5 px-1.5 py-[2px] rounded border font-medium bg-amber-50 text-amber-700 border-amber-200 ml-1"
          aria-label="Eponym classification note"
        >
          <span>Eponym</span>
          <span aria-hidden="true">ⓘ</span>
        </span>
      )}
    </div>
  )
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

        {/* Profile Applicability — LWW-NE workbook rows only. Informational
            chip grid showing which project types will trigger this rule at
            runtime. Does NOT affect enable/disable state or runtime execution
            — those remain controlled by the toggle switch + Scope-C overrides
            above. See lwwNeProfileApplies() for the mirroring logic. */}
        {!compact && <ProfileApplicability rule={rule} />}
      </div>
    </li>
  )
}

export default RuleDetails
