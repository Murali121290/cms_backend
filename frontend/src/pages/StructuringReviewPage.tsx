import { useState } from "react";
import { AlertTriangle, ArrowLeft, Download, RefreshCw, Save } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { StructuringMetadataPanel } from "@/features/structuringReview/components/StructuringMetadataPanel";
import { StructuringReturnAction } from "@/features/structuringReview/components/StructuringReturnAction";
import { StructuringSaveForm } from "@/features/structuringReview/components/StructuringSaveForm";
import { useStructuringReviewQuery } from "@/features/structuringReview/useStructuringReviewQuery";
import { useStructuringSave } from "@/features/structuringReview/useStructuringSave";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

export function StructuringReviewPage() {
  const navigate = useNavigate();
  const { projectId, chapterId, fileId } = useParams();
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const parsedChapterId = Number.parseInt(chapterId ?? "", 10);
  const parsedFileId = Number.parseInt(fileId ?? "", 10);
  const normalizedProjectId =
    Number.isInteger(parsedProjectId) && parsedProjectId > 0 ? parsedProjectId : null;
  const normalizedChapterId =
    Number.isInteger(parsedChapterId) && parsedChapterId > 0 ? parsedChapterId : null;
  const normalizedFileId =
    Number.isInteger(parsedFileId) && parsedFileId > 0 ? parsedFileId : null;

  const reviewQuery = useStructuringReviewQuery(normalizedFileId);
  const saveMutation = useStructuringSave(normalizedFileId);
  const [changesJson, setChangesJson] = useState("{}");
  const [parseError, setParseError] = useState<string | null>(null);

  useDocumentTitle(
    normalizedFileId === null
      ? "Structuring Review — S4 Carlisle CMS"
      : `Structuring Review #${normalizedFileId} — S4 Carlisle CMS`,
  );

  // Invalid params
  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Invalid structuring review route"
            description="The selected project, chapter, or file identifier is not valid."
          />
          <Link to={uiPaths.projects}>
            <Button variant="primary">Back to Projects</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (reviewQuery.isPending) {
    return (
      <main className="page-enter min-h-screen bg-surface-100">
        {/* Toolbar skeleton */}
        <div className="h-14 skeleton-shimmer" aria-hidden="true" />
        <div className="p-6">
          <SkeletonCard />
        </div>
      </main>
    );
  }

  if (reviewQuery.isError) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Structuring review unavailable"
            description={getApiErrorMessage(
              reviewQuery.error,
              "The frontend shell could not load the structuring review metadata.",
            )}
          />
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" onClick={() => void reviewQuery.refetch()}>
              Retry
            </Button>
            <Link to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
              <Button variant="secondary">Back to Chapter</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!reviewQuery.data) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Structuring review unavailable"
            description="The structuring review contract returned no data."
          />
          <Link to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
            <Button variant="primary">Back to Chapter</Button>
          </Link>
        </div>
      </main>
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

  const iframeHeight = "calc(100vh - 56px - 56px)";

  return (
    <main className="page-enter min-h-screen bg-surface-100 flex flex-col">
      {/* Top toolbar */}
      <div className="bg-white border-b border-surface-300 px-6 py-3 flex items-center justify-between sticky top-0 z-[10] h-14 shrink-0">
        {/* Left: back + title + badge */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            className="p-1.5 rounded hover:bg-surface-200 text-navy-500 hover:text-navy-900 transition-colors shrink-0"
            aria-label="Go back"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <span
            className="text-sm font-medium text-navy-900 truncate max-w-xs"
            title={review.file.filename}
          >
            {review.file.filename}
          </span>
          <Badge variant="info" size="sm" className="shrink-0">
            Structuring Review
          </Badge>
        </div>

        {/* Center: autosave indicator */}
        <div className="flex items-center gap-1.5 text-navy-500 shrink-0">
          <RefreshCw className="w-3 h-3 animate-spin text-success-600" aria-hidden="true" />
          <span className="text-xs text-navy-500">Autosaved via WOPI</span>
        </div>

        {/* Right: export + save */}
        <div className="flex items-center gap-2 shrink-0">
          <a href={review.actions.export_href}>
            <Button variant="secondary" size="sm" leftIcon={<Download />}>
              Export
            </Button>
          </a>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Save />}
            isLoading={saveMutation.isPending}
            disabled={saveMutation.isPending}
            onClick={() => void handleSave()}
          >
            Save Changes
          </Button>
        </div>
      </div>

      {/* Review toolbar / status */}
      <div className="bg-white border-b border-surface-200 px-6 py-2 flex items-center gap-3 h-14 shrink-0">
        {saveMutation.statusMessage ? (
          <div
            className={`px-3 py-1.5 rounded text-xs font-medium border ${
              saveMutation.isPending
                ? "bg-info-100 border-info-100 text-info-600"
                : "bg-success-100 border-success-100 text-success-600"
            }`}
          >
            {saveMutation.statusMessage}
          </div>
        ) : null}
        {saveMutation.errorMessage ? (
          <div className="px-3 py-1.5 rounded text-xs font-medium border bg-error-100 border-error-100 text-error-600">
            {saveMutation.errorMessage}
          </div>
        ) : null}
        {parseError ? (
          <div className="px-3 py-1.5 rounded text-xs font-medium border bg-error-100 border-error-100 text-error-600">
            {parseError}
          </div>
        ) : null}
        {saveMutation.result ? (
          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded text-xs font-medium border bg-success-100 border-success-100 text-success-600">
              Saved {saveMutation.result.saved_change_count} change
              {saveMutation.result.saved_change_count === 1 ? "" : "s"} to{" "}
              {saveMutation.result.target_filename}
            </div>
            <button
              className="text-xs text-navy-400 hover:text-navy-700 transition-colors"
              type="button"
              onClick={saveMutation.clearMessages}
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>

      {/* Body: iframe + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col">
          {review.editor.collabora_url ? (
            <iframe
              src={review.editor.collabora_url}
              title="Collabora document editor"
              style={{
                width: "100%",
                height: iframeHeight,
                border: "none",
                display: "block",
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-10">
              <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-5">
                <EmptyState
                  icon={AlertTriangle}
                  title="Collabora editor unavailable"
                  description="The backend did not provide a Collabora launch URL. Export the processed file or return to the chapter view."
                  action={
                    <div className="flex items-center justify-center gap-3">
                      <a href={review.actions.export_href}>
                        <Button variant="primary" leftIcon={<Download />}>
                          Download &amp; Edit Locally
                        </Button>
                      </a>
                      <StructuringReturnAction
                        actions={review.actions}
                        projectId={normalizedProjectId}
                        chapterId={normalizedChapterId}
                      />
                    </div>
                  }
                />
              </div>
            </div>
          )}

          {/* Manual save form below iframe */}
          <div className="border-t border-surface-300 bg-white p-5">
            <StructuringSaveForm
              isPending={saveMutation.isPending}
              onChange={setChangesJson}
              value={changesJson}
            />
          </div>
        </div>

        {/* Metadata sidebar */}
        <StructuringMetadataPanel review={review} />
      </div>
    </main>
  );
}
