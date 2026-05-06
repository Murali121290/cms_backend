import { Fragment, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  AlignLeft,
  Archive,
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Code2,
  ExternalLink,
  File,
  FileCheck,
  FileText,
  Image,
  Layers,
  Lock,
  MoreHorizontal,
} from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  FileContextMenu,
  type MenuAnchor,
} from "@/features/projects/components/FileContextMenu";
import { FileDetailsPanel } from "@/features/projects/components/FileDetailsPanel";
import { ReferenceCheckModal } from "@/features/projects/components/ReferenceCheckModal";
import type { FileRecord } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";
import type { ChapterSection } from "@/features/projects/components/ChapterCategorySummary";

type FileActionKind = "download" | "checkout" | "cancel_checkout" | "delete";

type SortKey = "uploaded_at" | "version" | "filename";
type SortDir = "asc" | "desc";

// ─── File type config ─────────────────────────────────────────────────────────

interface FileTypeConfig {
  Icon: React.ElementType;
  color: string;
  bg: string;
  badge: string;
}

function getFileTypeConfig(filename: string, mimeType: string): FileTypeConfig {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "docx" || ext === "doc")
    return { Icon: FileText,  color: "#1D4ED8", bg: "#DBEAFE", badge: "DOCX" };
  if (ext === "txt")
    return { Icon: AlignLeft, color: "#6B6560", bg: "#F0EBE4", badge: "TXT"  };
  if (ext === "pdf")
    return { Icon: FileCheck, color: "#B91C1C", bg: "#FEE2E2", badge: "PDF"  };
  if (ext === "xml")
    return { Icon: Code2,     color: "#C2410C", bg: "#FFF7ED", badge: "XML"  };
  if (ext === "indd" || ext === "idml")
    return { Icon: Layers,    color: "#7C3AED", bg: "#F3E8FF", badge: "INDD" };
  if (["jpg", "jpeg", "png", "tiff", "tif"].includes(ext))
    return { Icon: Image,     color: "#B45309", bg: "#FEF3C7", badge: "IMG"  };
  if (ext === "zip" || ext === "rar")
    return { Icon: Archive,   color: "#6B6560", bg: "#F0EBE4", badge: "ZIP"  };

  // Fallback — derive badge from extension or mime
  const badge = ext
    ? ext.toUpperCase().slice(0, 4)
    : (mimeType.split("/").pop() ?? "FILE").toUpperCase().slice(0, 4);
  return { Icon: File, color: "#6B6560", bg: "#F5F4F1", badge };
}

// ─── Portal Tooltip ───────────────────────────────────────────────────────────

function PortalTooltip({ label, x, y }: { label: string; x: number; y: number }) {
  return createPortal(
    <div
      role="tooltip"
      style={{
        position: "fixed", left: x, top: y,
        transform: "translate(-50%, -100%)",
        zIndex: 9999, pointerEvents: "none",
      }}
    >
      <div style={{
        backgroundColor: "#1A1714", color: "#fff",
        fontSize: "11px", padding: "3px 8px",
        borderRadius: "4px", whiteSpace: "nowrap", lineHeight: "1.5",
      }}>
        {label}
      </div>
      <div style={{
        position: "absolute", top: "100%", left: "50%",
        transform: "translateX(-50%)",
        borderLeft: "4px solid transparent",
        borderRight: "4px solid transparent",
        borderTop: "4px solid #1A1714",
      }} />
    </div>,
    document.body,
  );
}

// ─── Action Icon Button ───────────────────────────────────────────────────────

interface ActionIconBtnProps {
  label: string;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children?: React.ReactNode;
}

function ActionIconBtn({ label, disabled, onClick, children }: ActionIconBtnProps) {
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const divRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={divRef}
      onMouseEnter={() => {
        if (disabled) return;
        setHovered(true);
        if (divRef.current) {
          const r = divRef.current.getBoundingClientRect();
          setTooltipPos({ x: r.left + r.width / 2, y: r.top - 6 });
        }
      }}
      onMouseLeave={() => { setHovered(false); setTooltipPos(null); }}
      style={{ display: "inline-flex", flexShrink: 0 }}
    >
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        style={{
          width: "28px", height: "28px", borderRadius: "6px",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "none", padding: 0, flexShrink: 0,
          color: hovered ? "#1A1714" : "#9C9590",
          backgroundColor: hovered ? "#F0EBE4" : "transparent",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
          transition: "color 100ms ease, background-color 100ms ease",
        }}
      >
        {children}
      </button>
      {tooltipPos && <PortalTooltip label={label} x={tooltipPos.x} y={tooltipPos.y} />}
    </div>
  );
}

