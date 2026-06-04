import { useState } from "react";
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  LayoutGrid,
  LayoutList,
  Layout,
  Eye,
  Code2,
  FileText,
  Palette,
  Scissors,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";

import { cn } from "@/utils/cn";

export type ViewMode = "grid" | "list";

interface UploadOption {
  label: string;
  category: string;
  Icon: ComponentType<LucideProps>;
  color: string;
}

const UPLOAD_OPTIONS: UploadOption[] = [
  { label: "Upload Art", category: "Art", Icon: Palette, color: "#E8A838" },
  { label: "Upload Manuscript", category: "Manuscript", Icon: FileText, color: "#2B579A" },
  { label: "Upload InDesign", category: "InDesign", Icon: Layout, color: "#FF3366" },
  { label: "Upload Proof", category: "Proof", Icon: Eye, color: "#7C3AED" },
  { label: "Upload XML", category: "XML", Icon: Code2, color: "#16A34A" },
];

interface ChapterToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onUpload: (category: string) => void;
  onDownload?: () => void;
  isDownloading?: boolean;
}

export function ChapterToolbar({ viewMode, onViewModeChange, onUpload, onDownload, isDownloading = false }: ChapterToolbarProps) {
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="h-11 flex items-center gap-1.5 px-4 bg-white border-b border-border shrink-0">
      {/* Upload with dropdown */}
      <div className="relative">
        <button
          type="button"
          aria-expanded={uploadOpen}
          className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded bg-primary text-white hover:bg-primary active:bg-primary transition-colors"
          onClick={() => setUploadOpen((prev) => !prev)}
        >
          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
          Upload
          <ChevronDown className="w-3 h-3" aria-hidden="true" />
        </button>

        {uploadOpen && (
          <>
            {/* Click-away overlay */}
            <div
              className="fixed inset-0 z-10"
              aria-hidden="true"
              onClick={() => setUploadOpen(false)}
            />
            <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-border rounded-md shadow-card min-w-[168px]">
              {UPLOAD_OPTIONS.map((opt) => (
                <button
                  key={opt.category}
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text hover:bg-background transition-colors first:rounded-t-md last:rounded-b-md"
                  onClick={() => {
                    setUploadOpen(false);
                    onUpload(opt.category);
                  }}
                >
                  <opt.Icon className="w-3.5 h-3.5 shrink-0" style={{ color: opt.color }} aria-hidden="true" />
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-background mx-1" aria-hidden="true" />

      {/* Edit action icons (Cut / Copy / Paste / Delete) â€” enabled when files are selected */}
      {(
        [
          { Icon: Scissors, label: "Cut" },
          { Icon: Copy, label: "Copy" },
          { Icon: Clipboard, label: "Paste" },
          { Icon: Trash2, label: "Delete selected" },
        ] as const
      ).map(({ Icon, label }) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          disabled
          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted cursor-not-allowed"
        >
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Automate */}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded border border-border text-text hover:bg-background transition-colors"
      >
        <Zap className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
        Automate
      </button>

      {/* Download package */}
      {onDownload && (
        <button
          type="button"
          title="Download chapter package"
          aria-label="Download chapter package"
          disabled={isDownloading}
          className={cn(
            "inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded border border-border transition-colors",
            isDownloading
              ? "text-muted cursor-not-allowed"
              : "text-text hover:bg-background"
          )}
          onClick={onDownload}
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {isDownloading ? "Downloadingâ€¦" : "Download"}
        </button>
      )}

      {/* Divider */}
      <div className="w-px h-5 bg-background mx-1" aria-hidden="true" />

      {/* View mode toggle */}
      <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label="View mode">
        <button
          type="button"
          title="Grid view"
          aria-label="Grid view"
          aria-pressed={viewMode === "grid"}
          className={cn(
            "inline-flex items-center justify-center w-7 h-7 transition-colors",
            viewMode === "grid"
              ? "bg-background text-text"
              : "text-muted hover:bg-background hover:text-text"
          )}
          onClick={() => onViewModeChange("grid")}
        >
          <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="List view"
          aria-label="List view"
          aria-pressed={viewMode === "list"}
          className={cn(
            "inline-flex items-center justify-center w-7 h-7 border-l border-border transition-colors",
            viewMode === "list"
              ? "bg-background text-text"
              : "text-muted hover:bg-background hover:text-text"
          )}
          onClick={() => onViewModeChange("list")}
        >
          <LayoutList className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
