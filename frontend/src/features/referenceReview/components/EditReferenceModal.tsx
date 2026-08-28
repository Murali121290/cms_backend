import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { apiClient, getApiErrorMessage } from "@/api/client";
import {
  searchPubMed,
  searchCrossRef,
  searchGoogleBooks,
  searchWikipedia,
  type SearchResultItem,
} from "../services/externalReferenceSearch";
import { styleReferenceText, styledDiffHTML } from "../utils/referenceStyling";

export type ReferenceEditResult = {
  file_id: number;
  ref_number: number;
  old_text: string;
  new_text: string;
  changed: boolean;
};

interface Props {
  fileId?: number | null;
  refNumber?: number;
  originalText: string;
  originalHtml?: string;
  detectedStyle?: "AMA" | "APA";
  currentUser?: string;
  onClose: () => void;
  onSaved?: (result: ReferenceEditResult) => void;
  onSaveTrackChanges?: (diffHtml: string, newText: string) => Promise<void> | void;
}

function extractTitleForQuery(text: string): string {
  const trimmed = text.replace(/^\s*\d+\.\s*/, "");
  const yearMatch = trimmed.match(/\((?:19|20)\d{2}\)\.?\s*/);
  const afterYear = yearMatch ? trimmed.slice((yearMatch.index ?? 0) + yearMatch[0].length) : trimmed;
  const firstStop = afterYear.search(/[.?!]\s/);
  const candidate = firstStop > 20 ? afterYear.slice(0, firstStop) : afterYear.slice(0, 120);
  return candidate.trim();
}

