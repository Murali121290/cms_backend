import apiClient from './client'

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
  status: string
  created_at: string
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

export type JournalCheckModule = 'structuring' | 'references' | 'technical' | 'language' | 'xml'
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
  suggestion?: { type: 'replace' | 'retag' | 'html' | 'relink'; to: string }
  source_issue_id?: number
  status: IssueStatus
  resolution?: string
  resolved_by_id?: number
  resolved_at?: string
  created_at: string
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
  createJournal: async (data: { client_id: number; journal_code: string; journal_title: string; issn_print?: string; issn_online?: string; volume?: string; issue?: string }): Promise<Journal> => {
    const res = await apiClient.post('/journals', data)
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
  processPreEditing: async (articleId: number): Promise<any> => {
    const res = await apiClient.post(`/journals/articles/${articleId}/process-pre-editing`)
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
  }
}
