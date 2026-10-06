import { Check, Loader2, Lock, RotateCcw } from 'lucide-react'
import type { PreEditingState, PreEditingStep, PreEditingStepKey } from '@/api/journals'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

interface Props {
  state: PreEditingState
  selected: PreEditingStepKey
  busy: PreEditingStepKey | null
  onSelect: (key: PreEditingStepKey) => void
  onRun: (key: PreEditingStepKey) => void
  onFinish: (key: PreEditingStepKey, opts: { acceptWarnings?: boolean; runNext?: boolean }) => void
  onReopen: (key: PreEditingStepKey) => void
}

function StepIcon({ step, busy }: { step: PreEditingStep; busy: boolean }) {
  const base = 'size-6 shrink-0 rounded-full border-2 flex items-center justify-center text-[11px] font-bold'
  if (busy || step.status === 'running') return <span className={cn(base, 'border-primary text-primary')}><Loader2 className="size-3.5 animate-spin" /></span>
  if (step.status === 'finished') return <span className={cn(base, 'border-green-600 bg-green-600 text-white')}><Check className="size-3.5" /></span>
  if (step.status === 'locked') return <span className={cn(base, 'border-border text-muted', step.was_finished && 'border-dashed')}><Lock className="size-3" /></span>
  if (step.status === 'failed') return <span className={cn(base, 'border-danger text-danger')}>!</span>
  return <span className={cn(base, 'border-primary text-primary')}>{step.number}</span>
}

function Counts({ step }: { step: PreEditingStep }) {
  if (!step.ran || step.status === 'running') return null
  const { error, warning } = step.open
  if (!error && !warning) return <span className="rounded-full bg-green-600/10 text-green-700 px-1.5 text-[10px] font-semibold">clear</span>
  return (
    <>
      {error > 0 && <span className="rounded-full bg-danger/10 text-danger px-1.5 text-[10px] font-semibold tabular-nums">{error} error{error > 1 ? 's' : ''}</span>}
      {warning > 0 && <span className="rounded-full bg-amber-500/15 text-amber-700 px-1.5 text-[10px] font-semibold tabular-nums">{warning} warning{warning > 1 ? 's' : ''}</span>}
    </>
  )
}

const STEP_LABELS: Record<string, string> = {
  structuring: 'Structuring',
  references: 'Reference validation',
  ia_rules: 'Mechanical rules',
  technical: 'Citation checks',
}

function subtitle(step: PreEditingStep, busy: boolean) {
  if (busy || step.status === 'running') return step.key === 'structuring' && !step.ran ? 'Structuring the manuscript…' : 'Running…'
  if (step.status === 'locked') return step.was_finished ? 'Finished before; locked until the step above is finished again' : step.blocked_reason ?? 'Locked'
  if (step.status === 'failed') return step.error ?? 'The last run failed'
  if (step.key === 'ia_rules') return 'The Mechanical & IA rules selected in Journal settings'
  if (step.key === 'technical') return 'Figure and table callouts, equations, keywords, art folder image validation'
  return step.description
}

/** Pre-Editing as four gated steps (Structuring → References → Mechanical rules → Citation checks), finished one by one. */
export function PreEditingSteps({ state, selected, busy, onSelect, onRun, onFinish, onReopen }: Props) {
  const done = state.steps.filter(s => s.status === 'finished').length
  const step = state.steps.find(s => s.key === selected) ?? state.steps[0]
  const next = state.steps[step.number] as PreEditingStep | undefined
  const isBusy = busy === step.key || step.status === 'running'

  return (
    <div className="border-b border-border">
      <div className="px-3 pt-3 pb-2 space-y-1.5">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-text">Pre-Editing steps</p>
          <span className="text-[11px] text-muted tabular-nums">{done} of {state.steps.length} finished</span>
        </div>
        <ol className="space-y-1.5">
          {state.steps.map(s => (
            <li key={s.key}>
              <button type="button" onClick={() => onSelect(s.key)} aria-current={selected === s.key ? 'step' : undefined}
                      className={cn('w-full text-left rounded-md border px-2.5 py-2 flex gap-2.5 items-start',
                        selected === s.key ? 'border-primary ring-1 ring-primary' : 'border-border',
                        s.status === 'locked' && 'bg-surface text-muted')}>
                <StepIcon step={s} busy={busy === s.key} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
                    {s.number}. {STEP_LABELS[s.key] ?? s.label} <Counts step={s} />
                  </span>
                  <span className="block text-[11px] text-muted leading-snug">{subtitle(s, busy === s.key)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="px-3 pb-3 space-y-2">
        {isBusy ? (
          <p className="rounded-md bg-primary/10 px-2.5 py-1.5 text-xs text-text">Running {step.label}. Findings appear when it finishes.</p>
        ) : step.status === 'locked' ? (
          <p className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800">{step.blocked_reason}</p>
        ) : step.status === 'ready' || step.status === 'failed' ? (
          <Button size="sm" onClick={() => onRun(step.key)}>{step.status === 'failed' ? `Retry ${step.label}` : `Run ${step.label}`}</Button>
        ) : step.status === 'in_progress' ? (
          <>
            <p className={cn('rounded-md px-2.5 py-1.5 text-xs',
              step.open.error ? 'bg-danger/10 text-danger' : step.open.warning ? 'bg-amber-500/10 text-amber-800' : 'bg-green-600/10 text-green-800')}>
              {step.blocked_reason ?? 'No open errors. You can finish this step.'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" disabled={!step.can_finish} onClick={() => onFinish(step.key, { runNext: true })}>
                {next ? 'Finish & run next' : 'Finish step'}
              </Button>
              {step.can_accept_warnings && (
                <Button size="sm" variant="secondary" onClick={() => onFinish(step.key, { acceptWarnings: true, runNext: true })}>
                  Accept {step.open.warning} warning{step.open.warning > 1 ? 's' : ''} &amp; finish
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onRun(step.key)}>Re-run</Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-green-700 font-medium">{step.label} is finished{step.signed_off ? ' (warnings signed off)' : ''}.</span>
            <Button size="sm" variant="ghost" leftIcon={<RotateCcw />} onClick={() => onReopen(step.key)}>Reopen</Button>
            <Button size="sm" variant="ghost" onClick={() => onRun(step.key)}>Re-run check</Button>
          </div>
        )}
      </div>
    </div>
  )
}
