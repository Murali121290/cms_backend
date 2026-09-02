import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Link2, Loader2 } from "lucide-react";

import type { ReferenceValidationReviewResponse } from "@/api/referenceReview";

type Logs = ReferenceValidationReviewResponse["validation_logs"];
type ReferenceEntry = NonNullable<Logs["reference_entries"]>[number];

export interface LinkBookmarkFormValues {
  bookmark_name: string;
  ref_number: number | null;
  ref_text: string;
  citation_text: string | null;
}

interface Props {
  bookmarkName: string;
  bookmarkSnippet?: string;
  referenceEntries: ReferenceEntry[];
  isSubmitting?: boolean;
  error?: string;
  onSubmit: (values: LinkBookmarkFormValues) => void;
  onCancel: () => void;
}

/**
 * Manual link entry for an unlinked bookmark. User can either pick an existing
 * reference from the dropdown (populates ref_number + ref_text automatically)
 * or enter a reference number + text by hand. Citation number is optional and
 * only used to help the user recall where the citation should appear.
 */
export function LinkBookmarkModal({
  bookmarkName,
  bookmarkSnippet,
  referenceEntries,
  isSubmitting = false,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const [refSelection, setRefSelection] = useState<string>(""); // "" = custom entry
  const [refNumber, setRefNumber] = useState<string>("");
  const [refText, setRefText] = useState<string>("");
  const [citationText, setCitationText] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);

  const options = useMemo(
    () =>
      [...referenceEntries]
        .filter((e) => e.text)
        .sort((a, b) => {
          const na = a.number ?? Number.POSITIVE_INFINITY;
          const nb = b.number ?? Number.POSITIVE_INFINITY;
          return na - nb;
        }),
    [referenceEntries],
  );

  const handleSelectRef = (value: string) => {
    setRefSelection(value);
    if (!value) return;
    const idx = Number.parseInt(value, 10);
    const entry = Number.isFinite(idx) ? options[idx] : undefined;
    if (entry) {
      setRefNumber(entry.number != null ? String(entry.number) : "");
      setRefText(entry.text);
    }
  };

  const parsedRefNumber = (() => {
    const trimmed = refNumber.trim();
    if (!trimmed) return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : null;
  })();

  // Only disable during an in-flight request. Empty-form validation happens
  // inside handleSubmit and surfaces as an inline message, so the button click
  // is never silently swallowed by a `disabled` attribute that raced with a
  // native <select> onChange.
  const handleSubmit = () => {
    if (isSubmitting) return;
    if (!refText.trim()) {
      setLocalError("Pick a reference from the dropdown or paste reference text below.");
      return;
    }
    setLocalError(null);
    onSubmit({
      bookmark_name: bookmarkName,
      ref_number: parsedRefNumber,
      ref_text: refText.trim(),
      citation_text: citationText.trim() || null,
    });
  };

  return createPortal(
    <div
      // Inline zIndex is belt-and-suspenders in case Tailwind's arbitrary-value
      // class gets purged; 2^31-1 guarantees we beat any legacy hardcoded value.
      style={{ zIndex: 2147483647 }}
      className="fixed inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[440px] max-w-[92vw] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Link2 className="w-4 h-4 text-navy-700" />
          <h3 className="text-sm font-bold text-navy-800">Link Reference to Bookmark</h3>
        </div>

        <div className="mb-3 p-2 rounded-md bg-slate-50 border border-slate-200">
          <div className="text-[10px] uppercase font-bold tracking-wide text-navy-500 mb-1">
            Bookmark
          </div>
          <div className="text-xs font-mono text-navy-800 truncate">{bookmarkName}</div>
          {bookmarkSnippet && (
            <div className="text-[11px] text-navy-500 mt-1 line-clamp-2 italic">
              "{bookmarkSnippet}"
            </div>
          )}
        </div>

        {options.length > 0 && (
          <label className="block mb-3">
            <span className="text-[10px] uppercase font-bold tracking-wide text-navy-500">
              Pick an existing reference
            </span>
            <select
              value={refSelection}
              onChange={(e) => handleSelectRef(e.target.value)}
              className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-navy-400"
            >
              <option value="">— Enter manually below —</option>
              {options.map((entry, i) => {
                const label = entry.number != null ? `[${entry.number}] ` : "";
                const preview = entry.text.length > 80 ? `${entry.text.slice(0, 80)}…` : entry.text;
                return (
                  <option key={i} value={String(i)}>
                    {label}
                    {preview}
                  </option>
                );
              })}
            </select>
          </label>
        )}

        <div className="grid grid-cols-3 gap-2 mb-3">
          <label className="block col-span-1">
            <span className="text-[10px] uppercase font-bold tracking-wide text-navy-500">
              Reference #
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={refNumber}
              onChange={(e) => {
                setRefNumber(e.target.value);
                setRefSelection("");
              }}
              placeholder="e.g. 12"
              className="mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-navy-400"
            />
          </label>
          <label className="block col-span-2">
            <span className="text-[10px] uppercase font-bold tracking-wide text-navy-500">
              Citation # (optional)
            </span>
            <input
              type="text"
              value={citationText}
              onChange={(e) => setCitationText(e.target.value)}
              placeholder="e.g. 12 or Smith 2020"
              className="mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-navy-400"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-[10px] uppercase font-bold tracking-wide text-navy-500">
            Reference text
          </span>
          <textarea
            value={refText}
            onChange={(e) => {
              setRefText(e.target.value);
              setRefSelection("");
            }}
            rows={4}
            placeholder="Paste or type the full reference entry text…"
            className="mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-navy-400 resize-y"
          />
        </label>

        {(error || localError) && (
          <div className="mt-3 text-[11px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1">
            {error || localError}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-3 h-8 text-xs font-semibold rounded-md text-navy-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              // Use mousedown, not click, so the button fires before any
              // pending blur/change from the native <select> in the same
              // tick. Prevents the "first click does nothing" symptom that
              // happens when the dropdown just closed a moment earlier.
              e.preventDefault();
              handleSubmit();
            }}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Linking…
              </>
            ) : (
              <>
                <Link2 className="w-3.5 h-3.5" />
                Link Reference
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
