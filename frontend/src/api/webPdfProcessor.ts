import api, { getApiErrorMessage } from './client';

export interface WebPdfProject {
  id: number;
  client: string;
  client_code: string;
  project_name: string;
  folder_name: string;
  pdf_path: string;
  total_files: number;
  status: string;
  validation_status: string;
  latest_validation_file?: string;
  assignee?: string;
  uploaded_by_id?: number;
  uploaded_at: string;
  updated_at: string;
}

export async function listProjects(): Promise<WebPdfProject[]> {
  try {
    const { data } = await api.get<WebPdfProject[]>('/post-prod/web-pdf-processor/projects');
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to load projects'));
  }
}

export async function createProject(formData: FormData): Promise<{ message: string; project: WebPdfProject }> {
  try {
    const { data } = await api.post<{ message: string; project: WebPdfProject }>(
      '/post-prod/web-pdf-processor/projects',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to create project'));
  }
}

export async function updateProject(
  projectId: number,
  payload: { assignee?: string },
): Promise<WebPdfProject> {
  try {
    const { data } = await api.put<WebPdfProject>(`/post-prod/web-pdf-processor/projects/${projectId}`, payload);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to update project'));
  }
}

export async function deleteProject(projectId: number): Promise<void> {
  try {
    await api.delete(`/post-prod/web-pdf-processor/projects/${projectId}`);
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to delete project'));
  }
}

export interface ProjectFile {
  filename: string;
  relative_path: string;
  absolute_path: string;
  category: 'FC' | 'FM' | 'TEXT' | 'BM' | 'BC';
  order: number;
  size: number;
}

export async function listProjectFiles(projectId: number): Promise<ProjectFile[]> {
  try {
    const { data } = await api.get<ProjectFile[]>(`/post-prod/web-pdf-processor/projects/${projectId}/files`);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to list project files'));
  }
}

export interface MergeFile {
  filename: string;
  absolute_path: string;
  category: string;
}

export async function mergeProjectFiles(projectId: number, files: MergeFile[]): Promise<{ message: string; merged_path: string }> {
  try {
    const { data } = await api.post<{ message: string; merged_path: string }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/merge`,
      { files },
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to merge PDF files'));
  }
}

export interface TrimConfig {
  mode: string;
  margins?: number[];
  standardize_size: boolean;
  remove_marks: boolean;
}

export async function trimProjectPDF(projectId: number, config: TrimConfig): Promise<{ message: string; trimmed_path: string }> {
  try {
    const { data } = await api.post<{ message: string; trimmed_path: string }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/trim`,
      config,
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to trim PDF file'));
  }
}

export async function generateBookmarks(projectId: number, includeSubheadings: boolean = true): Promise<any> {
  try {
    const { data } = await api.post(`/post-prod/web-pdf-processor/projects/${projectId}/generate-bookmarks?include_subheadings=${includeSubheadings}`);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate bookmarks'));
  }
}

export interface BookmarkItem {
  level: number;
  title: string;
  page: number;
}

export interface ExistingBookmarksInfo {
  has_existing_bookmarks: boolean;
  count: number;
  sample_titles: string[];
}

export async function getExistingBookmarksInfo(projectId: number): Promise<ExistingBookmarksInfo> {
  try {
    const { data } = await api.get<ExistingBookmarksInfo>(`/post-prod/web-pdf-processor/projects/${projectId}/bookmarks-info`);
    return data;
  } catch (err) {
    return { has_existing_bookmarks: false, count: 0, sample_titles: [] };
  }
}

export async function acceptExistingBookmarks(projectId: number): Promise<{ success: boolean; toc_entries_detected: number; bookmarks_generated: number; kept_existing: boolean }> {
  try {
    const { data } = await api.post(`/post-prod/web-pdf-processor/projects/${projectId}/accept-existing-bookmarks`);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to accept existing bookmarks'));
  }
}

export async function getBookmarks(projectId: number): Promise<BookmarkItem[]> {
  try {
    const { data } = await api.get<{ bookmarks: BookmarkItem[] }>(`/post-prod/web-pdf-processor/projects/${projectId}/bookmarks`);
    return data.bookmarks;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to fetch bookmarks'));
  }
}

export async function updateBookmarks(projectId: number, bookmarks: BookmarkItem[]): Promise<void> {
  try {
    await api.put(`/post-prod/web-pdf-processor/projects/${projectId}/bookmarks`, bookmarks);
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to update bookmarks'));
  }
}

export interface ExistingTocLinksInfo {
  has_existing_links: boolean;
  count: number;
  toc_pages_count?: number;
}

export async function getExistingTocLinksInfo(projectId: number): Promise<ExistingTocLinksInfo> {
  try {
    const { data } = await api.get<ExistingTocLinksInfo>(`/post-prod/web-pdf-processor/projects/${projectId}/toc-links-info`);
    return data;
  } catch {
    return { has_existing_links: false, count: 0 };
  }
}

export async function acceptExistingTocLinks(projectId: number): Promise<{ success: boolean; total_links: number; kept_existing: boolean }> {
  try {
    const { data } = await api.post(`/post-prod/web-pdf-processor/projects/${projectId}/accept-existing-toc-links`);
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to accept existing TOC links'));
  }
}

export async function generateLinks(
  projectId: number,
  linkType: 'one_way' | 'two_way',
  analyzeOnly: boolean = false,
  preserveExisting: boolean = true
): Promise<{ 
  success: boolean; 
  total_links: number; 
  one_way_links: number; 
  two_way_links: number;
  existing_preserved?: number;
  details?: { type: string; title: string; source_page: number; target_page: number; is_linked: boolean; rect_found?: boolean; preserved?: boolean }[];
}> {
  try {
    const { data } = await api.post<{ 
      success: boolean; 
      total_links: number; 
      one_way_links: number; 
      two_way_links: number;
      existing_preserved?: number;
      details?: { type: string; title: string; source_page: number; target_page: number; is_linked: boolean; rect_found?: boolean; preserved?: boolean }[];
    }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-links`,
      { link_type: linkType, analyze_only: analyzeOnly, preserve_existing: preserveExisting },
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate links'));
  }
}

export async function generateLinkManual(
  projectId: number,
  type: string,
  title: string,
  sourcePage: number,
  targetPage: number
): Promise<{ success: boolean }> {
  try {
    const { data } = await api.post<{ success: boolean }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-links/manual`,
      { type, title, source_page: sourcePage, target_page: targetPage }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to manually create link'));
  }
}

export interface UrlLinkDetail {
  url: string;
  display_text: string;
  page: number;
  is_linked: boolean;
  rect: number[] | null;
  http_status: number | null;
  http_description: string;
  http_ok: boolean;
}

export async function generateUrlLinks(
  projectId: number,
  analyzeOnly: boolean = true,
  colorUrls: boolean = false
): Promise<{
  success: boolean;
  total_urls: number;
  already_linked: number;
  not_linked: number;
  details: UrlLinkDetail[];
}> {
  try {
    const { data } = await api.post(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-url-links`,
      { analyze_only: analyzeOnly, color_urls: colorUrls }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate URL links'));
  }
}

export interface EmailLinkDetail {
  email: string;
  page: number;
  is_linked: boolean;
  rect: number[] | null;
}

export async function generateEmailLinks(
  projectId: number,
  analyzeOnly: boolean = true,
  colorEmails: boolean = false
): Promise<{
  success: boolean;
  total_emails: number;
  already_linked: number;
  not_linked: number;
  details: EmailLinkDetail[];
}> {
  try {
    const { data } = await api.post(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-email-links`,
      { analyze_only: analyzeOnly, color_emails: colorEmails }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate email links'));
  }
}

export interface EndnoteDetail {
  note_number: number;
  reference_page: number | null;
  definition_page: number | null;
  is_linked: boolean;
  reference_count?: number;
  status?: string;
}

export async function generateEndnoteLinks(
  projectId: number,
  analyzeOnly: boolean = true
): Promise<{
  success: boolean;
  total_notes: number;
  linked: number;
  not_linked: number;
  details: EndnoteDetail[];
}> {
  try {
    const { data } = await api.post(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-endnote-links`,
      { analyze_only: analyzeOnly }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate endnote links'));
  }
}

export interface CrossrefDetail {
  type: string;
  reference_text: string;
  reference_page: number | null;
  target_type: string;
  target_identifier: string;
  target_page: number | null;
  is_linked: boolean;
}

export interface IndexLinkDetail {
  term: string;
  page_reference: string;
  printed_page: number;
  source_page: number;
  target_page: number;
  is_linked: boolean;
}

export interface GlossaryLinkDetail {
  term: string;
  body_term: string;
  body_page: number;
  glossary_page: number;
  is_linked: boolean;
  rect?: number[];
}

export async function generateIndexLinks(
  projectId: number,
  analyzeOnly: boolean = true
): Promise<{
  success: boolean;
  total_references: number;
  linked: number;
  not_linked: number;
  details: IndexLinkDetail[];
  index_pages: number[];
}> {
  try {
    const { data } = await api.post(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-index-links`,
      { analyze_only: analyzeOnly }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate index links'));
  }
}

export async function generateGlossaryLinks(
  projectId: number,
  analyzeOnly: boolean = true
): Promise<{
  success: boolean;
  total_terms: number;
  linked: number;
  not_linked: number;
  details: GlossaryLinkDetail[];
  glossary_pages: number[];
}> {
  try {
    const { data } = await api.post(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-glossary-links`,
      { analyze_only: analyzeOnly }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate glossary links'));
  }
}

export async function generateCrossrefLinks(
  projectId: number,
  analyzeOnly: boolean = true
): Promise<{
  success: boolean;
  total_references: number;
  linked: number;
  not_linked: number;
  details: CrossrefDetail[];
}> {
  try {
    const { data } = await api.post(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-crossref-links`,
      { analyze_only: analyzeOnly }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate cross-reference links'));
  }
}
export interface FontCheckResult {
  all_embedded: boolean;
  missing_fonts: string[];
  embedded_fonts: string[];
  total_fonts: number;
}

export async function checkProjectFonts(projectId: number): Promise<FontCheckResult> {
  try {
    const { data } = await api.get<FontCheckResult>(
      `/post-prod/web-pdf-processor/projects/${projectId}/fonts-status`
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to check fonts'));
  }
}

export async function fixProjectFonts(projectId: number): Promise<FontCheckResult> {
  try {
    const { data } = await api.post<FontCheckResult>(
      `/post-prod/web-pdf-processor/projects/${projectId}/fix-fonts`
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to fix and embed fonts'));
  }
}

export interface ValidationDiffReport {
  success: boolean;
  integrity_score: number;
  status: 'passed' | 'warnings' | 'failed';
  page_count_match: boolean;
  base_page_count: number;
  final_page_count: number;
  total_pages_analyzed: number;
  text_discrepancies_count: number;
  font_discrepancies_count: number;
  alignment_drifts_count: number;
  text_discrepancies: {
    page: number;
    issue: string;
    baseline_words: number;
    final_words: number;
    sample_baseline: string;
    sample_final: string;
  }[];
  font_discrepancies: {
    page: number;
    issue: string;
    missing_fonts: string[];
    new_fonts: string[];
  }[];
  alignment_drifts: {
    page: number;
    issue: string;
    max_drift_pt: number;
  }[];
  error?: string;
}

export async function runValidationDiff(projectId: number): Promise<ValidationDiffReport> {
  try {
    const { data } = await api.post<ValidationDiffReport>(
      `/post-prod/web-pdf-processor/projects/${projectId}/validation-diff`
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to run validation diff'));
  }
}
