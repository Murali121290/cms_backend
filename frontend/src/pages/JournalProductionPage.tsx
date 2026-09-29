import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Newspaper, Building2, BookOpen, Layers, Plus, CheckCircle, Clock, Sliders, ChevronRight, Loader2, FileArchive, Sparkles, Upload
} from 'lucide-react'
import { journalsApi, JournalClient, Journal, JournalArticle } from '@/api/journals'

export function JournalProductionPage() {
  // Dynamic API State
  const [clients, setClients] = useState<JournalClient[]>([])
  const [journals, setJournals] = useState<Journal[]>([])
  const [articles, setArticles] = useState<JournalArticle[]>([])

  const [activeClientId, setActiveClientId] = useState<number | undefined>(undefined)
  const [activeJournalId, setActiveJournalId] = useState<number | undefined>(undefined)

  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [showJournalModal, setShowJournalModal] = useState(false)
  const [showClientModal, setShowClientModal] = useState(false)
  const [showArticleModal, setShowArticleModal] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  // Form Inputs
  const [newJournalCode, setNewJournalCode] = useState('')
  const [newJournalTitle, setNewJournalTitle] = useState('')
  const [newJournalIssnPrint, setNewJournalIssnPrint] = useState('')
  const [newJournalIssnOnline, setNewJournalIssnOnline] = useState('')
  const [newJournalVolume, setNewJournalVolume] = useState('')
  const [newJournalIssue, setNewJournalIssue] = useState('')

  const [newClientCode, setNewClientCode] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [newClientEmail, setNewClientEmail] = useState('')

  const [newArticleDoi, setNewArticleDoi] = useState('')
  const [newArticleTitle, setNewArticleTitle] = useState('')
  const [newArticleAuthor, setNewArticleAuthor] = useState('')
  const [newArticleType, setNewArticleType] = useState('Research Article')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [extractedPreview, setExtractedPreview] = useState<any>(null)

  function triggerToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3500)
  }

  // 1. Fetch Journal Clients from Backend API
  async function fetchClients() {
    try {
      const data = await journalsApi.getClients()
      setClients(data)
      if (data.length > 0 && !activeClientId) {
        setActiveClientId(data[0].id)
      }
    } catch (err) {
      console.error('Error fetching journal clients:', err)
    }
  }

  // 2. Fetch Journals for Active Client from Backend API
  async function fetchJournals(clientId?: number) {
    try {
      const data = await journalsApi.getJournals(clientId)
      setJournals(data)
      if (data.length > 0) {
        setActiveJournalId(data[0].id)
      } else {
        setActiveJournalId(undefined)
      }
    } catch (err) {
      console.error('Error fetching journals:', err)
    }
  }

  // 3. Fetch Articles for Active Journal from Backend API
  async function fetchArticles(journalId?: number) {
    try {
      const data = await journalsApi.getArticles(journalId)
      setArticles(data)
    } catch (err) {
      console.error('Error fetching journal articles:', err)
    }
  }

  // Load initial API data
  useEffect(() => {
    async function initData() {
      setIsLoading(true)
      await fetchClients()
      setIsLoading(false)
    }
    initData()
  }, [])

  // Refetch journals when client changes
  useEffect(() => {
    if (activeClientId) {
      fetchJournals(activeClientId)
    }
  }, [activeClientId])

  // Refetch articles when journal changes
  useEffect(() => {
    if (activeJournalId) {
      fetchArticles(activeJournalId)
    } else {
      setArticles([])
    }
  }, [activeJournalId])

  // Handle Creating New Publisher Client (POST /api/journals/clients)
  async function handleCreateClient() {
    if (!newClientCode || !newClientName) return
    try {
      const created = await journalsApi.createClient({
        client_code: newClientCode,
        publisher_name: newClientName,
        contact_email: newClientEmail
      })
      setClients([...clients, created])
      setActiveClientId(created.id)
      setShowClientModal(false)
      setNewClientCode('')
      setNewClientName('')
      setNewClientEmail('')
      triggerToast(`Publisher Client Created: ${created.publisher_name}`)
    } catch (err: any) {
      triggerToast(err?.response?.data?.detail || 'Failed to create publisher client')
    }
  }

  // Handle Creating New Journal (POST /api/journals)
  async function handleCreateJournal() {
    if (!newJournalCode || !newJournalTitle || !activeClientId) return
    try {
      const created = await journalsApi.createJournal({
        client_id: activeClientId,
        journal_code: newJournalCode,
        journal_title: newJournalTitle,
        issn_print: newJournalIssnPrint,
        issn_online: newJournalIssnOnline,
        volume: newJournalVolume,
        issue: newJournalIssue
      })
      setJournals([...journals, created])
      setActiveJournalId(created.id)
      setShowJournalModal(false)
      setNewJournalCode('')
      setNewJournalTitle('')
      setNewJournalIssnPrint('')
      setNewJournalIssnOnline('')
      setNewJournalVolume('')
      setNewJournalIssue('')
      triggerToast(`Journal Created: ${created.journal_title} (${created.journal_code})`)
    } catch (err: any) {
      triggerToast(err?.response?.data?.detail || 'Failed to create journal')
    }
  }

  // Handle Selecting File / ZIP for Automatic Metadata Extraction
  async function handleFileSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setIsUploading(true)

    try {
      if (file.name.endsWith('.docx')) {
        const res = await journalsApi.extractMetadataFromFile(file)
        const meta = res.extracted_metadata || {}
        setExtractedPreview(meta)
        if (meta.article_title) setNewArticleTitle(meta.article_title)
        if (meta.article_doi) setNewArticleDoi(meta.article_doi)
        if (meta.lead_author) setNewArticleAuthor(meta.lead_author)
        triggerToast('Auto-extracted metadata from DOCX manuscript!')
      }
    } catch (err) {
      console.error('Extraction error:', err)
    } finally {
      setIsUploading(false)
    }
  }

  // Handle Adding New Article (Manual or ZIP Package Upload)
  async function handleCreateArticle() {
    if (!activeJournalId) return
    setIsUploading(true)

    try {
      if (selectedFile && selectedFile.name.endsWith('.zip')) {
        // Upload ZIP Package & Extract Metadata
        const res = await journalsApi.uploadZipPackage(activeJournalId, selectedFile)
        triggerToast(res.message || 'ZIP package unzipped and article created!')
        await fetchArticles(activeJournalId)
      } else {
        // Create Article via Metadata fields
        if (!newArticleTitle) return
        const created = await journalsApi.createArticle({
          journal_id: activeJournalId,
          article_doi: newArticleDoi || undefined,
          article_title: newArticleTitle,
          article_type: newArticleType,
          lead_author: newArticleAuthor || undefined
        })
        setArticles([created, ...articles])
        triggerToast(`Article Added & 8-Stage Workflow Initialized!`)
      }
      setShowArticleModal(false)
      setSelectedFile(null)
      setExtractedPreview(null)
      setNewArticleDoi('')
      setNewArticleTitle('')
      setNewArticleAuthor('')
    } catch (err: any) {
      triggerToast(err?.response?.data?.detail || 'Failed to add article')
    } finally {
      setIsUploading(false)
    }
  }

  const currentJournal = journals.find(j => j.id === activeJournalId)

  return (
    <div className="space-y-6 text-foreground">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-xl z-50 flex items-center gap-2 text-sm font-semibold">
          <CheckCircle size={18} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Header & Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">Dashboard</Link>
          <ChevronRight size={14} />
          <span className="text-foreground font-semibold flex items-center gap-1.5">
            <Newspaper size={16} className="text-primary" /> Journal Production (JATS)
          </span>
          {currentJournal && (
            <>
              <ChevronRight size={14} />
              <span className="text-foreground font-semibold">{currentJournal.journal_title}</span>
            </>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowClientModal(true)}
            className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs flex items-center gap-1.5 transition-all"
          >
            <Building2 size={14} /> + New Journal Client
          </button>
          <button
            onClick={() => setShowJournalModal(true)}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs flex items-center gap-1.5 transition-all"
          >
            <BookOpen size={14} /> + Create New Journal
          </button>
          <button
            onClick={() => setShowArticleModal(true)}
            disabled={!activeJournalId}
            className="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-medium text-xs flex items-center gap-1.5 transition-all"
          >
            <Plus size={14} /> + Add Article (ZIP / DOCX Auto-Extract)
          </button>
        </div>
      </div>

      {/* 3-Tier Dynamic Hierarchy Selector (Client -> Journal -> Articles) */}
      <div className="p-4 rounded-xl bg-card border border-border flex items-center gap-4 shadow-sm">
        <div className="flex-1 space-y-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Building2 size={12} /> Journal Clients
          </label>
          <select
            value={activeClientId || ''}
            onChange={(e) => setActiveClientId(Number(e.target.value))}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {clients.length === 0 ? (
              <option value="">No Publisher Clients Found</option>
            ) : (
              clients.map(c => (
                <option key={c.id} value={c.id}>{c.publisher_name} ({c.client_code})</option>
              ))
            )}
          </select>
        </div>

        <span className="text-muted-foreground text-sm mt-4">→</span>

        <div className="flex-1 space-y-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <BookOpen size={12} /> Journals
          </label>
          <select
            value={activeJournalId || ''}
            onChange={(e) => setActiveJournalId(Number(e.target.value))}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {journals.length === 0 ? (
              <option value="">No Journals Found for this Client</option>
            ) : (
              journals.map(j => (
                <option key={j.id} value={j.id}>{j.journal_title} ({j.journal_code})</option>
              ))
            )}
          </select>
        </div>

        <span className="text-muted-foreground text-sm mt-4">→</span>

        <div className="flex-1 space-y-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Layers size={12} /> Volume / Issue / Articles
          </label>
          <select className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
            <option>{articles.length} Active Articles</option>
          </select>
        </div>
      </div>

      {/* 8-Stage Pipeline Matrix Grid */}
      <div className="grid grid-cols-8 gap-2">
        {[
          { step: 1, title: '1. Pre-Editing' },
          { step: 2, title: '2. Tech Edit' },
          { step: 3, title: '3. Lang Edit' },
          { step: 4, title: '4. XML (XSLT)' },
          { step: 5, title: '5. Gen InDesign' },
          { step: 6, title: '6. InDesign Final' },
          { step: 7, title: '7. View Proof' },
          { step: 8, title: '8. Final Delivery' }
        ].map((s) => (
          <div key={s.step} className="p-2.5 rounded-lg bg-card border border-border text-center space-y-1">
            <span className="text-[10px] font-bold text-muted-foreground uppercase">Stage {s.step}</span>
            <p className="text-xs font-semibold text-foreground truncate">{s.title}</p>
          </div>
        ))}
      </div>

      {/* Articles Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin" /> Loading Journal Production Data...
          </div>
        ) : articles.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground space-y-3">
            <p className="text-base font-semibold text-foreground">No Articles Found</p>
            <p className="text-xs">Click "+ Add Article (ZIP / DOCX Auto-Extract)" to upload a manuscript package.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-[11px] font-semibold text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3">Article Title & DOI</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Current Stage</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {articles.map(art => (
                <tr key={art.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {art.article_doi && (
                        <span className="font-mono text-[11px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded w-fit">{art.article_doi}</span>
                      )}
                      <span className="font-semibold text-foreground">{art.article_title}</span>
                      <span className="text-xs text-muted-foreground">{art.lead_author || 'Author Unspecified'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">{art.article_type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold text-blue-400 flex items-center gap-1.5">
                      <Clock size={14} className="animate-spin" /> {art.current_stage}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">{art.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/journal-article-editor/${art.id}`}
                      className="px-3 py-1.5 text-xs font-medium bg-secondary text-secondary-foreground hover:bg-muted rounded-md inline-flex items-center gap-1"
                    >
                      <Sliders size={12} /> Open Editor
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal 1: Create New Journal Form Modal */}
      {showJournalModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <BookOpen size={20} className="text-emerald-500" /> Create New Journal Form
            </h3>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Publisher / Client</label>
              <select
                value={activeClientId || ''}
                onChange={e => setActiveClientId(Number(e.target.value))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              >
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.publisher_name} ({c.client_code})</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Journal Code</label>
              <input
                type="text"
                placeholder="e.g. JAIS"
                value={newJournalCode}
                onChange={e => setNewJournalCode(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Journal Full Title</label>
              <input
                type="text"
                placeholder="e.g. Journal of Artificial Intelligence Systems"
                value={newJournalTitle}
                onChange={e => setNewJournalTitle(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">ISSN Print</label>
                <input
                  type="text"
                  placeholder="2049-3651"
                  value={newJournalIssnPrint}
                  onChange={e => setNewJournalIssnPrint(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">ISSN Online</label>
                <input
                  type="text"
                  placeholder="2049-3652"
                  value={newJournalIssnOnline}
                  onChange={e => setNewJournalIssnOnline(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowJournalModal(false)}
                className="flex-1 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateJournal}
                className="flex-1 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
              >
                Save & Create Journal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Create New Client Modal */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Building2 size={20} className="text-purple-500" /> Create Publisher Client Form
            </h3>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Client Code</label>
              <input
                type="text"
                placeholder="e.g. WILEY-03"
                value={newClientCode}
                onChange={e => setNewClientCode(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Publisher Name</label>
              <input
                type="text"
                placeholder="e.g. John Wiley & Sons"
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Contact Email</label>
              <input
                type="email"
                placeholder="journal-prod@wiley.com"
                value={newClientEmail}
                onChange={e => setNewClientEmail(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowClientModal(false)}
                className="flex-1 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateClient}
                className="flex-1 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
              >
                Create Publisher
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Add Article Modal (with ZIP Upload & Metadata Extractor) */}
      {showArticleModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Plus size={20} className="text-primary" /> Add Journal Article (ZIP / DOCX Auto-Extract)
            </h3>

            {/* ZIP / DOCX File Selection Box */}
            <div className="p-4 rounded-xl bg-blue-500/5 border border-dashed border-blue-500/30 space-y-2 text-center">
              <div className="flex items-center justify-center gap-2 text-blue-400 font-semibold text-xs">
                <FileArchive size={18} /> Upload Manuscript Package (.zip or .docx)
              </div>
              <p className="text-[11px] text-muted-foreground">
                Select your article package ZIP (e.g., JAPPC_V11.1__189115-Manuscript_1.zip). Backend will unzipped files and auto-extract metadata!
              </p>
              <input
                type="file"
                accept=".zip,.docx"
                onChange={handleFileSelection}
                className="w-full text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90"
              />
            </div>

            {/* Auto-Extracted Preview Badge */}
            {extractedPreview && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-1 text-emerald-300">
                <div className="font-bold flex items-center gap-1">
                  <Sparkles size={14} /> Auto-Extracted Metadata Preview:
                </div>
                {extractedPreview.article_title && <div><strong>Title:</strong> {extractedPreview.article_title}</div>}
                {extractedPreview.article_doi && <div><strong>DOI:</strong> {extractedPreview.article_doi}</div>}
                {extractedPreview.lead_author && <div><strong>Author:</strong> {extractedPreview.lead_author}</div>}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Article Title</label>
              <input
                type="text"
                placeholder="e.g. MathML Processing in InDesign Pipelines"
                value={newArticleTitle}
                onChange={e => setNewArticleTitle(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Article DOI</label>
              <input
                type="text"
                placeholder="10.1016/j.jais.2026.04.005"
                value={newArticleDoi}
                onChange={e => setNewArticleDoi(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Lead Author</label>
              <input
                type="text"
                placeholder="e.g. Dr. Aris Thorne"
                value={newArticleAuthor}
                onChange={e => setNewArticleAuthor(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowArticleModal(false)}
                className="flex-1 py-2 text-sm font-medium bg-muted text-muted-foreground rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateArticle}
                disabled={isUploading}
                className="flex-1 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg flex items-center justify-center gap-1.5"
              >
                {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {isUploading ? 'Extracting & Creating...' : 'Add Article & Start Workflow'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
