import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Download, FolderOpen, AlertCircle } from "lucide-react";
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

  return (
    <div className="bg-white rounded-lg shadow-card border border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between text-left hover:bg-background transition-colors p-2 -m-2"
        >
          <h3 className="text-xs font-semibold text-text uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Version History
          </h3>
          <span className="text-sm font-semibold text-text">
            {isExpanded ? "âˆ’" : "+"}
          </span>
        </button>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {versionsQuery.isPending ? (
            <div className="text-center py-6 text-muted text-xs">
              <div className="inline-block animate-spin">âŸ³</div>
              <p className="mt-2">Loading versions...</p>
            </div>
          ) : versionsQuery.isError ? (
            <div className="p-3 bg-danger/5 border border-danger/30 rounded-md">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                <div className="text-xs text-danger">
                  <p className="font-semibold">Failed to load versions</p>
                  <p className="mt-1">
                    {getApiErrorMessage(versionsQuery.error, "Unable to fetch version history")}
                  </p>
                </div>
              </div>
            </div>
          ) : archivedVersions.length === 0 ? (
            <div className="text-center py-6 text-muted text-xs">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No previous versions available</p>
            </div>
          ) : (
            <>
              {/* Current version */}
              <div className="p-3 bg-gradient-to-r from-emerald-50 to-emerald-100/50 rounded-lg border border-emerald-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-xs font-bold text-emerald-900">Current Version</p>
                    <p className="text-[10px] text-emerald-700 mt-1">
                      File ID: {currentFileId}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-bold rounded-full whitespace-nowrap">
                    ACTIVE
                  </span>
                </div>
              </div>

              {/* Archived versions */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-text uppercase tracking-wider px-2">
                  Earlier Versions ({archivedVersions.length})
                </p>
                {[...archivedVersions]
                  .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
                  .map((version) => (
                    <div
                      key={version.id}
                      className="p-3 border border-border rounded-lg hover:bg-background hover:border-border transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-text">
                            Version {version.version_num}
                          </p>
                          <p className="text-[10px] text-muted mt-1">
                            {formatDateTime(version.uploaded_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => onOpenVersion(version.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-text/10 text-white text-[10px] font-bold rounded hover:bg-text/15 transition-colors"
                        >
                          <FolderOpen className="w-3 h-3" />
                          Open
                        </button>
                        <a
                          href={`/api/v2/files/${fileId}/versions/${version.id}/download`}
                          download
                          title={`Download version ${version.version_num}`}
                          className="px-2.5 py-1.5 bg-sidebar/5 text-text text-[10px] font-bold rounded hover:bg-sidebar/10 transition-colors inline-flex items-center gap-1.5"
                        >
                          <Download className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
