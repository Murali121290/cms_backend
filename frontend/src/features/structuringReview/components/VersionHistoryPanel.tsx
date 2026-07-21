import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { getFileVersions } from "@/api/files";
import { getApiErrorMessage } from "@/api/client";
import type { FileVersionsResponse } from "@/types/api";

interface VersionHistoryPanelProps {
  fileId: number | null;
  currentFileId: number;
  onOpenVersion: (fileId: number) => void;
  defaultExpanded?: boolean;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function VersionHistoryPanel({
  fileId,
  currentFileId,
  onOpenVersion,
  defaultExpanded = false,
}: VersionHistoryPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const versionsQuery = useQuery<FileVersionsResponse | undefined>({
    queryKey: ["file-versions", fileId],
    queryFn: () => (fileId ? getFileVersions(fileId) : Promise.resolve(undefined)),
    staleTime: 5 * 60_000,
    enabled: !!fileId && isExpanded,
  });

  const archivedVersions = versionsQuery.data?.versions ?? [];
  const versionCount = archivedVersions.length;

  return (
    <div className="bg-white rounded-lg shadow-card border border-border flex flex-col h-full overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className={[
          "w-full flex items-center justify-between gap-2 px-4 py-3 text-left",
          "hover:bg-surface-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
          "transition-colors",
        ].join(" ")}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Clock className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-text uppercase tracking-wider leading-tight">
              Version History
            </h3>
            {isExpanded && versionCount > 0 && (
              <p className="text-[10px] text-muted mt-0.5">
                {versionCount} earlier version{versionCount === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>
        <span className="text-muted shrink-0">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {/* ── Content ────────────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 border-t border-border">
          {versionsQuery.isPending ? (
            <div className="text-center py-6 text-muted text-xs">
              <Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" />
              <p className="mt-2">Loading versions…</p>
            </div>
          ) : versionsQuery.isError ? (
            <div className="p-3 bg-error-50 border border-error-200 rounded-md">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-error-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-error-900">
                  <p className="font-semibold">Failed to load versions</p>
                  <p className="mt-1">
                    {getApiErrorMessage(versionsQuery.error, "Unable to fetch version history")}
                  </p>
                </div>
              </div>
            </div>
          ) : archivedVersions.length === 0 ? (
            <div className="text-center py-8 text-muted text-xs">
              <div className="w-10 h-10 rounded-full bg-surface-50 border border-border mx-auto flex items-center justify-center mb-2">
                <Clock className="w-5 h-5 opacity-50" />
              </div>
              <p className="font-medium text-text">No previous versions</p>
              <p className="mt-0.5">This is the first version.</p>
            </div>
          ) : (
            <>
              {/* Current version */}
              <div className="p-3 rounded-lg border border-primary/25 bg-primary/5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <span
                      aria-hidden="true"
                      className="mt-1 w-2 h-2 rounded-full bg-primary ring-4 ring-primary/15 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text">Current version</p>
                      <p className="text-[10px] text-muted mt-0.5 font-mono">
                        File #{currentFileId}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 bg-primary text-white text-[9px] font-bold rounded-full whitespace-nowrap tracking-wide">
                    ACTIVE
                  </span>
                </div>
              </div>

              {/* Earlier versions */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider px-1">
                  Earlier versions
                </p>
                <ul className="space-y-1.5">
                  {[...archivedVersions]
                    .sort(
                      (a, b) =>
                        new Date(b.uploaded_at).getTime() -
                        new Date(a.uploaded_at).getTime()
                    )
                    .map((version) => (
                      <li
                        key={version.id}
                        className={[
                          "group p-3 border border-border rounded-lg bg-white",
                          "hover:border-primary/40 hover:shadow-card focus-within:border-primary/40",
                          "transition-all duration-150",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-text">
                              Version{" "}
                              <span className="font-mono text-primary">
                                v{version.version_num}
                              </span>
                            </p>
                            <p className="text-[10px] text-muted mt-0.5 truncate">
                              {formatDateTime(version.uploaded_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-2.5">
                          <button
                            onClick={() => onOpenVersion(version.id)}
                            className={[
                              "flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md",
                              "text-[10px] font-semibold border border-border bg-white text-text",
                              "hover:bg-primary hover:text-white hover:border-primary",
                              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                              "transition-colors",
                            ].join(" ")}
                          >
                            <FolderOpen className="w-3 h-3" />
                            Open
                          </button>
                          <a
                            href={`/api/v2/files/${fileId}/versions/${version.id}/download`}
                            download
                            title={`Download version ${version.version_num}`}
                            className={[
                              "inline-flex items-center justify-center px-2.5 py-1.5 rounded-md",
                              "text-[10px] font-semibold border border-border bg-white text-text",
                              "hover:bg-surface-100 hover:border-border",
                              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                              "transition-colors",
                            ].join(" ")}
                          >
                            <Download className="w-3 h-3" />
                          </a>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