// ─── Action Link Icon ─────────────────────────────────────────────────────────

function ActionLinkIcon({ label, to, children }: {
  label: string; to: string; children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const divRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={divRef}
      onMouseEnter={() => {
        setHovered(true);
        if (divRef.current) {
          const r = divRef.current.getBoundingClientRect();
          setTooltipPos({ x: r.left + r.width / 2, y: r.top - 6 });
        }
      }}
      onMouseLeave={() => { setHovered(false); setTooltipPos(null); }}
      style={{ display: "inline-flex", flexShrink: 0 }}
    >
      <Link
        to={to}
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "28px", height: "28px", borderRadius: "6px",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: hovered ? "#1A1714" : "#9C9590",
          backgroundColor: hovered ? "#F0EBE4" : "transparent",
          transition: "color 100ms ease, background-color 100ms ease",
          flexShrink: 0, textDecoration: "none",
        }}
      >
        {children}
      </Link>
      {tooltipPos && <PortalTooltip label={label} x={tooltipPos.x} y={tooltipPos.y} />}
    </div>
  );
}

// ─── Action Download Link ─────────────────────────────────────────────────────

function ActionDownloadLink({ label, href, children }: {
  label: string; href: string; children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const divRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={divRef}
      onMouseEnter={() => {
        setHovered(true);
        if (divRef.current) {
          const r = divRef.current.getBoundingClientRect();
          setTooltipPos({ x: r.left + r.width / 2, y: r.top - 6 });
        }
      }}
      onMouseLeave={() => { setHovered(false); setTooltipPos(null); }}
      style={{ display: "inline-flex", flexShrink: 0 }}
    >
      <a
        href={href}
        aria-label={label}
        download
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "28px", height: "28px", borderRadius: "6px",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: hovered ? "#1A1714" : "#9C9590",
          backgroundColor: hovered ? "#F0EBE4" : "transparent",
          transition: "color 100ms ease, background-color 100ms ease",
          flexShrink: 0, textDecoration: "none",
        }}
      >
        {children}
      </a>
      {tooltipPos && <PortalTooltip label={label} x={tooltipPos.x} y={tooltipPos.y} />}
    </div>
  );
}

// ─── Sortable column header ───────────────────────────────────────────────────

