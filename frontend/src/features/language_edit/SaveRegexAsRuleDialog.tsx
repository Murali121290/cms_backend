import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Loader2, AlertTriangle, Save } from 'lucide-react'
import apiClient from '@/api/client'
import type { LanguageRule, RuleCategory, RuleSeverity, ToolBehaviour } from '@/api/rulesApi'

/**
 * Scope D: dialog that promotes an ad-hoc regex from the editor's
 * Find bar into a persistent project rule.
 *
 * The parent owns the opened/closed state; this component owns the
 * form state + the POST. On success it calls ``onSaved`` with the
 * stored rule so the parent can refresh any Rules Picker it keeps
 * open. The caller passes ``draft`` captured from the Find bar.
 */
export interface RegexDraft {
  pattern: string
  replacement: string
  caseSensitive: boolean
  wholeWord: boolean
  matchCount: number
  firstMatch: string | null
  firstReplacement: string | null
}

export interface SaveRegexAsRuleDialogProps {
  open: boolean
  projectId: number | string
  draft: RegexDraft | null
  onClose: () => void
  onSaved?: (rule: LanguageRule) => void
}

const CATEGORIES: { value: RuleCategory; label: string }[] = [
  { value: 'custom',        label: 'Custom (default)' },
  { value: 'grammar',       label: 'Grammar' },
  { value: 'spelling',      label: 'Spelling' },
  { value: 'sentence',      label: 'Sentence' },
  { value: 'compounds',     label: 'Compounds' },
  { value: 'inclusive',     label: 'Inclusive' },
  { value: 'hyphenation',   label: 'Hyphenation' },
  { value: 'abbreviations', label: 'Abbreviations' },
]

const SEVERITIES: { value: RuleSeverity; label: string }[] = [
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'warning',    label: 'Warning' },
  { value: 'error',      label: 'Error' },
]

export function SaveRegexAsRuleDialog({ open, projectId, draft, onClose, onSaved }: SaveRegexAsRuleDialogProps) {
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<RuleCategory>('custom')
  const [severity, setSeverity] = useState<RuleSeverity>('warning')
  const [tool, setTool] = useState<ToolBehaviour>('flag')
  const [replacement, setReplacement] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstInputRef = useRef<HTMLInputElement | null>(null)

  // Pre-fill the form each time the dialog opens with a fresh draft so
  // consecutive promotions don't inherit the previous rule's metadata.
  useEffect(() => {
    if (!open || !draft) return
    setMessage(draft.replacement
      ? `Replace with "${draft.replacement}"`
      : 'Flag this pattern')
    setCategory('custom')
    setSeverity('warning')
    setTool(draft.replacement ? 'auto_replace' : 'flag')
    setReplacement(draft.replacement)
    setError(null)
    setSubmitting(false)
    // Defer focus until the dialog is mounted + visible.
    setTimeout(() => firstInputRef.current?.focus(), 10)
  }, [open, draft])

  const flags = useMemo<string[]>(() => {
    const out: string[] = []
    if (!draft?.caseSensitive) out.push('IGNORECASE')
    return out
  }, [draft])

  const canSubmit = !!draft && !!draft.pattern.trim() && !submitting

  async function submit() {
    if (!draft) return
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        pattern: draft.pattern,
        replacement: replacement || null,
        flags,
        message: message.trim() || 'Custom regex rule',
        category,
        severity,
        tool_behaviour: tool,
      }
      const res = await apiClient.post<{ ok: boolean; rule: LanguageRule }>(
        `/projects/${projectId}/language-rules/custom`,
        payload,
      )
      onSaved?.(res.data.rule)
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? 'Failed to save rule')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open || !draft) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Save regex as rule"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-teal-50">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Save regex as rule</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Promote this pattern to a reusable project rule</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-3.5">
          {/* Preview strip */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wide font-semibold">
              <span>Pattern</span>
              <span className="ml-auto text-emerald-700 font-mono tracking-normal normal-case">
                {draft.matchCount} match{draft.matchCount === 1 ? '' : 'es'} in document
              </span>
            </div>
            <code className="block text-xs font-mono text-slate-800 break-all">{draft.pattern}</code>
            {draft.firstMatch && (
              <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                <span className="text-slate-400">First match:</span>{' '}
                <span className="font-mono text-slate-700">"{draft.firstMatch}"</span>
                {draft.firstReplacement && (
                  <>
                    <span className="text-slate-400"> → </span>
                    <span className="font-mono text-emerald-700">"{draft.firstReplacement}"</span>
                  </>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 pt-1 flex-wrap">
              {flags.includes('IGNORECASE') && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-slate-200 text-slate-700">IGNORECASE</span>
              )}
              {draft.caseSensitive && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-200 text-amber-800">CASE-SENSITIVE</span>
              )}
              {draft.wholeWord && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-200 text-amber-800">WHOLE-WORD</span>
              )}
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1">What should the finding say?</label>
            <input
              ref={firstInputRef}
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Use 'and/or' sparingly"
              maxLength={200}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Replacement */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1">
              Replacement <span className="font-normal text-slate-400">(optional — leave blank to flag only)</span>
            </label>
            <input
              type="text"
              value={replacement}
              onChange={(e) => {
                setReplacement(e.target.value)
                if (e.target.value) setTool('auto_replace')
                else setTool('flag')
              }}
              placeholder="e.g. and or"
              className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
            <p className="text-[10px] text-slate-400 mt-1 font-mono">Use $1, $2 … for captured groups.</p>
          </div>

          {/* Three segmented pickers */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as RuleCategory)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-emerald-500"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as RuleSeverity)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-emerald-500"
              >
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1">Behaviour</label>
              <div className="flex rounded-md overflow-hidden border border-slate-300">
                <button
                  type="button"
                  onClick={() => setTool('flag')}
                  className={`flex-1 px-2 py-1.5 text-[11px] font-bold ${
                    tool === 'flag' ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >Flag</button>
                <button
                  type="button"
                  disabled={!replacement}
                  onClick={() => setTool('auto_replace')}
                  title={!replacement ? 'Needs a replacement string' : undefined}
                  className={`flex-1 px-2 py-1.5 text-[11px] font-bold ${
                    tool === 'auto_replace' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >Auto</button>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-md transition-colors disabled:opacity-40"
          >Cancel</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save rule
          </button>
        </div>
      </div>
    </div>
  )
}
