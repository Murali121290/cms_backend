import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { TechnicalIssuesForm } from "@/features/technicalReview/components/TechnicalIssuesForm";
import { useTechnicalApply } from "@/features/technicalReview/useTechnicalApply";
import { useTechnicalReviewQuery } from "@/features/technicalReview/useTechnicalReviewQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getSsrUrl, ssrPaths, uiPaths } from "@/utils/appPaths";

function buildInitialReplacements(issues: Array<{
  key: string;
  options: string[];
  found: string[];
}>) {
  return issues.reduce<Record<string, string>>((accumulator, issue) => {
    accumulator[issue.key] = issue.options[0] ?? issue.found[0] ?? "";
    return accumulator;
  }, {});
}

export function TechnicalReviewPage() {
  const { projectId, chapterId, fileId } = useParams();
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const parsedChapterId = Number.parseInt(chapterId ?? "", 10);
  const parsedFileId = Number.parseInt(fileId ?? "", 10);
  const normalizedProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0 ? parsedProjectId : null;
  const normalizedChapterId = Number.isInteger(parsedChapterId) && parsedChapterId > 0 ? parsedChapterId : null;
  const normalizedFileId = Number.isInteger(parsedFileId) && parsedFileId > 0 ? parsedFileId : null;
  const technicalReviewQuery = useTechnicalReviewQuery(normalizedFileId);
  const technicalApply = useTechnicalApply({
    projectId: normalizedProjectId,
    chapterId: normalizedChapterId,
    fileId: normalizedFileId,
  });
  const [replacements, setReplacements] = useState<Record<string, string>>({});

  useDocumentTitle(
    normalizedFileId === null ? "CMS UI Technical Review" : `CMS UI Technical Review ${normalizedFileId}`,
  );

  useEffect(() => {
    if (!technicalReviewQuery.data) {
      return;
    }

    setReplacements(buildInitialReplacements(technicalReviewQuery.data.issues));
  }, [technicalReviewQuery.data]);

  const canApply = useMemo(() => {
    const issues = technicalReviewQuery.data?.issues ?? [];
    if (issues.length === 0) {
      return false;
    }

    return issues.every((issue) => (replacements[issue.key] ?? "").trim().length > 0);
  }, [replacements, technicalReviewQuery.data?.issues]);

  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <ErrorState
        title="Invalid technical review route"
        message="The selected project, chapter, or file identifier is not valid."
        actions={
          <Link className="button" to={uiPaths.projects}>
            Back to projects
          </Link>
        }
      />
    );
  }

  if (technicalReviewQuery.isPending) {
    return (
      <LoadingState
        title="Loading technical review"
        message="Fetching normalized technical issues from /api/v2."
      />
    );
  }

  if (technicalReviewQuery.isError) {
    return (
      <ErrorState
        title="Technical review unavailable"
        message={getApiErrorMessage(
          technicalReviewQuery.error,
          "The frontend shell could not load the technical review contract.",
        )}
        actions={
          <>
            <button className="button" onClick={() => void technicalReviewQuery.refetch()}>
              Retry
            </button>
            <Link className="button button--secondary" to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
              Back to chapter
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

  if (!technicalReviewQuery.data) {
    return (
      <ErrorState
        title="Technical review unavailable"
        message="The technical review contract returned no data."
        actions={
          <Link className="button" to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
            Back to chapter
          </Link>
        }
      />
    );
  }

  const { file, issues } = technicalReviewQuery.data;

  async function handleApply() {
    if (!canApply) {
      return;
    }

    await technicalApply.apply(replacements);
  }

  return (
    <main className="page stack">
      <header className="page-header">
        <div className="page-breadcrumbs">
          <Link className="link-inline" to={uiPaths.projects}>
            Projects
          </Link>
          <span className="helper-text">/</span>
          <Link className="link-inline" to={uiPaths.projectDetail(normalizedProjectId)}>
            {normalizedProjectId}
          </Link>
          <span className="helper-text">/</span>
          <Link className="link-inline" to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
            {normalizedChapterId}
          </Link>
          <span className="helper-text">/</span>
          <span className="helper-text">Technical review</span>
        </div>
        <h1>Technical review: {file.filename}</h1>
        <p>
          Uses `GET /api/v2/files/{normalizedFileId}/technical-review` and
          `POST /api/v2/files/{normalizedFileId}/technical-review/apply`.
        </p>
      </header>

      <section className="panel stack">
        <div className="section-title">
          <h2>File context</h2>
          <Link className="link-inline" to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
            Back to chapter
          </Link>
        </div>
        <div className="detail-grid">
          <article className="detail-card">
            <strong>Filename</strong>
            <span>{file.filename}</span>
          </article>
          <article className="detail-card">
            <strong>Category</strong>
            <span>{file.category}</span>
          </article>
          <article className="detail-card">
            <strong>Version</strong>
            <span>v{file.version}</span>
          </article>
          <article className="detail-card">
            <strong>Lock state</strong>
            <span>{file.lock.is_checked_out ? "Checked out" : "Unlocked"}</span>
          </article>
        </div>
      </section>

      {technicalApply.statusMessage ? (
        <div className={`status-banner ${technicalApply.isPending ? "status-banner--pending" : "status-banner--success"}`}>
          {technicalApply.statusMessage}
        </div>
      ) : null}
      {technicalApply.errorMessage ? (
        <div className="status-banner status-banner--error">{technicalApply.errorMessage}</div>
      ) : null}

      {technicalApply.result ? (
        <section className="panel stack">
          <div className="section-title">
            <h2>Apply result</h2>
            <button className="button button--secondary" type="button" onClick={technicalApply.clearMessages}>
              Clear message
            </button>
          </div>
          <div className="detail-grid">
            <article className="detail-card">
              <strong>New file</strong>
              <span>{technicalApply.result.new_file.filename}</span>
            </article>
            <article className="detail-card">
              <strong>New file id</strong>
              <span>{technicalApply.result.new_file_id}</span>
            </article>
          </div>
        </section>
      ) : null}

      {issues.length === 0 ? (
        <EmptyState
          title="No technical issues found"
          message="The normalized issues list is empty for this file."
          actions={
            <Link className="button" to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
              Back to chapter
            </Link>
          }
        />
      ) : (
        <TechnicalIssuesForm
          canApply={canApply}
          isPending={technicalApply.isPending}
          issues={issues}
          onReplacementChange={(issueKey, value) =>
            setReplacements((current) => ({ ...current, [issueKey]: value }))
          }
          onSubmit={handleApply}
          replacements={replacements}
        />
      )}

      {!canApply && issues.length > 0 ? (
        <div className="helper-text">Select a replacement for each issue before applying changes.</div>
      ) : null}
    </main>
  );
}
