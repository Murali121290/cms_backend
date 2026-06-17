import api from './client'

export interface ChapterEntry {
  chapter_no: number | null
  file_name: string
  path: string
}

export interface FileEntry {
  file_name: string
  path: string
}

export interface UploadResult {
  zip_path: string
  extracted_path: string
  total_chapters: number
  chapters: ChapterEntry[]
  images: FileEntry[]
  xml: FileEntry[]
  docs: FileEntry[]
  chapters_inserted: number
}

export const uploadsApi = {
  uploadZip: async (customerCode: string, projectCode: string, projectId: number, file: File): Promise<UploadResult> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('project_id', String(projectId))
    const r = await api.post<UploadResult>(
      `/uploads/${encodeURIComponent(customerCode)}/${encodeURIComponent(projectCode)}`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return r.data
  },
}
