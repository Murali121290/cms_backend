import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2, Save } from 'lucide-react'
import { journalsApi, type JatsFinding, type JournalFileInfo } from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { SourceEditor, formatXmlString, type LintError, type SourceEditorRef } from '@/components/epub_validator/SourceEditor'
import { OutlineNode, parseXmlOutline } from '@/components/epub_validator/XmlOutline'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'

interface Props {
  articleId: number
  /** Bumped by the page after a new conversion so the editor reloads the latest version. */
  version?: number
  height?: string
  /** Called after a save so the page can refresh its checks. */
  onSaved?: () => void
}

const btn = 'px-2 py-0.5 rounded border text-[11px] transition-colors'
const btnOff = 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
const btnOn = 'bg-blue-50 text-blue-700 border-blue-200'

/** Validation log text in the book editor's form: one "article.xml:LINE: message" line per finding. */
function findingsLog(file: JournalFileInfo | null, findings: JatsFinding[]): string {
  const head = [
    'JATS 1.3 DTD Validation Log (Journal Publishing, MathML 3)',
    `Input File : ${file ? `${file.filename} (v${file.version})` : '-'}`,
    '--------------------------------',
  ]
  if (findings.length === 0) return [...head, '✓ VALIDATION PASSED — no DTD errors or publisher-rule warnings'].join('\n')
  const errors = findings.filter(f => f.severity === 'error').length
  const body = findings.map(f => {
    const msg = f.message.replace(/^article\.xml:\d+:\s*/, '')
    return `article.xml:${f.line ?? 0}: ${f.severity.toUpperCase()} [${f.rule_id}] ${f.title}\n    ${msg}`
  })
  return [...head, errors ? `✗ VALIDATION FAILED — ${errors} error(s), ${findings.length - errors} warning(s)` : `⚠ ${findings.length} warning(s)`, '', ...body].join('\n')
}

/**
 * JATS XML editor for a journal article: outline, CodeMirror source (SourceEditor) with DTD
 * errors highlighted, validation log and XPath evaluator. Same layout as the book XML editor.
 * Saving stores the next JATS XML version and re-runs the XML & DTD check.
 */
