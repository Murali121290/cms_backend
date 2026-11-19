import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, ChevronRight, ArrowLeft, CheckCircle2, AlertCircle, Clock, X, Paperclip } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { getApiErrorMessage } from '@/api/client'
import { uploadChapterFiles } from '@/api/files'
import { ChapterChecklist, type ChecklistChapter } from './ChapterChecklist'

const AVAILABLE_FOLDERS = [
  { id: 'Manuscript', label: 'Manuscript', description: 'Word documents (.docx)' },
  { id: 'XML', label: 'XML', description: 'XML & DTD packages' },
  { id: 'InDesign', label: 'InDesign', description: 'InDesign files (.indd, .idml)' },
  { id: 'Proof', label: 'Proof', description: 'Proof & gallery PDFs' },
  { id: 'Final Delivery', label: 'Final Delivery', description: 'Final ePUB / XML files' },
  { id: 'Art', label: 'Art', description: 'Images and figure files' },
]

interface ChapterRowUploadState {
  status: 'idle' | 'uploading' | 'success' | 'skipped' | 'error'
  message?: string
}

interface ProjectBulkUploadModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: number
  chapters: ChecklistChapter[]
  initialTrack?: 'manuscript' | 'art' | 'all'
}

export function ProjectBulkUploadModal({
  isOpen,
  onClose,
  projectId,
  chapters,
  initialTrack = 'manuscript',
}: ProjectBulkUploadModalProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedFolder, setSelectedFolder] = useState<string>('Manuscript')
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<number>>(new Set())
  const [filesByChapter, setFilesByChapter] = useState<Record<number, File[]>>({})
  const [uploadStatusByChapter, setUploadStatusByChapter] = useState<Record<number, ChapterRowUploadState>>({})
  const [isUploading, setIsUploading] = useState(false)
  const [hasCompleted, setHasCompleted] = useState(false)

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setIsUploading(false)
      setHasCompleted(false)
      setFilesByChapter({})
      setUploadStatusByChapter({})

      const valid = chapters.filter(c => !c.chapters?.toLowerCase().includes('final files'))
      if (initialTrack === 'art') {
        setSelectedFolder('Art')
        const artChaps = valid.filter(c => c.chapters?.toLowerCase().includes('art'))
        setSelectedChapterIds(new Set(artChaps.map(c => c.id)))
      } else {
        setSelectedFolder('Manuscript')
        const msChaps = valid.filter(c => !c.chapters?.toLowerCase().includes('art'))
        setSelectedChapterIds(new Set(msChaps.map(c => c.id)))
      }
    }
  }, [isOpen, initialTrack, chapters])

  // Get selected chapter objects in order
  const selectedChaptersList = useMemo(() => {
    return chapters.filter(c => selectedChapterIds.has(c.id))
  }, [chapters, selectedChapterIds])

  const totalFilesSelected = useMemo(() => {
    return Object.values(filesByChapter).reduce((acc, files) => acc + (files?.length || 0), 0)
  }, [filesByChapter])

  const handleFilesChosen = (chapterId: number, files: FileList | null) => {
    if (!files || files.length === 0) return
    const newFiles = Array.from(files)
    setFilesByChapter(prev => ({
      ...prev,
      [chapterId]: [...(prev[chapterId] || []), ...newFiles],
    }))
  }

  const handleRemoveFile = (chapterId: number, fileIndex: number) => {
    setFilesByChapter(prev => {
      const current = prev[chapterId] || []
      const next = current.filter((_, i) => i !== fileIndex)
      if (next.length === 0) {
        const copy = { ...prev }
        delete copy[chapterId]
        return copy
      }
      return { ...prev, [chapterId]: next }
    })
  }

  const handleUploadAll = async () => {
    if (totalFilesSelected === 0) return

    setIsUploading(true)
    let totalUploaded = 0
    let totalSkipped = 0
    let totalFailed = 0

    for (const ch of selectedChaptersList) {
      const files = filesByChapter[ch.id]
      if (!files || files.length === 0) continue

      setUploadStatusByChapter(prev => ({
        ...prev,
        [ch.id]: { status: 'uploading' },
      }))

      try {
        const res = await uploadChapterFiles({
          projectId,
          chapterId: ch.id,
          category: selectedFolder,
          files,
        })

        const upCount = res.uploaded?.length || 0
        const skipCount = res.skipped?.length || 0
        totalUploaded += upCount
        totalSkipped += skipCount

        if (skipCount > 0 && upCount === 0) {
          setUploadStatusByChapter(prev => ({
            ...prev,
            [ch.id]: {
              status: 'skipped',
              message: res.skipped[0]?.message || `${skipCount} skipped (locked)`,
            },
          }))
        } else {
          const detail = res.uploaded.map(u => `${u.file?.filename || 'file'} (${u.operation})`).join(', ')
          setUploadStatusByChapter(prev => ({
            ...prev,
            [ch.id]: {
              status: 'success',
              message: detail || `${upCount} uploaded`,
            },
          }))
        }
      } catch (err) {
        totalFailed += files.length
        setUploadStatusByChapter(prev => ({
          ...prev,
          [ch.id]: {
            status: 'error',
            message: getApiErrorMessage(err, 'Upload failed'),
          },
        }))
      }
    }

    setIsUploading(false)
    setHasCompleted(true)

    // Invalidate caches to refresh chapter cards and file tables
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-chapters', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['chapter-files'] }),
      queryClient.invalidateQueries({ queryKey: ['bulk-files-summary', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] }),
    ])

    if (totalFailed > 0) {
      toast.error(`Bulk upload completed with errors: ${totalUploaded} uploaded, ${totalFailed} failed.`)
    } else {
      toast.success(
        `Bulk upload completed: ${totalUploaded} file${totalUploaded !== 1 ? 's' : ''} uploaded${totalSkipped > 0 ? `, ${totalSkipped} skipped` : ''
        }.`
      )
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isUploading) onClose()
      }}
      title="Bulk Upload Chapter Files"
      description="Upload new or updated files to multiple chapters simultaneously. Existing same-name files will be versioned into Archive/."
      size="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          {step === 2 && !hasCompleted ? (
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={isUploading}
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
              disabled={isUploading}
              className="text-xs font-medium px-3.5 py-2 rounded-lg border border-border hover:bg-surface text-text transition-colors disabled:opacity-50"
            >
              {hasCompleted ? 'Close' : 'Cancel'}
            </button>

            {step === 1 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={selectedChapterIds.size === 0 || !selectedFolder}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Next: Choose Files</span>
                <ChevronRight size={13} />
              </button>
            ) : hasCompleted ? (
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white shadow-sm transition-colors"
              >
                Done
              </button>
            ) : (
              <button
                type="button"
                onClick={handleUploadAll}
                disabled={totalFilesSelected === 0 || isUploading}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <>
                    <Spinner size="sm" />
                    <span>Uploading files...</span>
                  </>
                ) : (
                  <>
                    <Upload size={13} />
                    <span>Upload All ({totalFilesSelected})</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Step indicator */}
        <div className="flex items-center justify-between border-b border-border pb-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 1 ? 'bg-primary text-white' : 'bg-emerald-500 text-white'
                }`}
            >
              {step > 1 ? '✓' : '1'}
            </span>
            <span className={step === 1 ? 'font-bold text-text' : 'text-muted'}>
              Target Folder & Chapters
            </span>
          </div>
          <span className="text-border">→</span>
          <div className="flex items-center gap-2">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 2 ? 'bg-primary text-white' : 'bg-surface text-muted border border-border'
                }`}
            >
              {hasCompleted ? '✓' : '2'}
            </span>
            <span className={step === 2 ? 'font-bold text-text' : 'text-muted'}>
              Pick Files & Upload
            </span>
          </div>
        </div>

        {/* Step 1: Folder & Chapter selection */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1.5">
                1. Select Target Folder for Upload:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {AVAILABLE_FOLDERS.map(f => {
                  const isSelected = selectedFolder === f.id
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedFolder(f.id)}
                      className={`p-2.5 rounded-lg border text-left transition-all ${isSelected
                        ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                        : 'border-border hover:bg-surface text-text'
                        }`}
                    >
                      <p className="font-semibold text-xs">{f.label}</p>
                      <p className="text-[10px] text-muted mt-0.5 truncate">{f.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="pt-2">
              <label className="block text-xs font-semibold text-text mb-1.5">
                2. Select Chapters to Upload to:
              </label>
              <ChapterChecklist
                chapters={chapters}
                selectedIds={selectedChapterIds}
                onChange={setSelectedChapterIds}
                initialTrack={initialTrack}
                showTrackFilter={true}
              />
            </div>
          </div>
        )}

        {/* Step 2: Per-chapter file picker */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="p-2.5 rounded-lg bg-surface border border-border text-xs text-muted flex items-center justify-between">
              <span>
                Target Folder: <strong className="text-primary font-semibold">{selectedFolder}</strong> (
                {selectedChaptersList.length} chapters selected)
              </span>
              <span className="text-[11px] font-mono">
                {totalFilesSelected} file{totalFilesSelected !== 1 ? 's' : ''} ready
              </span>
            </div>

            <div className="border border-border rounded-lg divide-y divide-border max-h-80 overflow-y-auto bg-background">
              {selectedChaptersList.map(ch => {
                const files = filesByChapter[ch.id] || []
                const statusState = uploadStatusByChapter[ch.id]
                const isArt = ch.chapters?.toLowerCase().includes('art')

                return (
                  <div
                    key={ch.id}
                    className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-surface/50 transition-colors"
                  >
                    <div className="min-w-[170px] flex-shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded uppercase ${isArt
                            ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300'
                            : 'bg-primary/10 text-primary'
                            }`}
                        >
                          {isArt ? ch.chapters : `Ch ${ch.chapters}`}
                        </span>
                        <span className="font-medium truncate text-text">
                          {ch.chapter_title || `Chapter ${ch.chapters}`}
                        </span>
                      </div>
                    </div>

                    {/* File Picker & Chosen Files */}
                    <div className="flex-1 flex flex-wrap items-center gap-2 min-w-0">
                      {!hasCompleted && (
                        <label className="px-2.5 py-1.5 rounded-lg border border-dashed border-border hover:border-primary hover:bg-surface cursor-pointer text-xs text-text flex items-center gap-1.5 transition-colors flex-shrink-0">
                          <Paperclip size={12} className="text-muted" />
                          <span>Choose Files</span>
                          <input
                            type="file"
                            multiple
                            disabled={isUploading}
                            onChange={e => handleFilesChosen(ch.id, e.target.files)}
                            className="hidden"
                          />
                        </label>
                      )}

                      {files.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {files.map((file, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface border border-border text-[11px] font-mono text-text"
                            >
                              <span className="truncate max-w-[140px]">{file.name}</span>
                              {!hasCompleted && !isUploading && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFile(ch.id, i)}
                                  className="text-muted hover:text-danger ml-0.5"
                                >
                                  <X size={10} />
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted italic">No files selected</span>
                      )}
                    </div>

                    {/* Status Column */}
                    <div className="min-w-[120px] text-right flex-shrink-0 font-mono text-[11px]">
                      {statusState?.status === 'uploading' ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <Spinner size="sm" /> Uploading...
                        </span>
                      ) : statusState?.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                          <CheckCircle2 size={12} /> {statusState.message || 'Uploaded'}
                        </span>
                      ) : statusState?.status === 'skipped' ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                          <Clock size={12} /> {statusState.message || 'Skipped'}
                        </span>
                      ) : statusState?.status === 'error' ? (
                        <span className="inline-flex items-center gap-1 text-danger font-semibold">
                          <AlertCircle size={12} /> {statusState.message || 'Failed'}
                        </span>
                      ) : files.length > 0 ? (
                        <span className="text-amber-600 font-medium">Ready</span>
                      ) : (
                        <span className="text-muted">Waiting</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
