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
  assigned_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
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
  not_linked?: number;
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
  page: number;
  page_idx?: number;
  url: string;
  display_text: string;
  original_text?: string;
  reconstructed_url?: string;
  annotation_dest?: string | null;
  is_linked: boolean;
  is_multiline?: boolean;
  line_count?: number;
  rect: number[] | null;
  all_rects?: number[][];
  segments?: string[];
  http_status: number | null;
  http_description: string;
  http_ok: boolean;
  validation_status?: string;
  final_url?: string | null;
  issue_type?: string | null;
  correction_suggestion?: string | null;
  correction_status?: string;
  error_description?: string | null;
  is_edited?: boolean;
}

export interface UrlLinkSummary {
  total_urls: number;
  total_annotations: number;
  already_linked: number;
  not_linked: number;
  multiline_reconstructed: number;
  valid_urls: number;
  broken_urls: number;
  redirected_urls: number;
  invalid_urls: number;
  access_restricted: number;
  timeouts: number;
  ssl_errors: number;
  missing_annotations: number;
  destination_mismatches: number;
  malformed_annotations: number;
  duplicate_annotations: number;
  automatically_corrected: number;
  needs_manual_review: number;
}

export interface GenerateUrlLinksResponse {
  success: boolean;
  total_urls: number;
  already_linked: number;
  not_linked: number;
  details: UrlLinkDetail[];
  summary?: UrlLinkSummary;
  verification?: {
    verified: boolean;
    corrected_count: number;
    total_links_in_pdf: number;
    verified_items_count: number;
    content_integrity_verified: boolean;
    message: string;
  };
}

export interface GenerateUrlLinksOptions {
  analyzeOnly?: boolean;
  colorUrls?: boolean;
  fixMultiline?: boolean;
  fixMissing?: boolean;
  fixMalformed?: boolean;
  removeDuplicates?: boolean;
  customDetails?: UrlLinkDetail[];
}

