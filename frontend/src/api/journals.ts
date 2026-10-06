import apiClient from './client'

export interface JournalUser {
  id: number
  username: string
  name: string
  first_name?: string
  last_name?: string
  email?: string
  role?: string
  team?: string
}

export interface JournalClient {
  id: number
  client_code: string
  publisher_name: string
  jats_version: string
  contact_email?: string
  website?: string
  active_status: boolean
  created_at: string
}

export interface Journal {
  id: number
  client_id: number
  journal_code: string
  journal_title: string
  issn_print?: string
  issn_online?: string
  volume?: string
  issue?: string
  journal_manager?: string
  workflow_id?: number
  workflow_name?: string
  status: string
  created_at: string
}

export interface JournalWorkflow {
  id: number
  name: string
  description?: string
  stage_numbers: number[]
  stages: string[]
  is_default: boolean
  is_active: boolean
}

export interface ArticleCounts {
  total: number
  in_progress: number
  completed: number
  delayed: number
}

export interface JournalClientOverview extends JournalClient {
  journal_count: number
  articles: ArticleCounts
}

export interface JournalOverview extends Journal {
  client_code?: string
  publisher_name?: string
  stages: string[]
  articles: ArticleCounts
  setup: { template?: string; template_version?: number; fonts: number; stylesheet?: string; grammarsheet?: string }
}

export interface IaRule { element: string; subtype: string; pattern: string; example?: string | null }

export interface IaRulesState {
  catalog: IaRule[]
  selected: IaRule[]
  stylesheet: { id: number; name: string; updated_at: string } | null
  project_id: number
}

export type AssetKind ='template' | 'font' | 'library' | 'logo' | 'css'

export interface JournalAsset {
  id: number
  kind: AssetKind
  filename: string
  version: number
  is_active: boolean
  note?: string
  size_bytes?: number
  uploaded_by_id?: number
  uploaded_at: string
}

export interface ArtCheck { status: 'ok' | 'warning' | 'error'; text: string }

export interface ArtFile {
  id: number
  filename: string
  figure_number: number | null
  version: number
  versions: number
  uploaded_at: string
  format: string
  width: number | null
  height: number | null
  dpi: number | null
  vector: boolean
  ppi: number | null
  checks: ArtCheck[]
  status: 'ok' | 'warning' | 'error'
}

export interface ArticleArt {
  rules: { formats: string[]; min_ppi: number; naming: string; placed_width_mm: number }
  figures: { number: number; file_id: number | null; filename: string | null; status: 'ok' | 'warning' | 'error' | 'missing' }[]
  files: ArtFile[]
}

export interface ArticleStageStatus {
  stage_number: number
  stage_name: string
  stage_status: string
  assignee_id?: number
  planned_end_date?: string
}

export interface JournalArticleRow {
  id: number
  article_doi?: string
  article_title: string
  article_type: string
  lead_author?: string
  current_stage: string
  status: string
  priority: string
  complexity_level?: string
  due_date?: string
  revised_due_date?: string
  current_assignee_id?: number
  current_assignee_name?: string
  delayed: boolean
  delay_category?: string
  delay_reason?: string
  delay_days?: number
  open_errors: number
  stages: ArticleStageStatus[]
  created_at: string
}

export interface ArticleWorkspace {
  article: { id: number; journal_id: number; article_title: string; article_doi?: string; current_stage: string; status: string }
  journal: { id: number; journal_code: string; journal_title: string } | null
  stages: ArticleStageStatus[]
  xhtml: { file: { id: number; filename: string; version: number }; content: string } | null
  /** Latest JATS XML version (Stage 4 onwards); the editor shows the XML tab once it exists. */
  jats: JournalFileInfo | null
  proof_pdf?: JournalFileInfo | null
  pre_editing: PreEditingState
  check_runs: Partial<Record<string, { status: string; rules_total: number; rules_passed: number; finished_at?: string }>>
  open_issues: Partial<Record<string, Record<'error' | 'warning' | 'info', number>>>
  stylesheet: string | null
  grammarsheet: string | null
  working_copy_changed: boolean
}

export interface ArticleUploadResult {
  created: { id: number; article_title: string; article_doi?: string; current_stage: string; filename: string }[]
  failed: { filename: string; error: string }[]
}

