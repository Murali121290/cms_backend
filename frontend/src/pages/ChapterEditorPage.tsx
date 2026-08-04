/**
 * ChapterEditorPage
 * Full-screen document viewer/editor.
 * Opened ONLY when the user clicks "View" from the file manager.
 *
 * Route: …/chapters/:chapterId/view/:subfolder/:filename
 */
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Save, Loader2, Download } from 'lucide-react'
import { DocxViewer } from '@/components/DocxViewer'
import { SourceEditor } from '@/components/epub_validator/SourceEditor'
import 'pdfjs-viewer-element'
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

  const [xmlContent, setXmlContent] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<string | null>(null)
  const [xmlLoading, setXmlLoading] = useState(false)
  const [xmlSaving, setXmlSaving] = useState(false)
  const [isXmlDirty, setIsXmlDirty] = useState(false)

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
  const logFilename = decodedFilename.replace(/\.xml$/i, '.log')

  // Build download / view URL from the API
  const fileUrl = chapterId && projectId && decodedSubfolder && decodedFilename
    ? `/api/uploads/${projectId}/chapter/${(() => {
        // Derive chapter_name from project file_details — match the chapter
        // this page is actually viewing (by chapter number), not just the
        // first entry in the array (see ChapterDetailPage.tsx for the same
        // pattern already working there).
        const chNo = chapter?.chapters?.match(/\d+/)?.[0]
        if (!project?.file_details || !chNo) return `chapter-${chNo ?? chapterId}`
        const cf = (project.file_details as { chapter_folders?: { chapters?: Array<{ chapter_name: string }> } }).chapter_folders
        return cf?.chapters?.find(c => c.chapter_name === `chapter-${chNo}`)?.chapter_name ?? `chapter-${chNo}`
      })()}/${decodedSubfolder}/${encodeURIComponent(decodedFilename)}/download`
    : null

  const logFileUrl = chapterId && projectId && decodedSubfolder && decodedFilename
    ? `/api/uploads/${projectId}/chapter/${(() => {
        const chNo = chapter?.chapters?.match(/\d+/)?.[0]
        if (!project?.file_details || !chNo) return `chapter-${chNo ?? chapterId}`
        const cf = (project.file_details as { chapter_folders?: { chapters?: Array<{ chapter_name: string }> } }).chapter_folders
        return cf?.chapters?.find(c => c.chapter_name === `chapter-${chNo}`)?.chapter_name ?? `chapter-${chNo}`
      })()}/${decodedSubfolder}/${encodeURIComponent(logFilename)}/download`
    : null

  const saveUrl = chapterId && projectId && decodedSubfolder && decodedFilename
    ? `/api/uploads/${projectId}/chapter/${(() => {
        const chNo = chapter?.chapters?.match(/\d+/)?.[0]
        if (!project?.file_details || !chNo) return `chapter-${chNo ?? chapterId}`
        const cf = (project.file_details as { chapter_folders?: { chapters?: Array<{ chapter_name: string }> } }).chapter_folders
        return cf?.chapters?.find(c => c.chapter_name === `chapter-${chNo}`)?.chapter_name ?? `chapter-${chNo}`
      })()}/${decodedSubfolder}/${encodeURIComponent(decodedFilename)}/save`
    : null

  const isEditable = !!chapter?.current_assignee_name

  // pdfjs-viewer-element only reacts to a `src` attribute change once its
  // internal viewer app has finished bootstrapping (its attributeChangedCallback
  // no-ops until then) — setting `src` as a plain JSX prop loses that race,
  // since React applies it before the element is even connected to the DOM.
  // Waiting on the element's own `initPromise` before setting it imperatively
  // sidesteps that entirely.
  const pdfViewerRef = useRef<(HTMLElement & { initPromise?: Promise<unknown> }) | null>(null)
  useEffect(() => {
    if (ext !== 'pdf' || !fileUrl) return
    const el = pdfViewerRef.current
    if (!el) return
    let cancelled = false
    Promise.resolve(el.initPromise).then(() => {
      if (!cancelled) el.setAttribute('src', fileUrl)
    })
    return () => { cancelled = true }
  }, [ext, fileUrl])

  // Warning for unsaved changes before leaving browser tab
  useEffect(() => {
    if (!isXmlDirty) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isXmlDirty])

  // Fetch XML and Log files if file is XML
  useEffect(() => {
    if (ext !== 'xml' || !fileUrl || !logFileUrl || loading || !chapter) return
    setXmlLoading(true)
    
    fetch(fileUrl)
      .then(res => {
        if (!res.ok) throw new Error('XML file not found')
        return res.text()
      })
      .then(text => {
        setXmlContent(text)
      })
      .catch(err => {
        console.error(err)
        toast.error('Failed to load XML content')
      })
      .finally(() => setXmlLoading(false))

    fetch(logFileUrl)
      .then(res => {
        if (!res.ok) return 'No log file found.'
        return res.text()
      })
      .then(text => {
        setLogContent(text)
      })
      .catch(() => {
        setLogContent('No log file found.')
      })
  }, [ext, fileUrl, logFileUrl])

  const handleXmlSave = async () => {
    if (!saveUrl || xmlContent === null || xmlSaving) return
    setXmlSaving(true)
    try {
      const res = await fetch(saveUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: xmlContent }),
      })
      if (!res.ok) throw new Error('Save failed')
      const data = await res.json()
      setIsXmlDirty(false)
      if (data.log_content) {
        setLogContent(data.log_content)
      }
      toast.success('XML file saved successfully')
    } catch (err) {
      toast.error('Failed to save XML file')
    } finally {
      setXmlSaving(false)
    }
  }

  const handleBack = () => {
    if (isXmlDirty) {
      if (!window.confirm('You have unsaved changes. Do you really want to leave?')) {
        return
      }
    }
    navigate(-1)
  }

  if (loading) return <FullPageSpinner/>

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">

      {/* ── TOOLBAR ──────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0 shadow-sm">
        {/* Back to file manager */}
        <button onClick={handleBack}
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

        {/* Save */}
        {isEditable && (
          <button
            onClick={ext === 'xml' ? handleXmlSave : () => toast.success('Auto-saved')}
            disabled={ext === 'xml' && xmlSaving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50">
            {xmlSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13}/>}
            {ext === 'xml' && isXmlDirty ? 'Save*' : 'Save'}
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
            key={fileUrl}
            ref={pdfViewerRef}
            style={{ width: '100%', height: '100%', display: 'block', border: '0' }}
          />
        ) : (ext === 'html' || ext === 'htm') ? (
          <iframe
            src={fileUrl}
            title={decodedFilename}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-white"
          />
        ) : (ext === 'docx' || ext === 'doc') ? (
          <DocxViewer src={fileUrl} editable={isEditable} className="h-full"/>
        ) : (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) ? (
          <div className="h-full flex items-center justify-center bg-gray-50 overflow-auto p-8">
            <img src={fileUrl} alt={decodedFilename}
              className="max-w-full max-h-full object-contain rounded-lg shadow-md"/>
          </div>
        ) : ext === 'xml' ? (
          xmlLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="flex h-full w-full">
              {/* Left Panel: XML Editor */}
              <div className="w-1/2 h-full border-r border-gray-200 flex flex-col">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wider flex items-center justify-between flex-shrink-0">
                  <span>XML Source</span>
                  {isXmlDirty && <span className="text-amber-600 normal-case font-normal font-sans">Unsaved changes</span>}
                </div>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <SourceEditor
                    value={xmlContent ?? ''}
                    onChange={(val) => {
                      setXmlContent(val)
                      setIsXmlDirty(true)
                    }}
                    readOnly={!isEditable}
                    className="flex-1 min-h-0"
                  />
                </div>
              </div>
              
              {/* Right Panel: Log (Read-only) */}
              <div className="w-1/2 h-full flex flex-col bg-gray-50">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wider flex-shrink-0">
                  <span>Conversion Log</span>
                </div>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <SourceEditor
                    value={logContent ?? 'Loading log...'}
                    onChange={() => {}}
                    readOnly={true}
                    className="flex-1 min-h-0 bg-gray-50 opacity-80"
                  />
                </div>
              </div>
            </div>
          )
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
