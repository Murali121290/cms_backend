import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Code2,
  Eye,
  ExternalLink,
  FileText,
  Layout,
  Minus,
  Palette,
  Pencil,
  PlusCircle,
  Trash2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/useToast";
import { deleteChapter } from "@/api/projects";
import { getApiErrorMessage } from "@/api/client";
import type { ChapterSummary } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";
import { cn } from "@/utils/cn";

/* ─── Stage config ─────────────────────────────────────────────────────────── */

const STAGES = [
  {
    key: "has_art" as const,
    label: "ART",
    Icon: Palette,
    color: "#E8A838",
    bg: "rgba(232,168,56,0.10)",
    text: "#A06515",
  },
  {
    key: "has_manuscript" as const,
    label: "MS",
    Icon: FileText,
    color: "#2B579A",
    bg: "rgba(43,87,154,0.10)",
    text: "#2B579A",
  },
  {
    key: "has_indesign" as const,
    label: "INDESIGN",
    Icon: Layout,
    color: "#FF3366",
    bg: "rgba(255,51,102,0.10)",
    text: "#CC1144",
  },
  {
    key: "has_proof" as const,
    label: "PROOF",
    Icon: Eye,
    color: "#7C3AED",
    bg: "rgba(124,58,237,0.10)",
    text: "#7C3AED",
  },
  {
    key: "has_xml" as const,
    label: "XML",
    Icon: Code2,
    color: "#16A34A",
    bg: "rgba(22,163,74,0.10)",
    text: "#16A34A",
  },
] as const;

type StageKey = (typeof STAGES)[number]["key"];
type CellState = "done" | "not_started";

function getState(chapter: ChapterSummary, key: StageKey): CellState {
  return chapter[key] ? "done" : "not_started";
}

/* ─── Progress summary ─────────────────────────────────────────────────────── */

