import { apiClient } from "@/api/client";
import type { FileRecord, Viewer } from "@/types/api";

export interface ReferenceValidationReviewResponse {
  status: "ok";
  viewer: Viewer;
  file: FileRecord;
  content: string;
  filename: string;
  styles: string[];
  validation_logs: {
    stats: Record<string, number>;
    total_refs: number;
    total_cites: number;
    issues: Array<{
      type: string;
      para_idx: number;
      message: string;
      citation?: string;
      original_text?: string;
      corrected_text?: string;
    }>;
    renumbering_map: Record<string, string>;
    duplicates: Array<{
      text1: string;
      text2: string;
      num1?: number;
      num2?: number;
      similarity: number;
      para_idx1: number;
      para_idx2: number;
    }>;
    sequence_issues: Array<{
      para_idx: number;
      message: string;
      citation?: string;
    }>;
    missing_references: Array<{
      type: string;
      para_idx: number;
      message: string;
      citation?: string;
    }>;
    unused_references: Array<{
      type: string;
      para_idx: number;
      message: string;
      citation?: string;
    }>;
    raw_log?: string;
    detected_style?: "AMA" | "APA";
    citation_pairs?: Array<{
      citation: string | null;
      ref_number?: number;
      ref_text: string;
      status: "ok" | "missing" | "unused";
      author?: string;
      year?: string;
      para_idx?: number;
      match_score?: number;
    }>;
    reference_entries?: Array<{
      number: number | null;
      text: string;
      style: string;
      is_cited: boolean;
      para_idx: number;
    }>;
    // AMA-specific additions
    broken_ranges?: Array<{ raw: string; match: string }>;
    invalid_numbers?: Array<{ number: number; message: string }>;
    mixed_citation_style?: { styles_found: string[]; message: string } | null;
    inline_text_citations?: Array<{ number: number; raw: string; message: string }>;
    roman_numeral_citations?: Array<{ raw: string; message: string }>;
    summary?: {
      missing_references: number;
      unused_references: number;
      sequence_issues: number;
      broken_ranges: number;
      invalid_numbers: number;
      format_warnings: number;
    };
    // APA-specific additions
    et_al_issues?: Array<{ type: string; message: string; para_idx: number; citation?: string; original_text?: string; corrected_text?: string }>;
    name_spelling_warnings?: Array<{ type: string; message: string; para_idx: number; original_text?: string; corrected_text?: string }>;
    ordering_issues?: Array<{ type: string; message: string; para_idx: number; original_text?: string; corrected_text?: string }>;
    suffix_issues?: Array<{ type: string; message: string; para_idx: number; original_text?: string; corrected_text?: string }>;
    disambiguation_issues?: Array<{ type: string; message: string; para_idx: number }>;
    personal_comm_citations?: Array<{ type: string; message: string; para_idx: number; raw?: string }>;
    secondary_citations?: Array<{ type: string; message: string; para_idx: number; raw?: string }>;
  };
  save_endpoint: string;
  export_href: string;
  return_href: string | null;
}

export interface ReferenceSaveResponse {
  status: "ok";
  file_id: number;
  target_filename: string;
}

export interface ReferenceValidateOnlyResponse {
  validation_logs: ReferenceValidationReviewResponse["validation_logs"];
  detected_style: "AMA" | "APA";
}

export async function getReferenceReview(fileId: number, style?: string, citationFormat?: string) {
  const params = new URLSearchParams();
  if (style) params.set("style", style);
  if (citationFormat) params.set("citation_format", citationFormat);
  const qs = params.toString();
  const url = `/files/${fileId}/reference-review${qs ? `?${qs}` : ""}`;
  const response = await apiClient.get<ReferenceValidationReviewResponse>(url);
  return response.data;
}

export async function saveReferenceReview(saveEndpoint: string, htmlContent: string) {
  const response = await apiClient.post<ReferenceSaveResponse>(
    saveEndpoint,
    { html_content: htmlContent }
  );
  return response.data;
}

export async function validateReferenceOnly(fileId: number, style?: string, citationFormat?: string) {
  const params = new URLSearchParams();
  if (style) params.set("style", style);
  if (citationFormat) params.set("citation_format", citationFormat);
  const qs = params.toString();
  const url = `/files/${fileId}/reference-review/validate-only${qs ? `?${qs}` : ""}`;
  const response = await apiClient.get<ReferenceValidateOnlyResponse>(url);
  return response.data;
}

