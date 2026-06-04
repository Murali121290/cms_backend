import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, FileText, Loader2, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useProjectsQuery } from "@/features/projects/useProjectsQuery";
import { useProjectChaptersQuery } from "@/features/projects/useProjectChaptersQuery";
import { useChapterFilesQuery } from "@/features/projects/useChapterFilesQuery";
import { useQualityReviewQuery } from "@/features/qc/useQualityReviewQuery";
import { uiPaths } from "@/utils/appPaths";
import type { ChapterSummary, TechnicalIssue } from "@/types/api";

interface SelectedFile {
  projectId: number;
  chapterId: number;
  fileId: number;
  filename: string;
}

export function QualityControlPage() {
  useDocumentTitle("Quality Control — S4 Carlisle CMS");

  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data?.projects ?? [];

  const [projectId, setProjectId] = useState<number | null>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);

  const effectiveProjectId = projectId ?? projects[0]?.id ?? null;
  const chaptersQuery = useProjectChaptersQuery(effectiveProjectId);
  const chapters = chaptersQuery.data?.chapters ?? [];

  return (
    <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
      <PageHeader
        title="Quality Control"
        subtitle="Run technical-review scans across manuscript files"
      />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* ── File picker ─────────────────────────────────────────── */}
        <aside className="bg-white rounded-lg shadow-card p-4">
          <label htmlFor="qc-project" className="block text-xs font-semibold text-navy-700 mb-1.5 uppercase tracking-wide">
            Project
          </label>
          <select
            id="qc-project"
            value={effectiveProjectId ?? ""}
            onChange={(e) => {
              setProjectId(Number.parseInt(e.target.value, 10));
              setSelected(null);
            }}
            disabled={projectsQuery.isPending || projects.length === 0}
            className="w-full px-3 py-2 rounded-md border border-navy-200 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent mb-4"
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.title}
              </option>
            ))}
          </select>

          <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">
            Manuscript files
          </p>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {chaptersQuery.isPending ? (
              <p className="text-sm text-navy-400">Loading chapters…</p>
            ) : chapters.length === 0 ? (
              <p className="text-sm text-navy-400">No chapters in this project.</p>
            ) : (
              chapters.map((chapter) => (
                <ChapterFilePicker
                  key={chapter.id}
                  chapter={chapter}
                  selectedFileId={selected?.fileId ?? null}
                  onSelect={(fileId, filename) =>
                    setSelected({
                      projectId: chapter.project_id,
                      chapterId: chapter.id,
                      fileId,
                      filename,
                    })
                  }
                />
              ))
            )}
          </div>
        </aside>

        {/* ── Results ─────────────────────────────────────────────── */}
        <section>
          {selected ? (
            <QualityResults selected={selected} />
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="Select a file to scan"
              description="Pick a manuscript file on the left to run a technical-review scan and see its findings summary."
            />
          )}
        </section>
      </div>
    </main>
  );
}

interface ChapterFilePickerProps {
  chapter: ChapterSummary;
  selectedFileId: number | null;
  onSelect: (fileId: number, filename: string) => void;
}

function ChapterFilePicker({ chapter, selectedFileId, onSelect }: ChapterFilePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const filesQuery = useChapterFilesQuery(chapter.project_id, expanded ? chapter.id : null);
  const manuscriptFiles = (filesQuery.data?.files ?? []).filter((f) => f.category === "Manuscript");

  return (
    <div className="border border-navy-100 rounded-md">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-2.5 hover:bg-navy-50 transition-colors text-left"
      >
        <span className="text-sm font-medium text-navy-700 truncate pr-2">
          Ch {chapter.number}: {chapter.title}
        </span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-navy-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-navy-400 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-navy-100 bg-navy-50 p-2 space-y-1">
          {filesQuery.isPending ? (
            <p className="text-xs text-navy-400 px-1 py-1">Loading…</p>
          ) : manuscriptFiles.length === 0 ? (
            <p className="text-xs text-navy-400 px-1 py-1">No manuscript files.</p>
          ) : (
            manuscriptFiles.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => onSelect(file.id, file.filename)}
                className={`w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded text-left transition-colors ${
                  selectedFileId === file.id
                    ? "bg-gold-100 text-gold-800 font-medium"
                    : "hover:bg-white text-navy-700"
                }`}
              >
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{file.filename}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function QualityResults({ selected }: { selected: SelectedFile }) {
  const query = useQualityReviewQuery(selected.fileId);

  const issues = useMemo<TechnicalIssue[]>(() => query.data?.issues ?? [], [query.data]);
  const byCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      const cat = issue.category ?? "Other";
      counts.set(cat, (counts.get(cat) ?? 0) + issue.count);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [issues]);

  const totalFindings = issues.reduce((sum, i) => sum + i.count, 0);

  return (
    <div className="bg-white rounded-lg shadow-card p-5">
      <header className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-surface-200">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-navy-900 truncate">{selected.filename}</h2>
          <p className="text-xs text-navy-400 mt-0.5">
            {query.isPending
              ? "Scanning…"
              : query.isError
                ? "Scan failed"
                : `${totalFindings} findings · ${issues.length} issue types`}
          </p>
        </div>
        <Link
          to={uiPaths.technicalReview(selected.projectId, selected.chapterId, selected.fileId)}
          className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-gold-600 text-white hover:bg-gold-700 border border-gold-600 shadow-subtle transition-all duration-150 shrink-0"
        >
          Open full review
        </Link>
      </header>

      {query.isPending ? (
        <div className="flex items-center justify-center gap-2 py-12 text-navy-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-gold-600" />
          Running technical-review scan…
        </div>
      ) : query.isError ? (
        <div className="py-10 text-center text-sm text-navy-500">
          Could not scan this file.{" "}
          <button className="text-gold-700 underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      ) : issues.length === 0 ? (
        <p className="py-10 text-center text-sm text-navy-500">No issues found in this file. 🎉</p>
      ) : (
        <>
          {/* Category summary */}
          <div className="flex flex-wrap gap-2 mb-5">
            {byCategory.map(([cat, count]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-100 text-navy-700 text-xs font-medium"
              >
                {cat}
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-gold-100 text-gold-700 text-[10px] font-semibold">
                  {count}
                </span>
              </span>
            ))}
          </div>

          {/* Issue table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-surface-300 text-navy-500 text-xs uppercase tracking-wide">
                  <th className="py-2 px-2 text-left font-semibold">Issue</th>
                  <th className="py-2 px-2 text-left font-semibold">Category</th>
                  <th className="py-2 px-2 text-right font-semibold">Count</th>
                  <th className="py-2 px-2 text-left font-semibold">Examples</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={issue.key} className="border-b border-surface-200 align-top">
                    <td className="py-2 px-2 font-medium text-navy-800">{issue.label}</td>
                    <td className="py-2 px-2 text-navy-600">{issue.category ?? "—"}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{issue.count}</td>
                    <td className="py-2 px-2 text-navy-500 max-w-md">
                      <span className="line-clamp-2">
                        {issue.found.slice(0, 3).join(", ") || "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
