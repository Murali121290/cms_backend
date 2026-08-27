import { useEffect, useMemo, useState } from "react";
import { Search, X, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { apiClient, getApiErrorMessage } from "@/api/client";

export type ReferenceEditResult = {
  file_id: number;
  ref_number: number;
  old_text: string;
  new_text: string;
  changed: boolean;
};

type SearchHit = {
  source: "pubmed" | "crossref";
  title: string;
  authors: string;
  year: string;
  journal: string;
  volume: string;
  issue: string;
  page: string;
  doi: string;
  url: string;
  formatted: string;
  pubmed_id?: string | null;
};

interface Props {
  fileId: number;
  refNumber: number;
  originalText: string;
  onClose: () => void;
  onSaved: (result: ReferenceEditResult) => void;
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
  fileId, refNumber, originalText, onClose, onSaved,
}: Props) {
  const initialQuery = useMemo(() => extractTitleForQuery(originalText), [originalText]);
  const [editedText, setEditedText] = useState(originalText);
  const [query, setQuery] = useState(initialQuery);
  const [activeDb, setActiveDb] = useState<"pubmed" | "crossref" | null>(null);
  const [results, setResults] = useState<SearchHit[]>([]);
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

  const runSearch = async (db: "pubmed" | "crossref") => {
    if (!query.trim()) return;
    setActiveDb(db);
    setSearchLoading(true);
    setSearchError(null);
    setResults([]);
    try {
      const { data } = await apiClient.get(
        `/files/${fileId}/reference-review/search`,
        { params: { db, query, max_results: 5 } },
      );
      setResults(data?.results ?? []);
    } catch (e) {
      setSearchError(getApiErrorMessage(e, "Search failed"));
    } finally {
      setSearchLoading(false);
    }
  };

  const useResult = (hit: SearchHit) => {
    setEditedText(hit.formatted);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await apiClient.post(
        `/files/${fileId}/reference-review/references/${refNumber}/edit`,
        { new_text: editedText.trim(), track_changes: true },
      );
      onSaved(data as ReferenceEditResult);
    } catch (e) {
      setSaveError(getApiErrorMessage(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const dirty = editedText.trim() !== originalText.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl my-8 bg-white rounded-lg shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-lg z-10">
          <div className="flex items-center gap-2 text-navy-900 font-semibold">
            <span className="text-slate-500">✎</span>
            Edit Reference Text
            <span className="text-slate-400 text-xs font-normal">— ref_{refNumber}</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <section>
            <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-wide mb-1">
              Original Reference
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap">
              {originalText}
            </div>
          </section>

          <section>
            <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-wide mb-1">
              Edited Reference (with track changes on save)
            </div>
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="w-full min-h-[120px] rounded border border-slate-300 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none px-3 py-2 text-[13px] leading-snug"
            />
          </section>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-wide">
              Search database for correct formatting (AMA style)
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch(activeDb ?? "pubmed");
                  }}
                  placeholder="Article title or keywords…"
                  className="w-full rounded border border-slate-300 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none pl-8 pr-3 py-2 text-[13px]"
                />
              </div>
              <button
                type="button"
                onClick={() => runSearch("pubmed")}
                disabled={searchLoading || !query.trim()}
                className="px-3 py-2 text-[12px] font-semibold rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40"
              >
                PubMed
              </button>
              <button
                type="button"
                onClick={() => runSearch("crossref")}
                disabled={searchLoading || !query.trim()}
                className="px-3 py-2 text-[12px] font-semibold rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40"
              >
                CrossRef
              </button>
            </div>
            {searchError && (
              <div className="text-[12px] text-rose-600">{searchError}</div>
            )}
            {(searchLoading || results.length > 0) && (
              <div className="rounded border border-slate-200">
                <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-navy-500 bg-slate-50 border-b border-slate-200">
                  Search Results {activeDb ? `(${activeDb})` : ""}
                </div>
                {searchLoading ? (
                  <div className="px-3 py-4 text-[12px] text-slate-500">Searching…</div>
                ) : (
                  <ul>
                    {results.map((hit, i) => (
                      <li
                        key={`${hit.source}-${i}`}
                        className="px-3 py-2.5 border-b border-slate-100 last:border-b-0 flex items-start gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] leading-snug text-navy-800">
                            {hit.formatted}
                          </div>
                          {hit.url && (
                            <a
                              href={hit.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline"
                            >
                              Open <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => useResult(hit)}
                          className="shrink-0 px-2.5 py-1 rounded border border-slate-300 text-[11px] font-semibold hover:bg-slate-50"
                        >
                          Use Result
                        </button>
                      </li>
                    ))}
                    {results.length === 0 && (
                      <li className="px-3 py-4 text-[12px] text-slate-500">No results.</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>

          {saveError && (
            <div className="text-[12px] text-rose-600">{saveError}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg sticky bottom-0">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !dirty || !editedText.trim()}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