export function JatsXmlEditor({ articleId, version, height = 'calc(100vh - 118px)', onSaved }: Props) {
  const editorRef = useRef<SourceEditorRef | null>(null)
  const [file, setFile] = useState<JournalFileInfo | null>(null)
  const [content, setContent] = useState<string>('')
  const [findings, setFindings] = useState<JatsFinding[]>([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [showOutline, setShowOutline] = useState(true)
  const [showLog, setShowLog] = useState(true)
  const [rightTab, setRightTab] = useState<'log' | 'xpath'>('log')
  const [xpathQuery, setXpathQuery] = useState('//ref')
  const [xpathResults, setXpathResults] = useState<{ line: number; tagName: string; text: string }[]>([])
  const [xpathError, setXpathError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await journalsApi.getJats(articleId)
      setFile(r.file)
      setContent(r.content)
      setFindings(r.findings ?? [])
      setDirty(false)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load the JATS XML'))
    } finally {
      setLoading(false)
    }
  }, [articleId])

  useEffect(() => { void load() }, [load, version])

  // Warn before leaving with unsaved XML edits.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const wellFormed = useMemo(() => {
    if (!content) return { ok: true } as { ok: boolean; line?: number; message?: string }
    const doc = new DOMParser().parseFromString(content, 'application/xml')
    const err = doc.getElementsByTagName('parsererror')[0]
    if (!err) return { ok: true }
    const text = err.textContent || 'XML syntax error'
    const m = text.match(/line(?: number)?\s*(\d+)/i)
    return { ok: false, line: m ? parseInt(m[1], 10) : undefined, message: text }
  }, [content])

  const lintErrors: LintError[] = useMemo(() => {
    const out: LintError[] = findings.filter(f => f.line).map(f => ({ line: f.line as number, message: `[${f.rule_id}] ${f.title}\n${f.message}` }))
    if (!wellFormed.ok && wellFormed.line) out.push({ line: wellFormed.line, message: `Syntax error: ${wellFormed.message}` })
    return out
  }, [findings, wellFormed])

  const outline = useMemo(() => parseXmlOutline(content), [content])
  const logText = useMemo(() => findingsLog(file, findings), [file, findings])
  const errorCount = findings.filter(f => f.severity === 'error').length
  const goToLine = (line: number) => editorRef.current?.scrollToLine(line)

  /** Server-side JATS 1.3 DTD check of the unsaved XML. Returns the errors (SourceEditor's DTD button shows them too). */
  const validate = async (): Promise<{ errors: { line_number: number; message: string; error_type?: string }[] }> => {
    if (!wellFormed.ok) {
      if (wellFormed.line) goToLine(wellFormed.line)
      toast.error('The XML is not well-formed. Fix the syntax error first.')
      return { errors: [{ line_number: wellFormed.line ?? 0, message: wellFormed.message ?? 'XML syntax error', error_type: 'XML-WF' }] }
    }
    setValidating(true)
    try {
      const r = await journalsApi.lintJats(articleId, content)
      setFindings(r.findings)
      setShowLog(true)
      setRightTab('log')
      const errors = r.findings.filter(f => f.severity === 'error')
      if (errors.length) toast.error(`JATS 1.3 DTD: ${errors.length} error${errors.length > 1 ? 's' : ''}`)
      else toast.success(r.findings.length ? `Valid against the JATS 1.3 DTD (${r.findings.length} warning${r.findings.length > 1 ? 's' : ''})` : 'Valid against the JATS 1.3 DTD')
      return { errors: errors.map(f => ({ line_number: f.line ?? 0, message: `[${f.rule_id}] ${f.title}`, error_type: f.rule_id })) }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Validation failed'))
      throw err
    } finally {
      setValidating(false)
    }
  }

  const save = async () => {
    if (!dirty || saving) return
    if (!wellFormed.ok) {
      if (wellFormed.line) goToLine(wellFormed.line)
      toast.error('The XML is not well-formed, so it was not saved.')
      return
    }
    setSaving(true)
    try {
      const r = await journalsApi.saveJats(articleId, content)
      setFile(r.file)
      setFindings(r.findings)
      setDirty(false)
      const errs = r.open_issues.xml?.error ?? 0
      toast.success(`Saved as JATS XML v${r.file.version}. ${errs ? `${errs} DTD error${errs > 1 ? 's' : ''} to fix.` : 'Valid against the JATS 1.3 DTD.'}`)
      onSaved?.()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save the XML'))
    } finally {
      setSaving(false)
    }
  }

  const format = () => {
    if (!wellFormed.ok) { toast.error('Fix the syntax error before formatting.'); return }
    setContent(formatXmlString(content))
    setDirty(true)
  }

  const evaluateXPath = () => {
    setXpathError(null)
    setXpathResults([])
    try {
      const doc = new DOMParser().parseFromString(content, 'application/xml')
      if (doc.getElementsByTagName('parsererror')[0]) throw new Error('XML is not well-formed. Fix syntax errors before running XPath queries.')
      const result = doc.evaluate(xpathQuery, doc, doc.createNSResolver(doc.documentElement || doc), XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
      const lines = content.split('\n')
      const matches: { line: number; tagName: string; text: string }[] = []
      for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i)
        if (!node) continue
        let tagName = node.nodeName || 'Match'
        let text = node.textContent?.trim() || ''
        if (node.nodeType === Node.ATTRIBUTE_NODE) { tagName = `@${(node as Attr).name}`; text = (node as Attr).value }
        const first = node.nodeType === Node.ELEMENT_NODE ? (node as Element).outerHTML.split('\n')[0].trim() : text
        const idx = lines.findIndex(l => l.includes(first) || (!!text && l.includes(text)))
        matches.push({ line: idx >= 0 ? idx + 1 : 1, tagName, text })
      }
      setXpathResults(matches)
      toast.success(`XPath: ${matches.length} match${matches.length === 1 ? '' : 'es'}`)
    } catch (err) {
      setXpathError(err instanceof Error ? err.message : 'XPath evaluation failed')
    }
  }

  if (loading && !file) {
    return <div className="flex items-center justify-center text-sm text-muted gap-2" style={{ height }}><Loader2 className="size-4 animate-spin" /> Loading JATS XML…</div>
  }

  return (
    <div className="flex w-full overflow-hidden bg-white text-gray-800" style={{ height }}>
      {showOutline && (
        <div className="w-60 h-full border-r border-gray-200 flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wider">Document Outline</div>
          <div className="flex-1 overflow-auto p-2">
            {outline.length === 0
              ? <div className="text-gray-400 text-center py-4 text-xs">No elements found</div>
              : outline.map((node, i) => <OutlineNode key={i} node={node} onSelect={goToLine} />)}
          </div>
        </div>
      )}

      <div className={cn(showLog ? 'w-1/2' : 'flex-1', 'min-w-0 h-full border-r border-gray-200 flex flex-col overflow-hidden flex-1')}>
        <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs flex flex-wrap items-center gap-1.5 flex-shrink-0 select-none">
          <span className="font-semibold text-gray-700 uppercase tracking-wider">XML Source</span>
          {file && <span className="text-[11px] text-gray-500 font-mono">{file.filename} · v{file.version}</span>}
          {dirty && <span className="text-amber-600 text-[11px]">Unsaved changes</span>}
          <span className={cn('rounded-full px-2 text-[10px] font-semibold', errorCount ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
            {errorCount ? `${errorCount} DTD error${errorCount > 1 ? 's' : ''}` : 'DTD valid'}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setShowOutline(v => !v)} className={cn(btn, showOutline ? btnOn : btnOff)}>Outline</button>
            <button type="button"
                    onClick={() => wellFormed.ok ? toast.success('✓ XML is well-formed') : (wellFormed.line && goToLine(wellFormed.line), toast.error(`✗ Syntax error${wellFormed.line ? ` on line ${wellFormed.line}` : ''}`))}
                    className={cn(btn, wellFormed.ok ? btnOff : 'bg-red-50 text-red-700 border-red-200 font-semibold')}>
              Check Well-Formedness
            </button>
            <button type="button" onClick={format} className={cn(btn, btnOff)}>Format XML</button>
            <button type="button" onClick={() => { validate().catch(() => undefined) }} disabled={validating} className={cn(btn, 'bg-indigo-50 text-indigo-800 border-indigo-300 hover:bg-indigo-100 disabled:opacity-50')}>
              {validating ? 'Validating…' : 'Validate (JATS DTD)'}
            </button>
            <button type="button" onClick={() => setShowLog(v => !v)} className={cn(btn, showLog ? btnOff : 'bg-amber-50 text-amber-700 border-amber-200')}>
              {showLog ? 'Hide Log' : 'Show Log'}
            </button>
            {file && (
              <a href={journalsApi.fileUrl(articleId, file.id)} className={cn(btn, btnOff, 'inline-flex items-center gap-1')}>
                <Download className="size-3" /> Download
              </a>
            )}
            <button type="button" onClick={save} disabled={!dirty || saving}
                    className="px-2.5 py-0.5 rounded text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
              {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} Save
            </button>
          </div>
        </div>
        <SourceEditor
          ref={editorRef}
          value={content}
          onChange={v => { setContent(v); setDirty(true) }}
          errors={lintErrors}
          onSave={save}
          onDtdValidate={validate}
          dtdLabel="JATS 1.3 DTD"
          className="flex-1 min-h-0"
        />
      </div>

      {showLog && (
        <div className="w-[38%] min-w-[320px] h-full flex flex-col bg-gray-50 overflow-hidden">
          <div className="flex bg-gray-100 border-b border-gray-200 h-9 flex-shrink-0 select-none">
            {(['log', 'xpath'] as const).map(t => (
              <button key={t} type="button" onClick={() => setRightTab(t)}
                      className={cn('flex-1 text-[11px] font-semibold uppercase tracking-wider border-b-2',
                        rightTab === t ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-50')}>
                {t === 'log' ? `Validation Log${findings.length ? ` (${findings.length})` : ''}` : 'XPath Evaluator'}
              </button>
            ))}
          </div>
          {rightTab === 'log' ? (
            <SourceEditor value={logText} onChange={() => {}} readOnly onLogLineClick={goToLine} className="flex-1 min-h-0 bg-gray-50" />
          ) : (
            <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden bg-white">
              <div className="flex gap-2">
                <input value={xpathQuery} onChange={e => setXpathQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') evaluateXPath() }}
                       placeholder="e.g. //ref or //xref[@ref-type='bibr']" aria-label="XPath query"
                       className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
                <button type="button" onClick={evaluateXPath} className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg">Evaluate</button>
              </div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Matches</div>
              <div className="flex-1 border border-gray-200 rounded-lg overflow-y-auto bg-gray-50 font-mono text-[11px]">
                {xpathError ? <div className="p-3 text-red-600">{xpathError}</div>
                  : xpathResults.length === 0 ? <div className="p-3 text-gray-400 text-center text-xs font-sans">Enter an XPath query and click Evaluate</div>
                  : xpathResults.map((m, i) => (
                    <button key={i} type="button" onClick={() => goToLine(m.line)} className="w-full text-left p-2 border-b border-gray-200 hover:bg-gray-100 flex flex-col gap-0.5">
                      <span className="text-blue-700 font-semibold">&lt;{m.tagName}&gt; (Line {m.line})</span>
                      <span className="text-gray-600 truncate">{m.text || '(empty)'}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