function ProgressSummary({ chapters }: { chapters: ChapterSummary[] }) {
  const total = chapters.length;
  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 bg-surface-50 border-b border-surface-200">
      <span className="text-[10px] font-semibold text-navy-400 uppercase tracking-widest">
        Progress
      </span>
      {STAGES.map((stage) => {
        const done = chapters.filter((c) => c[stage.key]).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <div key={stage.key} className="flex items-center gap-1.5">
            <stage.Icon className="w-3 h-3 shrink-0" style={{ color: stage.color }} aria-hidden="true" />
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: stage.text }}>
              {stage.label}
            </span>
            <div className="w-16 h-1.5 rounded-full bg-surface-300 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%`, backgroundColor: stage.color }}
              />
            </div>
            <span className="text-[10px] text-navy-400 tabular-nums w-8 text-right">
              {done}/{total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Stage cell ────────────────────────────────────────────────────────────── */

function StageCell({ state, color, label }: { state: CellState; color: string; label: string }) {
  if (state === "done") {
    return (
      <div className="flex items-center justify-center">
        <span
          className="flex items-center justify-center w-5 h-5 rounded-full"
          style={{ backgroundColor: color }}
          title={`${label}: Done`}
          aria-label={`${label}: Done`}
        >
          <Check className="w-3 h-3 text-white" strokeWidth={3} aria-hidden="true" />
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center" aria-label={`${label}: Not started`}>
      <Minus className="w-3.5 h-3.5 text-navy-300 opacity-40" aria-hidden="true" />
    </div>
  );
}

/* ─── Row action icon button ────────────────────────────────────────────────── */

function ActionBtn({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 28,
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: hov ? (destructive ? "#B91C1C" : "#1A1714") : "#9C9590",
        backgroundColor: hov ? (destructive ? "#FEE2E2" : "#F0EBE4") : "transparent",
        transition: "color 100ms ease, background-color 100ms ease",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/* ─── Main component ────────────────────────────────────────────────────────── */

interface ProjectChaptersTableProps {
  projectId: number;
  chapters: ChapterSummary[];
  onAddChapter: () => void;
  onEditChapter: (chapter: ChapterSummary) => void;
}

export function ProjectChaptersTable({
  projectId,
  chapters,
  onAddChapter,
  onEditChapter,
}: ProjectChaptersTableProps) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [pendingDelete, setPendingDelete] = useState<ChapterSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [addBtnHov, setAddBtnHov] = useState(false);

  async function handleDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteChapter(projectId, pendingDelete.id);
      await queryClient.invalidateQueries({ queryKey: ["project-chapters", projectId] });
      addToast({ title: `Chapter ${pendingDelete.number} deleted`, variant: "success" });
      setPendingDelete(null);
    } catch (err) {
      addToast({
        title: "Failed to delete chapter",
        description: getApiErrorMessage(err, "An unexpected error occurred."),
        variant: "error",
        duration: 6000,
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div>
      {/* Progress summary row */}
      <ProgressSummary chapters={chapters} />

      {/* Scrollable table */}
      <div className="overflow-x-auto overflow-y-auto max-h-[60vh]">
        <table className="w-full border-collapse min-w-[700px]">
          <thead className="sticky top-0 z-10 bg-white border-b border-surface-200 shadow-subtle">
            <tr>
              <th
                scope="col"
                className="text-xs font-semibold text-navy-500 uppercase tracking-wide px-4 py-3 text-left"
                style={{ width: 48 }}
              >
                #
              </th>
              <th
                scope="col"
                className="text-xs font-semibold text-navy-500 uppercase tracking-wide px-4 py-3 text-left"
              >
                Title
              </th>
              {STAGES.map((stage) => (
                <th
                  key={stage.key}
                  scope="col"
                  className="px-2 py-2.5 text-center"
                  style={{ width: 80, minWidth: 80 }}
                >
                  <div
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full mx-auto"
                    style={{ backgroundColor: stage.bg }}
                  >
                    <stage.Icon
                      className="w-3 h-3 shrink-0"
                      style={{ color: stage.color }}
                      aria-hidden="true"
                    />
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide leading-none"
                      style={{ color: stage.text }}
                    >
                      {stage.label}
                    </span>
                  </div>
                </th>
              ))}
              <th
                scope="col"
                className="text-xs font-semibold text-navy-500 uppercase tracking-wide px-4 py-3 text-right"
                style={{ width: 120 }}
              >
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {chapters.map((chapter, index) => (
              <tr
                key={chapter.id}
                className={cn(
                  "border-b border-surface-200 transition-colors duration-100",
                  "[&:hover]:bg-[#F0F4FF]",
                  index % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]",
                )}
              >
                <td
                  className="px-4 py-3.5 text-sm text-navy-400 tabular-nums"
                  style={{ width: 48 }}
                >
                  {chapter.number}
                </td>
                <td className="px-4 py-3.5 text-sm">
                  <Link
                    to={uiPaths.chapterDetail(projectId, chapter.id)}
                    className="font-medium text-navy-900 hover:text-gold-700 transition-colors"
                  >
                    {chapter.title || `Chapter ${chapter.number}`}
                  </Link>
                </td>
                {STAGES.map((stage) => (
                  <td
                    key={stage.key}
                    className="px-2 py-3.5 text-center"
                    style={{ width: 80 }}
                  >
                    <StageCell
                      state={getState(chapter, stage.key)}
                      color={stage.color}
                      label={stage.label}
                    />
                  </td>
                ))}
                <td className="px-4 py-3.5 text-right" style={{ width: 120 }}>
                  <div className="flex items-center justify-end gap-0.5">
                    {/* View */}
                    <Link
                      to={uiPaths.chapterDetail(projectId, chapter.id)}
                      aria-label="View Chapter"
                      title="View Chapter"
                      className="hover:bg-[#F0EBE4] hover:text-[#1A1714]"
                      style={{
                        width: 28,
                        height: 28,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 6,
                        color: "#9C9590",
                        textDecoration: "none",
                        transition: "color 100ms ease, background-color 100ms ease",
                        flexShrink: 0,
                      }}
                    >
                      <ExternalLink size={14} aria-hidden />
                    </Link>
                    {/* Edit */}
                    <ActionBtn label="Edit Chapter" onClick={() => onEditChapter(chapter)}>
                      <Pencil size={14} aria-hidden />
                    </ActionBtn>
                    {/* Delete */}
                    <ActionBtn
                      label="Delete Chapter"
                      destructive
                      onClick={() => setPendingDelete(chapter)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </ActionBtn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add chapter — full-width dashed button */}
      <div className="px-4 py-3 border-t border-surface-200">
        <button
          type="button"
          onClick={onAddChapter}
          onMouseEnter={() => setAddBtnHov(true)}
          onMouseLeave={() => setAddBtnHov(false)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            padding: "10px",
            border: `1.5px dashed ${addBtnHov ? "#C9821A" : "#D1CBC3"}`,
            borderRadius: 6,
            background: addBtnHov ? "#FEF8EE" : "transparent",
            color: addBtnHov ? "#C9821A" : "#6B6560",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            transition: "border-color 150ms ease, background 150ms ease, color 150ms ease",
          }}
        >
          <PlusCircle
            size={15}
            style={{
              marginRight: 6,
              color: addBtnHov ? "#C9821A" : "#9C9590",
              flexShrink: 0,
              transition: "color 150ms ease",
            }}
            aria-hidden
          />
          Add chapter
        </button>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => { if (!isDeleting) setPendingDelete(null); }}
        onConfirm={() => void handleDelete()}
        title={`Delete ${pendingDelete?.title || `Chapter ${pendingDelete?.number}`}?`}
        description="This will permanently delete the chapter and all its files. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
