import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ListChecks, Upload, Play, X, Download, FileText, AlertCircle,
  AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronRight, RefreshCw, Wrench,
  Image as ImageIcon,
} from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { toast } from '@/store/useToastStore'

type Severity = 'error' | 'warning' | 'info'

interface EocIssue {
  file: string
  chapter: number | null
  question: number | null
  rule: string
  rule_title: string
  severity: Severity
  message: string
  text: string
  line: number | null
}

interface EocFileSummary {
  file: string
  chapter: number | null
  questions: number
  mc: number
  tf: number
  sa?: number
  shuffle_lines: number
  images: number
  has_alt?: number
  missing_alt?: number
  errors: number
  warnings: number
  info: number
  status: 'pass' | 'review' | 'fail'
  fixes?: number
}

interface EocReport {
  mode?: string
  generated_at: string
  reference_prefix: string
  totals: {
    files: number
    questions: number
    mc?: number
    tf?: number
    sa?: number
    images?: number
    has_alt?: number
    missing_alt?: number
    errors: number
    warnings: number
    info: number
  }
  rules: { rule: string; title: string; count: number }[]
  files: EocFileSummary[]
  issues: EocIssue[]
}

interface EocFix {
  file: string
  question: number | null
  rule: string
  action: string
  before: string
  after: string
}

interface AnalyzeResponse {
  mode?: 'validate' | 'fix' | 'alt_text'
  report: EocReport
  before_totals?: EocReport['totals']
  fixes?: EocFix[]
  author?: string
  artifacts: { csv: string; xlsx_base64: string; zip_base64?: string; zip_name?: string }
}

type RunMode = 'validate' | 'fix' | 'alt_text'
type AssessmentType = 'auto' | 'mc' | 'sa'

const PREFIX_KEY = 'eocValidator.referencePrefix'
const MODE_KEY = 'eocValidator.mode'

const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'bg-red-500/10 text-red-600 border border-red-500/20',
  warning: 'bg-amber-500/10 text-amber-600 border border-amber-500/20',
  info: 'bg-blue-500/10 text-blue-600 border border-blue-500/20',
}

const STATUS_STYLE: Record<EocFileSummary['status'], string> = {
  pass: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20',
  review: 'bg-amber-500/10 text-amber-600 border border-amber-500/20',
  fail: 'bg-red-500/10 text-red-600 border border-red-500/20',
}

function SeverityIcon({ s }: { s: Severity }) {
  if (s === 'error') return <AlertCircle size={13} className="text-red-500 shrink-0" />
  if (s === 'warning') return <AlertTriangle size={13} className="text-amber-500 shrink-0" />
  return <Info size={13} className="text-blue-500 shrink-0" />
}

const RECENT_PREFIXES_KEY = 'eocValidator.recentPrefixes'
const RECENT_PREFIXES_MAX = 10

function readRecentPrefixes(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PREFIXES_KEY)
    const arr = raw ? JSON.parse(raw) : []
    const list = Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []
    // Carry over the single prefix remembered by earlier versions of this page.
    const legacy = localStorage.getItem(PREFIX_KEY)
    if (legacy && !list.includes(legacy)) list.push(legacy)
    return list.slice(0, RECENT_PREFIXES_MAX)
  } catch {
    return []
  }
}

function writeRecentPrefixes(list: string[]) {
  try {
    localStorage.setItem(RECENT_PREFIXES_KEY, JSON.stringify(list.slice(0, RECENT_PREFIXES_MAX)))
    localStorage.removeItem(PREFIX_KEY)
  } catch {
    /* storage unavailable — recent list just won't persist */
  }
}

