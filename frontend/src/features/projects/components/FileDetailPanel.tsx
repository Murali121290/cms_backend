import { useState, useEffect } from 'react'
import { X, Download, Loader2, AlertCircle, Clock } from 'lucide-react'
import type { FileRow } from '@/pages/ChapterFilePage'
import { getFileVersions, downloadFileVersion } from '@/api/files'
import type { VersionRecord } from '@/types/api'

interface FileDetailPanelProps {
  file: FileRow
  onClose: () => void
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 border-b border-border last:border-0">
      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</span>
      <div className="text-xs text-text">{children}</div>
    </div>
  )
}

function statusCls(v: string) {
  if (v === 'valid' || v === 'approved') return 'bg-emerald-100 text-emerald-700'
  if (v === 'invalid' || v === 'rejected') return 'bg-red-100 text-red-700'
  return 'bg-amber-100 text-amber-700'
}

export function FileDetailPanel({ file, onClose }: FileDetailPanelProps) {
  const [versions, setVersions] = useState<VersionRecord[] | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState(false)

  const fileDbId = file.db_id

  useEffect(() => {
    if (!fileDbId) return
    setVersionsLoading(true)
    setVersionsError(false)
    setVersions(null)
    getFileVersions(fileDbId)
      .then(res => setVersions([...res.versions].sort((a, b) => b.version_num - a.version_num)))
      .catch(() => setVersionsError(true))
      .finally(() => setVersionsLoading(false))
  }, [fileDbId])

  async function handleDownloadVersion(v: VersionRecord) {
    if (!fileDbId) return
    try {
      const { blob, filename } = await downloadFileVersion(fileDbId, v.id, v.archived_filename)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // silent fail
    }
  }

  return (
    <aside className="w-80 flex-shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">

      {/* Panel header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0 bg-surface">
        <span className="text-xs font-bold text-text flex-1 truncate" title={file.file_name}>
          {file.file_name}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded text-muted hover:text-text hover:bg-card transition-colors flex-shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Metadata ─────────────────────────────────────────── */}
        <div className="px-4 pt-3 pb-2">
          <p className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Metadata</p>
          <div>
            <MetaRow label="File Name">{file.file_name}</MetaRow>
            <MetaRow label="Folder">{file.subfolder}</MetaRow>
            <MetaRow label="Size">{file.file_size || '—'}</MetaRow>
            <MetaRow label="Uploaded By">{file.uploaded_by || '—'}</MetaRow>
            <MetaRow label="Uploaded On">
              {file.uploaded_on ? fmtDate(file.uploaded_on) : '—'}
            </MetaRow>

            {file.pageCount != null && (
              <MetaRow label="Page Count">{file.pageCount}</MetaRow>
            )}
            {file.dpi != null && (
              <MetaRow label="DPI">{file.dpi}</MetaRow>
            )}
            {file.width != null && file.height != null && (
              <MetaRow label="Dimensions">{file.width} × {file.height}</MetaRow>
            )}
            {file.colorProfile && (
              <MetaRow label="Color Profile">{file.colorProfile}</MetaRow>
            )}
            {file.xmlType && (
              <MetaRow label="XML Type">{file.xmlType}</MetaRow>
            )}
            {file.packageStatus && (
              <MetaRow label="Package Status">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface border border-border text-muted">
                  {file.packageStatus}
                </span>
              </MetaRow>
            )}
            {file.reviewer && (
              <MetaRow label="Reviewer">{file.reviewer}</MetaRow>
            )}
            {file.reviewStatus && (
              <MetaRow label="Review Status">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls(file.reviewStatus)}`}>
                  {file.reviewStatus}
                </span>
              </MetaRow>
            )}
            {file.validationStatus && (
              <MetaRow label="Validation">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusCls(file.validationStatus)}`}>
                  {file.validationStatus}
                </span>
              </MetaRow>
            )}
          </div>
        </div>

        {/* ── Version History ──────────────────────────────────── */}
        <div className="px-4 pt-2 pb-4">
          <p className="text-[10px] font-bold text-muted uppercase tracking-widest mb-2 flex items-center gap-1">
            <Clock size={10} /> Version History
          </p>

          {!fileDbId ? (
            <p className="text-[11px] text-muted italic">
              Version history is unavailable for folder-based file entries.
            </p>
          ) : versionsLoading ? (
            <div className="flex items-center gap-2 text-muted">
              <Loader2 size={12} className="animate-spin" />
              <span className="text-xs">Loading versions…</span>
            </div>
          ) : versionsError ? (
            <div className="flex items-center gap-1.5 text-red-600">
              <AlertCircle size={12} />
              <span className="text-[11px]">Could not load versions.</span>
            </div>
          ) : versions && versions.length === 0 ? (
            <p className="text-[11px] text-muted italic">No version history found.</p>
          ) : versions ? (
            <ol className="flex flex-col gap-2">
              {versions.map(v => (
                <li key={v.id} className="flex items-start gap-2 p-2 rounded-lg bg-surface border border-border">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0 mt-0.5">
                    v{v.version_num}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-text truncate" title={v.archived_filename}>
                      {v.archived_filename}
                    </p>
                    <p className="text-[10px] text-muted">{fmtDate(v.uploaded_at)}</p>
                    {v.uploaded_by_id != null && (
                      <p className="text-[10px] text-muted">User #{v.uploaded_by_id}</p>
                    )}
                  </div>
                  <button
                    onClick={() => void handleDownloadVersion(v)}
                    className="p-1 rounded text-muted hover:text-primary hover:bg-accent transition-colors flex-shrink-0 mt-0.5"
                    title="Download this version"
                  >
                    <Download size={12} />
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </div>

      </div>
    </aside>
  )
}
