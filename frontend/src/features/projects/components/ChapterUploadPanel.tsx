import { useEffect, useRef, useState } from "react";
import { Upload, CheckCircle2, AlertCircle } from "lucide-react";

import type { FileUploadResponse } from "@/types/api";

const categoryOptions = [
  "Manuscript",
  "Art",
  "InDesign",
  "Proof",
  "XML",
  "Miscellaneous",
] as const;

interface ChapterUploadPanelProps {
  activeTab: string;
  isPending: boolean;
  result: FileUploadResponse | null;
  statusMessage: string | null;
  errorMessage: string | null;
  onUpload: (category: string, files: File[]) => Promise<unknown>;
  onClearResult: () => void;
  onClose?: () => void;
}

export function ChapterUploadPanel({
  activeTab,
  isPending,
  result,
  statusMessage,
  errorMessage,
  onUpload,
  onClearResult,
  onClose,
}: ChapterUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [category, setCategory] = useState(
    categoryOptions.includes(activeTab as (typeof categoryOptions)[number])
      ? activeTab
      : "Manuscript",
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  useEffect(() => {
    if (
      selectedFiles.length === 0 &&
      categoryOptions.includes(activeTab as (typeof categoryOptions)[number])
    ) {
      setCategory(activeTab);
    }
  }, [activeTab, selectedFiles.length]);

  const canSubmit = selectedFiles.length > 0 && !isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await onUpload(category, selectedFiles);
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch {
      // error surfaced via hook state
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length > 0) {
      setSelectedFiles(droppedFiles);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-navy-900">Upload files</h2>
          <p className="text-sm text-navy-400 mt-0.5">
            Uploading to:{" "}
            <span className="font-medium text-navy-700">{category}</span>
          </p>
        </div>
        {onClose && (
          <button
            className="text-navy-400 hover:text-navy-700 transition-colors text-sm"
            disabled={isPending}
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        )}
      </div>

      {/* Category selector */}
      <div className="flex items-center gap-3">
        <label htmlFor="upload-category" className="text-xs font-medium text-navy-500 uppercase tracking-wide shrink-0">
          Category
        </label>
        <select
          id="upload-category"
          className="border border-surface-400 rounded-md px-3 py-1.5 text-sm bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-gold-600"
          disabled={isPending}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categoryOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <form onSubmit={handleSubmit}>
        <div
          className="bg-surface-100 border-2 border-dashed border-surface-400 rounded-lg p-6 flex flex-col items-center gap-3 text-center cursor-pointer hover:border-gold-400 hover:bg-surface-50 transition-colors"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          aria-label="Drop files here or click to upload"
        >
          <Upload className="w-8 h-8 text-navy-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-navy-700">
              {selectedFiles.length > 0
                ? selectedFiles.length === 1
                  ? selectedFiles[0].name
                  : `${selectedFiles.length} files selected`
                : "Drop files here or click to upload"}
            </p>
            <p className="text-xs text-navy-400 mt-0.5">
              Uploading to: <span className="font-medium">{category}</span>
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={isPending}
            className="sr-only"
            onChange={(e) => setSelectedFiles(Array.from(e.target.files ?? []))}
          />
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-gold-600 text-white hover:bg-gold-700 disabled:opacity-50 disabled:cursor-not-allowed border border-gold-600 shadow-subtle transition-all duration-150"
            disabled={!canSubmit}
            type="submit"
          >
            {isPending ? "Uploading…" : "Upload"}
          </button>
          {(result || statusMessage || errorMessage) && (
            <button
              className="inline-flex items-center h-9 px-4 text-sm font-medium rounded-md border border-surface-400 text-navy-700 hover:bg-surface-100 transition-colors"
              disabled={isPending}
              type="button"
              onClick={onClearResult}
            >
              Clear results
            </button>
          )}
        </div>
      </form>

      {/* Status messages */}
      {statusMessage && !errorMessage && (
        <div className="flex items-start gap-2 text-sm rounded-md bg-surface-100 border border-surface-300 px-3 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-success-600 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="text-navy-700">{statusMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="flex items-start gap-2 text-sm rounded-md bg-error-50 border border-error-200 px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-error-600 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="text-error-700">{errorMessage}</span>
        </div>
      )}

      {/* Upload results */}
      {result && (
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium text-navy-700 mb-1">
              Uploaded ({result.uploaded.length})
            </p>
            {result.uploaded.length === 0 ? (
              <p className="text-navy-400 text-xs">No files were uploaded.</p>
            ) : (
              <ul className="space-y-1">
                {result.uploaded.map((item) => (
                  <li
                    key={`${item.file.id}-${item.file.version}`}
                    className="flex items-center gap-2 text-xs text-navy-700"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-success-600 shrink-0" aria-hidden="true" />
                    <span className="font-medium">{item.file.filename}</span>
                    <span className="text-navy-400">
                      {item.operation === "created" ? "Created" : `Replaced (v${item.archived_version_num ?? "?"})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {result.skipped.length > 0 && (
            <div>
              <p className="font-medium text-navy-700 mb-1">
                Skipped ({result.skipped.length})
              </p>
              <ul className="space-y-1">
                {result.skipped.map((item) => (
                  <li
                    key={`${item.code}-${item.filename}`}
                    className="text-xs text-navy-500"
                  >
                    <span className="font-medium">{item.filename}</span> — {item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
