import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, Download, Layers, XCircle, ChevronDown, ChevronUp,
  ExternalLink, FileText, Image, FolderOpen, Info, CheckCircle2, AlertTriangle,
  File, X, Loader2, Upload, User, Check
} from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { toast } from '@/store/useToastStore'

interface Chapter {
  id: number
  chapter_no: string
  status: string
  source_filename: string
  error_message?: string
  attempts: number
  size_bytes?: number
  conversion_status: string
  conversion_completed_at?: string
  qc_status: string
  qc_completed_at?: string
  created_at?: string
  completed_at?: string
}

interface PostProdProject {
  id: number
  client: string
  client_code?: string
  project_name: string
  status: string
  assignee?: string
  created_at: string
  chapters: Chapter[]
}

interface SourceFile {
  name: string
  path: string
  size: number
}

interface ChapterSourceFiles {
  indesign: SourceFile[]
  docx: SourceFile[]
  images: SourceFile[]
  misc: SourceFile[]
}

export function PostProdChaptersPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<PostProdProject | null>(null)
  const [loading, setLoading] = useState(true)

  // Split-screen state
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null)
  const [chapterFiles, setChapterFiles] = useState<ChapterSourceFiles | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [activeTab, setActiveTab] = useState<'indesign' | 'docx' | 'images' | 'misc'>('indesign')
  const [expandedChapterIds, setExpandedChapterIds] = useState<number[]>([])
  const [expandedDateIds, setExpandedDateIds] = useState<number[]>([])
  const toggleDateExpand = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedDateIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([])
  const [isBulkConverting, setIsBulkConverting] = useState(false)
  const [isBulkDownloading, setIsBulkDownloading] = useState(false)

  const toggleExpand = (id: number) => {
    setExpandedChapterIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const toggleSelectChapter = (id: number) => {
    setSelectedChapterIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    if (!project) return
    const allIds = project.chapters.map(c => c.id)
    if (selectedChapterIds.length === allIds.length) {
      setSelectedChapterIds([])
    } else {
      setSelectedChapterIds(allIds)
    }
  }

  const handleBulkConvert = async () => {
    if (selectedChapterIds.length === 0) return
    setIsBulkConverting(true)
    try {
      await Promise.all(
        selectedChapterIds.map(id =>
          fetch(`/api/v2/post-prod/chapters/${id}/convert`, {
            method: 'POST'
          })
        )
      )
      setSelectedChapterIds([])
      fetchProjectDetails()
    } catch (err) {
      console.error(err)
      toast.error('Failed to start bulk conversion.')
    } finally {
      setIsBulkConverting(false)
    }
  }

  const handleBulkDownload = async () => {
    if (selectedChapterIds.length === 0) return
    setIsBulkDownloading(true)
    try {
      const chapterIdsStr = selectedChapterIds.join(',')
      const res = await fetch(`/api/v2/post-prod/projects/${projectId}/bulk-download-chapters?chapter_ids=${chapterIdsStr}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Download failed')
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `converted_chapters_${projectId}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)

      setSelectedChapterIds([])
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Failed to download the selected chapters.')
    } finally {
      setIsBulkDownloading(false)
    }
  }

  useDocumentTitle(project ? `${project.project_name} — Word Chapters` : 'Loading Chapters — S4Carlisle CMS')

  const fetchProjectDetails = async () => {
    try {
      const res = await fetch(`/api/v2/post-prod/projects/${projectId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.chapters) {
          data.chapters.sort((a: Chapter, b: Chapter) => {
            const numA = parseInt(a.chapter_no, 10);
            const numB = parseInt(b.chapter_no, 10);
            if (!isNaN(numA) && !isNaN(numB)) {
              return numA - numB;
            }
            return a.chapter_no.localeCompare(b.chapter_no, undefined, { numeric: true, sensitivity: 'base' });
          });
        }
        setProject(data)

        // Auto-update selected chapter if it exists
        if (selectedChapter) {
          const updated = data.chapters.find((c: Chapter) => c.id === selectedChapter.id)
          if (updated) {
            setSelectedChapter(updated)
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch project details', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProjectDetails()
    const timer = setInterval(() => {
      fetchProjectDetails()
    }, 5000)
    return () => clearInterval(timer)
  }, [projectId, selectedChapter?.id])

  // Fetch files when selected chapter changes
  useEffect(() => {
    if (!selectedChapter) {
      setChapterFiles(null)
      return
    }

    const fetchFiles = async () => {
      setLoadingFiles(true)
      try {
        const res = await fetch(`/api/v2/post-prod/chapters/${selectedChapter.id}/source-files`)
        if (res.ok) {
          const data = await res.json()
          setChapterFiles(data)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoadingFiles(false)
      }
    }

    fetchFiles()
  }, [selectedChapter?.id])

  const handleDownloadChapter = async (chapter: Chapter) => {
    try {
      const res = await fetch(`/api/v2/post-prod/chapters/${chapter.id}/download`)
      if (!res.ok) {
        throw new Error('Download failed')
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${chapter.source_filename.replace(/\.[^/.]+$/, '')}.docx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      toast.error('Failed to download the converted file.')
    }
  }

  const handleOpenInWord = async (chapter: Chapter) => {
    try {
      const res = await fetch(`/api/v2/post-prod/chapters/${chapter.id}/open-in-word`)
      if (!res.ok) {
        throw new Error('Failed to get Word editing link')
      }
      const data = await res.json()
      if (!data?.ms_word_uri) return
      window.location.href = data.ms_word_uri

      // Setup fallback check
      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          toast.info(`Word didn't open — downloading instead.`)
          handleDownloadChapter(chapter)
        }
      }, 2000)
    } catch (err) {
      console.error(err)
      toast.error('Failed to open the file in Word.')
    }
    fetchProjectDetails() // Refresh to fetch updated qc_status
  }

  const handleQCComplete = async (chapter: Chapter) => {
    try {
      const res = await fetch(`/api/v2/post-prod/chapters/${chapter.id}/qc-complete`, { method: 'POST' })
      if (!res.ok) throw new Error('QC complete failed')
      toast.success('QC marked as completed')
      fetchProjectDetails()
    } catch (err) {
      console.error(err)
      toast.error('Failed to update QC status')
    }
  }

  const handleConvertChapter = async (chapter: Chapter) => {
    try {
      const res = await fetch(`/api/v2/post-prod/chapters/${chapter.id}/convert`, {
        method: 'POST'
      })
      if (!res.ok) {
        throw new Error('Convert failed')
      }
      fetchProjectDetails()
    } catch (err) {
      console.error(err)
      toast.error('Failed to start conversion.')
    }
  }

  const handleDownloadSourceFile = async (filePath: string, fileName: string) => {
    if (!selectedChapter) return
    try {
      const res = await fetch(
        `/api/v2/post-prod/chapters/${selectedChapter.id}/download-source?path=${encodeURIComponent(filePath)}`
      )
      if (!res.ok) {
        throw new Error('File download failed')
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      toast.error('Failed to download file.')
    }
  }

  const triggerFileInput = (targetPath: string | null) => {
    if (!selectedChapter) return
    const input = document.createElement('input')
    input.type = 'file'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      const formData = new FormData()
      formData.append('file', file)
      if (targetPath) {
        formData.append('target_path', targetPath)
      }

      setLoadingFiles(true)
      try {
        const res = await fetch(`/api/v2/post-prod/chapters/${selectedChapter.id}/upload-file`, {
          method: 'POST',
          body: formData,
        })
        if (res.ok) {
          // Re-fetch files
          const filesRes = await fetch(`/api/v2/post-prod/chapters/${selectedChapter.id}/source-files`)
          if (filesRes.ok) {
            const data = await filesRes.json()
            setChapterFiles(data)
          }
          toast.success(targetPath ? 'File replaced successfully.' : 'File uploaded successfully.')
        } else {
          try {
            const err = await res.json()
            toast.error(err.detail || 'Upload failed.')
          } catch {
            toast.error('Upload failed.')
          }
        }
      } catch (err) {
        console.error(err)
        toast.error('Upload failed.')
      } finally {
        setLoadingFiles(false)
      }
    }
    input.click()
  }

  const FormatDate = ({ value, inline }: { value?: string, inline?: boolean }) => {
    if (!value) return <span>—</span>
    const date = new Date(value.endsWith('Z') ? value : value + 'Z')
    if (isNaN(date.getTime())) return <span>—</span>
    
    const dateStr = date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
    const timeStr = date.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()
    
    if (inline) {
      return <span>{dateStr} {timeStr}</span>
    }
    
    return (
      <div className="flex flex-col">
        <span>{dateStr}</span>
        <span className="text-[10px] opacity-75 leading-tight mt-0.5">{timeStr}</span>
      </div>
    )
  }

  const formatDuration = (start?: string, end?: string) => {
    if (!start || !end) return '—'
    const startMs = new Date(start.endsWith('Z') ? start : start + 'Z').getTime()
    const endMs = new Date(end.endsWith('Z') ? end : end + 'Z').getTime()
    if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return '—'
    const totalSeconds = Math.floor((endMs - startMs) / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }

  const formatBytes = (bytes?: number, decimals = 2) => {
    if (bytes === undefined || bytes === null) return '—'
    if (bytes === 0) return '0.00 MB'
    const dm = decimals < 0 ? 0 : decimals
    return (bytes / (1024 * 1024)).toFixed(dm) + ' MB'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-muted">
        <RefreshCw size={24} className="animate-spin mr-2" />
        <span>Loading project details...</span>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto p-6 text-center text-text">
        <XCircle size={48} className="mx-auto text-red-500" />
        <h2 className="text-xl font-bold">Project Not Found</h2>
        <p className="text-sm text-muted">The requested backlist project does not exist.</p>
        <button onClick={() => navigate('/post-production/word-conversion')} className="text-primary underline text-sm">
          Back to Projects list
        </button>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-110px)] flex flex-col max-w-7xl mx-auto p-6 text-text overflow-hidden">
      {/* Header / Breadcrumb */}
      <div className="flex items-center justify-between gap-4 shrink-0 mb-5 border-b border-border pb-3.5">
        <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-sm">
          <button
            onClick={() => navigate('/post-production/word-conversion')}
            className="p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="h-4 w-px bg-border hidden sm:block" />

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold font-serif text-text tracking-tight leading-tight">
                {project.project_name}
              </h1>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                {project.status}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-muted">
              <span>{project.client} {project.client_code && `(${project.client_code})`}</span>
              <span className="inline-flex items-center gap-1">
                <User size={11} /> {project.assignee || 'Unassigned'}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Chapters Split View */}
      <div className="flex flex-col lg:flex-row gap-6 items-stretch flex-1 min-h-0 overflow-hidden">

        {/* Left Side: Chapters List */}
        <div className={`transition-all duration-300 flex flex-col h-full overflow-hidden ${selectedChapter ? 'w-full lg:w-[45%]' : 'w-full'}`}>
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h2 className="text-lg font-bold font-serif flex items-center gap-2">
                <Layers size={18} className="text-muted" /> Chapters List
              </h2>
              {selectedChapterIds.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={handleBulkConvert}
                    disabled={isBulkConverting || isBulkDownloading}
                    className="px-3 py-1.5 border border-amber-200/80 bg-amber-500/5 hover:bg-amber-500/15 text-amber-600 hover:text-amber-700 disabled:bg-amber-500/2 disabled:text-amber-600/40 disabled:border-amber-200/20 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
                  >
                    {isBulkConverting ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Converting...
                      </>
                    ) : (
                      <>
                        <RefreshCw size={13} />
                        Convert Selected ({selectedChapterIds.length})
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleBulkDownload}
                    disabled={isBulkConverting || isBulkDownloading}
                    className="px-3 py-1.5 border border-blue-200/80 bg-blue-500/5 hover:bg-blue-500/15 text-blue-600 hover:text-blue-700 disabled:bg-blue-500/2 disabled:text-blue-600/40 disabled:border-blue-200/20 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
                  >
                    {isBulkDownloading ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Download size={13} />
                        Download Selected ({selectedChapterIds.length})
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {project.chapters.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted flex-1">
                <Layers size={48} className="mb-4 text-muted/50" />
                <p className="text-sm font-medium">No chapters detected</p>
              </div>
            ) : (
              <div className="border border-border rounded-xl overflow-y-auto overflow-x-auto bg-surface/50 flex-1 min-h-0">
                <table className="w-full min-w-[760px] text-left text-sm border-collapse">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border text-muted font-medium text-xs uppercase tracking-wider">
                      <th className="p-3.5 bg-card w-10">
                        <input
                          type="checkbox"
                          checked={project.chapters.length > 0 && selectedChapterIds.length === project.chapters.length}
                          onChange={toggleSelectAll}
                          className="rounded border-border text-primary focus:ring-primary cursor-pointer w-4 h-4"
                        />
                      </th>
                      <th className="p-3.5 bg-card">Chapter</th>
                      {!selectedChapter && <th className="p-3.5 bg-card">Filename</th>}
                      {!selectedChapter && <th className="p-3.5 bg-card">Size</th>}
                      <th className="p-3.5 bg-card">Created</th>
                      <th className="p-3.5 bg-card">Conversion Status</th>
                      <th className="p-3.5 bg-card">QC Status</th>
                      <th className="p-3.5 bg-card">Status</th>
                      <th className="p-3.5 bg-card">Completed</th>
                      <th className="p-3.5 bg-card text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {project.chapters.map((chap) => {
                      const isSelected = selectedChapter?.id === chap.id
                      const isFailed = chap.status === 'Failed'
                      const isExpanded = expandedChapterIds.includes(chap.id)

                      const getStatusCls = (s: string) => {
                        if (s === 'Completed') return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                        if (s === 'Converting' || s === 'In-Progress') return 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                        if (s === 'Failed') return 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
                        if (s === 'Pending') return 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400 font-semibold'
                        return 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400 font-semibold'
                      }

                      const conversionStatusCls = getStatusCls(chap.conversion_status)
                      const qcStatusCls = getStatusCls(chap.qc_status)
                      const statusCls = getStatusCls(chap.status)

                      return (
                        <React.Fragment key={chap.id}>
                          <tr
                            onClick={() => setSelectedChapter(chap)}
                            className={`cursor-pointer transition-all hover:bg-accent/40 ${isSelected ? 'bg-primary/5 border-l-4 border-l-primary font-semibold' : ''
                              }`}
                          >
                            <td className="p-3.5 w-10 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedChapterIds.includes(chap.id)}
                                onChange={() => toggleSelectChapter(chap.id)}
                                className="rounded border-border text-primary focus:ring-primary cursor-pointer w-4 h-4"
                              />
                            </td>
                            <td className="p-3.5 font-medium text-text">
                              Chapter {chap.chapter_no}
                            </td>
                            {!selectedChapter && (
                              <td className="p-3.5 text-text font-normal truncate max-w-[200px]" title={chap.source_filename}>
                                {chap.source_filename}
                              </td>
                            )}
                            {!selectedChapter && (
                              <td className="p-3.5 text-text whitespace-nowrap text-[13px]">
                                {formatBytes(chap.size_bytes)}
                              </td>
                            )}
                            <td className="p-3.5 text-muted whitespace-nowrap">
                              <FormatDate value={chap.created_at} />
                            </td>
                            <td className="p-3.5">
                              <div className="flex flex-col items-start gap-1.5">
                                <span
                                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${conversionStatusCls}`}
                                >
                                  {chap.conversion_status}
                                </span>
                                {chap.conversion_completed_at && (
                                  <div className="relative flex flex-col gap-1 cursor-pointer" onClick={(e) => toggleDateExpand(chap.id + 1000000, e)}>
                                    <span className="text-[10px] text-muted whitespace-nowrap hover:text-text transition-colors" title="Click to see details">
                                      ⏱ {formatDuration(chap.created_at, chap.conversion_completed_at)}
                                    </span>
                                    {expandedDateIds.includes(chap.id + 1000000) && (
                                      <div 
                                        className="absolute top-full left-0 mt-1 z-[100] shadow-xl text-[10px] text-text bg-card p-2.5 rounded-lg border border-border min-w-[150px]"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="flex flex-col gap-2">
                                          <div>
                                            <div className="text-[9px] text-muted uppercase tracking-wider mb-0.5">Start Time</div>
                                            <div className="font-medium"><FormatDate value={chap.created_at} inline /></div>
                                          </div>
                                          <div>
                                            <div className="text-[9px] text-muted uppercase tracking-wider mb-0.5">End Time</div>
                                            <div className="font-medium"><FormatDate value={chap.conversion_completed_at} inline /></div>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="p-3.5">
                              <div className="flex flex-col items-start gap-1.5">
                                <span
                                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${qcStatusCls}`}
                                >
                                  {chap.qc_status}
                                </span>
                                {chap.qc_completed_at && (
                                  <div className="relative flex flex-col gap-1 cursor-pointer" onClick={(e) => toggleDateExpand(chap.id + 2000000, e)}>
                                    <span className="text-[10px] text-muted whitespace-nowrap hover:text-text transition-colors" title="Click to see details">
                                      ⏱ {formatDuration(chap.conversion_completed_at, chap.qc_completed_at)}
                                    </span>
                                    {expandedDateIds.includes(chap.id + 2000000) && (
                                      <div 
                                        className="absolute top-full left-0 mt-1 z-[100] shadow-xl text-[10px] text-text bg-card p-2.5 rounded-lg border border-border min-w-[150px]"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="flex flex-col gap-2">
                                          <div>
                                            <div className="text-[9px] text-muted uppercase tracking-wider mb-0.5">Start Time</div>
                                            <div className="font-medium"><FormatDate value={chap.conversion_completed_at} inline /></div>
                                          </div>
                                          <div>
                                            <div className="text-[9px] text-muted uppercase tracking-wider mb-0.5">End Time</div>
                                            <div className="font-medium"><FormatDate value={chap.qc_completed_at} inline /></div>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="p-3.5">
                              <div className="flex flex-col items-start gap-1.5">
                                <span
                                  onClick={(e) => {
                                    if (isFailed) {
                                      e.stopPropagation();
                                      toggleExpand(chap.id);
                                    }
                                  }}
                                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${statusCls} ${isFailed ? 'cursor-pointer hover:opacity-85 select-none' : ''
                                    }`}
                                  title={isFailed ? (isExpanded ? "Hide conversion logs" : "Click to view conversion logs") : undefined}
                                >
                                  {chap.status}
                                  {isFailed && (
                                    <span className="ml-1 inline-block text-[8px] align-middle opacity-80">
                                      {isExpanded ? '▲' : '▼'}
                                    </span>
                                  )}
                                </span>
                                {chap.completed_at && (
                                  <span className="text-[10px] text-muted whitespace-nowrap" title="Total Duration">
                                    ⏱ {formatDuration(chap.created_at, chap.completed_at)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3.5 text-muted whitespace-nowrap">
                              <FormatDate value={chap.completed_at} />
                            </td>
                            <td className="p-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-center gap-1.5">
                                {chap.conversion_status === 'Converting' ? (
                                  <button
                                    disabled
                                    className="p-1.5 border border-amber-200/40 bg-amber-500/5 text-amber-500/60 rounded-lg cursor-not-allowed"
                                    title="Converting..."
                                  >
                                    <Loader2 size={13} className="animate-spin" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleConvertChapter(chap)}
                                    className="p-1.5 border border-amber-200/80 bg-amber-500/5 hover:bg-amber-500/15 text-amber-600 hover:text-amber-700 rounded-lg transition-all shadow-sm"
                                    title={chap.status === 'Completed' ? 'Reconvert' : 'Convert'}
                                  >
                                    <RefreshCw size={13} />
                                  </button>
                                )}

                                {chap.conversion_status === 'Completed' && (
                                  <>
                                    <button
                                      onClick={() => handleOpenInWord(chap)}
                                      className="p-1.5 border border-emerald-200/80 bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-600 hover:text-emerald-700 rounded-lg transition-all shadow-sm"
                                      title="Open in Word"
                                    >
                                      <FileText size={13} />
                                    </button>
                                    {chap.qc_status !== 'Completed' && (
                                      <button
                                        onClick={() => handleQCComplete(chap)}
                                        className="p-1.5 border border-purple-200/80 bg-purple-500/5 hover:bg-purple-500/15 text-purple-600 hover:text-purple-700 rounded-lg transition-all shadow-sm flex items-center justify-center"
                                        title="QC Completed"
                                      >
                                        <Check size={13} strokeWidth={3} />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleDownloadChapter(chap)}
                                      className="p-1.5 border border-blue-200/80 bg-blue-500/5 hover:bg-blue-500/15 text-blue-600 hover:text-blue-700 rounded-lg transition-all shadow-sm"
                                      title="Download Word File"
                                    >
                                      <Download size={13} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isFailed && isExpanded && (
                            <tr className="bg-red-500/[0.01]">
                              <td colSpan={selectedChapter ? 6 : 7} className="p-3 pt-0 pb-3.5">
                                <div className="text-xs text-red-500 bg-red-500/5 border border-red-500/10 rounded-xl p-3 font-mono overflow-x-auto max-h-[120px] overflow-y-auto">
                                  <strong className="block text-[10px] uppercase font-sans tracking-wide mb-1 text-red-600 dark:text-red-400">
                                    Conversion Failure Logs:
                                  </strong>
                                  {chap.error_message || 'No error logs provided.'}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Chapter Assets Explorer */}
        {selectedChapter && (
          <div className="w-full lg:w-[55%] bg-card border border-border rounded-2xl p-6 shadow-sm h-full flex flex-col justify-between overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-right-4">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Close / Header */}
              <div className="flex items-center justify-between pb-4 border-b border-border mb-4 shrink-0">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-muted">Selected Assets</span>
                  <h3 className="text-xl font-bold font-serif text-text">Chapter {selectedChapter.chapter_no}</h3>
                </div>
                <button
                  onClick={() => setSelectedChapter(null)}
                  className="p-1.5 hover:bg-accent rounded-lg text-muted hover:text-text transition-colors"
                  title="Close details"
                >
                  <X size={18} />
                </button>
              </div>


              {/* File Explorer Tabs */}
              <div className="flex items-center justify-between border-b border-border mb-3 shrink-0">
                <div className="flex overflow-x-auto whitespace-nowrap scrollbar-none -mb-px">
                  {(['indesign', 'docx', 'images', 'misc'] as const).map((tab) => {
                    let label = 'Files'
                    if (tab === 'indesign') label = 'Chapter'
                    else if (tab === 'docx') label = 'Word'
                    else if (tab === 'images') label = 'Images'
                    else if (tab === 'misc') label = 'Misc'

                    const count = chapterFiles ? chapterFiles[tab]?.length || 0 : 0

                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${activeTab === tab
                          ? 'border-primary text-primary font-bold'
                          : 'border-transparent text-muted hover:text-text'
                          }`}
                      >
                        {label}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === tab ? 'bg-primary/10 text-primary' : 'bg-accent text-muted'
                          }`}>
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <button
                  onClick={() => triggerFileInput(null)}
                  className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all mb-1 shrink-0"
                  title="Upload New Asset"
                >
                  <Upload size={13} />
                  Upload Asset
                </button>
              </div>

              {/* Files List */}
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                {loadingFiles ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted">
                    <Loader2 size={24} className="animate-spin mb-2" />
                    <span className="text-xs">Loading chapter files...</span>
                  </div>
                ) : !chapterFiles || !chapterFiles[activeTab] || chapterFiles[activeTab].length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted border border-dashed border-border rounded-xl">
                    <FolderOpen size={36} className="mb-2 text-muted/40" />
                    <span className="text-xs font-medium">No files found in this category</span>
                  </div>
                ) : (
                  <div className="border border-border rounded-xl overflow-hidden divide-y divide-border bg-surface/30">
                    {chapterFiles[activeTab].map((file, idx) => {
                      let FileIcon = File
                      if (activeTab === 'docx') FileIcon = FileText
                      else if (activeTab === 'images') FileIcon = Image
                      else if (activeTab === 'indesign') FileIcon = Layers

                      return (
                        <div key={idx} className="p-3 flex items-center justify-between gap-4 hover:bg-accent/30 transition-colors">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-2 bg-card border border-border rounded-lg text-muted">
                              <FileIcon size={16} />
                            </div>
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-text block truncate" title={file.name}>
                                {file.name}
                              </span>
                              {file.path !== '__converted__' && (
                                <span className="text-[10px] text-muted block truncate max-w-[280px]">
                                  {file.path}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs text-muted mr-1.5">{formatBytes(file.size)}</span>

                            {file.path !== '__converted__' && (
                              <button
                                onClick={() => triggerFileInput(file.path)}
                                className="p-1.5 bg-card border border-border text-muted hover:text-text rounded-lg hover:bg-accent transition-all shadow-sm"
                                title="Replace Asset"
                              >
                                <Upload size={14} />
                              </button>
                            )}

                            <button
                              onClick={() => handleDownloadSourceFile(file.path, file.name)}
                              className="p-1.5 bg-card border border-border text-muted hover:text-text rounded-lg hover:bg-accent transition-all shadow-sm"
                              title="Download Asset"
                            >
                              <Download size={14} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