/** Text box with a dropdown of recently used reference prefixes. */
function PrefixCombobox({
  value,
  onChange,
  recent,
  onRemove,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  recent: string[]
  onRemove: (v: string) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const items = q ? recent.filter((r) => r.toLowerCase().includes(q) && r !== value.trim()) : recent

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => setActive(-1), [value, open])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex">
        <input
          id="eoc-prefix"
          value={value}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="eoc-prefix-list"
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => recent.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, items.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && open && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]) }
            else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm rounded-l-lg bg-surface border border-border focus:outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={recent.length === 0}
          title={recent.length ? 'Recent prefixes' : 'No recent prefixes yet'}
          aria-label="Show recent prefixes"
          className="px-2 rounded-r-lg border border-l-0 border-border bg-surface text-muted hover:text-text disabled:opacity-40"
        >
          <ChevronDown size={15} />
        </button>
      </div>
      {open && items.length > 0 && (
        <ul
          id="eoc-prefix-list"
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-card shadow-lg py-1"
        >
          <li className="px-3 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-muted font-semibold">Recent</li>
          {items.map((r, i) => (
            <li
              key={r}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              className={`flex items-center justify-between gap-2 px-3 py-1.5 text-sm cursor-pointer ${i === active ? 'bg-primary/10 text-primary' : 'hover:bg-surface'}`}
            >
              <span className="font-mono text-xs truncate">{r}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); onRemove(r) }}
                className="text-muted hover:text-red-500 shrink-0"
                aria-label={`Remove ${r} from recent`}
                title="Remove from recent"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function readMode(): RunMode {
  try {
    const m = localStorage.getItem(MODE_KEY)
    if (m === 'fix' || m === 'alt_text') return m
    return 'validate'
  } catch {
    return 'validate'
  }
}

function saveMode(v: RunMode) {
  try {
    localStorage.setItem(MODE_KEY, v)
  } catch {
    /* ignore */
  }
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

function downloadBlob(name: string, blob: Blob) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

export function PostProdEocValidator() {
  useDocumentTitle('EOC Question Validator — S4Carlisle CMS')
  const navigate = useNavigate()

  const [prefix, setPrefix] = useState('')
  const [recentPrefixes, setRecentPrefixes] = useState<string[]>(readRecentPrefixes)
  const rememberPrefix = (p: string) => {
    setRecentPrefixes((prev) => {
      const next = [p, ...prev.filter((x) => x !== p)].slice(0, RECENT_PREFIXES_MAX)
      writeRecentPrefixes(next)
      return next
    })
  }
  const forgetPrefix = (p: string) => {
    setRecentPrefixes((prev) => {
      const next = prev.filter((x) => x !== p)
      writeRecentPrefixes(next)
      return next
    })
  }
  const [mode, setMode] = useState<RunMode>(readMode)
  const [assessmentType, setAssessmentType] = useState<AssessmentType>('auto')
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [running, setRunning] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sevFilter, setSevFilter] = useState<Record<Severity, boolean>>({ error: true, warning: true, info: false })
  const [ruleFilter, setRuleFilter] = useState<string>('all')
  const [hideZeroImages, setHideZeroImages] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const picked = Array.from(list).filter((f) => /\.(docx|zip)$/i.test(f.name) && !f.name.startsWith('~$'))
    const skipped = list.length - picked.length
    if (skipped > 0) toast.error(`${skipped} file(s) skipped — only .docx and .zip are accepted.`)
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
      return [...prev, ...picked.filter((f) => !names.has(f.name))].sort((a, b) => a.name.localeCompare(b.name))
    })
  }

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = prefix.trim()
    if (mode !== 'alt_text' && !p) {
      toast.error('Enter the reference prefix for this project (e.g. machfund2028_eoc).')
      return
    }
    if (files.length === 0) {
      toast.error('Add the Word files (or a ZIP of them).')
      return
    }
    saveMode(mode)
    setRunning(true)
    setErrorMsg(null)
    setResult(null)
    const fd = new FormData()
    fd.append('reference_prefix', p || 'alt_text')
    fd.append('mode', mode)
    fd.append('assessment_type', assessmentType)
    files.forEach((f) => fd.append('files', f))
    try {
      const endpoint = mode === 'fix' ? '/api/v2/eoc-validator/fix' : '/api/v2/eoc-validator/analyze'
      const res = await fetch(endpoint, { method: 'POST', body: fd })
      if (!res.ok) {
        let msg = 'Validation failed'
        try {
          const data = await res.json()
          msg = data.detail || msg
        } catch {
          /* ignore */
        }
        throw new Error(msg)
      }
      const data: AnalyzeResponse = await res.json()
      setResult(data)
      // Run succeeded: remember the prefix, then clear the inputs for the next
      // run (results and their downloads stay on screen; a failed run keeps them).
      if (p) rememberPrefix(p)
      setFiles([])
      setPrefix('')
      if (inputRef.current) inputRef.current.value = ''
      const failing = Object.fromEntries(data.report.files.filter((f) => f.status === 'fail').map((f) => [f.file, true]))
      setExpanded(failing)
      setRuleFilter('all')
      const t = data.report.totals
      if (data.mode === 'alt_text' || mode === 'alt_text') {
        toast.success(`Checked images in ${t.files} file(s): ${t.has_alt ?? 0} with Alt text, ${t.missing_alt ?? t.errors} missing Alt text.`)
      } else if (data.mode === 'fix') {
        toast.success(`Applied ${data.fixes?.length ?? 0} correction(s) as tracked changes. ${t.errors} error(s) still need manual review.`)
      } else {
        toast.success(`Checked ${t.questions} questions in ${t.files} file(s): ${t.errors} error(s), ${t.warnings} warning(s).`)
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Validation failed.')
      toast.error(err.message || 'Validation failed.')
    } finally {
      setRunning(false)
    }
  }

  const report = result?.report
  const isAltText = mode === 'alt_text' || result?.mode === 'alt_text'

  const issuesByFile = useMemo(() => {
    const map: Record<string, EocIssue[]> = {}
    for (const i of report?.issues ?? []) {
      if (!sevFilter[i.severity]) continue
      if (ruleFilter !== 'all' && i.rule !== ruleFilter) continue
      ;(map[i.file] ||= []).push(i)
    }
    return map
  }, [report, sevFilter, ruleFilter])

  const runIssues = issuesByFile['(run)'] ?? []
  const isFix = result?.mode === 'fix'

  const fixesByFile = useMemo(() => {
    const map: Record<string, EocFix[]> = {}
    for (const f of result?.fixes ?? []) {
      if (ruleFilter !== 'all' && f.rule !== ruleFilter) continue
      ;(map[f.file] ||= []).push(f)
    }
    return map
  }, [result, ruleFilter])

  const downloadXlsx = () => {
    if (!result) return
    const prefixName = isAltText ? 'AltText_Audit' : (isFix ? 'EOC_Correction' : 'EOC_Validation')
    downloadBlob(`${prefixName}_${report?.reference_prefix || 'report'}.xlsx`,
      base64ToBlob(result.artifacts.xlsx_base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
  }

  const downloadZip = () => {
    if (!result?.artifacts.zip_base64) return
    downloadBlob(result.artifacts.zip_name || 'eoc_corrected.zip', base64ToBlob(result.artifacts.zip_base64, 'application/zip'))
  }

  const downloadCsv = () => {
    if (!result) return
    downloadBlob(`EOC_Validation_${report?.reference_prefix || 'report'}.csv`,
      new Blob(['﻿' + result.artifacts.csv], { type: 'text/csv;charset=utf-8' }))
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 text-text">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/60 pb-4">
        <button
          onClick={() => navigate('/post-production')}
          className="p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
          aria-label="Back to Backlist Hub"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="p-2 bg-accent rounded-lg">
          <ListChecks size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold font-serif text-text m-0">EOC Question Validator</h1>
          <p className="text-sm text-muted">
            Check EOC/EOL assessment Word files against the G-W extraction requirements and shuffle rules, then download corrected copies (your originals are never changed).
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleRun} className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label htmlFor="eoc-prefix" className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
              Reference prefix {mode === 'alt_text' ? <span className="text-muted text-[11px] font-normal lowercase">(optional)</span> : <span className="text-red-500">*</span>}
            </label>
            <PrefixCombobox
              value={prefix}
              onChange={setPrefix}
              recent={recentPrefixes}
              onRemove={forgetPrefix}
              placeholder={mode === 'alt_text' ? 'Optional (e.g. ev2028_sm)' : 'machfund2028_eoc'}
            />
            <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
              {mode === 'alt_text'
                ? 'Optional for Alt text check. Upload any Word document (manuals, job sheets, chapters).'
                : <>Expected IDs: <code>{(prefix.trim() || 'prefix') + '01_001'}</code> — 2-digit chapter from the filename (<code>_ch01</code>), 3-digit question number.</>}
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
              {mode === 'alt_text' ? 'Word files (.docx or .zip)' : 'Chapter files (.docx or .zip)'}
            </label>
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
              className={`cursor-pointer border-2 border-dashed rounded-xl px-4 py-6 text-center transition-all flex flex-col items-center justify-center min-h-[110px] ${dragOver ? 'border-primary bg-accent/20' : 'border-border/80 hover:border-primary/60 bg-surface/50 hover:bg-accent/10'}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".docx,.zip"
                multiple
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
              />
              <Upload size={22} className="text-muted mb-2" />
              <p className="text-sm text-text m-0">Drop Word files here or click to choose</p>
              <p className="text-xs text-muted mt-1">
                {mode === 'alt_text'
                  ? 'Any Word files or ZIP (e.g. manuals, job sheets, chapters)'
                  : 'One file per chapter, e.g. machfun2028_tx_ch01.docx'}
              </p>
            </div>
            {files.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted">{files.length} file(s) selected</span>
                  <button type="button" onClick={() => setFiles([])} className="text-xs text-muted hover:text-red-500">
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                  {files.map((f) => (
                    <span key={f.name} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-surface border border-border">
                      <FileText size={12} className="text-muted" />
                      {f.name}
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}
                        className="text-muted hover:text-red-500"
                        aria-label={`Remove ${f.name}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <fieldset>
          <legend className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">Mode</legend>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {([
              {
                value: 'validate' as RunMode,
                title: 'Validation only (EOC)',
                desc: 'Full EOC assessment checks (numbering, options, shuffle, titles, LOs). Files are not changed.',
                icon: <ListChecks size={16} />,
              },
              {
                value: 'fix' as RunMode,
                title: 'Validation + fixes',
                desc: 'Safe EOC fixes made as Word tracked changes to Accept/Reject. Download corrected copies.',
                icon: <Wrench size={16} />,
              },
              {
                value: 'alt_text' as RunMode,
                title: 'Check Alt text only',
                desc: 'Audits images for Alt text across any Word file (chapters, manuals, job sheets). EOC structure not required.',
                icon: <ImageIcon size={16} />,
              },
            ]).map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${mode === opt.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
              >
                <input
                  type="radio"
                  name="eoc-mode"
                  value={opt.value}
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  className="mt-1"
                />
                <span className="text-primary mt-0.5">{opt.icon}</span>
                <span>
                  <span className="block text-sm font-semibold text-text">{opt.title}</span>
                  <span className="block text-xs text-muted mt-0.5 leading-relaxed">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode !== 'alt_text' && (
          <div>
            <label className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
              Assessment Type
            </label>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'auto' as AssessmentType, label: 'Auto-detect (MC & Short Answer)' },
                { value: 'mc' as AssessmentType, label: 'Multiple Choice only' },
                { value: 'sa' as AssessmentType, label: 'Short Answer / Discussion only' },
              ]).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                    assessmentType === opt.value
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'border-border text-muted hover:border-primary/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="assessment-type"
                    value={opt.value}
                    checked={assessmentType === opt.value}
                    onChange={() => setAssessmentType(opt.value)}
                    className="sr-only"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          {errorMsg && <span className="text-sm text-red-500 mr-auto">{errorMsg}</span>}
          <button
            type="submit"
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {running ? <RefreshCw size={15} className="animate-spin" /> : mode === 'fix' ? <Wrench size={15} /> : mode === 'alt_text' ? <ImageIcon size={15} /> : <Play size={15} />}
            {running
              ? (mode === 'fix' ? 'Validating and correcting…' : mode === 'alt_text' ? 'Checking Alt text…' : 'Validating…')
              : (mode === 'fix' ? 'Validate and fix' : mode === 'alt_text' ? 'Check Alt text' : 'Run validation')}
          </button>
        </div>
      </form>

      {/* Results */}
      {report && (
        <div className="space-y-5">
          {/* Fix summary */}
          {isFix && result?.before_totals && (
            <div className="bg-emerald-500/5 border border-emerald-500/25 rounded-xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <Wrench size={16} /> {result.fixes?.length ?? 0} correction(s) made as tracked changes
                {result.author ? <span className="font-normal text-muted">(author: {result.author})</span> : null}
              </span>
              <span className="text-sm text-text">
                Errors <b className="text-red-600">{result.before_totals.errors}</b> → <b className={report.totals.errors ? 'text-red-600' : 'text-emerald-600'}>{report.totals.errors}</b>
                <span className="mx-2 text-muted">·</span>
                Warnings <b className="text-amber-600">{result.before_totals.warnings}</b> → <b className="text-amber-600">{report.totals.warnings}</b>
              </span>
              <span className="text-xs text-muted">
                Counts below are for the corrected files (as if the changes are accepted). What remains needs a person.
              </span>
            </div>
          )}

          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {isAltText ? ([
              { label: 'Files with Images', value: report.files.filter((f) => f.images > 0).length, cls: 'text-text' },
              { label: 'Total Files', value: report.totals.files, cls: 'text-text' },
              { label: 'Total Images', value: report.totals.images ?? 0, cls: 'text-text' },
              { label: 'With Alt Text', value: report.totals.has_alt ?? 0, cls: 'text-emerald-600' },
              { label: 'Missing Alt Text', value: report.totals.missing_alt ?? report.totals.errors, cls: (report.totals.missing_alt ?? report.totals.errors) ? 'text-red-600' : 'text-emerald-600' },
            ]).map((t) => (
              <div key={t.label} className="bg-card border border-border rounded-xl p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{t.label}</div>
                <div className={`text-2xl font-bold mt-1 ${t.cls}`}>{t.value}</div>
              </div>
            )) : ([
              { label: 'Files', value: report.totals.files, cls: 'text-text' },
              { label: 'Questions', value: report.totals.sa ? `${report.totals.questions} (${report.totals.sa} SA)` : report.totals.questions, cls: 'text-text' },
              { label: isFix ? 'Errors left' : 'Errors', value: report.totals.errors, cls: 'text-red-600' },
              { label: isFix ? 'Warnings left' : 'Warnings', value: report.totals.warnings, cls: 'text-amber-600' },
              { label: 'Info', value: report.totals.info, cls: 'text-blue-600' },
            ]).map((t) => (
              <div key={t.label} className="bg-card border border-border rounded-xl p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{t.label}</div>
                <div className={`text-2xl font-bold mt-1 ${t.cls}`}>{t.value}</div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Show</span>
            {(['error', 'warning', 'info'] as Severity[]).map((s) => (
              <label key={s} className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={sevFilter[s]}
                  onChange={(e) => setSevFilter((prev) => ({ ...prev, [s]: e.target.checked }))}
                />
                <span className={`px-1.5 py-0.5 rounded ${SEVERITY_STYLE[s]}`}>{s}</span>
              </label>
            ))}
            <select
              value={ruleFilter}
              onChange={(e) => setRuleFilter(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-md bg-surface border border-border"
              aria-label="Filter by rule"
            >
              <option value="all">All rules</option>
              {report.rules.map((r) => (
                <option key={r.rule} value={r.rule}>{r.rule} — {r.title} ({r.count})</option>
              ))}
            </select>
            {isAltText && (
              <label className="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer hover:text-text select-none">
                <input
                  type="checkbox"
                  checked={hideZeroImages}
                  onChange={(e) => setHideZeroImages(e.target.checked)}
                  className="rounded"
                />
                <span>Only files with images ({report.files.filter((f) => f.images > 0).length})</span>
              </label>
            )}
            <div className="ml-auto flex gap-2">
              {isFix && (
                <button
                  onClick={downloadZip}
                  title="Corrected Word files (fixes as tracked changes) + Excel change log. Your originals are not modified."
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-white font-semibold hover:opacity-90"
                >
                  <Download size={13} /> Corrected Word files (ZIP)
                </button>
              )}
              <button
                onClick={downloadXlsx}
                title={isAltText ? "Download Excel report (only includes chapters containing images)" : "Download Excel report"}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:border-primary hover:text-primary"
              >
                <Download size={13} /> Excel report
              </button>
              <button onClick={downloadCsv} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:border-primary hover:text-primary">
                <Download size={13} /> CSV
              </button>
            </div>
          </div>

          {/* Run-level issues */}
          {runIssues.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-1.5">
              <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Across all files</div>
              {runIssues.map((i, k) => (
                <div key={k} className="flex items-start gap-2 text-sm">
                  <SeverityIcon s={i.severity} />
                  <span>{i.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Per-file table */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">File</th>
                    {isAltText ? (
                      <>
                        <th className="text-right px-3 py-2.5 font-semibold">Total Images</th>
                        <th className="text-right px-3 py-2.5 font-semibold">With Alt Text</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Missing Alt Text</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Warnings</th>
                      </>
                    ) : (
                      <>
                        <th className="text-right px-3 py-2.5 font-semibold">Ch.</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Questions</th>
                        <th className="text-right px-3 py-2.5 font-semibold">MC / TF / SA</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Shuffle</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Images</th>
                        {isFix && <th className="text-right px-3 py-2.5 font-semibold">Fixes</th>}
                        <th className="text-right px-3 py-2.5 font-semibold">Errors</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Warnings</th>
                      </>
                    )}
                    <th className="text-center px-3 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(isAltText && hideZeroImages ? report.files.filter((f) => f.images > 0) : report.files).map((f) => {
                    const open = !!expanded[f.file]
                    const list = issuesByFile[f.file] ?? []
                    const fileFixes = fixesByFile[f.file] ?? []
                    return (
                      <React.Fragment key={f.file}>
                        <tr
                          onClick={() => setExpanded((prev) => ({ ...prev, [f.file]: !open }))}
                          className="border-t border-border/60 hover:bg-surface/60 cursor-pointer"
                        >
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-1.5">
                              {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                              {f.file}
                            </span>
                          </td>
                          {isAltText ? (
                            <>
                              <td className="text-right px-3 font-semibold">{f.images}</td>
                              <td className="text-right px-3 text-emerald-600 font-semibold">{f.has_alt ?? (f.images - (f.missing_alt ?? f.errors))}</td>
                              <td className={`text-right px-3 ${(f.missing_alt ?? f.errors) ? 'text-red-600 font-semibold' : 'text-muted'}`}>{f.missing_alt ?? f.errors}</td>
                              <td className={`text-right px-3 ${f.warnings ? 'text-amber-600 font-semibold' : 'text-muted'}`}>{f.warnings}</td>
                            </>
                          ) : (
                            <>
                              <td className="text-right px-3">{f.chapter ?? '—'}</td>
                              <td className="text-right px-3 font-semibold">{f.questions}</td>
                              <td className="text-right px-3 text-muted text-xs">
                                {f.sa ? (f.mc || f.tf ? `${f.mc} / ${f.tf} / ${f.sa}` : `${f.sa} SA`) : `${f.mc} / ${f.tf}`}
                              </td>
                              <td className="text-right px-3 text-muted">{f.shuffle_lines}</td>
                              <td className="text-right px-3 text-muted">{f.images}</td>
                              {isFix && (
                                <td className={`text-right px-3 ${f.fixes ? 'text-emerald-600 font-semibold' : 'text-muted'}`}>{f.fixes ?? 0}</td>
                              )}
                              <td className={`text-right px-3 ${f.errors ? 'text-red-600 font-semibold' : 'text-muted'}`}>{f.errors}</td>
                              <td className={`text-right px-3 ${f.warnings ? 'text-amber-600 font-semibold' : 'text-muted'}`}>{f.warnings}</td>
                            </>
                          )}
                          <td className="text-center px-3">
                            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${STATUS_STYLE[f.status]}`}>
                              {f.status === 'pass' ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={10} /> pass</span> : f.status}
                            </span>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-surface/40">
                            <td colSpan={isAltText ? 6 : (isFix ? 10 : 9)} className="px-4 py-3 space-y-3">
                              {isFix && fileFixes.length > 0 && (
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
                                    Corrected (tracked changes) · {fileFixes.length}
                                  </div>
                                  <table className="w-full text-xs">
                                    <tbody>
                                      {fileFixes.map((fx, k) => (
                                        <tr key={k} className="border-t border-border/40 align-top">
                                          <td className="py-1.5 pr-3 w-12">{fx.question ?? '—'}</td>
                                          <td className="py-1.5 pr-3 w-20">
                                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">fixed</span>
                                          </td>
                                          <td className="py-1.5 pr-3 w-40 text-muted">{fx.rule}</td>
                                          <td className="py-1.5 pr-3">{fx.action}</td>
                                          <td className="py-1.5 font-mono text-[11px] break-all">
                                            {fx.before && <span className="line-through text-red-600/80">{fx.before.replace(/\t/g, ' ⇥ ')}</span>}
                                            {fx.before && fx.after && <span className="text-muted"> → </span>}
                                            {fx.after && <span className="text-emerald-700 dark:text-emerald-400">{fx.after}</span>}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                              {isFix && list.length > 0 && (
                                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Still to review · {list.length}</div>
                              )}
                              {list.length === 0 ? (
                                <p className="text-xs text-muted m-0">
                                  {isAltText
                                    ? (f.images === 0 ? 'No images found in this document (excluded from Excel report).' : 'All images in this document passed validation.')
                                    : (isFix ? 'Nothing left to review for the current filters.' : 'No issues match the current filters.')}
                                </p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead className="text-muted">
                                    <tr>
                                      <th className="text-left py-1 pr-3 font-semibold w-16">{isAltText ? 'Location' : 'Q'}</th>
                                      <th className="text-left py-1 pr-3 font-semibold w-20">Status</th>
                                      {!isAltText && <th className="text-left py-1 pr-3 font-semibold w-40">Rule</th>}
                                      <th className="text-left py-1 pr-3 font-semibold">{isAltText ? 'Image & Alt Text' : 'Issue'}</th>
                                      <th className="text-left py-1 font-semibold">{isAltText ? 'Nearby Text / Context' : 'Line'}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {list.map((i, k) => (
                                      <tr key={k} className="border-t border-border/40 align-top">
                                        <td className="py-1.5 pr-3 font-mono text-[11px]">
                                          {isAltText ? (i.line ? `¶${i.line}` : '—') : (i.question ?? '—')}
                                        </td>
                                        <td className="py-1.5 pr-3">
                                          <span className={`px-1.5 py-0.5 rounded ${SEVERITY_STYLE[i.severity]}`}>
                                            {isAltText && i.severity === 'info' ? 'pass' : i.severity}
                                          </span>
                                        </td>
                                        {!isAltText && <td className="py-1.5 pr-3 text-muted">{i.rule} · {i.rule_title}</td>}
                                        <td className="py-1.5 pr-3 font-medium">{i.message}</td>
                                        <td className="py-1.5 font-mono text-[11px] text-muted break-all">
                                          {i.text ? i.text.replace(/\t/g, ' ⇥ ') : ''}
                                          {!isAltText && i.line ? <span className="ml-1 opacity-60">(¶{i.line})</span> : null}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
