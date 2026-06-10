import { useState, useCallback, useRef } from 'react'
import type { DragEvent, ChangeEvent } from 'react'
import {
  X, Upload, File, CheckCircle2, AlertCircle,
  Loader2, AlertTriangle,
} from 'lucide-react'
import apiClient, { getApiErrorMessage } from '@/api/client'
import { toast } from '@/store/useToastStore'
import { fileTypeIcon } from '@/config/fileManagerConfig'

// ── Types ──────────────────────────────────────────────────────────────────

type FileStatus = 'pending' | 'uploading' | 'success' | 'error'
type Step       = 'select' | 'confirm' | 'uploading' | 'done'

interface UploadFile {
  id:       string
  file:     File
  status:   FileStatus
  progress: number
  error?:   string
}

export interface BulkUploadModalProps {
  open:              boolean
  onClose:           () => void
  projectId:         number
  chapterId:         number
  chapterName:       string
  subfolder:         string
  stageName?:        string
  existingFileNames: string[]
  onComplete:        () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileStatusIcon({ status }: { status: FileStatus }) {
  if (status === 'success')  return <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0"/>
  if (status === 'error')    return <AlertCircle  size={14} className="text-red-500 flex-shrink-0"/>
  if (status === 'uploading') return <Loader2     size={14} className="text-primary animate-spin flex-shrink-0"/>
  return null
}

// ── Component ──────────────────────────────────────────────────────────────

export function BulkUploadModal({
  open, onClose, projectId, chapterId, chapterName, subfolder, stageName = '', existingFileNames, onComplete,
}: BulkUploadModalProps) {
  const [files,      setFiles]      = useState<UploadFile[]>([])
  const [step,       setStep]       = useState<Step>('select')
  const [duplicates, setDuplicates] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── File selection ───────────────────────────────────────────────────────

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming)
    setFiles(prev => {
      const existingIds = new Set(prev.map(f => f.id))
      const fresh = arr
        .filter(f => !existingIds.has(f.name + String(f.size)))
        .map(f => ({
          id:       f.name + String(f.size),
          file:     f,
          status:   'pending' as FileStatus,
          progress: 0,
        }))
      return [...prev, ...fresh]
    })
  }, [])

  const removeFile = (id: string) =>
    setFiles(prev => prev.filter(f => f.id !== id))

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }

  // ── Upload flow ──────────────────────────────────────────────────────────

  const startUpload = () => {
    if (files.length === 0) return
    const dups = files
      .filter(uf =>
        existingFileNames.some(n => n.toLowerCase() === uf.file.name.toLowerCase())
      )
      .map(uf => uf.file.name)

    if (dups.length > 0) {
      setDuplicates(dups)
      setStep('confirm')
    } else {
      void doUpload()
    }
  }

  const doUpload = async () => {
    setStep('uploading')
    let errorCount = 0

    // Build a lowercase set of existing names for O(1) duplicate lookup
    const existingLower = new Set(existingFileNames.map(n => n.toLowerCase()))

    for (const uf of files) {
      setFiles(prev => prev.map(f =>
        f.id === uf.id ? { ...f, status: 'uploading', progress: 0 } : f
      ))

      const isDuplicate = existingLower.has(uf.file.name.toLowerCase())
      const fd = new FormData()
      fd.append('category', subfolder)
      fd.append('files', uf.file)

      const url = `/projects/${projectId}/chapters/${chapterId}/files/upload`

      if (isDuplicate) {
        fd.append('replaced_by', 'user')
        fd.append('stage_name', stageName)
      } else {
        fd.append('uploaded_by', 'user')
      }

      try {
        await apiClient.post(url, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (ev) => {
            const pct = ev.total ? Math.round((ev.loaded / ev.total) * 100) : 0
            setFiles(prev => prev.map(f =>
              f.id === uf.id ? { ...f, progress: pct } : f
            ))
          },
        })
        setFiles(prev => prev.map(f =>
          f.id === uf.id ? { ...f, status: 'success', progress: 100 } : f
        ))
      } catch (err: unknown) {
        const detail = getApiErrorMessage(err, isDuplicate ? 'Replace failed' : 'Upload failed')
        setFiles(prev => prev.map(f =>
          f.id === uf.id ? { ...f, status: 'error', error: detail } : f
        ))
        errorCount++
      }
    }

    setStep('done')
    if (errorCount === 0) {
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} uploaded successfully`)
    } else {
      toast.error(`${errorCount} file${errorCount > 1 ? 's' : ''} failed to upload`)
    }
    onComplete()
  }

  // ── Reset & close ────────────────────────────────────────────────────────

  const handleClose = () => {
    if (step === 'uploading') return
    setFiles([])
    setStep('select')
    setDuplicates([])
    setIsDragging(false)
    onClose()
  }

  if (!open) return null

  const successCount = files.filter(f => f.status === 'success').length
  const errorFiles   = files.filter(f => f.status === 'error')
  const isUploading  = step === 'uploading'

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-2xl shadow-2xl border border-border w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-text">Bulk Upload</h2>
            <p className="text-[11px] text-muted mt-0.5">
              {subfolder} folder · {chapterName}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X size={15}/>
          </button>
        </div>

        {/* ── Duplicate confirmation ────────────────────────────────────── */}
        {step === 'confirm' && (
          <div className="px-5 py-5 space-y-4 overflow-y-auto">
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="text-xs font-semibold text-amber-800">
                  Some files already exist
                </p>
                <p className="text-[11px] text-amber-700 mt-1">
                  Do you want to replace them?
                </p>
              </div>
            </div>

            <div className="space-y-1 max-h-44 overflow-y-auto">
              {duplicates.map(name => (
                <div key={name}
                  className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-border">
                  <AlertCircle size={12} className="text-amber-500 flex-shrink-0"/>
                  <span className="text-xs text-text truncate">{name}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleClose}
                className="flex-1 py-2 text-xs font-medium border border-border rounded-lg text-text hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void doUpload()}
                className="flex-1 py-2 text-xs font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
              >
                Replace &amp; Upload
              </button>
            </div>
          </div>
        )}

        {/* ── Select / Uploading / Done ─────────────────────────────────── */}
        {step !== 'confirm' && (
          <>
            {/* Drop zone — only shown in select step */}
            {step === 'select' && (
              <div className="px-5 pt-5 flex-shrink-0">
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => inputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 py-8 cursor-pointer transition-all select-none
                    ${isDragging
                      ? 'border-primary bg-accent scale-[0.99]'
                      : 'border-border hover:border-primary/50 hover:bg-surface'
                    }`}
                >
                  <div className={`p-3 rounded-full transition-colors ${isDragging ? 'bg-primary/10' : 'bg-surface'}`}>
                    <Upload size={20} className={isDragging ? 'text-primary' : 'text-muted'}/>
                  </div>
                  <p className="text-xs font-semibold text-text">
                    {isDragging ? 'Drop to add files' : 'Drop files here or click to browse'}
                  </p>
                  <p className="text-[11px] text-muted">Multiple files supported</p>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={onInputChange}
                  />
                </div>
              </div>
            )}

            {/* Done summary banner */}
            {step === 'done' && (
              <div className="px-5 pt-5 flex-shrink-0">
                <div className={`flex items-center gap-3 p-3 rounded-xl border text-xs font-medium
                  ${errorFiles.length === 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}>
                  {errorFiles.length === 0
                    ? <><CheckCircle2 size={14}/> {successCount} file{successCount > 1 ? 's' : ''} uploaded successfully</>
                    : <><AlertTriangle size={14}/> {successCount} succeeded · {errorFiles.length} failed</>
                  }
                </div>
              </div>
            )}

            {/* File list */}
            {files.length > 0 && (
              <div className="px-5 pt-3 overflow-y-auto flex-1 min-h-0 space-y-1.5 pb-1">
                {files.map(uf => {
                  const ext = uf.file.name.split('.').pop() ?? ''
                  const { color } = fileTypeIcon(ext)
                  return (
                    <div key={uf.id}
                      className="flex items-center gap-2.5 px-3 py-2.5 bg-surface rounded-xl border border-border">
                      <File size={14} style={{ color }} className="flex-shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-text truncate">{uf.file.name}</p>
                          <span className="text-[10px] text-muted flex-shrink-0">
                            {formatBytes(uf.file.size)}
                          </span>
                        </div>
                        {/* Progress bar — shown while uploading or done */}
                        {(isUploading || step === 'done') && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  uf.status === 'error'   ? 'bg-red-500' :
                                  uf.status === 'success' ? 'bg-emerald-500' : 'bg-primary'
                                }`}
                                style={{ width: `${uf.progress}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted w-8 text-right tabular-nums">
                              {uf.progress}%
                            </span>
                          </div>
                        )}
                        {uf.status === 'error' && uf.error && (
                          <p className="text-[10px] text-red-500 mt-0.5 truncate">{uf.error}</p>
                        )}
                      </div>
                      {/* Status icon */}
                      <FileStatusIcon status={uf.status}/>
                      {/* Remove button — only in select step */}
                      {step === 'select' && (
                        <button
                          onClick={() => removeFile(uf.id)}
                          className="p-0.5 rounded text-muted hover:text-red-500 transition-colors flex-shrink-0"
                        >
                          <X size={12}/>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Empty state */}
            {files.length === 0 && step === 'select' && (
              <div className="px-5 pt-3 pb-2">
                <p className="text-center text-[11px] text-muted py-2">
                  No files selected yet
                </p>
              </div>
            )}

            {/* ── Footer ─────────────────────────────────────────────────── */}
            <div className="px-5 py-4 flex items-center justify-between gap-3 border-t border-border flex-shrink-0 mt-2">
              <span className="text-[11px] text-muted">
                {step === 'done'
                  ? `${successCount}/${files.length} uploaded`
                  : files.length === 0
                    ? 'No files selected'
                    : `${files.length} file${files.length > 1 ? 's' : ''} selected`
                }
              </span>
              <div className="flex gap-2">
                {step === 'done' ? (
                  <button
                    onClick={handleClose}
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    Done
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleClose}
                      disabled={isUploading}
                      className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg text-text hover:bg-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={startUpload}
                      disabled={files.length === 0 || isUploading}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isUploading
                        ? <><Loader2 size={12} className="animate-spin"/> Uploading…</>
                        : <><Upload size={12}/> Upload</>
                      }
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
