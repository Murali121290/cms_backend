import { useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { StructuringReviewResponse } from "@/types/api";

interface StructuringMetadataPanelProps {
  review: StructuringReviewResponse;
}

export function StructuringMetadataPanel({ review }: StructuringMetadataPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-4 px-1 bg-white border-l border-surface-300 w-10 shrink-0">
        <button
          type="button"
          className="p-1.5 rounded hover:bg-surface-200 text-navy-400 hover:text-navy-700 transition-colors"
          aria-label="Expand metadata panel"
          onClick={() => setCollapsed(false)}
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <aside className="bg-white border-l border-surface-300 w-64 shrink-0 flex flex-col overflow-y-auto">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-300">
        <span className="text-xs font-semibold text-navy-500 uppercase tracking-wide">
          Document Info
        </span>
        <button
          type="button"
          className="p-1.5 rounded hover:bg-surface-200 text-navy-400 hover:text-navy-700 transition-colors"
          aria-label="Collapse metadata panel"
          onClick={() => setCollapsed(true)}
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* File info */}
        <section>
          <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">
            File
          </h3>
          <dl className="space-y-2.5">
            <div>
              <dt className="text-xs text-navy-400">Source file</dt>
              <dd className="text-xs font-medium text-navy-700 mt-0.5 break-all">
                {review.file.filename}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-navy-400">Processed file</dt>
              <dd className="text-xs font-medium text-navy-700 mt-0.5 break-all">
                {review.processed_file.filename}
              </dd>
            </div>
          </dl>
        </section>

        {/* Editor info */}
        <section>
          <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">
            Editor
          </h3>
          <dl className="space-y-2.5">
            <div>
              <dt className="text-xs text-navy-400">Mode</dt>
              <dd className="mt-0.5">
                <Badge variant="info" size="sm">
                  {review.editor.mode}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-navy-400">WOPI mode</dt>
              <dd className="mt-0.5">
                <Badge variant="default" size="sm">
                  {review.editor.wopi_mode}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-navy-400">Save mode</dt>
              <dd className="text-xs text-navy-700 mt-0.5">{review.editor.save_mode}</dd>
            </div>
          </dl>
        </section>

        {/* Styles */}
        {review.styles.length > 0 ? (
          <section>
            <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-3">
              Styles ({review.styles.length})
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {review.styles.map((style) => (
                <Badge key={style} variant="default" size="sm">
                  {style}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        {/* Export link */}
        <section>
          <a
            href={review.actions.export_href}
            className="flex items-center gap-2 text-xs text-navy-600 hover:text-navy-900 transition-colors"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export document</span>
          </a>
        </section>
      </div>
    </aside>
  );
}
