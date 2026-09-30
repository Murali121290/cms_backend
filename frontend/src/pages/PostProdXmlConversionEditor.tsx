import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Save, CheckCircle, Code, FileText, Download } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/useToastStore'
import api from '@/api/client'
import { SourceEditor } from '@/components/epub_validator/SourceEditor'

export function PostProdXmlConversionEditor() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<any>(null)
  const [xmlContent, setXmlContent] = useState<string>('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [htmlContent, setHtmlContent] = useState<string>('')
  const [viewMode, setViewMode] = useState<'xml' | 'html'>('xml')
  const [isS4cConverting, setIsS4cConverting] = useState(false)
  const [isTargetConverting, setIsTargetConverting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useDocumentTitle(`XML Editor - Project ${projectId || ''}`)

  useEffect(() => {
    fetchProject()
  }, [projectId])

  const fetchProject = async () => {
    try {
      // In a real app we might have a GET /projects/{id} but since we don't, 
      // we can fetch all and filter or assume we just have basic info.
      const res = await api.get(`/post-prod/xml-conversion/projects`)
      const found = res.data.find((p: any) => p.id === Number(projectId))
      if (found) {
        setProject(found)
        // Also fetch the existing XML if any
        try {
          const xmlRes = await api.get(`/post-prod/xml-conversion/projects/${projectId}/xml`)
          if (xmlRes.data?.xml) {
            setXmlContent(xmlRes.data.xml)
          }
          const htmlRes = await api.get(`/post-prod/xml-conversion/projects/${projectId}/html`)
          if (htmlRes.data?.html) {
            setHtmlContent(htmlRes.data.html)
            if (htmlRes.data.html.indexOf('No final XML') === -1) {
              setViewMode('html')
            }
          }
        } catch (err) {
          console.error("Failed to fetch existing XML/HTML", err)
        }
      } else {
        toast.error('Project not found')
        navigate('/post-production/xml-conversion')
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load project details')
    }
  }

  const handleS4cConversion = async () => {
    setIsS4cConverting(true)
    try {
      const res = await api.post(`/post-prod/xml-conversion/projects/${projectId}/s4c-convert`)
      setXmlContent(res.data.xml)
      toast.success('Converted to S4C XML successfully')
    } catch (err) {
      console.error(err)
      toast.error('Failed to run S4C conversion')
    } finally {
      setIsS4cConverting(false)
    }
  }

  const handleTargetConversion = async () => {
    if (!xmlContent) {
      toast.error('Please run S4C conversion first')
      return
    }
    setIsTargetConverting(true)
    try {
      const res = await api.post(`/post-prod/xml-conversion/projects/${projectId}/target-convert`)
      setXmlContent(res.data.xml)

      const htmlRes = await api.get(`/post-prod/xml-conversion/projects/${projectId}/html`)
      if (htmlRes.data?.html) {
        setHtmlContent(htmlRes.data.html)
        setViewMode('html')
      }
      toast.success('Converted to Target XML successfully')
    } catch (err) {
      console.error(err)
      toast.error('Failed to run Target conversion')
    } finally {
      setIsTargetConverting(false)
    }
  }

  const handleSaveXml = async () => {
    setIsSaving(true)
    try {
      await api.post(`/post-prod/xml-conversion/projects/${projectId}/xml`, { xml: xmlContent })

      // Update HTML preview if possible
      const htmlRes = await api.get(`/post-prod/xml-conversion/projects/${projectId}/html`)
      if (htmlRes.data?.html) {
        setHtmlContent(htmlRes.data.html)
      }

      setHasUnsavedChanges(false)
      toast.success('XML saved successfully')
    } catch (err) {
      console.error(err)
      toast.error('Failed to save XML')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDownloadXml = () => {
    if (!xmlContent) return;
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = project?.filename ? project.filename.replace(/\.pdf$/i, '_final.xml') : 'final.xml';
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloading ${fileName}`);
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (hasUnsavedChanges && !isSaving) {
          handleSaveXml()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasUnsavedChanges, isSaving, xmlContent, projectId])

  if (!project) {
    return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div></div>
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/post-production/xml-conversion')}
            className="p-1.5 hover:bg-muted/10 rounded-md transition-colors text-muted hover:text-text"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-sm font-bold text-text m-0 flex items-center gap-2">
              {project.project_name}
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary border border-primary/20">
                {project.target_format}
              </span>
            </h1>
            <p className="text-[11px] text-muted">{project.filename}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {xmlContent && (
            <div className="flex bg-card rounded-md border p-0.5 mr-2">
              <button
                onClick={() => setViewMode('xml')}
                className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${viewMode === 'xml' ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
              >
                Code
              </button>
              <button
                onClick={() => setViewMode('html')}
                className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${viewMode === 'html' ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
              >
                Preview
              </button>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleS4cConversion}
            disabled={isS4cConverting}
            className="text-xs h-8"
          >
            {isS4cConverting ? (
              <span className="flex items-center gap-1.5"><div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Converting...</span>
            ) : (
              <span className="flex items-center gap-1.5"><Code size={14} /> S4C XML Conversion</span>
            )}
          </Button>

          {xmlContent && viewMode === 'xml' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveXml}
              disabled={isSaving || !hasUnsavedChanges}
              className={`text-xs h-8 ${hasUnsavedChanges ? 'border-amber-500/50 text-amber-500 hover:bg-amber-500/10' : ''}`}
            >
              {isSaving ? (
                <span className="flex items-center gap-1.5"><div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /> Saving...</span>
              ) : (
                <span className="flex items-center gap-1.5"><Save size={14} /> Save </span>
              )}
            </Button>
          )}

          <Button
            variant="primary"
            size="sm"
            onClick={handleTargetConversion}
            disabled={isTargetConverting || !xmlContent}
            className="text-xs h-8"
          >
            {isTargetConverting ? (
              <span className="flex items-center gap-1.5"><div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Converting...</span>
            ) : (
              <span className="flex items-center gap-1.5"><Play size={14} /> Convert Target XML</span>
            )}
          </Button>

          {xmlContent && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadXml}
              className="text-xs h-8"
              title="Download the current XML content"
            >
              <span className="flex items-center gap-1.5"><Download size={14} /> Download XML</span>
            </Button>
          )}

        </div>
      </header>

      {/* Main Content Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left pane: PDF Viewer */}
        <div className="w-1/2 border-r border-border bg-card/30 flex flex-col relative">
          <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur text-white text-[10px] font-medium rounded z-10 flex items-center gap-1.5 shadow-sm">
            <FileText size={12} /> Source PDF
          </div>
          <iframe
            src={`/api/v2/post-prod/xml-conversion/projects/${projectId}/source-pdf#toolbar=0&navpanes=0&view=FitH`}
            className="w-full h-full border-0"
            title="Source PDF"
          />
        </div>

        {/* Right pane: XML Editor */}
        <div className="w-1/2 flex flex-col relative bg-[#1e1e1e]">
          <div className="h-9 bg-[#2d2d2d] flex items-center px-3 border-b border-black/40">
            <div className="flex items-center gap-1.5 text-[#cccccc] text-xs font-mono">
              <Code size={13} className="text-[#569cd6]" />
              {xmlContent ? (viewMode === 'xml' ? 'output.xml' : 'preview.html') : 'No output yet'}
            </div>
          </div>

          <div className="flex-1 overflow-auto relative">
            {!xmlContent && !htmlContent ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                  <Code size={24} className="text-[#858585]" />
                </div>
                <h3 className="text-[#cccccc] text-sm font-medium mb-1.5">No XML generated yet</h3>
                <p className="text-[#858585] text-xs max-w-xs leading-relaxed">
                  Click the <strong>S4C XML Conversion</strong> button above to extract the content from the PDF into our intermediate format.
                </p>
              </div>
            ) : viewMode === 'xml' ? (
              <SourceEditor
                value={xmlContent}
                onChange={(val) => {
                  setXmlContent(val)
                  setHasUnsavedChanges(true)
                }}
                onSave={handleSaveXml}
                onDtdValidate={async () => {
                  if (hasUnsavedChanges) {
                    await handleSaveXml();
                  }
                  const res = await api.post(`/post-prod/xml-conversion/projects/${projectId}/validate`);
                  return res.data;
                }}
                className="w-full h-full text-[13px]"
              />
            ) : (
              <iframe
                className="w-full h-full bg-white border-0"
                title="Preview"
                srcDoc={htmlContent}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