export interface JournalArticle {
  id: number
  journal_id: number
  article_doi?: string
  vendor_article_id?: string
  article_title: string
  article_type: string
  lead_author?: string
  corresponding_email?: string
  abstract?: string
  keywords?: string[]
  current_stage: string
  current_assignee_id?: number
  status: string
  created_at: string
}

export interface StageAssignment {
  article_id: number
  target_stage: string
  assignee_id: number
  planned_start_date?: string
  planned_end_date?: string
  sla_hours?: number
  complexity_level?: 'Low' | 'Medium' | 'High'
}

export interface JournalStylesheet {
  id: number
  journal_id: number
  name: string
  description?: string
  style_rules: Record<string, unknown>
  is_active: boolean
  created_at: string
}

export interface JournalGrammarsheet {
  id: number
  journal_id: number
  name: string
  language_variant: string
  grammar_rules: Record<string, unknown>
  is_active: boolean
  created_at: string
}

export type JournalCheckModule = 'structuring' | 'references' | 'ia_rules' | 'technical' | 'language' | 'xml' | 'indesign_qc' | 'proof'

/** Pre-Editing runs as four gated steps: each unlocks when the one before it is finished. */
export type PreEditingStepKey = 'structuring' | 'references' | 'ia_rules' | 'technical'
export type PreEditingStepStatus = 'locked' | 'ready' | 'running' | 'in_progress' | 'finished' | 'failed'

export interface PreEditingStep {
  key: PreEditingStepKey
  label: string
  module: JournalCheckModule
  description: string
  number: number
  status: PreEditingStepStatus
  was_finished: boolean
  ran: boolean
  ran_at: string | null
  finished_at: string | null
  error: string | null
  open: Record<'error' | 'warning' | 'info', number>
  signed_off: boolean
  can_finish: boolean
  can_accept_warnings: boolean
  blocked_reason: string | null
}

export interface PreEditingState {
  steps: PreEditingStep[]
  current_step: PreEditingStepKey | null
  all_finished: boolean
  applies: boolean
}
export type IssueSeverity = 'error' | 'warning' | 'info'
export type IssueStatus = 'open' | 'fixed' | 'ignored' | 'superseded'

export interface JournalCheckInfo {
  key: JournalCheckModule
  name: string
  stage_number: number
  implemented: boolean
}

export interface JournalCheckRun {
  id: number
  article_id: number
  module: JournalCheckModule
  stage_number: number
  status: string
  rule_set_version?: string
  rules_total: number
  rules_passed: number
  started_at: string
  finished_at?: string
}

export interface JournalIssue {
  id: number
  article_id: number
  run_id?: number
  module: JournalCheckModule
  rule_id: string
  severity: IssueSeverity
  title: string
  message?: string
  location?: Record<string, unknown>
  context_snippet?: string
  suggestion?: { type: 'replace' | 'retag' | 'html' | 'relink' | 'append' | 'signoff'; to?: string; from?: string }
  source_issue_id?: number
  status: IssueStatus
  resolution?: string
  resolved_by_id?: number
  resolved_at?: string
  created_at: string
}

export interface JournalFileInfo {
  id: number
  filename: string
  category: string
  version: number
  uploaded_at: string
}

type OpenIssueCounts = Partial<Record<JournalCheckModule, Record<IssueSeverity, number>>>

export interface JatsFinding {
  line: number | null
  severity: 'error' | 'warning' | 'info'
  rule_id: string
  title: string
  message: string
}

export interface JatsConversionResult {
  converter: 'xslt-server' | 'local'
  fallback_reason: string | null
  file: JournalFileInfo
  check_run: JournalCheckRun
  open_issues: OpenIssueCounts
}

export interface InDesignStatus {
  status: string | null
  indd: JournalFileInfo | null
  idml: JournalFileInfo | null
  proof_pdf: JournalFileInfo | null
  preflight: JournalFileInfo | null
  open_issues: OpenIssueCounts
}

export interface PreEditingResult {
  status: string
  article_id: number
  xhtml_version: number
  xhtml_content: string
  check_runs: Partial<Record<JournalCheckModule, Partial<JournalCheckRun> & { status: string; error_message?: string }>>
  open_issues: Partial<Record<JournalCheckModule, Record<IssueSeverity, number>>>
}

