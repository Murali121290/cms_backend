import { Link, useParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { ChapterCreateForm } from "@/features/projects/components/ChapterCreateForm";
import { ProjectChaptersTable } from "@/features/projects/components/ProjectChaptersTable";
import { ProjectMetadataPanel } from "@/features/projects/components/ProjectMetadataPanel";
import { useChapterMutations } from "@/features/projects/useChapterMutations";
import { useProjectChaptersQuery } from "@/features/projects/useProjectChaptersQuery";
import { useProjectDetailQuery } from "@/features/projects/useProjectDetailQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getSsrUrl, ssrPaths, uiPaths } from "@/utils/appPaths";

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const isValidProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0;
  const normalizedProjectId = isValidProjectId ? parsedProjectId : null;
  const projectDetailQuery = useProjectDetailQuery(normalizedProjectId);
  const projectChaptersQuery = useProjectChaptersQuery(normalizedProjectId);
  const chapterMutations = useChapterMutations({ projectId: normalizedProjectId });

  useDocumentTitle(
    normalizedProjectId === null ? "CMS UI Project" : `CMS UI Project ${normalizedProjectId}`,
  );

  if (normalizedProjectId === null) {
    return (
      <ErrorState
        title="Invalid project route"
        message="The selected project identifier is not valid."
        actions={
          <Link className="button" to={uiPaths.projects}>
            Back to projects
          </Link>
        }
      />
    );
  }

  if (projectDetailQuery.isPending || projectChaptersQuery.isPending) {
    return (
      <LoadingState
        title="Loading project"
        message="Fetching the project detail and chapter summary contracts from /api/v2."
      />
    );
  }

  if (projectDetailQuery.isError || projectChaptersQuery.isError) {
    const error = projectDetailQuery.error ?? projectChaptersQuery.error;

    return (
      <ErrorState
        title="Project detail unavailable"
        message={getApiErrorMessage(
          error,
          "The frontend shell could not load the project detail contracts.",
        )}
        actions={
          <>
            <button
              className="button"
              onClick={() => {
                void projectDetailQuery.refetch();
                void projectChaptersQuery.refetch();
              }}
            >
              Retry
            </button>
            <Link className="button button--secondary" to={uiPaths.projects}>
              Back to projects
            </Link>
            <a
              className="button button--secondary"
              href={getSsrUrl(ssrPaths.projectDetail(normalizedProjectId))}
            >
              Open SSR project view
            </a>
          </>
        }
      />
    );
  }

  if (!projectDetailQuery.data || !projectChaptersQuery.data) {
    return (
      <ErrorState
        title="Project detail unavailable"
        message="The project detail contract returned no data."
        actions={
          <Link className="button" to={uiPaths.projects}>
            Back to projects
          </Link>
        }
      />
    );
  }

  const project = projectDetailQuery.data.project;
  const chapters = projectChaptersQuery.data.chapters;

  return (
    <main className="page stack">
      <header className="page-header">
        <div className="page-breadcrumbs">
          <Link className="link-inline" to={uiPaths.projects}>
            Projects
          </Link>
          <span className="helper-text">/</span>
          <span className="helper-text">{project.code}</span>
        </div>
        <h1>{project.title}</h1>
        <p>
          Read-only project detail page using `/api/v2/projects/{normalizedProjectId}` and
          `/api/v2/projects/{normalizedProjectId}/chapters`.
        </p>
      </header>

      <section className="panel stack">
        <div className="section-title">
          <h2>Project metadata</h2>
          <a className="link-inline" href={getSsrUrl(ssrPaths.projectDetail(normalizedProjectId))}>
            Open SSR project view
          </a>
        </div>
        <ProjectMetadataPanel project={project} />
      </section>

      <ChapterCreateForm
        isPending={chapterMutations.isPending("create")}
        onSubmit={(number, title) => chapterMutations.createChapter(number, title)}
      />

      <section className="panel stack">
        <div className="section-title">
          <h2>Chapters</h2>
          <span className="helper-text">
            {chapters.length} chapter{chapters.length === 1 ? "" : "s"} loaded
          </span>
        </div>

        {chapterMutations.status ? (
          <div className={`status-banner status-banner--${chapterMutations.status.tone}`}>
            {chapterMutations.status.message}
          </div>
        ) : null}

        {chapters.length === 0 ? (
          <EmptyState
            compact
            title="No chapters available"
            message="This project currently has no chapter rows to display in the frontend shell."
          />
        ) : (
          <ProjectChaptersTable
            chapters={chapters}
            isPending={chapterMutations.isPending}
            onDelete={(chapterId, number) => chapterMutations.deleteChapter(chapterId, number)}
            onRename={(chapterId, number, title) =>
              chapterMutations.renameChapter(chapterId, number, title)
            }
            projectId={project.id}
          />
        )}
      </section>
    </main>
  );
}
