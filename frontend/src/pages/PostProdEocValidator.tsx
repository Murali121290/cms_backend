import React, { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ListChecks, Upload, Play, X, Download, FileText, AlertCircle,
  AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronRight, RefreshCw, Wrench,
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
  shuffle_lines: number
  images: number
  errors: number
  warnings: number
  info: number
  status: 'pass' | 'review' | 'fail'
  fixes?: number
}

interface EocReport {
  generated_at: string
  reference_prefix: string
  totals: { files: number; questions: number; errors: number; warnings: number; info: number }
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
  mode?: 'fix'
  report: EocReport
  before_totals?: EocReport['totals']
  fixes?: EocFix[]
  author?: string
  artifacts: { csv: string; xlsx_base64: string; zip_base64?: string; zip_name?: string }
}

type RunMode = 'validate' | 'fix'

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

function readPrefix(): string {
  try {
    return localStorage.getItem(PREFIX_KEY) || ''
  } catch {
    return ''
  }
}

function savePrefix(v: string) {
  try {
    localStorage.setItem(PREFIX_KEY, v)
  } catch {
    /* ignore */
  }
}

function readMode(): RunMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'fix' ? 'fix' : 'validate'
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

  const [prefix, setPrefix] = useState(readPrefix)
  const [mode, setMode] = useState<RunMode>(readMode)
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [running, setRunning] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sevFilter, setSevFilter] = useState<Record<Severity, boolean>>({ error: true, warning: true, info: false })
  const [ruleFilter, setRuleFilter] = useState<string>('all')
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
    if (!p) {
      toast.error('Enter the reference prefix for this project (e.g. machfund2028_eoc).')
      return
    }
    if (files.length === 0) {
      toast.error('Add the chapter Word files (or a ZIP of them).')
      return
    }
    savePrefix(p)
    saveMode(mode)
    setRunning(true)
    setErrorMsg(null)
    setResult(null)
    const fd = new FormData()
    fd.append('reference_prefix', p)
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
      const failing = Object.fromEntries(data.report.files.filter((f) => f.status === 'fail').map((f) => [f.file, true]))
      setExpanded(failing)
      setRuleFilter('all')
      const t = data.report.totals
      if (data.mode === 'fix') {
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
    downloadBlob(`EOC_${isFix ? 'Correction' : 'Validation'}_${report?.reference_prefix || 'report'}.xlsx`,
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
              Reference prefix <span className="text-red-500">*</span>
            </label>
            <input
              id="eoc-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="machfund2028_eoc"
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface border border-border focus:outline-none focus:border-primary"
            />
            <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
              Expected IDs: <code>{(prefix.trim() || 'prefix') + '01_001'}</code> — 2-digit chapter from the filename (<code>_ch01</code>), 3-digit question number.
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
              Chapter files (.docx or .zip)
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
              <p className="text-xs text-muted mt-1">One file per chapter, e.g. machfun2028_tx_ch01.docx</p>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {([
              {
                value: 'validate' as RunMode,
                title: 'Validation only',
                desc: 'Report every issue. The Word files are not changed.',
                icon: <ListChecks size={16} />,
              },
              {
                value: 'fix' as RunMode,
                title: 'Validation + fixes (tracked changes)',
                desc: 'Also download corrected copies. Safe fixes — Shuffle lines, Reference IDs, Learning Outcome spacing, mismatched titles, blank lines — are made as Word tracked changes to Accept/Reject. Originals are never modified.',
                icon: <Wrench size={16} />,
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

        <div className="flex items-center justify-end gap-3">
          {errorMsg && <span className="text-sm text-red-500 mr-auto">{errorMsg}</span>}
          <button
            type="submit"
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {running ? <RefreshCw size={15} className="animate-spin" /> : mode === 'fix' ? <Wrench size={15} /> : <Play size={15} />}
            {running
              ? (mode === 'fix' ? 'Validating and correcting…' : 'Validating…')
              : (mode === 'fix' ? 'Validate and fix' : 'Run validation')}
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
            {[
              { label: 'Files', value: report.totals.files, cls: 'text-text' },
              { label: 'Questions', value: report.totals.questions, cls: 'text-text' },
              { label: isFix ? 'Errors left' : 'Errors', value: report.totals.errors, cls: 'text-red-600' },
              { label: isFix ? 'Warnings left' : 'Warnings', value: report.totals.warnings, cls: 'text-amber-600' },
              { label: 'Info', value: report.totals.info, cls: 'text-blue-600' },
            ].map((t) => (
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
              <button onClick={downloadXlsx} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:border-primary hover:text-primary">
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
                    <th className="text-right px-3 py-2.5 font-semibold">Ch.</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Questions</th>
                    <th className="text-right px-3 py-2.5 font-semibold">MC / TF</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Shuffle</th>
                    {isFix && <th className="text-right px-3 py-2.5 font-semibold">Fixes</th>}
                    <th className="text-right px-3 py-2.5 font-semibold">Errors</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Warnings</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.files.map((f) => {
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
                          <td className="text-right px-3">{f.chapter ?? '—'}</td>
                          <td className="text-right px-3">{f.questions}</td>
                          <td className="text-right px-3 text-muted">{f.mc} / {f.tf}</td>
                          <td className="text-right px-3 text-muted">{f.shuffle_lines}</td>
                          {isFix && (
                            <td className={`text-right px-3 ${f.fixes ? 'text-emerald-600 font-semibold' : 'text-muted'}`}>{f.fixes ?? 0}</td>
                          )}
                          <td className={`text-right px-3 ${f.errors ? 'text-red-600 font-semibold' : 'text-muted'}`}>{f.errors}</td>
                          <td className={`text-right px-3 ${f.warnings ? 'text-amber-600 font-semibold' : 'text-muted'}`}>{f.warnings}</td>
                          <td className="text-center px-3">
                            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${STATUS_STYLE[f.status]}`}>
                              {f.status === 'pass' ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={10} /> pass</span> : f.status}
                            </span>
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-surface/40">
                            <td colSpan={isFix ? 9 : 8} className="px-4 py-3 space-y-3">
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
                                  {isFix ? 'Nothing left to review for the current filters.' : 'No issues match the current filters.'}
                                </p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead className="text-muted">
                                    <tr>
                                      <th className="text-left py-1 pr-3 font-semibold w-12">Q</th>
                                      <th className="text-left py-1 pr-3 font-semibold w-20">Severity</th>
                                      <th className="text-left py-1 pr-3 font-semibold w-40">Rule</th>
                                      <th className="text-left py-1 pr-3 font-semibold">Issue</th>
                                      <th className="text-left py-1 font-semibold">Line</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {list.map((i, k) => (
                                      <tr key={k} className="border-t border-border/40 align-top">
                                        <td className="py-1.5 pr-3">{i.question ?? '—'}</td>
                                        <td className="py-1.5 pr-3">
                                          <span className={`px-1.5 py-0.5 rounded ${SEVERITY_STYLE[i.severity]}`}>{i.severity}</span>
                                        </td>
                                        <td className="py-1.5 pr-3 text-muted">{i.rule} · {i.rule_title}</td>
                                        <td className="py-1.5 pr-3">{i.message}</td>
                                        <td className="py-1.5 font-mono text-[11px] text-muted break-all">
                                          {i.text ? i.text.replace(/\t/g, ' ⇥ ') : ''}
                                          {i.line ? <span className="ml-1 opacity-60">(¶{i.line})</span> : null}
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
