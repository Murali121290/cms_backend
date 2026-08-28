import { useState } from "react";
import { ArrowUpRight, Copy, Check, ExternalLink, Pencil } from "lucide-react";

import { EditReferenceModal, type ReferenceEditResult } from "./EditReferenceModal";

type ReferenceEntry = {
  number: number | null;
  text: string | null | undefined;
  para_idx: number | null;
  is_cited: boolean;
};

interface Props {
  fileId: number | null;
  entry: ReferenceEntry;
  index: number;
  onLocate: () => boolean;
  onSaved?: (result: ReferenceEditResult) => void;
}

const DOI_RE = /\b10\.\d{4,9}\/[\-._;()/:A-Z0-9]+/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;

function extractDetails(text: string | null | undefined) {
  const safe = text ?? "";
  const yearMatch = safe.match(YEAR_RE);
  const year = yearMatch ? yearMatch[0] : "";
  const trimmed = safe.replace(/^\s*\d+\.\s*/, "");
  const title = trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
  const doiMatch = safe.match(DOI_RE);
  const doi = doiMatch ? doiMatch[0] : "";
  return { year, title, doi };
}

export function ReferenceCard({ fileId, entry, index, onLocate, onSaved }: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [currentText, setCurrentText] = useState(entry.text ?? "");
  // `ref_N` bookmark is placed in document order (1..N), so when the parser
  // doesn't surface a numeric label (APA-style) we can safely use position+1.
  const refNumberForEdit = entry.number ?? index + 1;
  const label = entry.number != null ? `[${entry.number}]` : `#${index + 1}`;
  const { year, title, doi } = extractDetails(currentText);
  const queryForExternal = encodeURIComponent(title.replace(/…$/, ""));

  const handleCopy = () => {
    navigator.clipboard.writeText(currentText).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {
        /* clipboard denied; leave silent */
      },
    );
  };

  const handleLocate = () => {
    const ok = onLocate();
    if (!ok) {
      setNotFound(true);
      setTimeout(() => setNotFound(false), 1500);
    }
  };

  return (
    <li className="bg-white rounded-md border border-slate-200 px-3 py-2.5 space-y-2 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold tabular-nums text-navy-700">{label}</div>
        <div className="flex items-center gap-3 text-[11px]">
          <button
            type="button"
            onClick={handleLocate}
            className={`inline-flex items-center gap-1 font-semibold ${
              notFound ? "text-rose-500" : "text-sky-600 hover:text-sky-700 hover:underline"
            }`}
          >
            {notFound ? "Not found" : "Locate"}
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] font-semibold text-navy-500 tracking-wide uppercase">
            Reference Text
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="text-[11px] font-semibold text-navy-500 hover:text-navy-800 inline-flex items-center gap-1"
            title="Copy reference text"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="mt-1 text-[12px] leading-snug text-navy-800 line-clamp-4 whitespace-pre-wrap">
          {currentText}
        </div>
      </div>

      {(title || year) && (
        <div className="text-[11px] text-navy-600 space-y-0.5">
          {title && (
            <div>
              <span className="font-semibold text-navy-500">Title:</span> {title}
            </div>
          )}
          {year && (
            <div>
              <span className="font-semibold text-navy-500">Year:</span> {year}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
        <div className="flex items-center gap-3 text-[11px]">
          <a
            href={
              doi
                ? `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(doi)}`
                : `https://pubmed.ncbi.nlm.nih.gov/?term=${queryForExternal}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            PubMed <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href={
              doi
                ? `https://doi.org/${doi}`
                : `https://search.crossref.org/?q=${queryForExternal}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            CrossRef <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={fileId == null}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy-600 hover:text-navy-900 disabled:opacity-40 disabled:cursor-not-allowed"
          title={fileId == null ? "File not loaded" : "Edit reference"}
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
      </div>

      {editing && fileId != null && (
        <EditReferenceModal
          fileId={fileId}
          refNumber={refNumberForEdit}
          originalText={currentText}
          onClose={() => setEditing(false)}
          onSaved={(result) => {
            setCurrentText(result.new_text);
            setEditing(false);
            onSaved?.(result);
          }}
        />
      )}
    </li>
  );
}
