import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Upload, BookOpen, Download, AlertCircle, CheckCircle2,
  AlertTriangle, Info, ChevronDown, ChevronUp, RefreshCw, FileText, FileCode, Play, X
} from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/useToastStore'

interface ValidationIssue {
  level: 'error' | 'warning' | 'info'
  code: string
  category: string
  location: string
  message: string
}

interface SidecarCheck {
  name: string
  found: boolean
  location: string
  severity: string
  note: string
}

interface EncodingCheck {
  path: string
  encoding: string
  is_utf8: boolean
  bad_byte_offset: number
  severity: string
  note: string
}

interface VersionCheck {
  master_version: string | null
  epub_version: string | null
  match: boolean
  severity: string
  note: string
}

interface DeclChange {
  property: string
  master: string | null
  epub: string | null
  kind: 'changed' | 'added' | 'removed'
}

interface RuleDeclaration {
  property: string
  value: string
}

interface RuleDiff {
  media: string | null
  selector: string
  status: 'modified' | 'additional' | 'missing'
  severity: string
  changes?: DeclChange[]
  after_marker?: boolean
  declarations?: RuleDeclaration[]
  note?: string
}

interface UndefinedClass {
  class: string
  severity: string
}

interface ReportSummary {
  modified: number
  missing: number
  additional_marked: number
  additional_unmarked: number
  sidecar_missing: number
  encoding_errors: number
  undefined_classes: number
  validation_errors: number
  validation_warnings: number
  errors: number
  warnings: number
  infos: number
  verdict: 'PASS' | 'REVIEW' | 'FAIL'
}

interface MatchReport {
  generated_at: string
  epub: {
    title: string
    identifier: string
    file_count: number
    stylesheet_count: number
    primary_stylesheet: string | null
  }
  master: {
    version: string | null
  }
  summary: ReportSummary
  sidecar_checks: SidecarCheck[]
  encoding_checks: EncodingCheck[]
  version_check: VersionCheck
  rule_diffs: RuleDiff[]
  undefined_classes: UndefinedClass[]
  validation: {
    issues: ValidationIssue[]
    summary: {
      errors: number
      warnings: number
      infos: number
      by_category: Record<string, number>
      status: string
    }
  }
  has_additional_marker: boolean
}

interface AnalyzeResponse {
  report: MatchReport
  artifacts: {
    html: string
    csv: string
    json: string
  }
}