export async function generateUrlLinks(
  projectId: number,
  analyzeOnly: boolean = true,
  colorUrls: boolean = false,
  options?: GenerateUrlLinksOptions
): Promise<GenerateUrlLinksResponse> {
  try {
    const payload = {
      analyze_only: options?.analyzeOnly ?? analyzeOnly,
      color_urls: options?.colorUrls ?? colorUrls,
      fix_multiline: options?.fixMultiline ?? true,
      fix_missing: options?.fixMissing ?? true,
      fix_malformed: options?.fixMalformed ?? true,
      remove_duplicates: options?.removeDuplicates ?? true,
      custom_details: options?.customDetails ?? undefined,
    };
    const { data } = await api.post<GenerateUrlLinksResponse>(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-url-links`,
      payload
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
  analyzeOnly: boolean = true,
  customDetails?: any[]
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
      { analyze_only: analyzeOnly, custom_details: customDetails }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate endnote links'));
  }
}

export interface ReferenceCitationDetail {
  citation: string;
  author: string;
  year: string;
  page: number;
  def_page: number | null;
  target_author: string | null;
  target_preview: string | null;
  match_type: string;
  is_linked: boolean;
  status: string;
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

export async function generateReferenceCitationLinks(
  projectId: number,
  analyzeOnly: boolean = true
): Promise<{
  success: boolean;
  total_citations: number;
  matched: number;
  linked: number;
  not_linked: number;
  details: ReferenceCitationDetail[];
}> {
  try {
    const { data } = await api.post(
      `/post-prod/web-pdf-processor/projects/${projectId}/generate-reference-citation-links`,
      { analyze_only: analyzeOnly }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to generate reference citation links'));
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

export interface PageDimensionItem {
  page: number;
  width_pt: number;
  height_pt: number;
  width_in: number;
  height_in: number;
  width_mm: number;
  height_mm: number;
}

export interface PageDimensionsResponse {
  total_pages: number;
  pages: PageDimensionItem[];
}

export async function getPageDimensions(projectId: number): Promise<PageDimensionsResponse> {
  try {
    const { data } = await api.get<PageDimensionsResponse>(
      `/post-prod/web-pdf-processor/projects/${projectId}/page-dimensions`
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to fetch page dimensions'));
  }
}

export async function updatePageDimensions(
  projectId: number,
  payload: {
    page?: number;
    width: number;
    height: number;
    unit: 'in' | 'mm' | 'pt';
    mode?: 'scale' | 'crop';
    crop_rect?: [number, number, number, number];
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const { data } = await api.put<{ success: boolean; message: string }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/page-dimensions`,
      payload
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to update page dimensions'));
  }
}

export interface PageLabelUpdatePayload {
  subset: 'all' | 'selected' | 'range';
  pages?: string;
  style: 'D' | 'r' | 'R' | 'a' | 'A' | '';
  prefix: string;
  start: number;
}

export async function updatePageLabels(
  projectId: number,
  payload: PageLabelUpdatePayload
): Promise<{ success: boolean; message: string }> {
  try {
    const { data } = await api.put<{ success: boolean; message: string }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/page-labels`,
      payload
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to update page labels'));
  }
}

export interface PageLinkItem {
  link_index: number;
  xref?: number | null;
  rect: [number, number, number, number];
  kind: 'goto' | 'uri' | 'other';
  target_page?: number | null;
  uri?: string | null;
}

export interface PageLinksResponse {
  page: number;
  total_pages: number;
  width_pt: number;
  height_pt: number;
  links: PageLinkItem[];
}

export async function getPageLinks(
  projectId: number,
  page: number
): Promise<PageLinksResponse> {
  try {
    const { data } = await api.get<PageLinksResponse>(
      `/post-prod/web-pdf-processor/projects/${projectId}/page-links`,
      { params: { page } }
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to fetch page links'));
  }
}

export async function updatePageLink(
  projectId: number,
  payload: {
    action: 'update' | 'create' | 'delete';
    page: number;
    xref?: number | null;
    link_index?: number | null;
    rect?: [number, number, number, number];
    kind?: 'goto' | 'uri';
    target_page?: number | null;
    uri?: string | null;
  }
): Promise<{ success: boolean; message: string; links: PageLinkItem[] }> {
  try {
    const { data } = await api.put<{ success: boolean; message: string; links: PageLinkItem[] }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/page-links`,
      payload
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to update page link'));
  }
}

export interface DocumentPropertiesResponse {
  file_size_bytes: number;
  pdf_version: string;
  page_count: number;
  page_size: string;
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creation_date?: string;
  mod_date?: string;
}

export async function getDocumentProperties(projectId: number): Promise<DocumentPropertiesResponse> {
  try {
    const { data } = await api.get<DocumentPropertiesResponse>(
      `/post-prod/web-pdf-processor/projects/${projectId}/document-properties`
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to fetch document properties'));
  }
}

export async function updateDocumentProperties(
  projectId: number,
  payload: {
    title: string;
    author: string;
    subject: string;
    keywords: string;
    creator: string;
    producer: string;
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const { data } = await api.put<{ success: boolean; message: string }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/document-properties`,
      payload
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to update document properties'));
  }
}

export async function getPdfHistoryStatus(
  projectId: number
): Promise<{ can_undo: boolean; can_redo: boolean; undo_count: number; redo_count: number }> {
  try {
    const { data } = await api.get<{ can_undo: boolean; can_redo: boolean; undo_count: number; redo_count: number }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/pdf-history-status`
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to fetch PDF history status'));
  }
}

export async function undoPdfEdit(
  projectId: number
): Promise<{ success: boolean; message: string; can_undo: boolean; can_redo: boolean }> {
  try {
    const { data } = await api.post<{ success: boolean; message: string; can_undo: boolean; can_redo: boolean }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/pdf-undo`
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to undo PDF edit'));
  }
}

export async function redoPdfEdit(
  projectId: number
): Promise<{ success: boolean; message: string; can_undo: boolean; can_redo: boolean }> {
  try {
    const { data } = await api.post<{ success: boolean; message: string; can_undo: boolean; can_redo: boolean }>(
      `/post-prod/web-pdf-processor/projects/${projectId}/pdf-redo`
    );
    return data;
  } catch (err) {
    throw new Error(getApiErrorMessage(err, 'Failed to redo PDF edit'));
  }
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