export const journalsApi = {
  // Clients
  getClients: async (): Promise<JournalClient[]> => {
    const res = await apiClient.get('/journals/clients')
    return res.data
  },
  createClient: async (data: { client_code: string; publisher_name: string; jats_version?: string; contact_email?: string }): Promise<JournalClient> => {
    const res = await apiClient.post('/journals/clients', data)
    return res.data
  },

  // Journals
  getJournals: async (clientId?: number): Promise<Journal[]> => {
    const res = await apiClient.get('/journals', { params: { client_id: clientId } })
    return res.data
  },
  createJournal: async (data: {
    client_id: number; journal_code: string; journal_title: string; issn_print?: string; issn_online?: string
    volume?: string; issue?: string; journal_manager?: string; workflow_id?: number
  }): Promise<Journal> => {
    const res = await apiClient.post('/journals', data)
    return res.data
  },

  // Overviews for the client -> journal -> article pages
  getClientsOverview: async (): Promise<JournalClientOverview[]> => {
    const res = await apiClient.get('/journals/clients/overview')
    return res.data
  },
  getClient: async (clientId: number): Promise<JournalClient> => {
    const res = await apiClient.get(`/journals/clients/${clientId}`)
    return res.data
  },
  getJournalsOverview: async (clientId?: number): Promise<JournalOverview[]> => {
    const res = await apiClient.get('/journals/overview', { params: { client_id: clientId } })
    return res.data
  },
  getJournal: async (journalId: number): Promise<JournalOverview> => {
    const res = await apiClient.get(`/journals/${journalId}`)
    return res.data
  },
  getJournalArticles: async (journalId: number): Promise<JournalArticleRow[]> => {
    const res = await apiClient.get(`/journals/${journalId}/articles`)
    return res.data
  },
  uploadArticles: async (journalId: number, files: File[]): Promise<ArticleUploadResult> => {
    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    const res = await apiClient.post(`/journals/${journalId}/articles/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return res.data
  },

  saveXhtml: async (articleId: number, html: string): Promise<{
    status: string; xhtml_version: number; xhtml_content: string
    open_issues: Partial<Record<string, Record<'error' | 'warning' | 'info', number>>>
  }> => {
    const res = await apiClient.put(`/journals/articles/${articleId}/xhtml`, { html_content: html })
    return res.data
  },
  getWorkspace: async (articleId: number): Promise<ArticleWorkspace> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/workspace`)
    return res.data
  },

  // Journal design pack
  getAssets: async (journalId: number, kind?: AssetKind): Promise<JournalAsset[]> => {
    const res = await apiClient.get(`/journals/${journalId}/assets`, { params: { kind } })
    return res.data
  },
  uploadAssets: async (journalId: number, kind: AssetKind, files: File[], note?: string): Promise<JournalAsset[]> => {
    const fd = new FormData()
    fd.append('kind', kind)
    if (note) fd.append('note', note)
    files.forEach(f => fd.append('files', f))
    const res = await apiClient.post(`/journals/${journalId}/assets`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return res.data
  },
  activateAsset: async (journalId: number, assetId: number): Promise<JournalAsset> => {
    const res = await apiClient.post(`/journals/${journalId}/assets/${assetId}/activate`)
    return res.data
  },
  assetUrl: (journalId: number, assetId: number) => `${apiClient.defaults.baseURL ?? ''}/journals/${journalId}/assets/${assetId}/download`,
  activateStylesheet: async (journalId: number, id: number): Promise<JournalStylesheet> => {
    const res = await apiClient.post(`/journals/${journalId}/stylesheets/${id}/activate`)
    return res.data
  },
  activateGrammarsheet: async (journalId: number, id: number): Promise<JournalGrammarsheet> => {
    const res = await apiClient.post(`/journals/${journalId}/grammarsheets/${id}/activate`)
    return res.data
  },

  // IA rules: the journal's editorial stylesheet used by the book Technical review page
  getIaRules: async (journalId: number): Promise<IaRulesState> => {
    const res = await apiClient.get(`/journals/${journalId}/ia-rules`)
    return res.data
  },
  saveIaRules: async (journalId: number, rows: IaRule[], name?: string): Promise<Omit<IaRulesState, 'catalog'>> => {
    const res = await apiClient.put(`/journals/${journalId}/ia-rules`, { selected_ia_rows: rows, name })
    return res.data
  },

  deleteArticle: async (articleId: number): Promise<{ status: string; title: string; files_removed: number }> => {
    const res = await apiClient.delete(`/journals/articles/${articleId}`)
    return res.data
  },

  /** Shadow book file so the book Structuring / Technical / Language review pages can open the article. */
  ensureReviewFile: async (articleId: number): Promise<{ file_id: number; project_id: number }> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/review-file`)
    return res.data
  },

  // Stage 1 reference processing (bib_* styles, bookmarks, citation links, validation)
  processReferences: async (articleId: number): Promise<{ status: string; engine: 'local' | 'pph' }> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/references/process`)
    return res.data
  },
  getReferenceStatus: async (articleId: number): Promise<{ status: string | null; reports: JournalFileInfo[]; qa_report: JournalFileInfo | null }> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/references`)
    return res.data
  },
  fileUrl: (articleId: number, fileId: number, inline = false) =>
    `${apiClient.defaults.baseURL ?? ''}/journals/articles/${articleId}/files/${fileId}/download${inline ? '?inline=true' : ''}`,
  /** Download the article's latest file of a kind: docx (working copy), xhtml, xml, pdf, indd. */
  latestFileUrl: (articleId: number, ext: 'docx' | 'xhtml' | 'xml' | 'pdf' | 'indd') =>
    `${apiClient.defaults.baseURL ?? ''}/journals/articles/${articleId}/files/latest?ext=${ext}`,

  // Article art
  getArt: async (articleId: number): Promise<ArticleArt> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/art`)
    return res.data
  },
  uploadArt: async (articleId: number, files: File[], figureNumber?: number): Promise<{ id: number; filename: string; figure_number: number | null; version: number }[]> => {
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    if (figureNumber !== undefined) fd.append('figure_number', String(figureNumber))
    const res = await apiClient.post(`/journals/articles/${articleId}/art`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return res.data
  },
  linkArt: async (articleId: number, fileId: number, figureNumber: number | null) => {
    const res = await apiClient.patch(`/journals/articles/${articleId}/art/${fileId}`, { figure_number: figureNumber })
    return res.data
  },
  renameArt: async (articleId: number, fileId: number) => {
    const res = await apiClient.post(`/journals/articles/${articleId}/art/${fileId}/rename`)
    return res.data
  },
  artUrl: (articleId: number, fileId: number) => `${apiClient.defaults.baseURL ?? ''}/journals/articles/${articleId}/art/${fileId}/download`,

  // Workflows
  getWorkflows: async (): Promise<JournalWorkflow[]> => {
    const res = await apiClient.get('/journals/workflows')
    return res.data
  },

  // Articles
  getArticles: async (journalId?: number): Promise<JournalArticle[]> => {
    const res = await apiClient.get('/journals/articles', { params: { journal_id: journalId } })
    return res.data
  },
  createArticle: async (data: { journal_id: number; article_doi?: string; article_title: string; article_type?: string; lead_author?: string }): Promise<JournalArticle> => {
    const res = await apiClient.post('/journals/articles', data)
    return res.data
  },
  advanceStage: async (articleId: number, remarks?: string): Promise<any> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/advance-stage`, { remarks })
    return res.data
  },
  revertStage: async (articleId: number, targetStage: number | string, remarks?: string): Promise<any> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/move-stage`, { target_stage: targetStage, remarks })
    return res.data
  },
  assignStage: async (data: StageAssignment): Promise<{ status: string; message: string }> => {
    const res = await apiClient.post('/journals/articles/assign-stage', data)
    return res.data
  },
  uploadZipPackage: async (journalId: number, zipFile: File): Promise<any> => {
    const formData = new FormData()
    formData.append('journal_id', String(journalId))
    formData.append('file', zipFile)
    const res = await apiClient.post('/journals/articles/upload-zip', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return res.data
  },
  extractMetadataFromFile: async (docxFile: File): Promise<any> => {
    const formData = new FormData()
    formData.append('file', docxFile)
    const res = await apiClient.post('/journals/articles/extract-metadata', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return res.data
  },
  getArticleFiles: async (articleId: number): Promise<any[]> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/files`)
    return res.data
  },
  uploadArticleFiles: async (articleId: number, files: File[]): Promise<any> => {
    const formData = new FormData()
    files.forEach(file => formData.append('files', file))
    const res = await apiClient.post(`/journals/articles/${articleId}/upload-files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return res.data
  },
  processPreEditing: async (articleId: number): Promise<PreEditingResult> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/process-pre-editing`)
    return res.data
  },

  // Pre-Editing steps (Structuring -> References -> IA rules -> Technical)
  getPreEditing: async (articleId: number): Promise<PreEditingState> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/pre-editing`)
    return res.data
  },
  runStep: async (articleId: number, step: PreEditingStepKey, restructure = false): Promise<{ pre_editing: PreEditingState; xhtml_version: number | null }> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/pre-editing/${step}/run`, null, { params: restructure ? { restructure: true } : {} })
    return res.data
  },
  finishStep: async (articleId: number, step: PreEditingStepKey, acceptWarnings = false): Promise<PreEditingState> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/pre-editing/${step}/finish`, { accept_warnings: acceptWarnings })
    return res.data
  },
  reopenStep: async (articleId: number, step: PreEditingStepKey): Promise<PreEditingState> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/pre-editing/${step}/reopen`)
    return res.data
  },

  // Journal style sheets & grammar sheets
  getStylesheets: async (journalId: number): Promise<JournalStylesheet[]> => {
    const res = await apiClient.get(`/journals/${journalId}/stylesheets`)
    return res.data
  },
  createStylesheet: async (journalId: number, data: Pick<JournalStylesheet, 'name' | 'style_rules'> & Partial<JournalStylesheet>): Promise<JournalStylesheet> => {
    const res = await apiClient.post(`/journals/${journalId}/stylesheets`, data)
    return res.data
  },
  getGrammarsheets: async (journalId: number): Promise<JournalGrammarsheet[]> => {
    const res = await apiClient.get(`/journals/${journalId}/grammarsheets`)
    return res.data
  },
  createGrammarsheet: async (journalId: number, data: Pick<JournalGrammarsheet, 'name' | 'grammar_rules'> & Partial<JournalGrammarsheet>): Promise<JournalGrammarsheet> => {
    const res = await apiClient.post(`/journals/${journalId}/grammarsheets`, data)
    return res.data
  },

  // Validation checks & issues
  getChecks: async (): Promise<JournalCheckInfo[]> => {
    const res = await apiClient.get('/journals/checks')
    return res.data
  },
  runCheck: async (articleId: number, module: JournalCheckModule): Promise<JournalCheckRun> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/checks/${module}/run`)
    return res.data
  },
  runAllChecks: async (articleId: number): Promise<{ runs: JournalCheckRun[]; not_implemented: JournalCheckModule[] }> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/checks/run-all`)
    return res.data
  },
  getIssues: async (articleId: number, filters: { module?: JournalCheckModule; severity?: IssueSeverity; issue_status?: IssueStatus } = {}): Promise<JournalIssue[]> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/issues`, { params: filters })
    return res.data
  },
  updateIssue: async (articleId: number, issueId: number, action: 'accept' | 'ignore' | 'reopen'): Promise<JournalIssue> => {
    const res = await apiClient.patch(`/journals/articles/${articleId}/issues/${issueId}`, { action })
    return res.data
  },
  ignoreAllIssues: async (articleId: number, opts: { module?: string; severity?: string } = {}): Promise<{ status: string; ignored_count: number }> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/issues/ignore-all`, opts)
    return res.data
  },

  // Stage 4: JATS XML
  convertToJats: async (articleId: number): Promise<JatsConversionResult> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/xml/convert`)
    return res.data
  },
  validateJats: async (articleId: number): Promise<JournalCheckRun> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/xml/validate`)
    return res.data
  },
  getJats: async (articleId: number): Promise<{ file: JournalFileInfo; content: string; is_current: boolean; findings: JatsFinding[] }> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/xml`)
    return res.data
  },
  /** Validate edited XML against the JATS 1.3 DTD without saving. */
  lintJats: async (articleId: number, content: string): Promise<{ findings: JatsFinding[] }> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/xml/lint`, { content })
    return res.data
  },
  /** Save edited XML as the next JATS XML version and re-run the XML & DTD check. */
  saveJats: async (articleId: number, content: string): Promise<{ file: JournalFileInfo; check_run: JournalCheckRun; open_issues: OpenIssueCounts; findings: JatsFinding[] }> => {
    const res = await apiClient.put(`/journals/articles/${articleId}/xml`, { content })
    return res.data
  },

  // Stages 5-7: InDesign, final QC, proof
  generateInDesign: async (articleId: number): Promise<{ status: string; message: string }> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/indesign/generate`)
    return res.data
  },
  getInDesignStatus: async (articleId: number): Promise<InDesignStatus> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/indesign`)
    return res.data
  },
  replaceArticleFile: async (articleId: number, file: File): Promise<any> => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await apiClient.post(`/journals/articles/${articleId}/files/replace`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return res.data
  },
  proofUrl: (articleId: number): string => `${apiClient.defaults.baseURL ?? ''}/journals/articles/${articleId}/proof`,

  // Article file manager (the page before the review page)
  getFolders: async (articleId: number): Promise<ArticleFolders> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/folders`)
    return res.data
  },
  getFileVersions: async (articleId: number, fileId: number | 'working'): Promise<(ArticleFileRow & { current?: boolean })[]> => {
    const res = await apiClient.get(`/journals/articles/${articleId}/files/${fileId}/versions`)
    return res.data
  },
  restoreFile: async (articleId: number, fileId: number): Promise<{ message: string; file: JournalFileInfo | null }> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/files/${fileId}/restore`)
    return res.data
  },
  deleteFile: async (articleId: number, fileId: number): Promise<{ status: string; filename: string }> => {
    const res = await apiClient.delete(`/journals/articles/${articleId}/files/${fileId}`)
    return res.data
  },
  /** The selected files as one zip (saved by the browser). */
  bulkDownload: async (articleId: number, fileIds: (number | 'working')[]): Promise<Blob> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/files/bulk-download`, { file_ids: fileIds.map(String) }, { responseType: 'blob' })
    return res.data
  },
  archiveUrl: (articleId: number) => `${apiClient.defaults.baseURL ?? ''}/journals/articles/${articleId}/archive`,
  layoutHtmlUrl: (articleId: number) => `${apiClient.defaults.baseURL ?? ''}/journals/articles/${articleId}/xml/layout-html`,
  proofPdfUrl: (articleId: number) => `${apiClient.defaults.baseURL ?? ''}/journals/articles/${articleId}/proof`,
  downloadFileUrl: (articleId: number, file: ArticleFileRow) =>
    file.id === 'working'
      ? `${apiClient.defaults.baseURL ?? ''}/journals/articles/${articleId}/files/latest?ext=docx`
      : `${apiClient.defaults.baseURL ?? ''}/journals/articles/${articleId}/files/${file.id}/download`,
  createDelivery: async (articleId: number, opts: { include_indesign: boolean; include_art: boolean }): Promise<{ file: JournalFileInfo; readiness: DeliveryCheck[]; completed: boolean }> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/delivery`, opts)
    return res.data
  },
  getUsers: async (): Promise<JournalUser[]> => {
    const res = await apiClient.get('/journals/users')
    return res.data
  },
  assignArticle: async (articleId: number, data: { stage_number?: number; assignee_id?: number; assignee_name?: string; planned_start_date?: string; planned_end_date?: string; sla_hours?: number; complexity_level?: string; remarks?: string }): Promise<any> => {
    const res = await apiClient.patch(`/journals/articles/${articleId}/assign`, data)
    return res.data
  },
  updateDelay: async (articleId: number, data: { delay_category: string; revised_due_date: string; delay_days?: number; delay_reason: string }): Promise<any> => {
    const res = await apiClient.patch(`/journals/articles/${articleId}/delay`, data)
    return res.data
  },
}

export type ArticleFolderKey = 'manuscript' | 'art' | 'xml' | 'indesign' | 'proof' | 'delivery' | 'backup'

export interface ArticleFileRow {
  id: number | 'working'
  filename: string
  category: string
  type: string
  version: number
  versions: number
  size: number | null
  uploaded_at: string
  uploaded_by: string
  figure_number: number | null
  status: { kind: 'ok' | 'warn' | 'err' | 'info'; label: string }
  folder: ArticleFolderKey
  protected: boolean
  exists: boolean
  note?: string
}

export interface ArticleFolder {
  key: ArticleFolderKey
  label: string
  hint: string
  count: number
  attention: boolean
  files: ArticleFileRow[]
}

export interface DeliveryCheck { key: string; label: string; ok: boolean; detail: string | null }

export interface ArticleFolders {
  article: { id: number; article_title: string; article_doi?: string | null; current_stage: string; status: string }
  journal: { id: number; journal_code: string; journal_title: string; client_code: string | null; client_id: number; volume?: string | null; issue?: string | null } | null
  folders: ArticleFolder[]
  delivery_readiness: DeliveryCheck[]
}

