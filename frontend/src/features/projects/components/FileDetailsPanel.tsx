/**
 * FileDetailsPanel — lazy-loaded expandable details for a single file row.
 * Mounts only when the row is expanded; React Query caches data for 5 min.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  CheckCircle2,
  Copy,
  ExternalLink,
  Lock,
  Trash2,
  Unlock,
  Zap,
} from "lucide-react";

import { getApiErrorMessage } from "@/api/client";
import { getFileVersions } from "@/api/files";
import { getProcessingStatus, startProcessingJob } from "@/api/processing";
import { useToast } from "@/components/ui/useToast";
import type { FileRecord } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const MIME_SHORT: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/msword": "doc",
  "text/plain": "txt",
  "text/xml": "xml",
  "application/xml": "xml",
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/octet-stream": "bin",
  "application/zip": "zip",
};

function fileTypeLabel(mime: string): string {
  if (MIME_SHORT[mime]) return MIME_SHORT[mime];
  const last = mime.split("/").pop() ?? mime;
  return last.slice(0, 8);
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

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ─── Atom components ─────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <p style={{
      fontSize: "10px",
      fontWeight: 600,
      color: "#A09B96",
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      margin: "0 0 12px",
    }}>
      {text}
    </p>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <p style={{ fontSize: "11px", color: "#6B6560", margin: "0 0 2px" }}>{label}</p>
      <div style={{ fontSize: "13px", color: "#1A1714" }}>{children}</div>
    </div>
  );
}

function SkeletonField() {
  return (
    <div style={{ marginBottom: "12px" }}>
      <div
        className="animate-pulse"
        style={{ height: "10px", backgroundColor: "#E8E3DD", borderRadius: "4px", width: "45%", marginBottom: "5px" }}
      />
      <div
        className="animate-pulse"
        style={{ height: "13px", backgroundColor: "#E8E3DD", borderRadius: "4px", width: "72%" }}
      />
    </div>
  );
}

function NAValue({ text = "Not available" }: { text?: string }) {
  return (
    <span style={{ fontSize: "12px", color: "#A09B96", fontStyle: "italic" }}>{text}</span>
  );
}

function TypeChip({ mime }: { mime: string }) {
  return (
    <span style={{
      fontFamily: "ui-monospace, monospace",
      fontSize: "11px",
      backgroundColor: "#F5F4F1",
      color: "#6B6560",
      padding: "2px 8px",
      borderRadius: "4px",
      display: "inline-block",
    }}>
      {fileTypeLabel(mime)}
    </span>
  );
}

function CopyableId({ id }: { id: number }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontFamily: "ui-monospace, monospace",
        fontSize: "12px",
        color: "#6B6560",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span>{id}</span>
      {copied ? (
        <CheckCircle2 size={12} style={{ color: "#166534" }} />
      ) : (
        <Copy size={12} />
      )}
      {copied && <span style={{ fontSize: "11px", color: "#166534" }}>Copied!</span>}
    </button>
  );
}

// ─── Column 1: About ──────────────────────────────────────────────────────────

function AboutColumn({ file }: { file: FileRecord }) {
  return (
    <div>
      <SectionLabel text="About" />

      <FieldRow label="Uploaded by">
        <NAValue />
      </FieldRow>

      <FieldRow label="Uploaded on">
        <span>{formatDateTime(file.uploaded_at)}</span>
        <br />
        <span style={{ fontSize: "11px", color: "#A09B96" }}>
          {formatRelativeTime(file.uploaded_at)}
        </span>
      </FieldRow>

      <FieldRow label="Last modified">
        <NAValue text="Not modified since upload" />
      </FieldRow>

      <FieldRow label="Last processed">
        <NAValue />
      </FieldRow>
    </div>
  );
}

// ─── Column 2: Properties ─────────────────────────────────────────────────────

function PropertiesColumn({ file }: { file: FileRecord }) {
  const [showHistory, setShowHistory] = useState(false);

  const versionsQuery = useQuery({
    queryKey: ["file-versions", file.id],
    queryFn: () => getFileVersions(file.id),
    staleTime: 5 * 60_000,
  });

  const archivedVersions = versionsQuery.data?.versions ?? [];
  const totalVersions = archivedVersions.length + 1; // archived + current

  return (
    <div>
      <SectionLabel text="Properties" />

      <FieldRow label="File size">
        <NAValue />
      </FieldRow>

      <FieldRow label="Format">
        <TypeChip mime={file.file_type} />
      </FieldRow>

      <FieldRow label="Current version">
        {versionsQuery.isLoading ? (
          <SkeletonField />
        ) : (
          <>
            <span style={{ fontFamily: "ui-monospace, monospace" }}>v{file.version}</span>
            {totalVersions > 1 && (
              <>
                <span style={{ fontSize: "11px", color: "#6B6560", marginLeft: "6px" }}>
                  ({totalVersions} versions total)
                </span>
                {" "}
                <button
                  type="button"
                  style={{
                    fontSize: "11px",
                    color: "#C9821A",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                  onClick={() => setShowHistory((v) => !v)}
                >
                  {showHistory ? "Hide history" : "View history"}
                </button>
                {showHistory && (
                  <div style={{
                    marginTop: "8px",
                    borderTop: "1px solid #F0EBE4",
                    paddingTop: "8px",
                  }}>
                    {/* Current version */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", minWidth: "28px" }}>
                        v{file.version}
                      </span>
                      <span style={{ fontSize: "11px", color: "#6B6560" }}>Current file</span>
                      <span style={{
                        fontSize: "10px", color: "#FFFFFF", backgroundColor: "#C9821A",
                        padding: "1px 5px", borderRadius: "3px",
                      }}>
                        current
                      </span>
                    </div>
                    {/* Archived versions (newest first) */}
                    {[...archivedVersions]
                      .sort((a, b) => b.version_num - a.version_num)
                      .map((v) => (
                        <div key={v.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#6B6560", minWidth: "28px" }}>
                            v{v.version_num}
                          </span>
                          <span style={{ fontSize: "11px", color: "#A09B96" }}>
                            {new Date(v.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                          <a
                            href={`/api/v2/files/${file.id}/versions/${v.id}/download`}
                            download
                            title={`Download v${v.version_num}`}
                            style={{ color: "#6B6560", display: "inline-flex", alignItems: "center" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ArrowDownToLine size={12} />
                          </a>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </FieldRow>

      <FieldRow label="File ID">
        <CopyableId id={file.id} />
      </FieldRow>

      <FieldRow label="Lock status">
        {file.lock.is_checked_out ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <Lock size={13} style={{ color: "#B45309" }} />
            <span style={{ fontSize: "12px", color: "#B45309" }}>
              Locked by {file.lock.checked_out_by_username ?? "someone"}
              {file.lock.checked_out_at && (
                <span style={{ color: "#A09B96", marginLeft: "4px" }}>
                  · {formatRelativeTime(file.lock.checked_out_at)}
                </span>
              )}
            </span>
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <Unlock size={13} style={{ color: "#166534" }} />
            <span style={{ fontSize: "12px", color: "#166534" }}>Available for editing</span>
          </span>
        )}
      </FieldRow>
    </div>
  );
}

// ─── Column 3: Processing History ─────────────────────────────────────────────

function ProcessingHistoryColumn({ file }: { file: FileRecord }) {
  const processingQuery = useQuery({
    queryKey: ["processing-status", file.id, "structuring"],
    queryFn: () => getProcessingStatus(file.id, "structuring"),
    staleTime: 5 * 60_000,
    retry: false, // 404 = never processed; don't retry
  });

  return (
    <div>
      <SectionLabel text="Processing History" />

      {processingQuery.isLoading ? (
        <>
          <SkeletonField />
          <SkeletonField />
        </>
      ) : processingQuery.isError ? (
        <p style={{ fontSize: "12px", color: "#A09B96", fontStyle: "italic", margin: "0 0 8px" }}>
          No processing jobs run yet.
        </p>
      ) : processingQuery.data ? (
        <div>
          {/* Timeline entry */}
          <div style={{ display: "flex", gap: "10px" }}>
            {/* Status dot */}
            <div style={{ flexShrink: 0, marginTop: "4px" }}>
              <div style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: processingQuery.data.status === "completed" ? "#166534" : "#1D4ED8",
              }} />
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 500, color: "#1A1714", margin: "0 0 4px" }}>
                Structuring
              </p>
              <span style={{
                display: "inline-block",
                fontSize: "10px",
                fontWeight: 500,
                padding: "1px 6px",
                borderRadius: "3px",
                marginBottom: "6px",
                ...(processingQuery.data.status === "completed"
                  ? { backgroundColor: "#DCFCE7", color: "#166534" }
                  : { backgroundColor: "#DBEAFE", color: "#1D4ED8" }),
              }}>
                {processingQuery.data.status === "completed" ? "Completed" : "Processing"}
              </span>
              {processingQuery.data.compatibility_status && (
                <p style={{ fontSize: "11px", color: "#6B6560", margin: "0 0 2px" }}>
                  Compatibility: {processingQuery.data.compatibility_status}
                </p>
              )}
              {processingQuery.data.derived_filename && (
                <p style={{ fontSize: "11px", color: "#6B6560", margin: 0 }}>
                  Output: <span style={{ fontFamily: "ui-monospace, monospace" }}>{processingQuery.data.derived_filename}</span>
                </p>
              )}
            </div>
          </div>

          <p style={{
            fontSize: "11px",
            color: "#A09B96",
            margin: "12px 0 0",
            paddingTop: "10px",
            borderTop: "1px solid #F0EBE4",
          }}>
            Other process types available via the ⋯ menu.
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ─── FileDetailsPanel ─────────────────────────────────────────────────────────

export interface FileDetailsPanelProps {
  file: FileRecord;
  projectId: number;
  chapterId: number;
  onDelete: () => void;
}

export function FileDetailsPanel({
  file,
  projectId,
  chapterId,
  onDelete,
}: FileDetailsPanelProps) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  async function handleRunStructuring() {
    addToast({ title: "Structuring started", description: file.filename, variant: "info" });
    try {
      await startProcessingJob(file.id, "structuring", "style");
      addToast({ title: "Structuring complete", description: file.filename, variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["processing-status", file.id, "structuring"] });
    } catch (err) {
      addToast({
        title: "Structuring failed",
        description: getApiErrorMessage(err, "Unexpected error"),
        variant: "error",
        duration: 6000,
      });
    }
  }

  return (
    <div style={{
      backgroundColor: "#FAFAF8",
      borderTop: "1px solid #F0EBE4",
      borderBottom: "1px solid #E2DDD6",
      borderLeft: "3px solid #C9821A",
      padding: "20px 24px",
    }}>
      {/* 3-column grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "24px",
      }}>
        <AboutColumn file={file} />
        <PropertiesColumn file={file} />
        <ProcessingHistoryColumn file={file} />
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid #E2DDD6",
        marginTop: "16px",
        paddingTop: "12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{
          fontSize: "11px",
          fontFamily: "ui-monospace, monospace",
          color: "#A09B96",
        }}>
          File ID: {file.id}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Download */}
          <a
            href={`/api/v2/files/${file.id}/download`}
            download
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "12px", color: "#6B6560", textDecoration: "none",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#1A1714"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#6B6560"; }}
          >
            <ArrowDownToLine size={13} />
            Download
          </a>

          <span style={{ color: "#D4CFC9" }}>·</span>

          {/* Open in Editor */}
          <Link
            to={uiPaths.fileEditor(projectId, chapterId, file.id)}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "12px", color: "#1D4ED8", textDecoration: "none",
            }}
          >
            <ExternalLink size={13} />
            Open in Editor
          </Link>

          <span style={{ color: "#D4CFC9" }}>·</span>

          {/* Run Structuring */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void handleRunStructuring(); }}
            style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "12px", color: "#C9821A",
              background: "none", border: "none", cursor: "pointer", padding: 0,
            }}
          >
            <Zap size={13} />
            Run Structuring
          </button>

          <span style={{ color: "#D4CFC9" }}>·</span>

          {/* Delete */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "12px", color: "#B91C1C",
              background: "none", border: "none", cursor: "pointer", padding: 0,
            }}
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
