import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, ChevronRight, ArrowLeft } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { getApiErrorMessage } from '@/api/client'
import { bulkDownloadProjectFiles } from '@/api/files'
import { getBulkFilesSummary } from '@/api/projects'
import { downloadBlob } from '@/utils/download'
import { ChapterChecklist, type ChecklistChapter } from './ChapterChecklist'

const AVAILABLE_FOLDERS = [
  { id: 'Manuscript', label: 'Manuscript', description: 'Source Word documents (.docx)' },
  { id: 'XML', label: 'XML', description: 'Validated XML and DTD files' },
  { id: 'InDesign', label: 'InDesign', description: 'Typesetting InDesign / IDML packages' },
  { id: 'Proof', label: 'Proof', description: 'Review and gallery PDFs' },
  { id: 'Final Delivery', label: 'Final Delivery', description: 'Final ePUB and delivery XML archives' },
  { id: 'Art', label: 'Art', description: 'Graphic figures and image assets' },
]

interface BulkDownloadModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: number
  chapters: ChecklistChapter[]
  initialTrack?: 'manuscript' | 'art' | 'all'
}

export function BulkDownloadModal({
  isOpen,
  onClose,
  projectId,
  chapters,
  initialTrack = 'manuscript',
}: BulkDownloadModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<number>>(new Set())
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set(['Manuscript', 'XML']))
  const [downloading, setDownloading] = useState(false)

  // Fetch summary of file counts per chapter
  const summaryQuery = useQuery({
    queryKey: ['bulk-files-summary', projectId],
    queryFn: () => getBulkFilesSummary(projectId),
    enabled: isOpen,
    staleTime: 30_000,
  })

  // Build summary mapping: { chapter_id: { folder: count } }
  const summaryCounts = useMemo(() => {
    const map: Record<number, Record<string, number>> = {}
    if (summaryQuery.data?.chapters) {
      for (const ch of summaryQuery.data.chapters) {
        map[ch.chapter_id] = ch.counts || {}
      }
    }
    return map
  }, [summaryQuery.data])

  // Reset or pre-select on open
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setDownloading(false)
      const valid = chapters.filter(c => !c.chapters?.toLowerCase().includes('final files'))
      if (initialTrack === 'art') {
        const artChaps = valid.filter(c => c.chapters?.toLowerCase().includes('art'))
        setSelectedChapterIds(new Set(artChaps.map(c => c.id)))
        setSelectedFolders(new Set(['Art']))
      } else {
        const msChaps = valid.filter(c => !c.chapters?.toLowerCase().includes('art'))
        setSelectedChapterIds(new Set(msChaps.map(c => c.id)))
        setSelectedFolders(new Set(['Manuscript', 'XML']))
      }
    }
  }, [isOpen, initialTrack, chapters])

  // Count files per folder for the selected chapters
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const folder of AVAILABLE_FOLDERS) {
      counts[folder.id] = 0
    }
    for (const chId of selectedChapterIds) {
      const chCounts = summaryCounts[chId]
      if (chCounts) {
        for (const folder of AVAILABLE_FOLDERS) {
          counts[folder.id] += chCounts[folder.id] || 0
        }
      }
    }
    return counts
  }, [selectedChapterIds, summaryCounts])

  const totalFilesToDownload = useMemo(() => {
    let total = 0
    for (const folderId of selectedFolders) {
      total += folderCounts[folderId] || 0
    }
    return total
  }, [selectedFolders, folderCounts])

  const handleToggleFolder = (folderId: string) => {
    setSelectedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  const handleSelectAllFolders = () => {
    setSelectedFolders(new Set(AVAILABLE_FOLDERS.map(f => f.id)))
  }

  const handleDeselectAllFolders = () => {
    setSelectedFolders(new Set())
  }

  const handleDownload = async () => {
    if (selectedChapterIds.size === 0 || selectedFolders.size === 0) return

    setDownloading(true)
    try {
      const result = await bulkDownloadProjectFiles(projectId, {
        chapter_ids: Array.from(selectedChapterIds),
        categories: Array.from(selectedFolders),
      })

      downloadBlob(result.blob, result.filename)

      if (result.missingCount > 0) {
        toast.warning(
          `Downloaded ZIP, but ${result.missingCount} file(s) were missing on disk and omitted. See _missing_files.txt inside the ZIP.`
        )
      } else {
        toast.success(`Downloaded archive: ${result.filename}`)
      }
      onClose()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to download project files.'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!downloading) onClose()
      }}
      title="Bulk Download Chapter Files"
      description="Download current active files across selected chapters packaged in chapter/folder layout."
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {step === 2 ? (
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={downloading}
              className="text-xs font-medium px-3.5 py-2 rounded-lg border border-border hover:bg-surface text-text flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <ArrowLeft size={13} />
              Back
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={downloading}
              className="text-xs font-medium px-3.5 py-2 rounded-lg border border-border hover:bg-surface text-text transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            {step === 1 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={selectedChapterIds.size === 0}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Next</span>
                <ChevronRight size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDownload}
                disabled={selectedFolders.size === 0 || downloading}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {downloading ? (
                  <>
                    <Spinner size="sm" />
                    <span>Preparing ZIP...</span>
                  </>
                ) : (
                  <>
                    <Download size={13} />
                    <span>Download ZIP</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Step Tabs indicator */}
        <div className="flex items-center justify-between border-b border-border pb-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 1 ? 'bg-primary text-white' : 'bg-emerald-500 text-white'
                }`}
            >
              {step > 1 ? '✓' : '1'}
            </span>
            <span className={step === 1 ? 'font-bold text-text' : 'text-muted'}>
              Select Chapters
            </span>
          </div>
          <span className="text-border">→</span>
          <div className="flex items-center gap-2">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 2 ? 'bg-primary text-white' : 'bg-surface text-muted border border-border'
                }`}
            >
              2
            </span>
            <span className={step === 2 ? 'font-bold text-text' : 'text-muted'}>
              Select Folders
            </span>
          </div>
        </div>

        {/* Step 1: Chapters */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Choose the chapters you wish to bundle into the archive:
            </p>
            <ChapterChecklist
              chapters={chapters}
              selectedIds={selectedChapterIds}
              onChange={setSelectedChapterIds}
              summaryCounts={summaryCounts}
              initialTrack={initialTrack}
              showTrackFilter={true}
            />
          </div>
        )}

        {/* Step 2: Folders */}
        {step === 2 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                Folders ({selectedFolders.size}/{AVAILABLE_FOLDERS.length} selected)
              </span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleDeselectAllFolders}
                  className="text-[11px] text-primary hover:underline font-medium transition-colors"
                >
                  Deselect all
                </button>
                <span className="text-border">|</span>
                <button
                  type="button"
                  onClick={handleSelectAllFolders}
                  className="text-[11px] text-primary hover:underline font-medium transition-colors"
                >
                  Select all
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {AVAILABLE_FOLDERS.map(f => {
                const isSelected = selectedFolders.has(f.id)
                const count = folderCounts[f.id] ?? 0
                return (
                  <label
                    key={f.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer select-none ${isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-surface'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleFolder(f.id)}
                      className="mt-0.5 rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-text">{f.label}</span>
                        <span
                          className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${count > 0
                            ? 'bg-primary/10 text-primary font-bold'
                            : 'bg-surface text-muted border border-border'
                            }`}
                        >
                          {count} file{count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted mt-0.5">{f.description}</p>
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="p-3 rounded-lg bg-surface border border-border text-xs text-muted flex items-center justify-between">
              <span>
                Selected Chapters: <strong>{selectedChapterIds.size}</strong>
              </span>
              <span>
                Total Files: <strong className="text-text">{totalFilesToDownload}</strong>
              </span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
