import { Link, useParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { ChapterCategorySummary } from "@/features/projects/components/ChapterCategorySummary";
import { ChapterFilesTable } from "@/features/projects/components/ChapterFilesTable";
import { ChapterMetadataPanel } from "@/features/projects/components/ChapterMetadataPanel";
import { ChapterUploadPanel } from "@/features/projects/components/ChapterUploadPanel";
import { useChapterFileActions } from "@/features/projects/useChapterFileActions";
import { useChapterDetailQuery } from "@/features/projects/useChapterDetailQuery";
import { useChapterFilesQuery } from "@/features/projects/useChapterFilesQuery";
import { useChapterUpload } from "@/features/projects/useChapterUpload";
import { ProcessingStatusPanel } from "@/features/processing/components/ProcessingStatusPanel";
import { useStructuringProcessing } from "@/features/processing/useStructuringProcessing";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getSsrUrl, ssrPaths, uiPaths } from "@/utils/appPaths";

export function ChapterDetailPage() {
  const { projectId, chapterId } = useParams();
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const parsedChapterId = Number.parseInt(chapterId ?? "", 10);
  const hasValidProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0;
  const hasValidChapterId = Number.isInteger(parsedChapterId) && parsedChapterId > 0;
  const normalizedProjectId = hasValidProjectId ? parsedProjectId : null;
  const normalizedChapterId = hasValidChapterId ? parsedChapterId : null;
  const chapterDetailQuery = useChapterDetailQuery(normalizedProjectId, normalizedChapterId);
  const chapterFilesQuery = useChapterFilesQuery(normalizedProjectId, normalizedChapterId);
  const fileActions = useChapterFileActions({
    projectId: normalizedProjectId,
    chapterId: normalizedChapterId,
  });
  const chapterUpload = useChapterUpload({
    projectId: normalizedProjectId,
    chapterId: normalizedChapterId,
  });
  const structuringProcessing = useStructuringProcessing({
    projectId: normalizedProjectId,
    chapterId: normalizedChapterId,
  });

  useDocumentTitle(
    normalizedChapterId === null ? "CMS UI Chapter" : `CMS UI Chapter ${normalizedChapterId}`,
  );

  if (normalizedProjectId === null || normalizedChapterId === null) {
    return (
      <ErrorState
        title="Invalid chapter route"
        message="The selected project or chapter identifier is not valid."
        actions={
          <Link className="button" to={uiPaths.projects}>
            Back to projects
          </Link>
        }
      />
    );
  }

  if (chapterDetailQuery.isPending || chapterFilesQuery.isPending) {
    return (
      <LoadingState
        title="Loading chapter"
        message="Fetching chapter detail and file list contracts from /api/v2."
      />
    );
  }

  if (chapterDetailQuery.isError || chapterFilesQuery.isError) {
    const error = chapterDetailQuery.error ?? chapterFilesQuery.error;

    return (
      <ErrorState
        title="Chapter detail unavailable"
        message={getApiErrorMessage(
          error,
          "The frontend shell could not load the chapter detail contracts.",
        )}
        actions={
          <>
            <button
              className="button"
              onClick={() => {
                void chapterDetailQuery.refetch();
                void chapterFilesQuery.refetch();
              }}
            >
              Retry
            </button>
            <Link className="button button--secondary" to={uiPaths.projectDetail(normalizedProjectId)}>
              Back to project
            </Link>
            <a
              className="button button--secondary"
              href={getSsrUrl(ssrPaths.chapterDetail(normalizedProjectId, normalizedChapterId))}
            >
              Open SSR chapter view
            </a>
          </>
        }
      />
    );
  }

  if (!chapterDetailQuery.data || !chapterFilesQuery.data) {
    return (
      <ErrorState
        title="Chapter detail unavailable"
        message="The chapter detail contract returned no data."
        actions={
          <Link className="button" to={uiPaths.projectDetail(normalizedProjectId)}>
            Back to project
          </Link>
        }
      />
    );
  }

  const { project, chapter, active_tab: activeTab } = chapterDetailQuery.data;
  const files = chapterFilesQuery.data.files;
  const actionStatus = fileActions.status;

  return (
    <main className="page stack">
      <header className="page-header">
        <div className="page-breadcrumbs">
          <Link className="link-inline" to={uiPaths.projects}>
            Projects
          </Link>
          <span className="helper-text">/</span>
          <Link className="link-inline" to={uiPaths.projectDetail(project.id)}>
            {project.code}
          </Link>
          <span className="helper-text">/</span>
          <span className="helper-text">{chapter.number}</span>
        </div>
        <h1>
          {chapter.number} - {chapter.title}
        </h1>
        <p>
          Read-only chapter detail page using `/api/v2/projects/{normalizedProjectId}/chapters/{normalizedChapterId}`
          and `/api/v2/projects/{normalizedProjectId}/chapters/{normalizedChapterId}/files`.
        </p>
      </header>

      <section className="panel stack">
        <div className="section-title">
          <h2>Chapter metadata</h2>
          <a
            className="link-inline"
            href={getSsrUrl(ssrPaths.chapterDetail(normalizedProjectId, normalizedChapterId))}
          >
            Open SSR chapter view
          </a>
        </div>
        <ChapterMetadataPanel activeTab={activeTab} chapter={chapter} />
        <ChapterCategorySummary activeTab={activeTab} counts={chapter.category_counts} />
      </section>

      <ChapterUploadPanel
        activeTab={activeTab}
        errorMessage={chapterUpload.errorMessage}
        isPending={chapterUpload.isPending}
        onClearResult={chapterUpload.clearResult}
        onUpload={chapterUpload.submitUpload}
        result={chapterUpload.result}
        statusMessage={chapterUpload.statusMessage}
      />

      <ProcessingStatusPanel status={structuringProcessing.status} />

      <section className="panel stack">
        <div className="section-title">
          <h2>Files</h2>
          <span className="helper-text">
            {files.length} file{files.length === 1 ? "" : "s"} loaded
          </span>
        </div>

        {actionStatus ? (
          <div className={`status-banner status-banner--${actionStatus.tone}`}>
            {actionStatus.message}
          </div>
        ) : null}

        {files.length === 0 ? (
          <EmptyState
            compact
            title="No files available"
            message="This chapter currently has no file rows to display in the frontend shell."
          />
        ) : (
          <ChapterFilesTable
            activeTab={activeTab}
            chapterId={chapter.id}
            files={files}
            isActionPending={(fileId, action) => fileActions.isPending(fileId, action)}
            isProcessingPending={(fileId) => structuringProcessing.isPending(fileId)}
            onCancelCheckout={(file) => fileActions.handleCancelCheckout(file)}
            onCheckout={(file) => fileActions.handleCheckout(file)}
            onDelete={(file) => fileActions.handleDelete(file)}
            onDownload={(file) => fileActions.handleDownload(file)}
            onRunStructuring={(file) => structuringProcessing.startStructuring(file)}
            projectId={project.id}
          />
        )}
      </section>
    </main>
  );
}