export interface MergeDuplicatesRequest {
  canonical_num: number;     // Keep this reference (num1)
  duplicate_num: number;     // Remove this reference (num2)
}

export interface MergeDuplicatesResponse {
  status: "ok";
  canonical_num: number;
  duplicate_num: number;
  message: string;
}

// NOTE: The actual merge is performed client-side in the editor (queued);
// this endpoint only records the intent so the server can renumber on next validate.
export async function queueDuplicateMerge(
  fileId: number,
  data: MergeDuplicatesRequest
) {
  const response = await apiClient.post<MergeDuplicatesResponse>(
    `/files/${fileId}/reference-review/merge-duplicate`,
    data
  );
  return response.data;
}

// Phase 2: Citation Linking

export interface CitationCandidate {
  ref_key: string | number;
  ref_text: string;
  match_type: "exact" | "smart" | "spelling_mismatch" | "year_mismatch" | "fuzzy";
  confidence: number;
  reason: string;
}

export interface CitationCandidatesResponse {
  status: "ok";
  citation_text: string;
  candidates: CitationCandidate[];
}

export async function getCitationCandidates(
  fileId: number,
  citationText: string,
  author?: string,
  year?: string
) {
  const response = await apiClient.post<CitationCandidatesResponse>(
    `/files/${fileId}/citation-candidates`,
    {
      citation_text: citationText,
      author: author || citationText,
      year,
    }
  );
  return response.data;
}

export interface ReferenceCandidatesResponse {
  status: "ok";
  reference_key: string;
  candidates: Array<{
    citation_text: string;
    para_idx: number;
    match_type: string;
    confidence: number;
    reason: string;
  }>;
}

export async function getReferenceCandidates(
  fileId: number,
  refText: string,
  refIdx?: number
) {
  const response = await apiClient.post<ReferenceCandidatesResponse>(
    `/files/${fileId}/reference-candidates`,
    {
      ref_text: refText,
      ref_idx: refIdx,
      only_unmatched: true,
    }
  );
  return response.data;
}

export interface LinkCitationRequest {
  citation_key: string;
  citation_text: string;
  para_idx: number;
  ref_idx: number;
  ref_text: string;
  match_type?: string;
  confidence?: number;
  link_flags?: {
    flag_type: "verified" | "secondary" | "manual_fix";
    user_notes?: string;
  };
}

export interface LinkCitationResponse {
  status: "ok";
  link_id: string;
  citation_key: string;
  ref_idx: number;
  comment_id: string;
}

export async function linkCitationToReference(
  fileId: number,
  linkData: LinkCitationRequest
) {
  const response = await apiClient.post<LinkCitationResponse>(
    `/files/${fileId}/link-citation-to-reference`,
    linkData
  );
  return response.data;
}

export interface CitationCommentData {
  comment_id: string;
  target_type: "citation" | "reference";
  citation_key?: string;
  citation_text?: string;
  para_idx?: number;
  ref_idx?: number | null;
  ref_text?: string;
  comment_text: string;
  flags: string[];
  created_at: string;
  created_by: string;
}

export interface CitationCommentsResponse {
  status: "ok";
  links: Array<{
    link_id: string;
    citation_key: string;
    citation_text: string;
    para_idx: number;
    ref_idx: number;
    ref_text: string;
    match_type: string;
    confidence: number;
    linked_at: string;
    linked_by: string;
    link_flags?: Record<string, string>;
  }>;
  comments: CitationCommentData[];
}

export async function getCitationComments(fileId: number) {
  const response = await apiClient.get<CitationCommentsResponse>(
    `/files/${fileId}/citation-comments`
  );
  return response.data;
}

export interface AddCommentRequest {
  target_type: "citation" | "reference";
  comment_text: string;
  citation_key?: string;
  para_idx?: number;
  ref_idx?: number;
  flags?: string[];
}

export interface AddCommentResponse {
  status: "ok";
  comment_id: string;
  created_at: string;
}

export async function addCitationComment(
  fileId: number,
  commentData: AddCommentRequest
) {
  const response = await apiClient.post<AddCommentResponse>(
    `/files/${fileId}/citation-comments`,
    commentData
  );
  return response.data;
}
