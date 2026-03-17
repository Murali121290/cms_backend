import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { StructuringMetadataPanel } from "@/features/structuringReview/components/StructuringMetadataPanel";
import { StructuringReturnAction } from "@/features/structuringReview/components/StructuringReturnAction";
import { StructuringSaveForm } from "@/features/structuringReview/components/StructuringSaveForm";
import { useStructuringReviewQuery } from "@/features/structuringReview/useStructuringReviewQuery";
import { useStructuringSave } from "@/features/structuringReview/useStructuringSave";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

export function StructuringReviewPage() {
  const { projectId, chapterId, fileId } = useParams();
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const parsedChapterId = Number.parseInt(chapterId ?? "", 10);
  const parsedFileId = Number.parseInt(fileId ?? "", 10);
  const normalizedProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0 ? parsedProjectId : null;
  const normalizedChapterId = Number.isInteger(parsedChapterId) && parsedChapterId > 0 ? parsedChapterId : null;
  const normalizedFileId = Number.isInteger(parsedFileId) && parsedFileId > 0 ? parsedFileId : null;
  const reviewQuery = useStructuringReviewQuery(normalizedFileId);
  const saveMutation = useStructuringSave(normalizedFileId);
  const [changesJson, setChangesJson] = useState("{}");
  const [parseError, setParseError] = useState<string | null>(null);

  useDocumentTitle(
    normalizedFileId === null ? "CMS UI Structuring Review" : `CMS UI Structuring Review ${normalizedFileId}`,
  );

  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <ErrorState
        title="Invalid structuring review route"
        message="The selected project, chapter, or file identifier is not valid."
        actions={
          <Link className="button" to={uiPaths.projects}>
            Back to projects
          </Link>
        }
      />
    );
  }

  if (reviewQuery.isPending) {
    return (
      <LoadingState
        title="Loading structuring review"
        message="Fetching the current /api/v2 structuring-review metadata contract."
      />
    );
  }

  if (reviewQuery.isError) {
    return (
      <ErrorState
        title="Structuring review unavailable"
        message={getApiErrorMessage(
          reviewQuery.error,
          "The frontend shell could not load the structuring review metadata.",
        )}
        actions={
          <>
            <button className="button" onClick={() => void reviewQuery.refetch()}>
              Retry
            </button>
            <Link className="button button--secondary" to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
              Back to chapter
            </Link>
          </>
        }
      />
    );
  }

  if (!reviewQuery.data) {
    return (
      <ErrorState
        title="Structuring review unavailable"
        message="The structuring review contract returned no data."
        actions={
          <Link className="button" to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
            Back to chapter
          </Link>
        }
      />
    );
  }

  const review = reviewQuery.data;

  async function handleSave() {
    setParseError(null);

    let parsedChanges: Record<string, unknown>;
    try {
      const parsed = JSON.parse(changesJson);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        setParseError("Changes must be a JSON object.");
        return;
      }
      parsedChanges = parsed as Record<string, unknown>;
    } catch {
      setParseError("Changes must be valid JSON.");
      return;
    }

    await saveMutation.save(review.actions.save_endpoint, parsedChanges);
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
          <span className="helper-text">Structuring review</span>
        </div>
        <h1>Structuring review: {review.file.filename}</h1>
        <p>
          Frontend shell over the current `/api/v2/files/{normalizedFileId}/structuring-review`
          contract.
        </p>
      </header>

      <section className="panel stack">
        <div className="section-title">
          <h2>Actions</h2>
          <StructuringReturnAction actions={review.actions} />
        </div>
        <div className="upload-actions">
          <a className="button button--secondary" href={review.actions.export_href}>
            Export processed file
          </a>
        </div>
      </section>

      {saveMutation.statusMessage ? (
        <div className={`status-banner ${saveMutation.isPending ? "status-banner--pending" : "status-banner--success"}`}>
          {saveMutation.statusMessage}
        </div>
      ) : null}
      {saveMutation.errorMessage ? (
        <div className="status-banner status-banner--error">{saveMutation.errorMessage}</div>
      ) : null}
      {parseError ? <div className="status-banner status-banner--error">{parseError}</div> : null}

      <StructuringMetadataPanel review={review} />

      <StructuringSaveForm
        isPending={saveMutation.isPending}
        onChange={setChangesJson}
        onSubmit={handleSave}
        value={changesJson}
      />

      {saveMutation.result ? (
        <section className="panel stack">
          <div className="section-title">
            <h2>Save result</h2>
            <button className="button button--secondary" type="button" onClick={saveMutation.clearMessages}>
              Clear message
            </button>
          </div>
          <div className="detail-grid">
            <article className="detail-card">
              <strong>Saved changes</strong>
              <span>{saveMutation.result.saved_change_count}</span>
            </article>
            <article className="detail-card">
              <strong>Target file</strong>
              <span>{saveMutation.result.target_filename}</span>
            </article>
          </div>
        </section>
      ) : null}
    </main>
  );
}
