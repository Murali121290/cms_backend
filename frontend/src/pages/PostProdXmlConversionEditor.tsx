import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Save, CheckCircle, Code, FileText, Download, ChevronDown, AlertTriangle, AlertCircle, Loader2 } from 'lucide-react'
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
  const [targetFormat, setTargetFormat] = useState('JATS')
  const [isFormatDropdownOpen, setIsFormatDropdownOpen] = useState(false)
  const [xmlType, setXmlType] = useState<'s4c' | 'final' | null>(null)
  
  const [isQcModalOpen, setIsQcModalOpen] = useState(false)
  const [isQcRunning, setIsQcRunning] = useState(false)
  const [qcResult, setQcResult] = useState<{isWellFormed: boolean, wellFormedErrors: string[], isDtdValid: boolean, dtdErrors: string[]} | null>(null)
  const [isManuallyVerified, setIsManuallyVerified] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)

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
            if (xmlRes.data.type) setXmlType(xmlRes.data.type)
            
            if (xmlRes.data.type === 's4c') {
              const s4cHtmlRes = await api.get(`/post-prod/xml-conversion/projects/${projectId}/s4c-html`)
              if (s4cHtmlRes.data?.html && s4cHtmlRes.data.html.indexOf('No S4C XML') === -1) {
                setHtmlContent(s4cHtmlRes.data.html)
                setViewMode('html')
              }
            } else {
              const htmlRes = await api.get(`/post-prod/xml-conversion/projects/${projectId}/html`)
              if (htmlRes.data?.html && htmlRes.data.html.indexOf('No final XML') === -1) {
                setHtmlContent(htmlRes.data.html)
                setViewMode('html')
              }
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
      setXmlType('s4c')
      
      const htmlRes = await api.get(`/post-prod/xml-conversion/projects/${projectId}/s4c-html`)
      if (htmlRes.data?.html) {
        setHtmlContent(htmlRes.data.html)
        setViewMode('html')
      }
      
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
      const res = await api.post(`/post-prod/xml-conversion/projects/${projectId}/target-convert?format=${targetFormat}`)
      setXmlContent(res.data.xml)
      setXmlType('final')

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
      await api.post(`/post-prod/xml-conversion/projects/${projectId}/xml`, { xml: xmlContent, type: xmlType })

      // Update HTML preview if possible
      let htmlRes;
      if (xmlType === 's4c') {
        htmlRes = await api.get(`/post-prod/xml-conversion/projects/${projectId}/s4c-html`)
      } else {
        htmlRes = await api.get(`/post-prod/xml-conversion/projects/${projectId}/html`)
      }
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

  const handleRunQc = async () => {
    setIsQcModalOpen(true)
    setIsQcRunning(true)
    setIsManuallyVerified(false)
    setQcResult(null)
    try {
      if (hasUnsavedChanges) await handleSaveXml()
      const res = await api.post(`/post-prod/xml-conversion/projects/${projectId}/validate`, { xmlType })
      setQcResult(res.data)
    } catch (err) {
      console.error(err)
      toast.error('Failed to run QC validation')
      setIsQcModalOpen(false)
    } finally {
      setIsQcRunning(false)
    }
  }

  const handleMarkComplete = async () => {
    setIsCompleting(true)
    try {
      await api.post(`/post-prod/xml-conversion/projects/${projectId}/complete`)
      toast.success('Project marked as completed!')
      navigate('/post-production/xml-conversion')
    } catch (err) {
      console.error(err)
      toast.error('Failed to complete project')
    } finally {
      setIsCompleting(false)
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

          <div className="relative flex items-center bg-white dark:bg-[#202020] border border-gray-200 dark:border-white/10 rounded-md overflow-visible">
            <button
              onClick={() => !isTargetConverting && xmlContent && setIsFormatDropdownOpen(!isFormatDropdownOpen)}
              disabled={isTargetConverting || !xmlContent}
              className="px-3 h-8 text-xs font-medium flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed min-w-[70px] transition-colors"
            >
              <span>{targetFormat}</span>
              <ChevronDown size={14} className={`text-muted transition-transform ${isFormatDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {isFormatDropdownOpen && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setIsFormatDropdownOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1 w-[120px] bg-white dark:bg-[#202020] border border-gray-200 dark:border-white/10 rounded-md shadow-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                  {['JATS', 'BITS'].map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => {
                        setTargetFormat(fmt)
                        setIsFormatDropdownOpen(false)
                      }}
                      className={`w-full px-3 py-2 text-left text-xs transition-colors hover:bg-gray-100 dark:hover:bg-white/10 ${targetFormat === fmt ? 'font-semibold text-primary' : 'text-text dark:text-gray-300'}`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </>
            )}
            
            <div className="w-px h-5 bg-gray-200 dark:bg-white/10" />
            
            <button
              onClick={handleTargetConversion}
              disabled={isTargetConverting || !xmlContent}
              className="px-3 h-8 text-xs hover:bg-primary/10 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed group relative"
              title="Convert Target XML"
            >
              {isTargetConverting ? (
                <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Play size={14} className="text-primary group-hover:scale-110 transition-transform" />
                  <span className="font-medium text-primary hidden sm:inline">Run</span>
                </>
              )}
            </button>
          </div>

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

          {xmlContent && xmlType === 'final' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRunQc}
              className="text-xs h-8 ml-2 border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10"
              title="Run Quality Control Validation"
            >
              <span className="flex items-center gap-1.5"><CheckCircle size={14} /> Run QC</span>
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
              {xmlContent ? (viewMode === 'xml' ? (project?.filename ? project.filename.replace(/\.pdf$/i, xmlType === 's4c' ? '_raw.xml' : '_final.xml') : (xmlType === 's4c' ? 'raw.xml' : 'final.xml')) : (project?.filename ? project.filename.replace(/\.pdf$/i, '_preview.html') : 'preview.html')) : 'No output yet'}
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
                  const res = await api.post(`/post-prod/xml-conversion/projects/${projectId}/validate`, { xmlType });
                  
                  const mappedErrors: Array<{line_number: number, message: string, error_type?: string}> = [];
                  
                  if (!res.data.isWellFormed && res.data.wellFormedErrors) {
                    res.data.wellFormedErrors.forEach((err: string) => {
                      const match = err.match(/Line (\d+): (.*)/);
                      if (match) {
                        mappedErrors.push({ line_number: parseInt(match[1], 10), message: match[2], error_type: 'XMLSyntax' });
                      } else {
                        mappedErrors.push({ line_number: 0, message: err, error_type: 'XMLSyntax' });
                      }
                    });
                  }
                  
                  if (!res.data.isDtdValid && res.data.dtdErrors) {
                    res.data.dtdErrors.forEach((err: string) => {
                      const match = err.match(/Line (\d+): (.*)/);
                      if (match) {
                        mappedErrors.push({ line_number: parseInt(match[1], 10), message: match[2], error_type: 'DTD' });
                      } else {
                        mappedErrors.push({ line_number: 0, message: err, error_type: 'DTD' });
                      }
                    });
                  }
                  
                  return { errors: mappedErrors };
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

      {/* QC Modal */}
      {isQcModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsQcModalOpen(false)} />
          <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[85vh] border border-border">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/5 rounded-t-xl">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <CheckCircle className="text-emerald-500" size={20} />
                Quality Control ({xmlType === 's4c' ? 'S4C' : 'Final'} XML)
              </h2>
              <button onClick={() => setIsQcModalOpen(false)} className="text-muted hover:text-text transition-colors">
                &times;
              </button>
            </div>
            
            <div className="p-6 flex-1 overflow-y-auto space-y-6">
              {isQcRunning ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted">
                  <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                  <p>Running automated validations...</p>
                </div>
              ) : qcResult ? (
                <>
                  {/* Stage 1 */}
                  <div className={`p-4 rounded-lg border ${qcResult.isWellFormed ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${qcResult.isWellFormed ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'}`}>
                        {qcResult.isWellFormed ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">Stage 1: Well-Formedness Check</h4>
                        <p className={`text-xs ${qcResult.isWellFormed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {qcResult.isWellFormed ? 'XML syntax is well-formed.' : 'XML contains syntax errors.'}
                        </p>
                      </div>
                    </div>
                    {!qcResult.isWellFormed && qcResult.wellFormedErrors?.length > 0 && (
                      <div className="mt-3 text-xs bg-red-500/5 p-3 rounded border border-red-500/20 text-red-600 dark:text-red-400 max-h-32 overflow-y-auto">
                        <ul className="list-disc pl-4 space-y-1">
                          {qcResult.wellFormedErrors.map((err: string, i: number) => <li key={i}>{err}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Stage 2 */}
                  <div className={`p-4 rounded-lg border ${qcResult.isDtdValid ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${qcResult.isDtdValid ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'}`}>
                        {qcResult.isDtdValid ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">Stage 2: DTD Validation</h4>
                        <p className={`text-xs ${qcResult.isDtdValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {qcResult.isDtdValid ? 'Document matches the DTD schema.' : 'Document failed schema validation.'}
                        </p>
                      </div>
                    </div>
                    {!qcResult.isDtdValid && qcResult.dtdErrors?.length > 0 && (
                      <div className="mt-3 text-xs bg-red-500/5 p-3 rounded border border-red-500/20 text-red-600 dark:text-red-400 max-h-32 overflow-y-auto">
                        <ul className="list-disc pl-4 space-y-1">
                          {qcResult.dtdErrors.map((err: string, i: number) => <li key={i}>{err}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Stage 3 */}
                  <div className={`p-4 rounded-lg border ${(qcResult.isWellFormed && qcResult.isDtdValid) ? 'bg-blue-500/10 border-blue-500/20' : 'bg-muted/10 border-border opacity-50'}`}>
                    <div className="flex gap-3">
                      <div className={`mt-0.5 w-8 h-8 rounded-full flex shrink-0 items-center justify-center ${(qcResult.isWellFormed && qcResult.isDtdValid) ? 'bg-blue-500/20 text-blue-500' : 'bg-muted text-muted-foreground'}`}>
                        3
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">Stage 3: Manual Verification</h4>
                        <p className="text-xs text-muted mt-1 mb-3">
                          Please verify the contents match the original PDF structure and text before marking as complete.
                        </p>
                        <label className={`flex items-center gap-2 text-sm ${(qcResult.isWellFormed && qcResult.isDtdValid) ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                          <input 
                            type="checkbox" 
                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                            checked={isManuallyVerified}
                            onChange={(e) => setIsManuallyVerified(e.target.checked)}
                            disabled={!(qcResult.isWellFormed && qcResult.isDtdValid)}
                          />
                          <span className="select-none font-medium text-text">I have manually verified the XML output.</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-3 bg-muted/5 rounded-b-xl">
              <Button variant="outline" onClick={() => setIsQcModalOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleMarkComplete} 
                disabled={!isManuallyVerified || isCompleting}
                className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[140px]"
              >
                {isCompleting ? (
                  <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Completing...</span>
                ) : (
                  <span className="flex items-center gap-2"><CheckCircle size={16} /> Mark as Complete</span>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
