import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle, Info } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TechnicalIssuesForm } from "@/features/technicalReview/components/TechnicalIssuesForm";
import { useTechnicalApply } from "@/features/technicalReview/useTechnicalApply";
import { useTechnicalReviewQuery } from "@/features/technicalReview/useTechnicalReviewQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

function buildInitialReplacements(
  issues: Array<{
    key: string;
    options: string[];
    found: string[];
  }>,
) {
  return issues.reduce<Record<string, string>>((accumulator, issue) => {
    accumulator[issue.key] = issue.options[0] ?? issue.found[0] ?? "";
    return accumulator;
  }, {});
}

export function TechnicalReviewPage() {
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

  const technicalReviewQuery = useTechnicalReviewQuery(normalizedFileId);
  const technicalApply = useTechnicalApply({
    projectId: normalizedProjectId,
    chapterId: normalizedChapterId,
    fileId: normalizedFileId,
  });
  const [replacements, setReplacements] = useState<Record<string, string>>({});

  useDocumentTitle(
    normalizedFileId === null
      ? "Technical Review — S4 Carlisle CMS"
      : `Technical Review #${normalizedFileId} — S4 Carlisle CMS`,
  );

  useEffect(() => {
    if (!technicalReviewQuery.data) {
      return;
    }
    setReplacements(buildInitialReplacements(technicalReviewQuery.data.issues));
  }, [technicalReviewQuery.data]);

  const canApply = useMemo(() => {
    const issues = technicalReviewQuery.data?.issues ?? [];
    if (issues.length === 0) return false;
    return issues.every((issue) => (replacements[issue.key] ?? "").trim().length > 0);
  }, [replacements, technicalReviewQuery.data?.issues]);

  // Invalid params
  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Invalid technical review route"
            description="The selected project, chapter, or file identifier is not valid."
          />
          <Link to={uiPaths.projects}>
            <Button variant="primary">Back to Projects</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (technicalReviewQuery.isPending) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="h-14 skeleton-shimmer rounded-md" aria-hidden="true" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (technicalReviewQuery.isError) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Technical review unavailable"
            description={getApiErrorMessage(
              technicalReviewQuery.error,
              "The frontend shell could not load the technical review contract.",
            )}
          />
          <div className="flex items-center justify-center gap-3">
            <Button variant="primary" onClick={() => void technicalReviewQuery.refetch()}>
              Try Again
            </Button>
            <Link to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
              <Button variant="secondary">Back to Chapter</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!technicalReviewQuery.data) {
    return (
      <main className="page-enter min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Technical review unavailable"
            description="The technical review contract returned no data."
          />
          <Link to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}>
            <Button variant="primary">Back to Chapter</Button>
          </Link>
        </div>
      </main>
    );
  }

  const { file, issues } = technicalReviewQuery.data;

  async function handleApply() {
    if (!canApply) return;
    await technicalApply.apply(replacements);
  }

  return (
    <main className="page-enter min-h-screen bg-surface-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Page Header */}
        <PageHeader
          breadcrumb={
            <span className="flex items-center gap-1.5 text-sm text-navy-400">
              <Link className="hover:text-navy-700 transition-colors" to={uiPaths.projects}>
                Projects
              </Link>
              <span>/</span>
              <Link
                className="hover:text-navy-700 transition-colors"
                to={uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId)}
              >
                Chapter
              </Link>
              <span>/</span>
              <span className="text-navy-700">Technical Review</span>
            </span>
          }
          title="Technical Review"
          subtitle={file.filename}
          secondaryActions={[
            <Button
              key="back"
              variant="secondary"
              leftIcon={<ArrowLeft />}
              onClick={() => navigate(-1)}
            >
              Back
            </Button>,
          ]}
        />

        {/* Status / error banners */}
        {technicalApply.statusMessage ? (
          <div
            className={`px-4 py-3 rounded-md text-sm font-medium border ${
              technicalApply.isPending
                ? "bg-info-100 border-info-100 text-info-600"
                : "bg-success-100 border-success-100 text-success-600"
            }`}
          >
            {technicalApply.statusMessage}
          </div>
        ) : null}
        {technicalApply.errorMessage ? (
          <div className="px-4 py-3 rounded-md text-sm font-medium border bg-error-100 border-error-100 text-error-600">
            {technicalApply.errorMessage}
          </div>
        ) : null}

        {/* Apply result */}
        {technicalApply.result ? (
          <div className="bg-white rounded-lg shadow-card p-5 flex items-start gap-4">
            <div className="w-9 h-9 rounded-md flex items-center justify-center bg-success-100 shrink-0">
              <CheckCircle className="w-5 h-5 text-success-600" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-navy-900 text-sm">Apply result</p>
              <p className="text-sm text-navy-500 mt-0.5">
                New file:{" "}
                <span className="font-medium text-navy-700">
                  {technicalApply.result.new_file.filename}
                </span>{" "}
                (ID {technicalApply.result.new_file_id})
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={technicalApply.clearMessages}>
              Dismiss
            </Button>
          </div>
        ) : null}

        {/* Main layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel: Issues */}
          <div className="lg:col-span-2">
            {issues.length === 0 ? (
              <div className="bg-white rounded-lg shadow-card p-10">
                <EmptyState
                  title="No technical issues found"
                  description="The normalized issues list is empty for this file."
                />
              </div>
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
          </div>

          {/* Right panel */}
          <div className="space-y-4">
            {/* File info card */}
            <div className="bg-white rounded-lg shadow-card p-5">
              <h3 className="text-sm font-semibold text-navy-900 mb-4">File Information</h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-navy-400 uppercase tracking-wide font-medium">
                    Filename
                  </dt>
                  <dd className="text-sm text-navy-700 mt-0.5 font-medium truncate">
                    {file.filename}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-navy-400 uppercase tracking-wide font-medium">
                    Category
                  </dt>
                  <dd className="mt-0.5">
                    <Badge variant="default" size="sm">
                      {file.category}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-navy-400 uppercase tracking-wide font-medium">
                    Version
                  </dt>
                  <dd className="text-sm text-navy-700 mt-0.5">v{file.version}</dd>
                </div>
                <div>
                  <dt className="text-xs text-navy-400 uppercase tracking-wide font-medium">
                    Uploaded
                  </dt>
                  <dd className="text-sm text-navy-700 mt-0.5">
                    {new Date(file.uploaded_at).toLocaleDateString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-navy-400 uppercase tracking-wide font-medium mb-0.5">
                    Lock state
                  </dt>
                  <dd>
                    <StatusBadge
                      status={file.lock.is_checked_out ? "processing" : "ready"}
                      size="sm"
                    />
                  </dd>
                </div>
              </dl>
            </div>

            {/* Instructions card */}
            <div className="bg-gold-50 border border-gold-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-gold-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-navy-900 mb-1">Instructions</p>
                  <p className="text-xs text-navy-600 leading-relaxed">
                    Review each detected pattern and choose the preferred replacement. Once all
                    replacements are selected, click "Apply All" to generate a corrected file
                    version.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
