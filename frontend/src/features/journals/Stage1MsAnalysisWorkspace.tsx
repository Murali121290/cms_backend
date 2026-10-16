import { useState } from 'react'
import {
  FileText, CheckCircle2, AlertTriangle, AlertCircle, Download,
  ExternalLink, RefreshCw, ShieldCheck, HelpCircle, ArrowRight,
  BookOpen, Sparkles, Layers, Image as ImageIcon, ChevronRight, Edit3
} from 'lucide-react'
import type { ArticleWorkspace, MsAnalysisState, AuthorQuery, ChecklistItem } from '@/api/journals'
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

export function Stage1MsAnalysisWorkspace({ workspace, onRunAnalysis, onCompleteStage, onReload, onViewElog, isBusy }: Props) {
  const { article, journal, ms_analysis } = workspace
  const [activeTab, setActiveTab] = useState<'declarations' | 'assets' | 'queries' | 'language'>('declarations')
  const [leModalOpen, setLeModalOpen] = useState(false)
  const [selectedLeLevel, setSelectedLeLevel] = useState<string>(
    article.le_level ?? ms_analysis?.le_chosen_level ?? 'Level 2 – Medium'
  )
  const [leReason, setLeReason] = useState('')
  const [savingLe, setSavingLe] = useState(false)

  const analysis = ms_analysis

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

  if (!analysis) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50 text-slate-800">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <div className="size-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <Sparkles className="size-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Stage 1: Manuscript (MS) Analysis</h2>
          <p className="text-xs text-slate-500">
            Automated analysis has not run for this manuscript yet. Run analysis to extract word counts, check declarations compliance, cross-verify artwork callouts, calculate advisory LE level, and generate the ELOG.
          </p>
          <Button onClick={onRunAnalysis} isLoading={isBusy} variant="primary" className="w-full">
            Run 7-Step MS Analysis & Generate ELOG
          </Button>
        </div>
      </div>
    )
  }

  const declCount = Object.values(analysis.declarations || {}).filter(d => d.present).length
  const totalDecls = Object.keys(analysis.declarations || {}).length
  const missingArtCount = (analysis.figures || []).filter(f => f.status === 'missing_file').length

  const leBadgeColor =
    analysis.le_chosen_level.includes('Light') || analysis.le_chosen_level.includes('1')
      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
      : analysis.le_chosen_level.includes('Medium') || analysis.le_chosen_level.includes('2')
      ? 'bg-amber-50 text-amber-700 border-amber-300'
      : 'bg-rose-50 text-rose-700 border-rose-300'

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50/70 text-slate-800 overflow-y-auto">
      <div className="w-full p-6 space-y-6">
        {/* Metric Cards Grid - Clean White */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3.5">
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <BookOpen className="size-3.5 text-sky-500" />
              <span>Word Count</span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900">{analysis.word_count.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">~{analysis.estimated_pages} pages · {analysis.paragraphs_count} paras</div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-purple-500" />
              <span>Advisory LE Level</span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn('text-xs font-bold px-2.5 py-0.5 rounded-full border', leBadgeColor)}>
                {analysis.le_chosen_level}
              </span>
              <button
                type="button"
                onClick={() => setLeModalOpen(true)}
                className="text-[11px] text-primary hover:underline font-semibold ml-auto"
                title="Change Level"
              >
                Edit
              </button>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Density: <strong className="text-slate-700">{analysis.le_density}</strong>/1k words
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              <span>Declarations</span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900">
              {declCount} <span className="text-sm font-normal text-slate-400">/ {totalDecls}</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {declCount === totalDecls ? (
                <span className="text-emerald-600 font-semibold">All 5 confirmed</span>
              ) : (
                <span className="text-amber-600 font-semibold">{totalDecls - declCount} statement(s) missing</span>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <ImageIcon className="size-3.5 text-pink-500" />
              <span>Figures Called</span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900">{analysis.figures.length}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {missingArtCount > 0 ? (
                <span className="text-rose-600 font-bold">{missingArtCount} file(s) missing</span>
              ) : (
                <span className="text-emerald-600 font-semibold">All art matched</span>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <Layers className="size-3.5 text-amber-500" />
              <span>Tables & Refs</span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900">
              {analysis.tables.length} <span className="text-sm font-normal text-slate-400">tbl / {analysis.references_count} refs</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {analysis.citations_count} citations called
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              <HelpCircle className="size-3.5 text-indigo-500" />
              <span>Author Queries</span>
            </div>
            <div className="text-2xl font-extrabold text-slate-900">{analysis.author_queries.length}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {analysis.author_queries.length > 0 ? (
                <span className="text-sky-600 font-semibold">Logged in ELOG</span>
              ) : (
                <span className="text-emerald-600 font-semibold">No queries required</span>
              )}
            </div>
          </div>
        </div>

        {/* 7-Step Pipeline Checklist Horizontal Cards - Clean White Theme */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span>7-Step MS Analysis Pipeline Progress</span>
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
          <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-2.5 flex items-center gap-2">
            <button
              onClick={() => setActiveTab('declarations')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
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
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
                activeTab === 'assets'
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              <ImageIcon className="size-3.5 text-pink-600" />
              <span>Artwork & Figures ({analysis.figures.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('queries')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
                activeTab === 'queries'
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              <HelpCircle className="size-3.5 text-indigo-600" />
              <span>Consolidated Author Queries ({analysis.author_queries.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('language')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
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
            {/* Tab 1: Declarations */}
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

            {/* Tab 2: Assets & Figures */}
            {activeTab === 'assets' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Figures called in manuscript text matched against uploaded image files:</span>
                  <span className="text-slate-800 font-semibold">{analysis.figures.length} figure callouts detected</span>
                </div>
                {analysis.figures.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-slate-200">
                    No figure callouts detected in manuscript text.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {analysis.figures.map(f => {
                      const isOk = f.status === 'ok'
                      return (
                        <div
                          key={f.label}
                          className={cn(
                            'p-4 rounded-xl border flex flex-col justify-between space-y-2',
                            isOk ? 'bg-slate-50/60 border-slate-200' : 'bg-rose-50/40 border-rose-200'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <ImageIcon className={cn('size-4', isOk ? 'text-emerald-600' : 'text-rose-600')} />
                              <span>{f.label}</span>
                            </span>
                            <span
                              className={cn(
                                'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border',
                                isOk ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                              )}
                            >
                              {isOk ? 'Matched' : 'Missing File'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 font-mono truncate bg-white p-2 rounded border border-slate-200">
                            File: {f.matched_file || <span className="text-rose-600 italic font-semibold">None attached in package</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Author Queries */}
            {activeTab === 'queries' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Consolidated queries automatically compiled for author resolution:</span>
                  <span className="text-primary font-semibold">{analysis.author_queries.length} total queries</span>
                </div>
                {analysis.author_queries.length === 0 ? (
                  <div className="p-8 text-center text-emerald-700 text-xs bg-emerald-50/60 border border-emerald-200 rounded-xl font-medium">
                    ✓ All declarations and artwork checks passed. No Author Queries required!
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 uppercase text-[11px] font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3 w-20">AQ ID</th>
                          <th className="px-4 py-3 w-32">Category</th>
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

            {/* Tab 4: Language Editing */}
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
    </div>
  )
}
