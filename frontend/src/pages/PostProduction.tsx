import React, { useState } from 'react'
import { Upload, Layers, CheckCircle2, XCircle, ChevronRight, FileText, Download } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

interface ConversionResult {
  chapter_number: string
  success: boolean
  error?: string
  indd_file_id?: number
  docx_file_id?: number
}

export function PostProduction() {
  useDocumentTitle('Post Production — S4Carlisle CMS')

  // InDesign to Word state
  const [clientName, setClientName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState<ConversionResult[] | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // PDF to Word state
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfEngine, setPdfEngine] = useState('pdf2docx')
  const [pdfConverting, setPdfConverting] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const handleInDesignSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientName || !projectId || files.length === 0) return

    setUploading(true)
    setErrorMsg(null)
    setResults(null)
    const formData = new FormData()
    formData.append('client_name', clientName)
    formData.append('project_code', projectId)
    files.forEach(f => formData.append('files', f))

    try {
      const res = await fetch('/api/v1/conversion/batch-indesign-to-word', {
        method: 'POST',
        body: formData
      })
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || 'Batch conversion failed')
      }
      const data = await res.json()
      setResults(data.results)
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'An error occurred during InDesign conversion.')
    } finally {
      setUploading(false)
    }
  }

  const handlePdfSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pdfFile) return

    setPdfConverting(true)
    setPdfError(null)
    const formData = new FormData()
    formData.append('file', pdfFile)
    formData.append('engine', pdfEngine)

    try {
      const res = await fetch('/api/v1/conversion/pdf-to-word', {
        method: 'POST',
        body: formData
      })
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || 'PDF conversion failed')
      }
      // Trigger browser file download
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `converted_${pdfFile.name.replace(/\.pdf$/i, '')}.docx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      console.error(err)
      setPdfError(err.message || 'An error occurred during PDF conversion.')
    } finally {
      setPdfConverting(false)
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-4">
      <div>
        <h1 className="text-3xl font-bold font-serif text-white tracking-tight">Post Production</h1>
        <p className="text-sm text-zinc-400 mt-1">InDesign to Word & PDF to Word Ingestion Pipeline</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Forms */}
        <div className="lg:col-span-1 space-y-8">
          
          {/* Section 1: InDesign to Word */}
          <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6 shadow-xl space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">InDesign Ingestion</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Upload InDesign files to map to project/chapters</p>
            </div>
            
            <form onSubmit={handleInDesignSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Client Name</label>
                <input 
                  type="text" 
                  value={clientName} 
                  onChange={e => setClientName(e.target.value)} 
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition-colors placeholder:text-zinc-600"
                  placeholder="e.g. Oxford Press"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Project ID / Book Code</label>
                <input 
                  type="text" 
                  value={projectId} 
                  onChange={e => setProjectId(e.target.value)} 
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition-colors placeholder:text-zinc-600"
                  placeholder="e.g. OP_2026_BIO"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Batch InDesign Files (.indd)</label>
                <div className="border border-dashed border-white/20 hover:border-primary rounded-xl p-6 text-center cursor-pointer transition-colors bg-zinc-950/50">
                  <input 
                    type="file" 
                    multiple 
                    accept=".indd,.zip" 
                    onChange={e => e.target.files && setFiles(Array.from(e.target.files))}
                    className="hidden" 
                    id="indd-upload"
                  />
                  <label htmlFor="indd-upload" className="cursor-pointer space-y-2 block">
                    <Upload className="mx-auto text-zinc-400" size={28} />
                    <p className="text-xs font-medium text-zinc-300">Click or Drag InDesign Files</p>
                    <p className="text-[10px] text-zinc-500">Supports .indd or packaged .zip</p>
                  </label>
                </div>
                {files.length > 0 && (
                  <div className="mt-3 bg-zinc-950 border border-white/5 rounded-lg p-2.5 text-xs text-zinc-400 max-h-40 overflow-y-auto space-y-1">
                    <p className="font-semibold text-zinc-300">{files.length} files selected:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {files.map((f, i) => (
                        <li key={i} className="truncate">{f.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <button 
                type="submit" 
                disabled={uploading || !clientName || !projectId || files.length === 0}
                className="w-full py-2.5 bg-primary text-black font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-black" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Converting Batch...
                  </>
                ) : 'Run InDesign to Word'}
              </button>
            </form>
          </div>

          {/* Section 2: PDF to Word */}
          <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6 shadow-xl space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">PDF to Word Conversion</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Convert standard PDF files directly to Word documents</p>
            </div>

            <form onSubmit={handlePdfSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Select PDF File</label>
                <div className="border border-dashed border-white/20 hover:border-primary rounded-xl p-5 text-center cursor-pointer transition-colors bg-zinc-950/50">
                  <input 
                    type="file" 
                    accept=".pdf" 
                    onChange={e => e.target.files && setPdfFile(e.target.files[0])}
                    className="hidden" 
                    id="pdf-upload"
                  />
                  <label htmlFor="pdf-upload" className="cursor-pointer space-y-1.5 block">
                    <FileText className="mx-auto text-zinc-400" size={24} />
                    <p className="text-xs font-medium text-zinc-300">Choose PDF File</p>
                  </label>
                </div>
                {pdfFile && (
                  <div className="mt-2 text-xs text-zinc-400 truncate">
                    Selected: <span className="text-zinc-300 font-medium">{pdfFile.name}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Engine Mode</label>
                <select 
                  value={pdfEngine} 
                  onChange={e => setPdfEngine(e.target.value)} 
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="pdf2docx">pdf2docx (Python Native)</option>
                  <option value="word_com">Word COM Automation (High Quality)</option>
                  <option value="acrobat_com">Acrobat COM Automation (Pro Layout)</option>
                </select>
              </div>

              {pdfError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">
                  {pdfError}
                </div>
              )}

              <button 
                type="submit" 
                disabled={pdfConverting || !pdfFile}
                className="w-full py-2.5 bg-primary/20 text-primary border border-primary/30 font-semibold rounded-lg hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {pdfConverting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Converting PDF...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Convert and Download
                  </>
                )}
              </button>
            </form>
          </div>

        </div>

        {/* Right Column: Ingestion Status View */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6 shadow-xl h-full min-h-[500px] flex flex-col">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white">Ingestion & Chapter Mapping View</h2>
              <p className="text-xs text-zinc-400 mt-1">Hierarchical tree view of project files automatically mapped after ingestion</p>
            </div>

            {errorMsg && (
              <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm flex items-center gap-2">
                <XCircle size={18} />
                {errorMsg}
              </div>
            )}

            {results ? (
              <div className="flex-1 space-y-6">
                <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg text-sm">
                  <CheckCircle2 size={18} />
                  Batch ingestion completed. Files mapped.
                </div>

                <div className="border border-white/10 rounded-xl overflow-hidden bg-zinc-950/30">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-zinc-950/80 border-b border-white/10 text-zinc-400 font-medium">
                      <tr>
                        <th className="p-4">Book/Project ID</th>
                        <th className="p-4">Chapter Folder</th>
                        <th className="p-4">InDesign Source (INDD)</th>
                        <th className="p-4">Manuscript Destination (DOCX)</th>
                        <th className="p-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-white">
                      {results.map((res) => (
                        <tr key={res.chapter_number} className="hover:bg-white/[0.01] transition-colors">
                          <td className="p-4 font-semibold text-primary">{projectId}</td>
                          <td className="p-4">Chapter {res.chapter_number}</td>
                          <td className="p-4">
                            <span className="inline-flex items-center gap-1.5 text-xs bg-zinc-900 border border-white/10 px-2.5 py-1.5 rounded-lg text-zinc-300">
                              <FileText size={13} className="text-zinc-500" />
                              {res.chapter_number}.indd
                            </span>
                          </td>
                          <td className="p-4">
                            {res.success ? (
                              <span className="inline-flex items-center gap-1.5 text-xs bg-green-500/10 border border-green-500/20 px-2.5 py-1.5 rounded-lg text-green-400">
                                <FileText size={13} />
                                Chapter_{res.chapter_number}.docx
                              </span>
                            ) : (
                              <span className="text-xs text-zinc-600">—</span>
                            )}
                          </td>
                          <td className="p-4">
                            {res.success ? (
                              <span className="inline-flex items-center gap-1 text-xs text-green-400 font-semibold">
                                <CheckCircle2 size={14} /> Mapped
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-red-400 font-semibold" title={res.error}>
                                <XCircle size={14} /> Failed
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-20 text-zinc-500 border border-dashed border-white/5 rounded-xl bg-zinc-950/20">
                <Layers size={48} className="mb-4 text-zinc-700" />
                <p className="text-sm font-medium text-zinc-400">Upload InDesign files to start ingestion mapping</p>
                <p className="text-xs text-zinc-600 mt-1 max-w-sm text-center leading-relaxed">
                  The backend automatically parses chapter numbers, generates CMS directories, and triggers server-side conversions.
                </p>
                <div className="flex items-center gap-2 mt-6 text-xs text-zinc-600 font-mono bg-zinc-950 px-3 py-1.5 rounded-lg border border-white/5">
                  <span>Book / Project</span>
                  <ChevronRight size={12} className="text-zinc-700" />
                  <span>Chapter Folder</span>
                  <ChevronRight size={12} className="text-zinc-700" />
                  <span>InDesign (INDD)</span>
                  <ChevronRight size={12} className="text-zinc-700" />
                  <span className="text-primary/70">Manuscript (DOCX)</span>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
