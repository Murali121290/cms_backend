import { useState, useEffect } from 'react'
import {
  FileText, CheckCircle2, AlertTriangle, AlertCircle, Download,
  ExternalLink, RefreshCw, ShieldCheck, HelpCircle, ArrowRight,
  BookOpen, Sparkles, Layers, Image as ImageIcon, ChevronRight, Edit3,
  Sliders, Send, CheckCircle, XCircle, Award, Tag
} from 'lucide-react'
import type { ArticleWorkspace, MsAnalysisState, AuthorQuery, ChecklistItem, EditorialScreeningData } from '@/api/journals'
import { journalsApi } from '@/api/journals'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'

interface Props {
  workspace: ArticleWorkspace
  onRunAnalysis: () => Promise<void>
  onCompleteStage: () => Promise<void>
  onReload: () => Promise<void>
  onViewElog: () => void
  isBusy: boolean
}

const ARTICLE_TYPES = [
  'Original Article',
  'Review Article',
  'Systematic Review & Meta-Analysis',
  'Case Report',
  'Short Communication',
  'Editorial',
  'Letter to Editor',
  'Methodology',
  'Clinical Trial'
]

export function Stage1MsAnalysisWorkspace({
  workspace,
  onRunAnalysis,
  onCompleteStage,
  onReload,
  onViewElog,
  isBusy
}: Props) {
  const { article, journal, ms_analysis } = workspace
  const analysis = ms_analysis

  const [activeTab, setActiveTab] = useState<'screening' | 'declarations' | 'assets' | 'queries' | 'language'>('screening')
  const [leModalOpen, setLeModalOpen] = useState(false)
  const [selectedLeLevel, setSelectedLeLevel] = useState<string>(
    article.le_level ?? ms_analysis?.le_chosen_level ?? 'Level 2 – Medium'
  )
  const [leReason, setLeReason] = useState('')
  const [savingLe, setSavingLe] = useState(false)

  // TRTA State
  const [trtaModalOpen, setTrtaModalOpen] = useState(false)
  const [trtaReason, setTrtaReason] = useState('')
  const [isTrtaBusy, setIsTrtaBusy] = useState(false)

  // Editorial Screening Form State
  const screening = analysis?.editorial_screening

  const [scopeAligned, setScopeAligned] = useState<boolean>(screening?.scope_aligned ?? true)
  const [scopeNotes, setScopeNotes] = useState<string>(
    screening?.scope_notes ?? 'Manuscript fits the aims and scope of the journal.'
  )
  const [articleType, setArticleType] = useState<string>(
    screening?.article_type ?? article.complexity_level ?? 'Original Article'
  )
  const [similarityPct, setSimilarityPct] = useState<number>(screening?.similarity_percentage ?? 12)
  const [peerReviewStatus, setPeerReviewStatus] = useState<string>(
    screening?.peer_review_status ?? 'Accepted for Production'
  )
  const [ethicsClearance, setEthicsClearance] = useState<boolean>(
    screening?.ethics_clearance_confirmed ?? true
  )
  const [savingScreening, setSavingScreening] = useState(false)

  // Sync state when analysis updates
  useEffect(() => {
    if (analysis?.editorial_screening) {
      const sc = analysis.editorial_screening
      setScopeAligned(sc.scope_aligned ?? true)
      setScopeNotes(sc.scope_notes ?? 'Manuscript fits the aims and scope of the journal.')
      setArticleType(sc.article_type ?? 'Original Article')
      setSimilarityPct(sc.similarity_percentage ?? 12)
      setPeerReviewStatus(sc.peer_review_status ?? 'Accepted for Production')
      setEthicsClearance(sc.ethics_clearance_confirmed ?? true)
    }
  }, [analysis?.editorial_screening])

  const handleSaveLeLevel = async () => {
    setSavingLe(true)
    try {
      await journalsApi.setLeLevel(article.id, selectedLeLevel, leReason || undefined)
      toast.success(`Language Editing level updated to ${selectedLeLevel}`)
      setLeModalOpen(false)
      await onReload()
    } catch (err) {
      toast.error('Failed to update Language Editing level')
    } finally {
      setSavingLe(false)
    }
  }

  const handleSaveScreening = async () => {
    setSavingScreening(true)
    try {
      await journalsApi.updateEditorialScreening(article.id, {
        scope_aligned: scopeAligned,
        scope_notes: scopeNotes,
        article_type: articleType,
        similarity_percentage: similarityPct,
        peer_review_status: peerReviewStatus,
        ethics_clearance_confirmed: ethicsClearance,
        intake_status: scopeAligned ? 'Cleared for Production' : 'Requires Scope Clarification'
      })
      toast.success('Editorial screening parameters & ELOG updated')
      await onReload()
    } catch (err) {
      toast.error('Failed to update editorial screening')
    } finally {
      setSavingScreening(false)
    }
  }

  const handleTriggerTrta = async () => {
    setIsTrtaBusy(true)
    try {
      const res = await journalsApi.triggerTrta(article.id, trtaReason || undefined)
      toast.success(res.message)
      setTrtaModalOpen(false)
      await onReload()
    } catch (err) {
      toast.error('Failed to initiate Return to Author')
    } finally {
      setIsTrtaBusy(false)
    }
  }

  if (!analysis) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50 text-slate-800">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <div className="size-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <Sparkles className="size-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Stage 1: Submission Intake & MS Analysis</h2>
          <p className="text-xs text-slate-500">
            Automated technical check and editorial screening have not run for this manuscript yet. Run analysis to extract word counts, check declarations compliance, preflight artwork resolution (≥300 DPI), screen scope & similarity, and generate the official ELOG dossier.
          </p>
          <Button onClick={onRunAnalysis} isLoading={isBusy} variant="primary" className="w-full">
            Run Intake Technical Check & Generate ELOG
          </Button>
        </div>
      </div>
    )
  }

  const declCount = Object.values(analysis.declarations || {}).filter(d => d.present).length
  const totalDecls = Object.keys(analysis.declarations || {}).length
  const missingArtCount = (analysis.figures || []).filter(f => f.status === 'missing_file').length
  const lowResArtCount = (analysis.figures || []).filter(f => f.is_low_res).length
  const uncalledArtCount = (analysis.uncalled_art_files || []).length
  const isTrta = screening?.intake_status?.includes('TRTA') || screening?.intake_status?.includes('Return')
  const hasCriticalDeficiencies =
    missingArtCount > 0 || lowResArtCount > 0 || totalDecls - declCount > 0 || similarityPct > 25 || !scopeAligned

  const itaScore = analysis.ita_compliance?.score ?? 0
  const itaVerdict = analysis.ita_compliance?.verdict ?? 'Under Review'
  const itaBadge = analysis.ita_compliance?.verdict_badge ?? 'Evaluation'
  const itaBadgeColor =
    itaScore >= 80
      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
      : itaScore >= 60
      ? 'bg-amber-50 text-amber-700 border-amber-300'
      : 'bg-rose-50 text-rose-700 border-rose-300'
  const itaBarColor =
    itaScore >= 80 ? 'bg-emerald-500' : itaScore >= 60 ? 'bg-amber-500' : 'bg-rose-500'

  const leBadgeColor =
    analysis.le_chosen_level.includes('Light') || analysis.le_chosen_level.includes('1')
      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
      : analysis.le_chosen_level.includes('Medium') || analysis.le_chosen_level.includes('2')
      ? 'bg-amber-50 text-amber-700 border-amber-300'
      : 'bg-rose-50 text-rose-700 border-rose-300'

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50/70 text-slate-800 overflow-y-auto">
      <div className="w-full p-6 space-y-6">

        {/* TRTA Banner (if active) */}
        {isTrta && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <AlertCircle className="size-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-rose-900 flex items-center gap-2">
                  <span>Technical Return to Author (TRTA) Recorded</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-200/80 text-rose-800">
                    {screening?.trta_timestamp ? new Date(screening.trta_timestamp).toLocaleString() : 'Active'}
                  </span>
                </div>
                <div className="text-xs text-rose-700 mt-0.5">
                  Reason: {screening?.trta_reason || 'Deficiencies detected during intake preflight.'}
                </div>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={onViewElog}>
              View ELOG Dossier
            </Button>
          </div>
        )}

        {/* Intake Deficiencies Warning Banner (if deficiencies exist and not yet TRTA) */}
        {!isTrta && hasCriticalDeficiencies && (
          <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-amber-900 flex items-center gap-2">
                  <span>Intake Screening: Deficiencies Flagged for Author Resolution</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800">
                    {analysis.author_queries.length} Queries Logged
                  </span>
                </div>
                <div className="text-xs text-amber-800 mt-0.5">
                  {missingArtCount > 0 && `${missingArtCount} missing artwork, `}
                  {lowResArtCount > 0 && `${lowResArtCount} low-resolution (<300 DPI) images, `}
                  {totalDecls - declCount > 0 && `${totalDecls - declCount} missing declarations, `}
                  {similarityPct > 25 && `${similarityPct}% similarity (>25%), `}
                  {!scopeAligned && 'Scope alignment clarification required.'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="border-amber-300 text-amber-900 hover:bg-amber-100"
                onClick={() => {
                  setTrtaReason(
                    `Deficiencies detected: ${missingArtCount > 0 ? `${missingArtCount} missing artwork, ` : ''}${lowResArtCount > 0 ? `${lowResArtCount} low-res (<300 DPI) figures, ` : ''}${totalDecls - declCount > 0 ? `${totalDecls - declCount} declarations missing` : ''}`
                  )
                  setTrtaModalOpen(true)
                }}
              >
                Initiate Return to Author (TRTA)
              </Button>
              <Button size="sm" variant="secondary" onClick={onViewElog}>
                View ELOG Dossier
              </Button>
            </div>
          </div>
        )}

        {/* Metric Cards Grid - 8 KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <BookOpen className="size-3.5 text-sky-500" />
              <span>Word Count</span>
            </div>
            <div className="text-xl font-extrabold text-slate-900">{analysis.word_count.toLocaleString()}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">~{analysis.estimated_pages} pgs · {analysis.paragraphs_count} paras</div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <Award className="size-3.5 text-emerald-600" />
              <span>ITA Intake Score</span>
            </div>
            <div className="text-xl font-extrabold text-slate-900 flex items-center gap-1.5">
              <span>{itaScore}%</span>
              <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full border', itaBadgeColor)}>
                {itaBadge}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5 truncate">
              {itaScore >= 80 ? 'Ready for Production' : itaScore >= 60 ? 'Revisions Required' : 'TRTA Recommended'}
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <FileText className="size-3.5 text-blue-500" />
              <span>Front Matter</span>
            </div>
            <div className="text-base font-extrabold text-slate-900 mt-0.5 truncate">
              {analysis.abstract_words || 0}w <span className="text-xs font-normal text-slate-400">abs</span> · {analysis.keywords_count || 0} <span className="text-xs font-normal text-slate-400">kw</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1 truncate">
              Title: <strong className={analysis.title_length && analysis.title_length > 120 ? 'text-amber-600' : 'text-slate-700'}>{analysis.title_length || 0}</strong>/120 chars
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-purple-500" />
              <span>Advisory LE Level</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border truncate', leBadgeColor)}>
                {analysis.le_chosen_level}
              </span>
              <button
                type="button"
                onClick={() => setLeModalOpen(true)}
                className="text-[10px] text-primary hover:underline font-semibold ml-auto shrink-0"
                title="Change Level"
              >
                Edit
              </button>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Density: <strong className="text-slate-700">{analysis.le_density}</strong>/1k
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <Sliders className="size-3.5 text-indigo-500" />
              <span>Scope &amp; Similarity</span>
            </div>
            <div className="text-base font-extrabold text-slate-900 mt-0.5 flex items-center gap-1.5">
              {scopeAligned ? (
                <span className="text-emerald-600 flex items-center gap-1 text-xs">
                  <CheckCircle className="size-3.5" /> Aligned
                </span>
              ) : (
                <span className="text-amber-600 flex items-center gap-1 text-xs">
                  <AlertTriangle className="size-3.5" /> Review
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Similarity: <strong className={similarityPct > 25 ? 'text-rose-600' : 'text-slate-700'}>{similarityPct}%</strong>
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              <span>Declarations</span>
            </div>
            <div className="text-xl font-extrabold text-slate-900">
              {declCount} <span className="text-xs font-normal text-slate-400">/ {totalDecls}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {declCount === totalDecls ? (
                <span className="text-emerald-600 font-semibold">All 5 present</span>
              ) : (
                <span className="text-amber-600 font-semibold">{totalDecls - declCount} missing</span>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <ImageIcon className="size-3.5 text-pink-500" />
              <span>Figures &amp; Tables</span>
            </div>
            <div className="text-base font-extrabold text-slate-900 mt-0.5">
              {analysis.figures.length} <span className="text-xs font-normal text-slate-400">fig</span> · {analysis.tables.length} <span className="text-xs font-normal text-slate-400">tbl</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1 truncate">
              {lowResArtCount > 0 ? (
                <span className="text-amber-600 font-semibold">{lowResArtCount} low-res (&lt;300)</span>
              ) : missingArtCount > 0 ? (
                <span className="text-rose-600 font-semibold">{missingArtCount} missing</span>
              ) : (
                <span className="text-emerald-600 font-semibold">Resolution OK</span>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <Layers className="size-3.5 text-amber-500" />
              <span>Refs &amp; Citations</span>
            </div>
            <div className="text-base font-extrabold text-slate-900 mt-0.5">
              {analysis.references_count} <span className="text-xs font-normal text-slate-400">ref</span> · {analysis.citations_count} <span className="text-xs font-normal text-slate-400">cit</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Ratio: <strong className={analysis.citation_reference_ratio === 0 ? 'text-amber-600' : 'text-slate-700'}>{analysis.citation_reference_ratio ?? 0}</strong> ({analysis.citation_reference_ratio === 0 ? 'uncited' : 'matched'})
            </div>
          </div>
        </div>

        {/* 7-Step Pipeline Checklist Horizontal Cards - Clean White Theme */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span>7-Step Submission Intake & Technical Check Pipeline</span>
            </h2>
            <span className="text-xs text-slate-400 font-medium">PA Editorial Standard · 100% Gated Pre-flight</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-7 gap-2.5">
            {analysis.checklist.map(c => {
              const isPass = c.status === 'pass'
              return (
                <div
                  key={c.step}
                  className={cn(
                    'p-3.5 rounded-xl border flex flex-col justify-between transition-all select-none',
                    isPass
                      ? 'bg-slate-50/70 border-emerald-200 hover:border-emerald-300'
                      : 'bg-amber-50/40 border-amber-200 hover:border-amber-300'
                  )}
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="text-[10px] font-mono font-bold text-slate-400">Step {c.step}</span>
                    {isPass ? (
                      <span className="size-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">
                        ✓
                      </span>
                    ) : (
                      <span className="size-4 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-bold">
                        !
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-bold text-slate-800 leading-tight mb-1.5">{c.title}</div>
                  <div className="text-[11px] text-slate-500 line-clamp-2 mt-auto leading-relaxed">{c.details}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Detail Tabs - Clean White Theme */}
        <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
          <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-2.5 flex items-center gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('screening')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0',
                activeTab === 'screening'
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              <Sliders className="size-3.5 text-indigo-600" />
              <span>Editorial Scope & Quality</span>
            </button>
            <button
              onClick={() => setActiveTab('declarations')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0',
                activeTab === 'declarations'
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              <ShieldCheck className="size-3.5 text-emerald-600" />
              <span>Mandatory Declarations ({declCount}/{totalDecls})</span>
            </button>
            <button
              onClick={() => setActiveTab('assets')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0',
                activeTab === 'assets'
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              <ImageIcon className="size-3.5 text-pink-600" />
              <span>Artwork & Figures ({analysis.figures.length})</span>
              {lowResArtCount > 0 && (
                <span className="size-2 rounded-full bg-amber-500 animate-pulse" title="Low resolution artwork detected" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('queries')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0',
                activeTab === 'queries'
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              <HelpCircle className="size-3.5 text-indigo-600" />
              <span>Author Queries ({analysis.author_queries.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('language')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0',
                activeTab === 'language'
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              <Sparkles className="size-3.5 text-purple-600" />
              <span>Language Editing Density ({analysis.le_density}/1k)</span>
            </button>
          </div>

          <div className="p-6">
            {/* Tab 1: Editorial Scope & Quality Screening */}
            {activeTab === 'screening' && (
              <div className="space-y-6">
                {/* 100-Point Instructions to Authors (ITA) Compliance & Gap Analysis Dashboard */}
                <div className="bg-slate-50/70 border border-slate-200 rounded-2xl p-5 space-y-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                        <Award className="size-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            Instructions to Authors (ITA) 100-Point Compliance &amp; Gap Analysis
                          </h3>
                          <span className={cn('text-xs font-bold px-2.5 py-0.5 rounded-full border', itaBadgeColor)}>
                            {itaScore}% · {itaVerdict}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Weighted evaluation benchmarked to PA Editorial &amp; Taylor &amp; Francis criteria: Front Matter (20%), Body Text (40%), Figures (15%), Tables (10%), References (15%).
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={onViewElog}>
                        <FileText className="size-3.5 mr-1 text-slate-500" />
                        Printable ELOG Dossier
                      </Button>
                    </div>
                  </div>

                  {/* Progress Bar with Gate Markings */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-semibold text-slate-700">
                      <span>Overall Manuscript Intake Compliance: <strong className="text-slate-900">{itaScore} / 100 points</strong></span>
                      <span className="text-[11px] text-slate-500">Threshold: ≥80 Accepted · 60–79 Revisions · &lt;60 TRTA</span>
                    </div>
                    <div className="relative w-full bg-slate-200 rounded-full h-3.5 overflow-hidden">
                      <div
                        className={cn('h-full transition-all duration-500 rounded-full', itaBarColor)}
                        style={{ width: `${Math.min(100, Math.max(5, itaScore))}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 font-medium px-1">
                      <span>0% (Desk Reject)</span>
                      <span className="text-rose-500 font-semibold">&lt; 60% TRTA Gate</span>
                      <span className="text-amber-600 font-semibold">60% Revisions Gate</span>
                      <span className="text-emerald-600 font-semibold">≥ 80% Production Ready</span>
                      <span>100%</span>
                    </div>
                  </div>

                  {/* 5 Component Breakdown Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-1">
                    {/* Front Matter (20%) */}
                    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Front Matter</span>
                        <span className="text-xs font-bold text-slate-900">
                          {analysis.ita_compliance?.breakdown.front_matter.score ?? 0} <span className="text-[10px] font-normal text-slate-400">/ 20</span>
                        </span>
                      </div>
                      <div className="text-xs space-y-1 text-slate-600">
                        <div className="flex justify-between items-center">
                          <span>Title Length:</span>
                          <span className={cn('font-semibold text-[11px]', (analysis.title_length || 0) <= 10 || analysis.ita_compliance?.metrics?.is_type_flag ? 'text-amber-700' : (analysis.title_length || 0) <= 120 ? 'text-emerald-700' : 'text-amber-700')}>
                            {(analysis.title_length || 0) <= 10 || analysis.ita_compliance?.metrics?.is_type_flag ? `${analysis.title_length || 0}c (Type Flagged)` : `${analysis.title_length || 0} / 120c`}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Abstract Words:</span>
                          <span className={cn('font-semibold text-[11px]', (analysis.abstract_words || 0) <= (analysis.ita_compliance?.metrics?.max_abstract_words || 120) ? 'text-emerald-700' : 'text-amber-700')}>
                            {analysis.abstract_words || 0} / {analysis.ita_compliance?.metrics?.max_abstract_words || 120}w
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Keywords:</span>
                          <span className={cn('font-semibold text-[11px]', (analysis.keywords_count || 0) >= 3 ? 'text-emerald-700' : 'text-amber-700')}>
                            {analysis.keywords_count || 0} (req 5–10)
                          </span>
                        </div>
                      </div>
                      {analysis.keywords && analysis.keywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-100">
                          {analysis.keywords.slice(0, 5).map((kw, i) => (
                            <span key={i} className="text-[9px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]">
                              {kw}
                            </span>
                          ))}
                          {analysis.keywords.length > 5 && (
                            <span className="text-[9px] text-slate-400 font-semibold self-center">
                              +{analysis.keywords.length - 5}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="text-[10px] text-amber-700 bg-amber-50 rounded p-1 font-medium border border-amber-200/60">
                          ⚠ 0 keywords found
                        </div>
                      )}
                    </div>

                    {/* Body Text (40%) */}
                    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Body Text</span>
                        <span className="text-xs font-bold text-slate-900">
                          {analysis.ita_compliance?.breakdown.body_text.score ?? 0} <span className="text-[10px] font-normal text-slate-400">/ 40</span>
                        </span>
                      </div>
                      <div className="text-xs space-y-1 text-slate-600">
                        <div className="flex justify-between items-center">
                          <span>Word Count:</span>
                          <span className="font-semibold text-[11px] text-slate-800">
                            {analysis.word_count.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Target Range:</span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {analysis.ita_compliance?.metrics?.min_words || 1500}–{analysis.ita_compliance?.metrics?.max_words || 6500}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Declarations:</span>
                          <span className={cn('font-semibold text-[11px]', declCount === totalDecls ? 'text-emerald-700' : 'text-amber-700')}>
                            {declCount} / {totalDecls} ({declCount * 3}/15 pts)
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                        IMRAD Sections: <strong>{Object.values(analysis.imrad_sections || {}).filter(Boolean).length}/7</strong> detected
                      </div>
                    </div>

                    {/* Figures & Artwork (15%) */}
                    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Figures &amp; Art</span>
                        <span className="text-xs font-bold text-slate-900">
                          {analysis.ita_compliance?.breakdown.figures.score ?? 0} <span className="text-[10px] font-normal text-slate-400">/ 15</span>
                        </span>
                      </div>
                      <div className="text-xs space-y-1 text-slate-600">
                        <div className="flex justify-between items-center">
                          <span>Figures Called:</span>
                          <span className="font-semibold text-[11px] text-slate-800">{analysis.figures.length}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Missing Files:</span>
                          <span className={cn('font-semibold text-[11px]', missingArtCount === 0 ? 'text-emerald-700' : 'text-rose-700')}>
                            {missingArtCount}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Low-Res (&lt;300 DPI):</span>
                          <span className={cn('font-semibold text-[11px]', lowResArtCount === 0 ? 'text-emerald-700' : 'text-amber-700')}>
                            {lowResArtCount}
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                        Uncalled Art Files: <strong>{uncalledArtCount}</strong>
                      </div>
                    </div>

                    {/* Tables (10%) */}
                    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tables</span>
                        <span className="text-xs font-bold text-slate-900">
                          {analysis.ita_compliance?.breakdown.tables.score ?? 0} <span className="text-[10px] font-normal text-slate-400">/ 10</span>
                        </span>
                      </div>
                      <div className="text-xs space-y-1 text-slate-600">
                        <div className="flex justify-between items-center">
                          <span>Tables Called:</span>
                          <span className="font-semibold text-[11px] text-slate-800">{analysis.tables.length}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Sequential Call:</span>
                          <span className="font-semibold text-[11px] text-emerald-700">✓ Verified</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Format Check:</span>
                          <span className="font-semibold text-[11px] text-slate-700">Editable JATS</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                        Non-redundant with figures
                      </div>
                    </div>

                    {/* References & Citations (15%) */}
                    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">References</span>
                        <span className="text-xs font-bold text-slate-900">
                          {analysis.ita_compliance?.breakdown.references.score ?? 0} <span className="text-[10px] font-normal text-slate-400">/ 15</span>
                        </span>
                      </div>
                      <div className="text-xs space-y-1 text-slate-600">
                        <div className="flex justify-between items-center">
                          <span>Bibliography:</span>
                          <span className="font-semibold text-[11px] text-slate-800">{analysis.references_count}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Citations (Text &amp; Tbl):</span>
                          <span className="font-semibold text-[11px] text-slate-800">{analysis.citations_count}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Citation Ratio:</span>
                          <span className={cn('font-semibold text-[11px]', (analysis.citation_reference_ratio ?? 0) >= 0.5 ? 'text-emerald-700' : 'text-amber-700')}>
                            {analysis.citation_reference_ratio ?? 0}
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 truncate">
                        {analysis.citation_reference_ratio === 0 ? (
                          <span className="text-amber-700 font-semibold">⚠ 0 citations called</span>
                        ) : (
                          <span>Text &amp; Table citations balanced</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Identified Gap Analysis Summary Table */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mt-3">
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="size-3.5 text-primary" />
                        <span>Manuscript Gap Analysis vs Journal ITA Requirements</span>
                      </span>
                      <span className="text-[11px] text-slate-500">Automated Intake Audit</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50/50 text-slate-600 uppercase text-[10px] font-bold border-b border-slate-200">
                          <tr>
                            <th className="px-3.5 py-2">Parameter</th>
                            <th className="px-3.5 py-2">Required by ITA</th>
                            <th className="px-3.5 py-2">Found in Manuscript</th>
                            <th className="px-3.5 py-2 w-28 text-center">Status</th>
                            <th className="px-3.5 py-2">Automated Action / Author Query</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[11px]">
                          <tr>
                            <td className="px-3.5 py-2 font-semibold text-slate-800">Article Title</td>
                            <td className="px-3.5 py-2 text-slate-500">Full title (≤ 120 chars, not article classification)</td>
                            <td className="px-3.5 py-2 text-slate-700">
                              <span className="font-semibold text-slate-900 block truncate max-w-[280px]" title={analysis.title}>
                                {analysis.title}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500">
                                {analysis.title_length || 0} characters
                              </span>
                            </td>
                            <td className="px-3.5 py-2 text-center">
                              {(analysis.title_length || 0) <= 10 || analysis.ita_compliance?.metrics?.is_type_flag ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Gap Flagged</span>
                              ) : (analysis.title_length || 0) <= 120 ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Pass</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Gap Flagged</span>
                              )}
                            </td>
                            <td className="px-3.5 py-2 text-slate-600">
                              {(analysis.title_length || 0) <= 10 || analysis.ita_compliance?.metrics?.is_type_flag ? (
                                <span className="text-amber-700 font-medium">
                                  Title appears to be an article classification ('{analysis.title}') rather than full manuscript title. Full title required.
                                </span>
                              ) : (analysis.title_length || 0) <= 120 ? (
                                `Within permissible limit (${analysis.title_length || 0} / 120 chars)`
                              ) : (
                                'AQ logged: title exceeds 120 characters - shorten title or provide running head'
                              )}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3.5 py-2 font-semibold text-slate-800">Abstract Length</td>
                            <td className="px-3.5 py-2 text-slate-500">≤ {analysis.ita_compliance?.metrics?.max_abstract_words || 120} words</td>
                            <td className="px-3.5 py-2 text-slate-700 font-mono">{analysis.abstract_words || 0} words</td>
                            <td className="px-3.5 py-2 text-center">
                              {(analysis.abstract_words || 0) <= (analysis.ita_compliance?.metrics?.max_abstract_words || 120) ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Pass</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Gap Flagged</span>
                              )}
                            </td>
                            <td className="px-3.5 py-2 text-slate-600">
                              {(analysis.abstract_words || 0) <= (analysis.ita_compliance?.metrics?.max_abstract_words || 120)
                                ? 'Within permissible limits'
                                : `AQ logged to condense abstract from ${analysis.abstract_words} words to ≤ 120 words`}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3.5 py-2 font-semibold text-slate-800">Keywords for Indexing</td>
                            <td className="px-3.5 py-2 text-slate-500">5–10 keywords (min 3)</td>
                            <td className="px-3.5 py-2 text-slate-700 font-mono">{analysis.keywords_count || 0} keywords found</td>
                            <td className="px-3.5 py-2 text-center">
                              {(analysis.keywords_count || 0) >= 3 ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Pass</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Gap Flagged</span>
                              )}
                            </td>
                            <td className="px-3.5 py-2 text-slate-600">
                              {(analysis.keywords_count || 0) >= 3 ? 'Sufficient for discoverability' : 'AQ logged requesting 5–10 indexing keywords'}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3.5 py-2 font-semibold text-slate-800">Mandatory Declarations</td>
                            <td className="px-3.5 py-2 text-slate-500">5 statements (Funding, Ethics, Conflicts, Data, Consent)</td>
                            <td className="px-3.5 py-2 text-slate-700 font-mono">{declCount} of {totalDecls} verified</td>
                            <td className="px-3.5 py-2 text-center">
                              {declCount === totalDecls ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Pass</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Gap Flagged</span>
                              )}
                            </td>
                            <td className="px-3.5 py-2 text-slate-600">
                              {declCount === totalDecls ? 'Full ethical compliance' : `AQs logged for ${totalDecls - declCount} missing statement(s)`}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3.5 py-2 font-semibold text-slate-800">Figure Resolution &amp; DPI</td>
                            <td className="px-3.5 py-2 text-slate-500">≥ 300 DPI (no missing art files)</td>
                            <td className="px-3.5 py-2 text-slate-700 font-mono">
                              {analysis.figures.length} called · {lowResArtCount} low-res · {missingArtCount} missing
                            </td>
                            <td className="px-3.5 py-2 text-center">
                              {lowResArtCount === 0 && missingArtCount === 0 ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Pass</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Gap Flagged</span>
                              )}
                            </td>
                            <td className="px-3.5 py-2 text-slate-600">
                              {lowResArtCount === 0 && missingArtCount === 0 ? 'Print preflight approved' : 'AQs logged requesting high-resolution replacement image files'}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3.5 py-2 font-semibold text-slate-800">Citations &amp; References</td>
                            <td className="px-3.5 py-2 text-slate-500">All bibliography cited in text &amp; tables (ratio ≥ 0.5)</td>
                            <td className="px-3.5 py-2 text-slate-700 font-mono">
                              {analysis.references_count} refs · {analysis.citations_count} cit (Ratio: {analysis.citation_reference_ratio ?? 0})
                            </td>
                            <td className="px-3.5 py-2 text-center">
                              {(analysis.citation_reference_ratio ?? 0) >= 0.5 ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Pass</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Gap Flagged</span>
                              )}
                            </td>
                            <td className="px-3.5 py-2 text-slate-600">
                              {analysis.citation_reference_ratio === 0
                                ? 'AQ logged: 0 citations called for reference list'
                                : (analysis.citation_reference_ratio ?? 0) >= 0.5
                                ? `Balanced callouts across text & tables (${analysis.citations_count}/${analysis.references_count} cited)`
                                : 'AQ logged for uncited reference items'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Editorial Screening: Aims, Scope, Article Type & Academic Quality
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Formal editorial pre-flight screening to ensure journal suitability, ethical clearance, and similarity index compliance before technical processing.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="border-rose-300 text-rose-700 hover:bg-rose-50"
                      onClick={() => {
                        setTrtaReason(
                          `Deficiencies detected: ${missingArtCount > 0 ? `${missingArtCount} missing artwork, ` : ''}${lowResArtCount > 0 ? `${lowResArtCount} low-res (<300 DPI) figures, ` : ''}${totalDecls - declCount > 0 ? `${totalDecls - declCount} declarations missing` : ''}`
                        )
                        setTrtaModalOpen(true)
                      }}
                    >
                      <AlertCircle className="size-3.5 mr-1" />
                      Initiate TRTA (Return to Author)
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleSaveScreening}
                      isLoading={savingScreening}
                    >
                      Save Screening & Update ELOG
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Column: Scope & Article Type */}
                  <div className="space-y-4">
                    <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <CheckCircle2 className="size-4 text-emerald-600" />
                          <span>Aims & Scope Alignment</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setScopeAligned(!scopeAligned)}
                          className={cn(
                            'text-xs font-bold px-3 py-1 rounded-full border transition-all cursor-pointer',
                            scopeAligned
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                              : 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100'
                          )}
                        >
                          {scopeAligned ? '✓ Aligned with Journal Scope' : '✗ Scope Clarification Needed'}
                        </button>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Scope & Suitability Notes:
                        </label>
                        <textarea
                          value={scopeNotes}
                          onChange={e => setScopeNotes(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 outline-none focus:border-primary resize-none"
                          placeholder="Editorial assessment on journal aims, scope, novelty, and reader interest..."
                        />
                      </div>
                    </div>

                    <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 space-y-3">
                      <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Layers className="size-4 text-blue-600" />
                        <span>Article Type Classification</span>
                      </label>
                      <select
                        value={articleType}
                        onChange={e => setArticleType(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 font-medium outline-none focus:border-primary cursor-pointer"
                      >
                        {ARTICLE_TYPES.map(t => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-500">
                        Classification determines required IMRAD structural checks and section headers during Step 2.
                      </p>
                    </div>
                  </div>

                  {/* Right Column: Similarity & Peer Review Verification */}
                  <div className="space-y-4">
                    <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <Sliders className="size-4 text-indigo-600" />
                          <span>Similarity & Plagiarism Index</span>
                        </label>
                        <span
                          className={cn(
                            'text-xs font-bold px-2.5 py-0.5 rounded-full border',
                            similarityPct < 20
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              : similarityPct <= 30
                              ? 'bg-amber-50 text-amber-700 border-amber-300'
                              : 'bg-rose-50 text-rose-700 border-rose-300'
                          )}
                        >
                          {similarityPct < 20
                            ? 'Normal (<20%)'
                            : similarityPct <= 30
                            ? 'Moderate (20-30%)'
                            : 'High (>30%) - Flagged'}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={similarityPct}
                          onChange={e => setSimilarityPct(Number(e.target.value))}
                          className="flex-1 accent-primary cursor-pointer"
                        />
                        <div className="w-16 flex items-center">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={similarityPct}
                            onChange={e => setSimilarityPct(Number(e.target.value))}
                            className="w-full px-2 py-1 rounded bg-white border border-slate-200 text-xs text-center font-bold font-mono text-slate-800"
                          />
                          <span className="text-xs text-slate-500 ml-1">%</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Standard STM threshold is 20%. Any manuscript with &gt;25% similarity automatically logs an Author Query (AQ) in the ELOG for author citation clarification.
                      </p>
                    </div>

                    <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 space-y-3">
                      <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <ShieldCheck className="size-4 text-emerald-600" />
                        <span>Peer Review Sign-off & Ethics Clearance</span>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Review Decision:
                          </label>
                          <select
                            value={peerReviewStatus}
                            onChange={e => setPeerReviewStatus(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 font-medium outline-none"
                          >
                            <option value="Accepted for Production">Accepted for Production</option>
                            <option value="Fast-Track Acceptance">Fast-Track Acceptance</option>
                            <option value="Conditional Acceptance">Conditional Acceptance</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Ethics Clearance:
                          </label>
                          <label className="flex items-center gap-2 p-1.5 rounded bg-white border border-slate-200 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ethicsClearance}
                              onChange={e => setEthicsClearance(e.target.checked)}
                              className="accent-primary"
                            />
                            <span className="font-semibold text-slate-700">IRB / Ethics Verified</span>
                          </label>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
                        <span>Current Intake Status:</span>
                        <strong className={isTrta ? 'text-rose-600' : 'text-emerald-700'}>
                          {screening?.intake_status || 'Cleared for Production'}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Declarations */}
            {activeTab === 'declarations' && (
              <div className="space-y-4">
                <div className="text-xs text-slate-500">
                  Journals require five core ethical and administrative statements. Missing declarations automatically generate an Author Query (AQ).
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {Object.entries(analysis.declarations || {}).map(([key, d]) => (
                    <div
                      key={key}
                      className={cn(
                        'p-4 rounded-xl border flex flex-col justify-between space-y-2',
                        d.present ? 'bg-slate-50/60 border-slate-200' : 'bg-rose-50/40 border-rose-200'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          {d.present ? (
                            <CheckCircle2 className="size-4 text-emerald-600" />
                          ) : (
                            <AlertCircle className="size-4 text-rose-600" />
                          )}
                          <span>{d.label}</span>
                        </span>
                        <span
                          className={cn(
                            'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border',
                            d.present ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                          )}
                        >
                          {d.present ? 'Present' : 'Missing'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-700 bg-white p-3 rounded-lg border border-slate-200 font-mono leading-relaxed">
                        {d.snippet || <span className="text-rose-600 italic">No statement detected in manuscript. AQ generated.</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: Assets, Figures & Deep Resolution Check */}
            {activeTab === 'assets' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-4">
                    <span>
                      Total Called: <strong className="text-slate-800">{analysis.figures.length}</strong>
                    </span>
                    <span>
                      Missing Files: <strong className={missingArtCount > 0 ? 'text-rose-600' : 'text-slate-800'}>{missingArtCount}</strong>
                    </span>
                    <span>
                      Low Resolution (&lt;300 DPI): <strong className={lowResArtCount > 0 ? 'text-amber-600' : 'text-emerald-600'}>{lowResArtCount}</strong>
                    </span>
                  </div>
                  <span className="text-slate-700 font-semibold">
                    STM Standard: ≥300 DPI for Halftone / Photographs · 600–1200 DPI for Line Art
                  </span>
                </div>

                {analysis.figures.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-slate-200">
                    No figure callouts detected in manuscript text.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {analysis.figures.map(f => {
                      const isOk = f.status === 'ok'
                      const isLowRes = Boolean(f.is_low_res)

                      return (
                        <div
                          key={f.label}
                          className={cn(
                            'p-4 rounded-xl border flex flex-col justify-between space-y-3',
                            !isOk
                              ? 'bg-rose-50/40 border-rose-200'
                              : isLowRes
                              ? 'bg-amber-50/40 border-amber-200'
                              : 'bg-slate-50/60 border-slate-200'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <ImageIcon
                                className={cn(
                                  'size-4',
                                  !isOk ? 'text-rose-600' : isLowRes ? 'text-amber-600' : 'text-emerald-600'
                                )}
                              />
                              <span>{f.label}</span>
                            </span>
                            <div className="flex items-center gap-1.5">
                              {f.dpi ? (
                                <span
                                  className={cn(
                                    'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                                    isLowRes
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  )}
                                >
                                  {f.dpi} DPI {isLowRes ? '(!)' : '✓'}
                                </span>
                              ) : null}
                              <span
                                className={cn(
                                  'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border',
                                  isOk
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-rose-50 text-rose-700 border-rose-200'
                                )}
                              >
                                {isOk ? 'Matched' : 'Missing File'}
                              </span>
                            </div>
                          </div>

                          <div className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200 space-y-1 font-mono">
                            <div className="truncate">
                              File: {f.matched_file || <span className="text-rose-600 italic font-semibold">None attached</span>}
                            </div>
                            {f.width && f.height && (
                              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                                <span>Dimensions: {f.width} × {f.height} px</span>
                                <span>Format: {f.format?.toUpperCase()}</span>
                              </div>
                            )}
                          </div>

                          {isLowRes && (
                            <div className="text-[11px] text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200 flex items-center gap-1.5">
                              <AlertTriangle className="size-3.5 shrink-0 text-rose-600" />
                              <span>Resolution &lt;300 DPI. Author query logged for high-res file.</span>
                            </div>
                          )}

                          {!isOk && (
                            <div className="text-[11px] text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200 flex items-center gap-1.5">
                              <AlertCircle className="size-3.5 shrink-0 text-rose-600" />
                              <span>Figure called in text but file missing from submission package.</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Uncalled Artwork Files Section */}
                {analysis.uncalled_art_files && analysis.uncalled_art_files.length > 0 && (
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                        <AlertTriangle className="size-4 text-amber-600" />
                        <span>Uncalled Artwork Files Detected in Package ({analysis.uncalled_art_files.length})</span>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                        AQ Logged
                      </span>
                    </div>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      The following image files were included in the submission package but are not cited anywhere in the manuscript body. An Author Query has been logged for author verification.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {analysis.uncalled_art_files.map((filename, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-amber-200/80 text-xs text-slate-800 font-mono"
                        >
                          <ImageIcon className="size-3.5 text-amber-600 shrink-0" />
                          <span className="truncate">{filename}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: Author Queries */}
            {activeTab === 'queries' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Consolidated queries automatically compiled for author resolution:</span>
                  <span className="text-primary font-semibold">{analysis.author_queries.length} total queries</span>
                </div>
                {analysis.author_queries.length === 0 ? (
                  <div className="p-8 text-center text-emerald-700 text-xs bg-emerald-50/60 border border-emerald-200 rounded-xl font-medium">
                    ✓ All declarations, artwork, and editorial checks passed. No Author Queries required!
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 uppercase text-[11px] font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3 w-20">AQ ID</th>
                          <th className="px-4 py-3 w-36">Category</th>
                          <th className="px-4 py-3">Query Text</th>
                          <th className="px-4 py-3 w-28 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {analysis.author_queries.map(q => (
                          <tr key={q.id} className="hover:bg-slate-50/80">
                            <td className="px-4 py-3 font-mono font-bold text-sky-600">{q.id}</td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                                {q.category}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-800 leading-relaxed font-normal">{q.query}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                {q.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tab 5: Language Editing */}
            {activeTab === 'language' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    Language editing density is measured by linguistic issues per 1,000 words:
                    <span className="ml-2 font-mono text-slate-700">&lt;10 Light · 10–25 Medium · &gt;25 Heavy</span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setLeModalOpen(true)}>
                    <Edit3 className="size-3.5 mr-1" />
                    <span>Change Assigned Level</span>
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div
                    className={cn(
                      'p-4 rounded-xl border flex flex-col justify-between space-y-2',
                      analysis.le_chosen_level.includes('Light') || analysis.le_chosen_level.includes('1')
                        ? 'bg-emerald-50/50 border-emerald-300'
                        : 'bg-white border-slate-200 opacity-60'
                    )}
                  >
                    <div className="text-xs font-bold text-emerald-800">Level 1 – Light</div>
                    <div className="text-[11px] text-slate-600 leading-relaxed">
                      &lt;10 issues / 1k words. Clean manuscript. Standard typographical, punctuation, and minor grammatical consistency.
                    </div>
                  </div>

                  <div
                    className={cn(
                      'p-4 rounded-xl border flex flex-col justify-between space-y-2',
                      analysis.le_chosen_level.includes('Medium') || analysis.le_chosen_level.includes('2')
                        ? 'bg-amber-50/50 border-amber-300'
                        : 'bg-white border-slate-200 opacity-60'
                    )}
                  >
                    <div className="text-xs font-bold text-amber-800">Level 2 – Medium (Standard)</div>
                    <div className="text-[11px] text-slate-600 leading-relaxed">
                      10–25 issues / 1k words. Moderate syntactic restructuring, tense consistency, passive/active voice harmonization, and terminology refinement.
                    </div>
                  </div>

                  <div
                    className={cn(
                      'p-4 rounded-xl border flex flex-col justify-between space-y-2',
                      analysis.le_chosen_level.includes('Heavy') || analysis.le_chosen_level.includes('3')
                        ? 'bg-rose-50/50 border-rose-300'
                        : 'bg-white border-slate-200 opacity-60'
                    )}
                  >
                    <div className="text-xs font-bold text-rose-800">Level 3 – Heavy</div>
                    <div className="text-[11px] text-slate-600 leading-relaxed">
                      &gt;25 issues / 1k words. Extensive paragraph rewriting, ESL/EFL developmental phrasing, restructuring ambiguous technical claims.
                    </div>
                  </div>
                </div>

                {analysis.sample_language_issues && analysis.sample_language_issues.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Sample Detected Linguistic Markers ({analysis.sample_language_issues.length} shown)
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {analysis.sample_language_issues.map((iss, idx) => (
                        <div key={idx} className="bg-white p-3 rounded-lg border border-slate-200 text-xs flex items-center justify-between">
                          <span className="text-slate-800 font-medium">{iss.message}</span>
                          <span className="text-slate-500 font-mono text-[11px] bg-slate-50 px-2 py-0.5 rounded border border-slate-100 truncate max-w-[280px]">
                            {iss.snippet}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Language Editing Level Modal */}
      {leModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-slate-900">Adjust Language Editing (LE) Level</h3>
            <p className="text-xs text-slate-500">
              The system recommended <strong>{analysis.le_recommended_level}</strong> based on an error density of <strong>{analysis.le_density} / 1k words</strong>. You can manually adjust the assigned level:
            </p>

            <div className="space-y-2">
              {(['Level 1 – Light', 'Level 2 – Medium', 'Level 3 – Heavy'] as const).map(lvl => (
                <label
                  key={lvl}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all',
                    selectedLeLevel === lvl ? 'bg-primary/10 border-primary text-primary font-semibold' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="leLevel"
                      value={lvl}
                      checked={selectedLeLevel === lvl}
                      onChange={() => setSelectedLeLevel(lvl)}
                      className="accent-primary"
                    />
                    <span>{lvl}</span>
                  </div>
                  {analysis.le_recommended_level === lvl && (
                    <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-mono">
                      Recommended
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Reason for change (optional):
              </label>
              <input
                type="text"
                value={leReason}
                onChange={e => setLeReason(e.target.value)}
                placeholder="e.g., Client requested developmental edit"
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 outline-none focus:border-primary"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setLeModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleSaveLeLevel} isLoading={savingLe}>
                Save Level & Update ELOG
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Return to Author (TRTA) Confirmation Modal */}
      {trtaModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200">
                <AlertCircle className="size-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">Initiate Technical Return to Author (TRTA)</h3>
                <p className="text-xs text-slate-500">
                  Return manuscript #{article.id} to corresponding author for mandatory technical, artwork, or declaration corrections.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
              <div className="font-semibold text-slate-700">Identified Deficiencies to be Compiled in Author Return:</div>
              <ul className="space-y-1.5 text-slate-600">
                <li className="flex items-center justify-between">
                  <span>Author Queries (AQ) Logged:</span>
                  <strong className="text-slate-900 font-mono">{analysis.author_queries.length} queries</strong>
                </li>
                <li className="flex items-center justify-between">
                  <span>Missing Mandatory Declarations:</span>
                  <strong className={totalDecls - declCount > 0 ? 'text-rose-600 font-mono' : 'text-slate-900 font-mono'}>
                    {totalDecls - declCount} missing
                  </strong>
                </li>
                <li className="flex items-center justify-between">
                  <span>Missing Artwork Files:</span>
                  <strong className={missingArtCount > 0 ? 'text-rose-600 font-mono' : 'text-slate-900 font-mono'}>
                    {missingArtCount} missing
                  </strong>
                </li>
                <li className="flex items-center justify-between">
                  <span>Low-Resolution Artwork (&lt;300 DPI):</span>
                  <strong className={lowResArtCount > 0 ? 'text-amber-600 font-mono' : 'text-slate-900 font-mono'}>
                    {lowResArtCount} low-res
                  </strong>
                </li>
              </ul>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                TRTA Editorial Return Note to Author:
              </label>
              <textarea
                value={trtaReason}
                onChange={e => setTrtaReason(e.target.value)}
                rows={3}
                placeholder="Specify required corrections or instructions for author revision..."
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-50 resize-none"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setTrtaModalOpen(false)} disabled={isTrtaBusy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="bg-rose-600 hover:bg-rose-700 text-white border-transparent"
                onClick={handleTriggerTrta}
                isLoading={isTrtaBusy}
              >
                Confirm Return to Author & Log ELOG
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
