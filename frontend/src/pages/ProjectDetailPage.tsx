import { useState } from "react";
import { Link, useParams } from "react-router-dom";


import { getApiErrorMessage } from "@/api/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SkeletonTable } from "@/components/ui/SkeletonLoader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddChapterDrawer } from "@/features/projects/components/AddChapterDrawer";
import { ProjectChaptersTable } from "@/features/projects/components/ProjectChaptersTable";
import { useProjectChaptersQuery } from "@/features/projects/useProjectChaptersQuery";
import { useProjectDetailQuery } from "@/features/projects/useProjectDetailQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";
import type { ChapterSummary } from "@/types/api";

type ActiveTab = "chapters" | "overview";

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const [activeTab, setActiveTab] = useState<ActiveTab>("chapters");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingChapter, setEditingChapter] = useState<ChapterSummary | null>(null);
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const isValidProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0;
  const normalizedProjectId = isValidProjectId ? parsedProjectId : null;
  const projectDetailQuery = useProjectDetailQuery(normalizedProjectId);
  const projectChaptersQuery = useProjectChaptersQuery(normalizedProjectId);

  useDocumentTitle(
    normalizedProjectId === null
      ? "Projects — S4 Carlisle CMS"
      : projectDetailQuery.data?.project.title
        ? `${projectDetailQuery.data.project.title} — S4 Carlisle CMS`
        : `Project ${normalizedProjectId} — S4 Carlisle CMS`,
  );

  if (normalizedProjectId === null) {
    return (
      <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-card p-8 text-center">
          <p className="text-sm text-navy-500 mb-4">The selected project identifier is not valid.</p>
          <Link className="text-sm text-gold-700 hover:text-gold-800 font-medium" to={uiPaths.projects}>
            Back to projects
          </Link>
        </div>
      </main>
    );
  }

  if (projectDetailQuery.isPending || projectChaptersQuery.isPending) {
    return (
      <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="skeleton-shimmer rounded h-8 w-64 mb-2" aria-hidden="true" />
          <div className="skeleton-shimmer rounded h-4 w-40" aria-hidden="true" />
        </div>
        <div className="bg-white rounded-lg shadow-card overflow-hidden">
          <SkeletonTable rows={6} cols={8} />
        </div>
      </main>
    );
  }

  if (projectDetailQuery.isError || projectChaptersQuery.isError) {
    const error = projectDetailQuery.error ?? projectChaptersQuery.error;
    return (
      <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-card p-8 text-center">
          <p className="text-sm text-navy-500 mb-4">
            {getApiErrorMessage(error, "The project detail could not be loaded.")}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              className="text-sm text-gold-700 hover:text-gold-800 font-medium"
              onClick={() => {
                void projectDetailQuery.refetch();
                void projectChaptersQuery.refetch();
              }}
              type="button"
            >
              Retry
            </button>
            <Link className="text-sm text-navy-600 hover:text-navy-900 font-medium" to={uiPaths.projects}>
              Back to projects
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!projectDetailQuery.data || !projectChaptersQuery.data) {
    return (
      <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-card p-8 text-center">
          <p className="text-sm text-navy-500 mb-4">No project data was returned.</p>
          <Link className="text-sm text-gold-700 hover:text-gold-800 font-medium" to={uiPaths.projects}>
            Back to projects
          </Link>
        </div>
      </main>
    );
  }

  const project = projectDetailQuery.data.project;
  const chapters = projectChaptersQuery.data.chapters;

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: "chapters", label: "Chapters" },
    { id: "overview", label: "Overview" },
  ];

  const overviewFields: { label: string; value: string | number }[] = [
    { label: "Code", value: project.code },
    { label: "Publisher", value: project.client_name ?? "—" },
    { label: "XML Standard", value: project.xml_standard },
    { label: "Status", value: project.status },
    { label: "Chapters", value: project.chapter_count },
    { label: "Files", value: project.file_count },
  ];

  return (
    <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
      <PageHeader
        breadcrumb={
          <span className="flex items-center gap-1.5">
            <Link
              to={uiPaths.projects}
              className="hover:text-navy-700 transition-colors"
            >
              Projects
            </Link>
            <span aria-hidden="true">›</span>
            <span className="text-navy-700 truncate max-w-xs">{project.title}</span>
          </span>
        }
        title={project.title}
        badge={<StatusBadge status={project.status} size="sm" />}
        subtitle={project.client_name ?? project.code}
      />

      {/* Tab bar */}
      <div className="inline-flex border-b border-surface-300 mb-6 mt-6 w-full">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-gold-600 text-gold-700"
                : "border-transparent text-navy-500 hover:text-navy-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Chapters tab */}
      {activeTab === "chapters" && (
        <div className="bg-white rounded-lg shadow-card overflow-hidden">
          {chapters.length === 0 ? (
            <EmptyState
              title="No chapters yet"
              description="This project has no chapters to display."
              action={
                <button
                  type="button"
                  onClick={() => { setEditingChapter(null); setIsDrawerOpen(true); }}
                  className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-gold-600 text-white hover:bg-gold-700 border border-gold-600 shadow-subtle transition-all duration-150"
                >
                  Add first chapter
                </button>
              }
            />
          ) : (
            <ProjectChaptersTable
              chapters={chapters}
              projectId={project.id}
              onAddChapter={() => { setEditingChapter(null); setIsDrawerOpen(true); }}
              onEditChapter={(chapter) => { setEditingChapter(chapter); setIsDrawerOpen(true); }}
            />
          )}
        </div>
      )}

      <AddChapterDrawer
        isOpen={isDrawerOpen}
        onClose={() => { setIsDrawerOpen(false); setEditingChapter(null); }}
        projectId={normalizedProjectId}
        projectName={project.title}
        existingChapters={chapters}
        editingChapter={editingChapter}
      />

      {/* Overview tab */}
      {activeTab === "overview" && (
        <div className="bg-white rounded-lg shadow-card p-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {overviewFields.map((field) => (
              <div key={field.label} className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-navy-500 font-medium">
                  {field.label}
                </p>
                <p className="text-sm font-medium text-navy-900 mt-1">{field.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
