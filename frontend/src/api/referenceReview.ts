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
    }>;
    reference_entries?: Array<{
      number: number | null;
      text: string;
      style: string;
      is_cited: boolean;
      para_idx: number;
    }>;
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

export async function getReferenceReview(fileId: number) {
  const response = await apiClient.get<ReferenceValidationReviewResponse>(
    `/files/${fileId}/reference-review`
  );
  return response.data;
}

export async function saveReferenceReview(saveEndpoint: string, htmlContent: string) {
  const response = await apiClient.post<ReferenceSaveResponse>(
    saveEndpoint,
    { html_content: htmlContent }
  );
  return response.data;
}

export async function validateReferenceOnly(fileId: number) {
  const response = await apiClient.get<ReferenceValidateOnlyResponse>(
    `/files/${fileId}/reference-review/validate-only`
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
