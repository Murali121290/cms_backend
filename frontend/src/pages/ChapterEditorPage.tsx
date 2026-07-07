/**
 * ChapterEditorPage
 * Full-screen document viewer/editor.
 * Opened ONLY when the user clicks "View" from the file manager.
 *
 * Route: …/chapters/:chapterId/view/:subfolder/:filename
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Save, Loader2, Download } from 'lucide-react'
import { DocxViewer } from '@/components/DocxViewer'
import { projectsApi } from '@/api/projects'
import { chaptersApi } from '@/api/chapters'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'

export function ChapterEditorPage() {
  const { projectId, chapterId, subfolder, filename } = useParams<{
    projectId:  string
    chapterId:  string
    subfolder:  string
    filename:   string
  }>()
  const navigate = useNavigate()

  const [loading,  setLoading]  = useState(true)
  const [chapter,  setChapter]  = useState<{ chapter_title: string | null; chapters: string; current_assignee_name: string | null } | null>(null)
  const [project,  setProject]  = useState<{ file_details: Record<string,unknown> | null } | null>(null)

  useEffect(() => {
    if (!chapterId || !projectId) return
    setLoading(true)
    Promise.all([
      chaptersApi.getById(Number(chapterId)),
      projectsApi.getById(Number(projectId)),
    ])
      .then(([ch, proj]) => {
        setChapter(ch)
        setProject((proj as any).project as { file_details: Record<string, unknown> | null })
      })
      .catch(() => toast.error('Failed to load chapter'))
      .finally(() => setLoading(false))
  }, [chapterId, projectId])

  useEffect(() => {
    const scriptId = 'pdfjs-viewer-element-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.type = 'module';
      script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-viewer-element/dist/pdfjs-viewer-element.js';
      document.body.appendChild(script);
    }
  }, [])

  const decodedFilename  = filename  ? decodeURIComponent(filename)  : ''
  const decodedSubfolder = subfolder ? decodeURIComponent(subfolder) : ''
  const ext = decodedFilename.split('.').pop()?.toLowerCase() ?? ''

  // Build download / view URL from the API
  const fileUrl = chapterId && projectId && decodedSubfolder && decodedFilename
    ? `/api/uploads/${projectId}/chapter/${(() => {
        // Derive chapter_name from project file_details
        if (!project?.file_details) return `chapter-${chapterId}`
        const cf = (project.file_details as { chapter_folders?: { chapters?: Array<{ chapter_name: string }> } }).chapter_folders
        return cf?.chapters?.find(() => true)?.chapter_name ?? `chapter-${chapterId}`
      })()}/${decodedSubfolder}/${encodeURIComponent(decodedFilename)}/download`
    : null

  const isEditable = !!chapter?.current_assignee_name

  if (loading) return <FullPageSpinner/>

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">

      {/* ── TOOLBAR ──────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0 shadow-sm">
        {/* Back to file manager */}
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          <ArrowLeft size={13}/> Back to Files
        </button>

        <div className="w-px h-5 bg-gray-200 flex-shrink-0"/>

        {/* File name */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileText size={14} className="text-gray-400 flex-shrink-0"/>
          <span className="text-sm font-semibold text-gray-900 truncate">{decodedFilename}</span>
          <span className="text-[10px] text-gray-400">{decodedSubfolder}</span>
          {!isEditable && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 flex-shrink-0">
              View Only
            </span>
          )}
        </div>

        {/* Download */}
        {fileUrl && (
          <a href={fileUrl} download={decodedFilename}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <Download size={13}/> Download
          </a>
        )}

        {/* Save (placeholder) */}
        {isEditable && (
          <button
            onClick={() => toast.success('Auto-saved')}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
            <Save size={13}/> Save
          </button>
        )}
      </header>

      {/* ── DOCUMENT AREA — full screen, no split ─────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {!fileUrl ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <FileText size={48} className="mx-auto mb-3 opacity-20"/>
              <p className="text-sm">File not found</p>
            </div>
          </div>
        ) : ext === 'pdf' ? (
          // @ts-ignore
          <pdfjs-viewer-element
            src={fileUrl}
            style={{ width: '100%', height: '100%', display: 'block', border: '0' }}
          />
        ) : (ext === 'html' || ext === 'htm') ? (
          <iframe
            src={fileUrl}
            title={decodedFilename}
            className="w-full h-full border-0 bg-white"
          />
        ) : (ext === 'docx' || ext === 'doc') ? (
          <DocxViewer src={fileUrl} editable={isEditable} className="h-full"/>
        ) : (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) ? (
          <div className="h-full flex items-center justify-center bg-gray-50 overflow-auto p-8">
            <img src={fileUrl} alt={decodedFilename}
              className="max-w-full max-h-full object-contain rounded-lg shadow-md"/>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
            <FileText size={52} className="text-gray-200"/>
            <p className="text-sm font-semibold text-gray-700">{decodedFilename}</p>
            <p className="text-xs text-gray-400">.{ext.toUpperCase()} files cannot be previewed in the browser.</p>
            <a href={fileUrl} download={decodedFilename}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors">
              ⬇ Download to view
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
