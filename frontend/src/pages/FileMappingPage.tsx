import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Save, AlertCircle, CheckCircle2, XCircle, File as FileIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { toast } from '@/store/useToastStore'
import { getProjectDetail, finalizeMapping, resumeMapping, FileMappingEntry } from '@/api/projects'
import { Spinner } from '@/components/ui/Spinner'
import { motion } from 'framer-motion'

const CATEGORIES = [
  { value: 'Front Matter', label: 'Front Matter' },
  { value: 'Chapters', label: 'Chapter' },
  { value: 'Appendix', label: 'Appendix' },
  { value: 'Back Matter', label: 'Back Matter' },
  { value: 'Not Found', label: 'Not Found / Skip' }
]

export function FileMappingPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<any>(null)
  const [files, setFiles] = useState<FileMappingEntry[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const fetchPreviewData = async () => {
      const state = (window.history.state as any)?.usr
      if (state?.previewData) {
        setSessionId(state.previewData.session_id)
        setFiles(state.previewData.files)
        return
      }
      
      if (!id) return
      
      try {
        setLoading(true)
        const res = await resumeMapping(Number(id))
        setSessionId(res.session_id)
        setFiles(res.files)
      } catch (err) {
        toast.error('No mapping data found or zip missing.')
        navigate(-1)
      } finally {
        setLoading(false)
      }
    }
    
    fetchPreviewData()

    if (id) {
      getProjectDetail(Number(id)).then(p => {
        setProject(p)
      }).catch(() => {
        toast.error('Failed to load project details.')
      }).finally(() => {
        setLoading(false)
      })
    }
  }, [id, navigate])

  const handleCategoryChange = (index: number, newCategory: string) => {
    const newFiles = [...files]
    newFiles[index].category = newCategory
    if (newCategory === 'Front Matter') newFiles[index].chapter_number = 'FM'
    else if (newCategory === 'Back Matter') newFiles[index].chapter_number = 'BM'
    else if (newCategory === 'Not Found') newFiles[index].chapter_number = null
    setFiles(newFiles)
  }

  const handleNumberChange = (index: number, newNumber: string) => {
    const newFiles = [...files]
    newFiles[index].chapter_number = newNumber
    setFiles(newFiles)
  }

  const handleSave = async () => {
    if (!id || !sessionId) return
    setSaving(true)
    try {
      const res = await finalizeMapping(Number(id), {
        session_id: sessionId,
        mappings: files
      })
      toast.success(res.message || 'Mapping saved successfully.')
      navigate(`/projects/${id}/planning`)
    } catch (err) {
      toast.error('Failed to finalize mapping.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Spinner size={32} />
      </div>
    )
  }

  const projectIdentifier = project?.project_code || project?.code
  const projectTitle = project?.project_title || project?.title
  const unmappedCount = files.filter(f => f.file_type === 'Manuscript' && f.category === 'Not Found').length
  const isReadyToSave = unmappedCount === 0

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50 backdrop-blur-sm z-10 sticky top-0 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft size={20} />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              File Mapping
            </h1>
            {(projectIdentifier || projectTitle) && (
              <p className="text-sm text-muted-foreground font-medium mt-0.5 flex items-center gap-1.5">
                {projectIdentifier && <span>{projectIdentifier}</span>}
                {projectIdentifier && projectTitle && <span>•</span>}
                {projectTitle && <span>{projectTitle}</span>}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6 flex flex-col">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-6xl mx-auto h-full flex flex-col font-sans pb-4"
        >
          <Card className="border-border/60 shadow-md bg-card flex flex-col flex-1 min-h-0">
            <CardHeader className="border-b border-border/40 pb-5 shrink-0">
              <CardTitle className="text-xl font-serif text-foreground">Review Classified Files</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Please verify the auto-classification of your uploaded files. Adjust categories and numbers if necessary before finalizing.
              </p>
            </CardHeader>
            <CardBody className="p-0 flex flex-col flex-1 min-h-0">
              
              <div className="flex items-center justify-between p-4 bg-muted/30 border-b border-border/40 shrink-0">
                <div className="flex items-center gap-3">
                  {isReadyToSave ? (
                    <div className="bg-emerald-500/10 p-2 rounded-full">
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </div>
                  ) : (
                    <div className="bg-amber-500/10 p-2 rounded-full">
                      <AlertCircle className="h-5 w-5 text-amber-500" />
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-sm">
                      {isReadyToSave ? 'All Files Mapped' : 'Review Needed'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isReadyToSave 
                        ? 'All files are assigned to a valid category.' 
                        : `${unmappedCount} file(s) marked as "Not Found / Skip".`}
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={handleSave} 
                  disabled={saving}
                  className="px-5 py-2"
                >
                  <div className="flex flex-row items-center justify-center gap-2 whitespace-nowrap">
                    {saving ? (
                      <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                    ) : (
                      <Save className="h-4 w-4 shrink-0" />
                    )}
                    <span>Save & Continue</span>
                  </div>
                </Button>
              </div>

              <div className="flex flex-col flex-1 min-h-0">
                <div className="grid grid-cols-12 gap-4 bg-muted/40 p-3 px-6 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50 shrink-0">
                  <div className="col-span-5">File Name</div>
                  <div className="col-span-2">File Type</div>
                  <div className="col-span-3">Category</div>
                  <div className="col-span-2">Number/Label</div>
                </div>
                <div className="max-h-[calc(100vh-350px)] overflow-y-auto divide-y divide-border/40">
                  {files.length === 0 ? (
                    <div className="p-10 text-center text-sm text-muted-foreground">
                      No files found in the upload.
                    </div>
                  ) : (
                    files.map((file, idx) => {
                      if (file.file_type !== 'Manuscript') return null;

                      const isNotFound = file.category === 'Not Found';
                      
                      return (
                        <div 
                          key={idx} 
                          className={`grid grid-cols-12 gap-4 items-center p-3 px-6 transition-all duration-200 ${isNotFound ? 'bg-amber-500-[0.02] hover:bg-amber-500/5' : 'hover:bg-muted/30'}`}
                        >
                          <div className="col-span-5 flex items-center gap-3 pr-2 overflow-hidden">
                            {isNotFound ? (
                              <XCircle className="h-4 w-4 text-amber-500 shrink-0" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 opacity-80" />
                            )}
                            <span className="font-mono text-xs font-medium truncate text-foreground/80" title={file.original_filename}>
                              {file.original_filename}
                            </span>
                          </div>
                          <div className="col-span-2 text-xs text-muted-foreground font-medium">
                            {file.file_type}
                          </div>
                          <div className="col-span-3">
                            <select
                              className={`w-full text-xs font-semibold rounded-lg border py-1.5 px-3 transition-colors shadow-sm outline-none ${
                                isNotFound 
                                  ? 'bg-amber-500/5 border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20' 
                                  : 'bg-card border-border text-foreground hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20'
                              }`}
                              value={file.category}
                              onChange={(e) => handleCategoryChange(idx, e.target.value)}
                            >
                              {CATEGORIES.map(cat => (
                                <option key={cat.value} value={cat.value}>{cat.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <input
                              type="text"
                              className={`w-full text-xs font-semibold rounded-lg border py-1.5 px-3 transition-colors shadow-sm outline-none ${
                                isNotFound 
                                  ? 'bg-amber-500/5 border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20' 
                                  : 'bg-card border-border text-foreground hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted/50 disabled:text-muted-foreground'
                              }`}
                              value={file.chapter_number || ''}
                              onChange={(e) => handleNumberChange(idx, e.target.value)}
                              placeholder="e.g. 01, A"
                              disabled={file.category === 'Front Matter' || file.category === 'Back Matter' || file.category === 'Not Found'}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </CardBody>
          </Card>
        </motion.div>
      </main>
    </div>
  )
}