export function EditReferenceModal({
  fileId,
  refNumber,
  originalText,
  originalHtml,
  detectedStyle = "AMA",
  currentUser = "Editor",
  onClose,
  onSaved,
  onSaveTrackChanges,
}: Props) {
  const initialQuery = useMemo(() => extractTitleForQuery(originalText), [originalText]);
  const [editedText, setEditedText] = useState(originalText);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [searchSource, setSearchSource] = useState<"pubmed" | "crossref" | "googlebooks" | "wikipedia" | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSearch = async (source: "pubmed" | "crossref" | "googlebooks" | "wikipedia") => {
    if (!searchQuery.trim()) return;
    setSearchSource(source);
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      let results: SearchResultItem[] = [];
      if (source === "pubmed") {
        results = await searchPubMed(searchQuery, detectedStyle);
      } else if (source === "crossref") {
        results = await searchCrossRef(searchQuery, detectedStyle);
      } else if (source === "googlebooks") {
        results = await searchGoogleBooks(searchQuery, detectedStyle);
      } else if (source === "wikipedia") {
        results = await searchWikipedia(searchQuery);
      }
      setSearchResults(results);
    } catch (err) {
      setSearchError(getApiErrorMessage(err, `${source} search failed`));
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editedText.trim()) return;
    setSaving(true);
    setSaveError(null);

    const dirty = editedText.trim() !== originalText.trim();
    if (!dirty) {
      onClose();
      return;
    }

    const diffHtml = styledDiffHTML(originalText, editedText, currentUser);

    try {
      if (onSaveTrackChanges) {
        await onSaveTrackChanges(diffHtml, editedText.trim());
      } else if (fileId != null && refNumber != null) {
        const { data } = await apiClient.post(
          `/files/${fileId}/reference-review/references/${refNumber}/edit`,
          { new_text: editedText.trim(), track_changes: true },
        );
        onSaved?.(data as ReferenceEditResult);
      } else {
        onSaved?.({
          file_id: fileId ?? 0,
          ref_number: refNumber ?? 0,
          old_text: originalText,
          new_text: editedText.trim(),
          changed: true,
        });
      }
      onClose();
    } catch (e) {
      setSaveError(getApiErrorMessage(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const dirty = editedText.trim() !== originalText.trim();
  const livePreviewHtml = originalHtml || styleReferenceText(editedText);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-navy-100 max-w-3xl w-full flex flex-col overflow-hidden max-h-[90vh] transition-all duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-navy-50 flex items-center justify-between bg-surface-50">
          <h3 className="text-sm font-bold text-navy-900 flex items-center gap-2">
            <span className="text-navy-600">✎</span>
            Edit Reference Text
            {refNumber != null && (
              <span className="text-navy-400 text-xs font-normal">— ref_{refNumber}</span>
            )}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-navy-400 hover:text-navy-600 transition-colors p-1 rounded-md hover:bg-navy-50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
          <div className="space-y-1">
            <label className="text-[9px] uppercase font-bold text-navy-400 tracking-wider">
              Edited Reference
            </label>
            <textarea
              className="w-full text-xs p-3 border border-navy-200 rounded-lg text-navy-800 bg-white focus:outline-none focus:ring-2 focus:ring-navy-400 focus:border-navy-500 font-medium leading-relaxed min-h-[90px]"
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={3}
              placeholder="Modify reference text here..."
            />
          </div>

          <div className="space-y-1">
            <label className="text-[9px] uppercase font-bold text-navy-400 tracking-wider">
              Live Preview (with styling highlights)
            </label>
            {livePreviewHtml && (
              <div
                className="p-3 bg-surface-50/50 rounded-lg border border-navy-100/30 text-xs leading-relaxed font-medium select-text ProseMirror"
                style={{ whiteSpace: "pre-wrap" }}
                dangerouslySetInnerHTML={{ __html: livePreviewHtml }}
              />
            )}
            {/* Track changes diff preview — shown when textarea text differs from original */}
            {dirty && (
              <div className="space-y-1 mt-2">
                <div className="text-[9px] uppercase font-bold text-navy-400 tracking-wider">
                  After save (track changes)
                </div>
                <div
                  className="p-3 bg-white rounded-lg border border-navy-100/30 text-xs leading-relaxed font-medium select-text ProseMirror"
                  style={{ whiteSpace: "pre-wrap" }}
                  dangerouslySetInnerHTML={{
                    __html: styledDiffHTML(originalText, editedText, currentUser),
                  }}
                />
              </div>
            )}
          </div>

          {/* Database Search Section */}
          <div className="border-t border-navy-50 pt-4 space-y-3">
            <div className="text-[9px] uppercase font-bold text-navy-400 tracking-wider">
              Search Database for correct formatting ({detectedStyle} Style)
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-navy-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch(searchSource || "pubmed");
                  }}
                  className="w-full pl-8 pr-3 py-1.5 bg-surface-50 text-xs rounded-lg border border-navy-200 focus:outline-none focus:ring-1 focus:ring-navy-400 font-medium"
                  placeholder="Enter article title or keywords..."
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleSearch("pubmed")}
                disabled={searchLoading || !searchQuery.trim()}
                className="cursor-pointer"
              >
                PubMed
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleSearch("crossref")}
                disabled={searchLoading || !searchQuery.trim()}
                className="cursor-pointer"
              >
                CrossRef
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleSearch("googlebooks")}
                disabled={searchLoading || !searchQuery.trim()}
                className="cursor-pointer"
              >
                Google Books
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleSearch("wikipedia")}
                disabled={searchLoading || !searchQuery.trim()}
                className="cursor-pointer"
              >
                Wikipedia
              </Button>
            </div>

            {searchError && <div className="text-[12px] text-rose-600">{searchError}</div>}

            {searchLoading && (
              <div className="flex items-center justify-center py-6 text-xs text-navy-500 font-semibold gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-navy-600" />
                Searching{" "}
                {searchSource === "pubmed"
                  ? "PubMed"
                  : searchSource === "crossref"
                  ? "CrossRef"
                  : searchSource === "googlebooks"
                  ? "Google Books"
                  : "Wikipedia"}
                ...
              </div>
            )}

            {!searchLoading && searchResults.length > 0 && (
              <div className="space-y-2.5 max-h-[200px] overflow-y-auto border border-navy-100 rounded-lg p-3 bg-surface-50/20">
                <div className="text-[9px] uppercase font-bold text-navy-400 tracking-wider mb-2">
                  Search Results (
                  {searchSource === "pubmed"
                    ? "PubMed"
                    : searchSource === "crossref"
                    ? "CrossRef"
                    : searchSource === "googlebooks"
                    ? "Google Books"
                    : "Wikipedia"}
                  )
                </div>
                {searchResults.map((result, index) => (
                  <div
                    key={`${result.id}-${index}`}
                    className="p-2.5 bg-white border border-navy-100 rounded-lg shadow-sm flex items-start justify-between gap-4 hover:border-navy-300 transition-colors"
                  >
                    <div className="text-xs text-navy-800 leading-relaxed font-medium flex-1">
                      {result.formatted}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditedText(result.formatted)}
                      className="shrink-0 text-[10px] font-bold px-2 py-1 h-auto cursor-pointer"
                    >
                      Use Result
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {!searchLoading && searchSource && searchResults.length === 0 && !searchError && (
              <div className="text-center py-6 text-navy-400 text-xs font-semibold bg-surface-50/50 rounded-lg border border-navy-100/50">
                No matches found on{" "}
                {searchSource === "pubmed"
                  ? "PubMed"
                  : searchSource === "crossref"
                  ? "CrossRef"
                  : searchSource === "googlebooks"
                  ? "Google Books"
                  : "Wikipedia"}
                . Try refining the query keywords.
              </div>
            )}
          </div>

          {saveError && <div className="text-[12px] text-rose-600">{saveError}</div>}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-navy-50 flex justify-end gap-3 bg-surface-50/50">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || !dirty || !editedText.trim()}
            className="cursor-pointer font-bold"
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