export function PostProdCssMatcher() {
  useDocumentTitle('EPUB CSS Matcher — S4Carlisle CMS')
  const navigate = useNavigate()

  // Input states
  const [epubFile, setEpubFile] = useState<File | null>(null)
  const [cssFile, setCssFile] = useState<File | null>(null)
  const [packageFiles, setPackageFiles] = useState('')
  const [expectedSidecars, setExpectedSidecars] = useState('frontlist.csv')

  // UI state
  const [analyzing, setAnalyzing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)

  // Accordion toggle states
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    validation: false,
    sidecars: true,
    encoding: true,
    modified: true,
    additional: true,
    missing: false,
    undefinedClasses: false
  })

  const epubInputRef = useRef<HTMLInputElement>(null)
  const cssInputRef = useRef<HTMLInputElement>(null)

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const handleRunMatch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!epubFile || !cssFile) {
      toast.error('Please choose both an EPUB and a Master CSS file.')
      return
    }

    setAnalyzing(true)
    setErrorMsg(null)
    setResult(null)

    const formData = new FormData()
    formData.append('epub', epubFile)
    formData.append('master_css', cssFile)
    formData.append('package_files', packageFiles)
    formData.append('expected_sidecars', expectedSidecars)

    try {
      const res = await fetch('/api/v2/post-prod/css-matcher/analyze', {
        method: 'POST',
        body: formData
      })

      if (!res.ok) {
        let errMsg = 'Failed to analyze files'
        try {
          const data = await res.json()
          errMsg = data.detail || errMsg
        } catch {
          // ignore
        }
        throw new Error(errMsg)
      }

      const data = await res.json()
      setResult(data)
      toast.success('CSS Matching completed successfully!')
      // Auto open validation if it has errors, else default sections are fine
      const summary = data.report.summary
      setOpenSections({
        validation: summary.validation_errors > 0,
        sidecars: summary.sidecar_missing > 0,
        encoding: summary.encoding_errors > 0,
        modified: summary.modified > 0,
        additional: summary.additional_unmarked > 0 || summary.additional_marked > 0,
        missing: summary.missing > 0,
        undefinedClasses: summary.undefined_classes > 0
      })
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during analysis.')
      toast.error(err.message || 'Analysis failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleDownloadFile = (name: string, content: string, type: string) => {
    const blob = new Blob([content], { type })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  }

  const getVerdictBadgeClass = (verdict: 'PASS' | 'REVIEW' | 'FAIL') => {
    if (verdict === 'PASS') return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold'
    if (verdict === 'REVIEW') return 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 font-bold'
    return 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400 font-bold'
  }

  const getSeverityBadgeClass = (sev: string) => {
    const s = sev.toLowerCase()
    if (s === 'error' || s === 'bad' || s === 'fail') return 'bg-red-500/10 text-red-600 border border-red-500/20'
    if (s === 'warning' || s === 'warn') return 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
    if (s === 'info') return 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
    return 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
  }

  const getVerdictIcon = (verdict: 'PASS' | 'REVIEW' | 'FAIL') => {
    if (verdict === 'PASS') return <CheckCircle2 className="text-emerald-500" size={20} />
    if (verdict === 'REVIEW') return <AlertTriangle className="text-amber-500" size={20} />
    return <AlertCircle className="text-red-500" size={20} />
  }

  const report = result?.report
  const summary = report?.summary

  const modifiedRules = report?.rule_diffs.filter(r => r.status === 'modified') || []
  const additionalRules = report?.rule_diffs.filter(r => r.status === 'additional') || []
  const missingRules = report?.rule_diffs.filter(r => r.status === 'missing') || []

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 text-text">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/post-production')}
            className="p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-lg">
              <BookOpen size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-serif text-text m-0">EPUB CSS Matcher</h1>
              <p className="text-sm text-muted">Verify EPUB stylesheets against standard master templates</p>
            </div>
          </div>
        </div>
      </div>

      {/* Input Form Card */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <form onSubmit={handleRunMatch} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* EPUB Selector */}
            <div>
              <label className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
                EPUB Package File
              </label>
              <div
                onClick={() => epubInputRef.current?.click()}
                className="cursor-pointer border-2 border-dashed border-border/80 hover:border-primary/60 rounded-xl px-4 py-6 text-center bg-surface/50 hover:bg-accent/10 transition-all flex flex-col items-center justify-center min-h-[110px]"
              >
                <input
                  ref={epubInputRef}
                  type="file"
                  accept=".epub"
                  className="hidden"
                  onChange={(e) => setEpubFile(e.target.files?.[0] || null)}
                />
                {epubFile ? (
                  <div className="flex items-center gap-2 max-w-full">
                    <FileCode className="text-primary shrink-0" size={24} />
                    <span className="text-sm font-medium text-text truncate max-w-xs md:max-w-sm">
                      {epubFile.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEpubFile(null)
                      }}
                      className="p-1 rounded-full hover:bg-accent hover:text-text text-muted transition-colors shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="text-muted/60 mb-2" size={24} />
                    <span className="text-sm text-text font-medium">Click to choose EPUB</span>
                    <span className="text-xs text-muted mt-1">Accepts .epub files</span>
                  </>
                )}
              </div>
            </div>

            {/* Master CSS Selector */}
            <div>
              <label className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
                Master CSS Template
              </label>
              <div
                onClick={() => cssInputRef.current?.click()}
                className="cursor-pointer border-2 border-dashed border-border/80 hover:border-primary/60 rounded-xl px-4 py-6 text-center bg-surface/50 hover:bg-accent/10 transition-all flex flex-col items-center justify-center min-h-[110px]"
              >
                <input
                  ref={cssInputRef}
                  type="file"
                  accept=".css"
                  className="hidden"
                  onChange={(e) => setCssFile(e.target.files?.[0] || null)}
                />
                {cssFile ? (
                  <div className="flex items-center gap-2 max-w-full">
                    <FileText className="text-amber-500 shrink-0" size={24} />
                    <span className="text-sm font-medium text-text truncate max-w-xs md:max-w-sm">
                      {cssFile.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCssFile(null)
                      }}
                      className="p-1 rounded-full hover:bg-accent hover:text-text text-muted transition-colors shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="text-muted/60 mb-2" size={24} />
                    <span className="text-sm text-text font-medium">Click to choose Master CSS</span>
                    <span className="text-xs text-muted mt-1">Accepts .css files</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Delivery package files input */}
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
                Delivery Package Files (Optional, one per line)
              </label>
              <textarea
                value={packageFiles}
                onChange={(e) => setPackageFiles(e.target.value)}
                rows={3}
                placeholder="e.g. frontlist.csv&#10;cover.jpg&#10;metadata.xml"
                className="w-full text-sm border border-border bg-surface/50 rounded-xl px-3.5 py-2.5 font-mono focus:outline-none focus:border-primary/60 transition-all"
              />
              <p className="text-[10px] text-muted mt-1.5">
                List the files shipping alongside the EPUB in the package so sidecar checkers can verify their presence.
              </p>
            </div>

            {/* Expected sidecars */}
            <div>
              <label className="block text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
                Expected Sidecar Files
              </label>
              <input
                value={expectedSidecars}
                onChange={(e) => setExpectedSidecars(e.target.value)}
                className="w-full text-sm border border-border bg-surface/50 rounded-xl px-3.5 py-2.5 font-mono focus:outline-none focus:border-primary/60 transition-all"
              />
              <p className="text-[10px] text-muted mt-1.5">
                Comma or newline separated list of files expected in the delivery.
              </p>
            </div>
          </div>

          {/* Submit bar */}
          <div className="flex items-center gap-4 border-t border-border/40 pt-4">
            <Button type="submit" disabled={analyzing} leftIcon={analyzing ? <RefreshCw className="animate-spin" size={15} /> : <Play size={14} />}>
              {analyzing ? 'Analyzing...' : 'Run CSS Match'}
            </Button>
            {errorMsg && (
              <span className="text-xs font-semibold text-red-500 bg-red-500/5 px-3 py-1.5 rounded-lg border border-red-500/10">
                {errorMsg}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Results Workspace */}
      {result && report && summary && (
        <div className="space-y-6">
          {/* Verdict Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-card border border-border rounded-2xl shadow-sm">
            <div className="flex items-center gap-3">
              {getVerdictIcon(summary.verdict)}
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] uppercase tracking-wider font-extrabold px-3 py-1 rounded-full border ${getVerdictBadgeClass(summary.verdict)}`}>
                    Verdict: {summary.verdict}
                  </span>
                  <span className="text-sm font-semibold text-text">
                    {report.epub.title || 'Untitled Book'}
                  </span>
                </div>
                <div className="text-xs text-muted mt-1">
                  ID: <span className="font-mono">{report.epub.identifier || '—'}</span> &middot; stylesheet v{report.master.version || '?'}
                </div>
              </div>
            </div>

            {/* Downloads */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadFile('epub_css_report.html', result.artifacts.html, 'text/html')}
                leftIcon={<Download size={13} />}
              >
                HTML Report
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadFile('epub_css_log.csv', result.artifacts.csv, 'text/csv')}
                leftIcon={<Download size={13} />}
              >
                CSV Log
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadFile('epub_css_report.json', result.artifacts.json, 'application/json')}
                leftIcon={<Download size={13} />}
              >
                JSON Report
              </Button>
            </div>
          </div>

          {/* Cards metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="text-xl font-black text-amber-600">{summary.modified}</div>
              <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">Value Changes</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="text-xl font-black text-blue-500">{summary.additional_marked}</div>
              <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">Bespoke (Marked)</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="text-xl font-black text-amber-600">{summary.additional_unmarked}</div>
              <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">Bespoke (Unmarked)</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="text-xl font-black text-amber-500">{summary.missing}</div>
              <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">Missing Selectors</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="text-xl font-black text-red-500">{summary.encoding_errors}</div>
              <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">Encoding Errors</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="text-xl font-black text-red-500">{summary.sidecar_missing}</div>
              <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">Sidecars Absent</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="text-xl font-black text-red-600">{summary.validation_errors}</div>
              <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">Validation Errors</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="text-xl font-black text-amber-600">{summary.validation_warnings}</div>
              <div className="text-[10px] text-muted font-bold uppercase tracking-wider mt-0.5">Validation Warns</div>
            </div>
          </div>

          {/* Collapsible Report Sections */}
          <div className="space-y-4">
            
            {/* SECTION 1: Spec Validation Issues */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => toggleSection('validation')}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-accent/10 border-b border-border/50 text-left font-semibold text-sm hover:bg-accent/25 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="font-serif text-base text-text">EPUB Specification Validation Checks</span>
                  <span className="text-xs px-2 py-0.5 bg-accent/40 text-muted rounded-full">
                    {report.validation.issues.length}
                  </span>
                </div>
                {openSections.validation ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.validation && (
                <div className="p-5">
                  {report.validation.issues.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-500/5 px-4 py-3 rounded-lg border border-emerald-500/10">
                      <CheckCircle2 size={16} />
                      <span>No EPUB OCF, PKG, MAN, spine, xml well-formedness, link, or accessibility issues found.</span>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border text-muted font-bold uppercase tracking-wider">
                            <th className="py-2.5 px-3">Level</th>
                            <th className="py-2.5 px-3">Code</th>
                            <th className="py-2.5 px-3">Category</th>
                            <th className="py-2.5 px-3">Location</th>
                            <th className="py-2.5 px-3">Message</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {report.validation.issues.map((issue, idx) => (
                            <tr key={idx} className="hover:bg-accent/10">
                              <td className="py-3 px-3">
                                <span className={`text-[9px] uppercase font-extrabold px-2 py-0.5 rounded-full ${getSeverityBadgeClass(issue.level)}`}>
                                  {issue.level}
                                </span>
                              </td>
                              <td className="py-3 px-3 font-mono text-[11px] text-text font-bold">{issue.code}</td>
                              <td className="py-3 px-3 text-muted">{issue.category}</td>
                              <td className="py-3 px-3 font-mono text-[10px] text-muted truncate max-w-[200px]" title={issue.location}>
                                {issue.location}
                              </td>
                              <td className="py-3 px-3 text-text font-medium leading-relaxed">{issue.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SECTION 2: Package & Sidecar Checks */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => toggleSection('sidecars')}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-accent/10 border-b border-border/50 text-left font-semibold text-sm hover:bg-accent/25 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="font-serif text-base text-text">Package Sidecar Delivery Checks</span>
                  <span className="text-xs px-2 py-0.5 bg-accent/40 text-muted rounded-full">
                    {report.sidecar_checks.length}
                  </span>
                </div>
                {openSections.sidecars ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.sidecars && (
                <div className="p-5">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted font-bold uppercase tracking-wider">
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Filename</th>
                          <th className="py-2.5 px-3">Verification Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {report.sidecar_checks.map((check, idx) => (
                          <tr key={idx} className="hover:bg-accent/10">
                            <td className="py-3 px-3">
                              <span className={`text-[9px] uppercase font-extrabold px-2 py-0.5 rounded-full ${getSeverityBadgeClass(check.severity)}`}>
                                {check.severity === 'ok' ? 'found' : check.severity}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono text-text font-bold">{check.name}</td>
                            <td className="py-3 px-3 text-muted font-medium">{check.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 3: Encoding & Version Checks */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => toggleSection('encoding')}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-accent/10 border-b border-border/50 text-left font-semibold text-sm hover:bg-accent/25 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="font-serif text-base text-text">Encoding & Stylesheet Version Checks</span>
                  <span className="text-xs px-2 py-0.5 bg-accent/40 text-muted rounded-full">
                    {report.encoding_checks.length + 1}
                  </span>
                </div>
                {openSections.encoding ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.encoding && (
                <div className="p-5">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted font-bold uppercase tracking-wider">
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Resource Checked</th>
                          <th className="py-2.5 px-3">Detailed Verification Verdict</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {report.encoding_checks.map((check, idx) => (
                          <tr key={idx} className="hover:bg-accent/10">
                            <td className="py-3 px-3">
                              <span className={`text-[9px] uppercase font-extrabold px-2 py-0.5 rounded-full ${getSeverityBadgeClass(check.severity)}`}>
                                {check.severity === 'ok' ? 'utf-8' : check.severity}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono text-text font-bold">{check.path}</td>
                            <td className="py-3 px-3 text-muted font-medium">{check.note}</td>
                          </tr>
                        ))}
                        <tr className="hover:bg-accent/10">
                          <td className="py-3 px-3">
                            <span className={`text-[9px] uppercase font-extrabold px-2 py-0.5 rounded-full ${getSeverityBadgeClass(report.version_check.severity)}`}>
                              {report.version_check.severity === 'ok' ? 'matching' : report.version_check.severity}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-text font-bold">BoD Version Banner</td>
                          <td className="py-3 px-3 text-muted font-medium">{report.version_check.note}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 4: Modified Standard Classes */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => toggleSection('modified')}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-accent/10 border-b border-border/50 text-left font-semibold text-sm hover:bg-accent/25 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="font-serif text-base text-text">Modified Standard Template Classes (Value Changes)</span>
                  <span className="text-xs px-2 py-0.5 bg-accent/40 text-muted rounded-full">
                    {modifiedRules.length}
                  </span>
                </div>
                {openSections.modified ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.modified && (
                <div className="p-5">
                  {modifiedRules.length === 0 ? (
                    <p className="text-sm text-muted">No modification of standard template properties detected.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border text-muted font-bold uppercase tracking-wider">
                            <th className="py-2.5 px-3">Selector</th>
                            <th className="py-2.5 px-3">@media Context</th>
                            <th className="py-2.5 px-3">Property</th>
                            <th className="py-2.5 px-3">Standard Value</th>
                            <th className="py-2.5 px-3">EPUB Value</th>
                            <th className="py-2.5 px-3">Change Type</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {modifiedRules.flatMap((r, rIdx) =>
                            r.changes?.map((ch, cIdx) => (
                              <tr key={rIdx + '-' + cIdx} className="hover:bg-accent/10 align-top">
                                {cIdx === 0 ? (
                                  <td className="py-3 px-3 font-mono text-text font-bold" rowSpan={r.changes?.length}>
                                    <code>{r.selector}</code>
                                  </td>
                                ) : null}
                                {cIdx === 0 ? (
                                  <td className="py-3 px-3 text-muted font-mono text-[10px]" rowSpan={r.changes?.length}>
                                    {r.media || 'None'}
                                  </td>
                                ) : null}
                                <td className="py-3 px-3 font-mono text-[11px] text-text">{ch.property}</td>
                                <td className="py-3 px-3 font-mono text-muted">{ch.master ?? '—'}</td>
                                <td className="py-3 px-3 font-mono text-amber-700 font-bold dark:text-amber-500">{ch.epub ?? '—'}</td>
                                <td className="py-3 px-3">
                                  <span className={`text-[9px] uppercase font-extrabold px-2 py-0.5 rounded-full ${
                                    ch.kind === 'changed' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' :
                                    ch.kind === 'added' ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20' :
                                    'bg-red-500/10 text-red-600 border border-red-500/20'
                                  }`}>
                                    {ch.kind}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SECTION 5: Additional Bespoke Styles */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => toggleSection('additional')}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-accent/10 border-b border-border/50 text-left font-semibold text-sm hover:bg-accent/25 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="font-serif text-base text-text">Bespoke Styles / Selectors (Not in Standard Master)</span>
                  <span className="text-xs px-2 py-0.5 bg-accent/40 text-muted rounded-full">
                    {additionalRules.length}
                  </span>
                </div>
                {openSections.additional ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.additional && (
                <div className="p-5">
                  {additionalRules.length === 0 ? (
                    <p className="text-sm text-muted">No custom styles added beyond standard template.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border text-muted font-bold uppercase tracking-wider">
                            <th className="py-2.5 px-3">Severity</th>
                            <th className="py-2.5 px-3">Selector</th>
                            <th className="py-2.5 px-3">@media Context</th>
                            <th className="py-2.5 px-3">Declarations</th>
                            <th className="py-2.5 px-3">Review Remark</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {additionalRules.map((rule, idx) => (
                            <tr key={idx} className="hover:bg-accent/10 align-top">
                              <td className="py-3 px-3">
                                <span className={`text-[9px] uppercase font-extrabold px-2 py-0.5 rounded-full ${getSeverityBadgeClass(rule.severity)}`}>
                                  {rule.severity}
                                </span>
                              </td>
                              <td className="py-3 px-3 font-mono text-text font-bold">
                                <code>{rule.selector}</code>
                              </td>
                              <td className="py-3 px-3 font-mono text-[10px] text-muted">{rule.media || 'None'}</td>
                              <td className="py-3 px-3 font-mono text-[11px] text-muted space-y-0.5">
                                {rule.declarations?.map((d, dIdx) => (
                                  <div key={dIdx}>
                                    <span className="text-text font-medium">{d.property}</span>: {d.value};
                                  </div>
                                ))}
                              </td>
                              <td className="py-3 px-3 text-text font-medium leading-relaxed">{rule.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SECTION 6: Missing Standard Selectors */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => toggleSection('missing')}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-accent/10 border-b border-border/50 text-left font-semibold text-sm hover:bg-accent/25 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="font-serif text-base text-text">Standard Template Selectors Missing in EPUB</span>
                  <span className="text-xs px-2 py-0.5 bg-accent/40 text-muted rounded-full">
                    {missingRules.length}
                  </span>
                </div>
                {openSections.missing ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.missing && (
                <div className="p-5">
                  {missingRules.length === 0 ? (
                    <p className="text-sm text-emerald-600 font-medium">All standard selectors from the master template exist inside the EPUB stylesheet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border text-muted font-bold uppercase tracking-wider">
                            <th className="py-2.5 px-3">Severity</th>
                            <th className="py-2.5 px-3">Selector</th>
                            <th className="py-2.5 px-3">@media Context</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {missingRules.map((rule, idx) => (
                            <tr key={idx} className="hover:bg-accent/10">
                              <td className="py-3 px-3">
                                <span className={`text-[9px] uppercase font-extrabold px-2 py-0.5 rounded-full ${getSeverityBadgeClass(rule.severity)}`}>
                                  {rule.severity}
                                </span>
                              </td>
                              <td className="py-3 px-3 font-mono text-text font-bold">
                                <code>{rule.selector}</code>
                              </td>
                              <td className="py-3 px-3 font-mono text-[10px] text-muted">{rule.media || 'None'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SECTION 7: Undefined Class Names Used in XHTML */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <button
                type="button"
                onClick={() => toggleSection('undefinedClasses')}
                className="w-full flex items-center justify-between px-5 py-3.5 bg-accent/10 border-b border-border/50 text-left font-semibold text-sm hover:bg-accent/25 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="font-serif text-base text-text">Class Names Used in HTML Content but Undefined in CSS</span>
                  <span className="text-xs px-2 py-0.5 bg-accent/40 text-muted rounded-full">
                    {report.undefined_classes.length}
                  </span>
                </div>
                {openSections.undefinedClasses ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.undefinedClasses && (
                <div className="p-5">
                  {report.undefined_classes.length === 0 ? (
                    <p className="text-sm text-emerald-600 font-medium">All class names referenced in markup have a corresponding definition in the EPUB CSS stylesheets.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {report.undefined_classes.map((item, idx) => (
                        <span key={idx} className="px-2.5 py-1.5 font-mono text-xs text-amber-700 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/10 rounded-lg transition-colors">
                          .{item.class}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
