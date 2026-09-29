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

export const journalsApi = {
  // Clients
  getCclients: async (): Promise<JournalClient[]> => {
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
    const res = await apiClient.post(`/journals/articles/${articleId}/advance-stage`, { article_id: articleId, current_stage: '', remarks })
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
  }
}