function SortableHeader({
  label,
  colKey,
  activeSortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  colKey: SortKey;
  activeSortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "center" | "right";
}) {
  const isActive = activeSortKey === colKey;
  const [hov, setHov] = useState(false);

  return (
    <th
      style={{ cursor: "pointer", userSelect: "none", textAlign: align }}
      className="px-3 transition-colors duration-100 hover:bg-surface-200"
      onClick={() => onSort(colKey)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <span style={{
        display: "inline-flex", alignItems: "center", gap: "3px",
        fontSize: "11px", fontWeight: 500,
        textTransform: "uppercase", letterSpacing: "0.06em",
        color: isActive ? "#C9821A" : (hov ? "#6B6560" : "#9C9590"),
        transition: "color 100ms",
      }}>
        {label}
        {isActive
          ? sortDir === "desc"
            ? <ChevronDown size={12} aria-hidden />
            : <ChevronUp size={12} aria-hidden />
          : <ChevronsUpDown size={12} style={{ opacity: hov ? 1 : 0.4, transition: "opacity 100ms" }} aria-hidden />
        }
      </span>
    </th>
  );
}

// ─── ChapterFilesTable ────────────────────────────────────────────────────────

interface ChapterFilesTableProps {
  projectId: number;
  chapterId: number;
  files: FileRecord[];
  selectedSection: ChapterSection;
  searchQuery: string;
  isActionPending: (fileId: number, action: FileActionKind) => boolean;
  onCheckout: (file: FileRecord) => void | Promise<void>;
  onCancelCheckout: (file: FileRecord) => void | Promise<void>;
  onDelete: (file: FileRecord) => void | Promise<void>;
}

export function ChapterFilesTable({
  projectId,
  chapterId,
  files,
  selectedSection,
  searchQuery,
  isActionPending,
  onCheckout,
  onCancelCheckout,
  onDelete,
}: ChapterFilesTableProps) {
  const [pendingDeleteFile, setPendingDeleteFile] = useState<FileRecord | null>(null);
  const [menuState, setMenuState] = useState<{ file: FileRecord; anchor: MenuAnchor } | null>(null);
  const [expandedFileId, setExpandedFileId] = useState<number | null>(null);
  const [refCheckFile, setRefCheckFile] = useState<FileRecord | null>(null);
  const [hoveredFileId, setHoveredFileId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("uploaded_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function toggleExpand(fileId: number) {
    setExpandedFileId((id) => (id === fileId ? null : fileId));
  }

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredFiles = files
    .filter((f) => selectedSection === "Overview" || f.category === selectedSection)
    .filter((f) => {
      if (!normalizedSearch) return true;
      return (
        f.filename.toLowerCase().includes(normalizedSearch) ||
        f.category.toLowerCase().includes(normalizedSearch) ||
        f.file_type.toLowerCase().includes(normalizedSearch)
      );
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "uploaded_at") {
        cmp = new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime();
      } else if (sortKey === "version") {
        cmp = a.version - b.version;
      } else {
        cmp = a.filename.localeCompare(b.filename);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  // Highest version across current view — used to mark the "latest" dot in VER cell
  const maxVersion = filteredFiles.length > 0
    ? Math.max(...filteredFiles.map((f) => f.version))
    : 0;

  if (filteredFiles.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={`No ${selectedSection === "Overview" ? "" : selectedSection + " "}files`}
        description={
          normalizedSearch
            ? "No files matched your search."
            : "Upload files to this folder to get started."
        }
        size="sm"
      />
    );
  }

  return (
    <>
      <div>
        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          {/* Authoritative column widths — 7 cols, no separate icon col (icon lives inside filename cell) */}
          <colgroup>
            <col style={{ width: "28px" }} />   {/* chevron */}
            <col />                              {/* filename (flex-1, absorbs remaining) */}
            <col style={{ width: "68px" }} />   {/* type */}
            <col style={{ width: "56px" }} />   {/* ver */}
            <col style={{ width: "108px" }} />  {/* uploaded */}
            <col style={{ width: "120px" }} />  {/* status */}
            <col style={{ width: "96px" }} />   {/* actions */}
          </colgroup>

          {/* ── Table header ── */}
          <thead style={{
            backgroundColor: "#F5F4F1",
            borderTop: "1px solid #E2DDD6",
            borderBottom: "2px solid #E2DDD6",
          }}>
            <tr style={{ height: "36px" }}>
              {/* Chevron — no label */}
              <th className="px-2" aria-label="Expand row" />

              {/* FILENAME */}
              <SortableHeader
                label="Filename"
                colKey="filename"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />

              {/* TYPE — sortable */}
              <SortableHeader
                label="Type"
                colKey="filename"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                align="center"
              />

              {/* VER — sortable */}
              <SortableHeader
                label="Ver"
                colKey="version"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                align="center"
              />

              {/* UPLOADED — sortable */}
              <SortableHeader
                label="Uploaded"
                colKey="uploaded_at"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />

              {/* STATUS — not sortable */}
              <th className="px-3" style={{ textAlign: "center" }}>
                <span style={{
                  fontSize: "11px", fontWeight: 500,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  color: "#9C9590",
                }}>
                  Status
                </span>
              </th>

              {/* ACTIONS — not sortable */}
              <th className="px-3" style={{ textAlign: "right" }}>
                <span style={{
                  fontSize: "11px", fontWeight: 500,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  color: "#9C9590",
                }}>
                  Actions
                </span>
              </th>
            </tr>
          </thead>

          {/* ── Table body ── */}
          <tbody>
            {filteredFiles.map((file, index) => {
              const isExpanded    = expandedFileId === file.id;
              const isRowHovered  = hoveredFileId === file.id;
              const isEvenRow     = index % 2 === 1;
              const isLatestVer   = file.version === maxVersion && filteredFiles.length > 1;
              const fileConfig    = getFileTypeConfig(file.filename, file.file_type);

              // Row background
              const rowBg = isExpanded
                ? "#FEFAF4"
                : isRowHovered
                  ? "#FDFCFA"
                  : isEvenRow
                    ? "#FAFAF8"
                    : "#FFFFFF";

              // Chevron: hidden by default, visible on hover, gold when expanded
              const chevronOpacity = isExpanded ? 1 : isRowHovered ? 0.6 : 0;
              const chevronColor   = isExpanded ? "#C9821A" : "#D4CFC9";

              // Formatted date
              const uploadedDate = new Date(file.uploaded_at).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
              });

              return (
                <Fragment key={file.id}>
                  {/* ── File row ── */}
                  <tr
                    style={{
                      backgroundColor: rowBg,
                      borderBottom: isExpanded ? "none" : "1px solid #F0EBE4",
                      transition: "background-color 120ms ease",
                      cursor: "default",
                    }}
                    onMouseEnter={() => setHoveredFileId(file.id)}
                    onMouseLeave={() => setHoveredFileId(null)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenuState({ file, anchor: { type: "cursor", x: e.clientX, y: e.clientY } });
                    }}
                  >
                    {/* ── Chevron ── */}
                    <td
                      className="px-2 py-3"
                      style={{ verticalAlign: "middle", cursor: "pointer" }}
                      onClick={() => toggleExpand(file.id)}
                    >
                      <ChevronRight
                        size={14}
                        aria-hidden
                        style={{
                          display: "block",
                          color: chevronColor,
                          opacity: chevronOpacity,
                          transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform 150ms ease, opacity 150ms ease, color 150ms",
                        }}
                      />
                    </td>

                    {/* ── Filename (icon embedded) ── */}
                    <td
                      className="px-3 py-3"
                      style={{
                        verticalAlign: "middle",
                        cursor: "pointer",
                        borderLeft: isExpanded ? "3px solid #C9821A" : "3px solid transparent",
                        transition: "border-color 120ms",
                      }}
                      onClick={() => toggleExpand(file.id)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                        {/* File type icon badge */}
                        <div
                          aria-hidden
                          style={{
                            width: "32px", height: "32px", borderRadius: "8px",
                            backgroundColor: fileConfig.bg,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <fileConfig.Icon size={16} style={{ color: fileConfig.color }} />
                        </div>

                        {/* Text block */}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: "13px", fontWeight: 500,
                              color: isExpanded ? "#C9821A" : "#1A1714",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              transition: "color 120ms",
                            }}
                            title={file.filename}
                            aria-expanded={isExpanded}
                          >
                            {file.filename}
                          </div>
                          {file.category && (
                            <div style={{ fontSize: "11px", color: "#9C9590", marginTop: "1px" }}>
                              {file.category}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* ── Type chip ── */}
                    <td className="px-3 py-3" style={{ verticalAlign: "middle", textAlign: "center" }}>
                      <span style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: "10px", fontWeight: 500,
                        textTransform: "uppercase",
                        backgroundColor: "#F0EBE4",
                        color: "#6B6560",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        display: "inline-block",
                        letterSpacing: "0.03em",
                      }}>
                        {fileConfig.badge}
                      </span>
                    </td>

                    {/* ── Version ── */}
                    <td className="px-3 py-3" style={{ verticalAlign: "middle", textAlign: "center" }}>
                      <span style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: "12px",
                        color: "#6B6560",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                      }}>
                        {isLatestVer && (
                          <span
                            aria-label="Latest version"
                            style={{
                              width: "5px", height: "5px", borderRadius: "50%",
                              backgroundColor: "#C9821A", display: "inline-block", flexShrink: 0,
                            }}
                          />
                        )}
                        v{file.version}
                      </span>
                    </td>

                    {/* ── Uploaded ── */}
                    <td className="px-3 py-3" style={{ verticalAlign: "middle" }}>
                      <span style={{ fontSize: "12px", color: "#6B6560", whiteSpace: "nowrap" }}>
                        {uploadedDate}
                      </span>
                    </td>

                    {/* ── Status / Lock ── */}
                    <td className="px-3 py-3" style={{ verticalAlign: "middle", textAlign: "center" }}>
                      {file.lock.is_checked_out ? (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: "5px",
                          backgroundColor: "#FEF3C7",
                          padding: "2px 8px", borderRadius: "6px",
                        }}>
                          <Lock size={12} style={{ color: "#92400E", flexShrink: 0 }} aria-hidden />
                          <span style={{ fontSize: "12px", color: "#92400E", whiteSpace: "nowrap" }}>
                            {file.lock.checked_out_by_username
                              ? `By ${file.lock.checked_out_by_username}`
                              : "Locked"}
                          </span>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                          <Lock size={12} style={{ color: "#16A34A", flexShrink: 0 }} aria-hidden />
                          <span
                            style={{
                              width: "6px", height: "6px", borderRadius: "50%",
                              backgroundColor: "#16A34A", flexShrink: 0, display: "inline-block",
                            }}
                          />
                          <span style={{ fontSize: "12px", color: "#15803D", whiteSpace: "nowrap" }}>
                            Available
                          </span>
                        </span>
                      )}
                    </td>

                    {/* ── Actions (4 inline: Download · Preview · Edit · More) ── */}
                    <td
                      className="px-2 py-3"
                      style={{ verticalAlign: "middle" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5px", justifyContent: "flex-end" }}>
                        <ActionDownloadLink
                          href={`/api/v2/files/${file.id}/download`}
                          label="Download"
                        >
                          <ArrowDownToLine size={14} aria-hidden />
                        </ActionDownloadLink>

                        <ActionLinkIcon
                          to={uiPaths.fileEditor(projectId, chapterId, file.id)}
                          label="Open in Editor"
                        >
                          <ExternalLink size={14} aria-hidden />
                        </ActionLinkIcon>

                        <ActionIconBtn
                          label="More actions"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuState({ file, anchor: { type: "element", el: e.currentTarget } });
                          }}
                        >
                          <MoreHorizontal size={14} aria-hidden />
                        </ActionIconBtn>
                      </div>
                    </td>
                  </tr>

                  {/* ── Details row (animated expand) ── */}
                  <tr style={{ borderBottom: isExpanded ? "1px solid #E2DDD6" : "none" }}>
                    <td colSpan={7} style={{ padding: 0, border: "none" }}>
                      <div style={{
                        maxHeight: isExpanded ? "600px" : "0",
                        opacity: isExpanded ? 1 : 0,
                        overflow: "hidden",
                        transition: "max-height 220ms ease-out, opacity 180ms ease-out",
                      }}>
                        {isExpanded && (
                          <FileDetailsPanel
                            file={file}
                            projectId={projectId}
                            chapterId={chapterId}
                            onDelete={() => {
                              setExpandedFileId(null);
                              setPendingDeleteFile(file);
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Confirm delete dialog */}
      <ConfirmDialog
        isOpen={pendingDeleteFile !== null}
        onClose={() => setPendingDeleteFile(null)}
        onConfirm={() => {
          if (pendingDeleteFile) {
            void onDelete(pendingDeleteFile);
            setPendingDeleteFile(null);
          }
        }}
        title="Delete file"
        description={`Are you sure you want to delete "${pendingDeleteFile?.filename}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        isLoading={pendingDeleteFile ? isActionPending(pendingDeleteFile.id, "delete") : false}
      />

      {/* Context menu */}
      {menuState && (
        <FileContextMenu
          file={menuState.file}
          projectId={projectId}
          chapterId={chapterId}
          anchor={menuState.anchor}
          onClose={() => setMenuState(null)}
          onCheckout={() => void onCheckout(menuState.file)}
          onCancelCheckout={() => void onCancelCheckout(menuState.file)}
          onDelete={() => {
            setMenuState(null);
            setPendingDeleteFile(menuState.file);
          }}
          onOpenReferenceCheck={() => {
            setRefCheckFile(menuState.file);
            setMenuState(null);
          }}
        />
      )}

      {/* Reference Check modal */}
      {refCheckFile && (
        <ReferenceCheckModal
          file={refCheckFile}
          isOpen={refCheckFile !== null}
          onClose={() => setRefCheckFile(null)}
        />
      )}

    </>
  );
}
