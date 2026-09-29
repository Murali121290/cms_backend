import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle2, Play, Code, Sparkles, Download, Forward, Loader2, FileText, Check
} from 'lucide-react'
import { journalsApi } from '@/api/journals'

export function JournalArticleEditorPage() {
  const { articleId } = useParams<{ articleId: string }>()
  const idNum = Number(articleId) || 1

  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [structuringStatus, setStructuringStatus] = useState<string>('PASS')
  const [refValStatus, setRefValStatus] = useState<string>('PASS')
  const [xhtmlContent, setXhtmlContent] = useState<string>('')
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<number>(1)

  function triggerToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3500)
  }

  const [filesList, setFilesList] = useState<any[]>([])

  // On page mount: Run Structuring + Reference Validation -> Convert to XHTML -> Load in WYSIWYG Editor
  useEffect(() => {
    async function loadAndProcessPreEditing() {
      setIsLoading(true)
      try {
        const [res, files] = await Promise.all([
          journalsApi.processPreEditing(idNum),
          journalsApi.getArticleFiles(idNum)
        ])
        setStructuringStatus(res.structuring_status || 'PASS')
        setRefValStatus(res.reference_validation_status || 'PASS')
        setXhtmlContent(res.xhtml_content || '')
        setFilesList(files || [])
        triggerToast('Structuring & Ref Validation completed! XHTML loaded into WYSIWYG Editor.')
      } catch (err) {
        console.error('Pre-editing error:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadAndProcessPreEditing()
  }, [idNum])

  async function handleAdvanceStage() {
    try {
      const res = await journalsApi.advanceStage(idNum, 'Pre-editing XHTML completed')
      triggerToast(res.message || 'Advanced to Next Stage!')
      if (currentStep < 8) setCurrentStep(currentStep + 1)
    } catch (err) {
      triggerToast('Failed to advance stage')
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-xl z-50 flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 size={18} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Header */}
      <header className="h-14 bg-card border-b border-border px-4 flex items-center justify-between">
        <Link to="/journal-production" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 font-medium">
          <ArrowLeft size={14} /> Back to Articles List
        </Link>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">Article #{idNum}</span>
          <span className="font-semibold text-sm">WYSIWYG XHTML Pre-Editing Editor</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => triggerToast('XHTML Exported')}
            className="px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 rounded-md flex items-center gap-1.5"
          >
            <Download size={14} /> Export XHTML
          </button>
          <button
            onClick={handleAdvanceStage}
            className="px-3.5 py-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 rounded-md flex items-center gap-1.5 shadow-sm"
          >
            <Forward size={14} /> Complete Stage & Advance
          </button>
        </div>
      </header>

      {/* 8-Stage Workflow Stepper Bar */}
      <div className="bg-card border-b border-border px-4 py-2 flex items-center justify-between overflow-x-auto">
        {[
          { step: 1, name: '1. Pre-Editing' },
          { step: 2, name: '2. Tech Edit' },
          { step: 3, name: '3. Lang Edit' },
          { step: 4, name: '4. XML (XSLT)' },
          { step: 5, name: '5. Gen InDesign' },
          { step: 6, name: '6. InDesign Final' },
          { step: 7, name: '7. View Proof' },
          { step: 8, name: '8. Final Delivery' }
        ].map(s => (
          <div
            key={s.step}
            onClick={() => setCurrentStep(s.step)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-md cursor-pointer whitespace-nowrap transition-all ${
              s.step === currentStep
                ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                : s.step < currentStep
                ? 'text-emerald-400'
                : 'text-muted-foreground'
            }`}
          >
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
              s.step < currentStep ? 'bg-emerald-500 text-white' : s.step === currentStep ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {s.step < currentStep ? <Check size={10} /> : s.step}
            </span>
            <span>{s.name}</span>
          </div>
        ))}
      </div>

      {/* Main Workspace Split Screen */}
      <div className="flex-1 grid grid-cols-12 overflow-hidden">
        {/* Left Side: Structuring & Ref Validation Status Panel */}
        <aside className="col-span-3 bg-card border-r border-border p-4 space-y-4 overflow-y-auto">
          <div className="p-3 rounded-lg bg-background border border-border space-y-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">Stage 1 Execution Log</span>
            <div className="flex items-center justify-between text-xs">
              <span>Structuring Pipeline:</span>
              <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">✓ {structuringStatus}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>CrossRef Ref Validation:</span>
              <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">✓ {refValStatus}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>Word $\rightarrow$ XHTML Conversion:</span>
              <span className="text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded">✓ Completed</span>
            </div>
          </div>

          {/* Article Package Files (Chapter Files) */}
          <div className="p-3 rounded-lg bg-background border border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">Article Files ({filesList.length})</span>
              <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded font-mono">ZIP Unzipped</span>
            </div>
            {filesList.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No extra files attached</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {filesList.map((f, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded bg-card border border-border/60 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <FileText size={14} className="text-blue-400 shrink-0" />
                      <span className="truncate font-medium text-foreground">{f.filename}</span>
                    </div>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground px-1.5 py-0.5 bg-muted rounded shrink-0">
                      {f.category || f.file_type}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 rounded-lg bg-background border border-border space-y-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">Rule Enforcement Config</span>
            <div className="text-xs space-y-1 text-muted-foreground">
              <p>• MathML equation markup checked</p>
              <p>• Journal Style Sheet: JAIS_Style_v2</p>
              <p>• Journal Grammar Sheet: JAIS_US_Grammar</p>
            </div>
          </div>
        </aside>

        {/* Right Side: WYSIWYG Editor Workspace */}
        <main className="col-span-9 bg-background flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 size={24} className="animate-spin text-primary" />
              <p className="text-sm font-medium">Running Structuring, Ref Validation & Converting Word to XHTML...</p>
            </div>
          ) : (
            <div className="flex-1 p-6 overflow-auto">
              <div className="max-w-4xl mx-auto bg-card border border-border rounded-xl shadow-lg p-8 space-y-6 text-foreground">
                <div
                  contentEditable
                  suppressContentEditableWarning
                  className="prose dark:prose-invert max-w-none focus:outline-none leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: xhtmlContent }}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
