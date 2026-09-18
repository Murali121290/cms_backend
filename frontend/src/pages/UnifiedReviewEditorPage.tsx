import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Lock } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";
import { NewStructuringReviewPage } from "./NewStructuringReviewPage";
import { NewReferenceReviewPage } from "./NewReferenceReviewPage";
import { NewTechnicalReviewPage } from "./NewTechnicalReviewPage";

type Stage = "structuring" | "reference" | "technical";
const STAGES: Stage[] = ["structuring", "reference", "technical"];
const STAGE_LABELS: Record<Stage, string> = {
  structuring: "Structuring",
  reference: "Reference Validation",
  technical: "Technical Editing",
};

function parseStage(value: string | null): Stage | null {
  return value === "structuring" || value === "reference" || value === "technical" ? value : null;
}

// New, additive entry point: a single unified workspace that walks a reviewer
// through Structuring -> Reference Validation -> Technical Editing -> Export,
// gated so a stage only unlocks once the previous one is complete. Every
// existing review page/route/endpoint remains untouched — this page and its
// sub-views are the only new UI, reusing the same hooks and shared panel
// components those pages already use.
export function UnifiedReviewEditorPage() {
  const navigate = useNavigate();
  const { projectId, chapterId, fileId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const parsedChapterId = Number.parseInt(chapterId ?? "", 10);
  const parsedFileId = Number.parseInt(fileId ?? "", 10);
  const normalizedProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0 ? parsedProjectId : null;
  const normalizedChapterId = Number.isInteger(parsedChapterId) && parsedChapterId > 0 ? parsedChapterId : null;
  const normalizedFileId = Number.isInteger(parsedFileId) && parsedFileId > 0 ? parsedFileId : null;

  const [activeFileId, setActiveFileId] = useState<number | null>(normalizedFileId);
  const [completedStages, setCompletedStages] = useState<Set<Stage>>(new Set());
  const [activeStage, setActiveStage] = useState<Stage>(() => parseStage(searchParams.get("stage")) ?? "structuring");
  const [exported, setExported] = useState(false);
  const exportAnchorRef = useRef<HTMLAnchorElement>(null);

  useDocumentTitle(
    normalizedFileId === null
      ? "Review Studio — S4 Carlisle CMS"
      : `Review Studio #${normalizedFileId} — S4 Carlisle CMS`,
  );

  function isUnlocked(stage: Stage): boolean {
    const idx = STAGES.indexOf(stage);
    return idx === 0 || completedStages.has(STAGES[idx - 1]);
  }

  // Clamp the URL-driven stage against real progress so a hand-typed
  // ?stage=technical can't skip an incomplete gate.
  useEffect(() => {
    const requested = parseStage(searchParams.get("stage"));
    if (requested && isUnlocked(requested)) {
      if (requested !== activeStage) setActiveStage(requested);
      return;
    }
    const firstIncomplete = STAGES.find((s) => !completedStages.has(s)) ?? STAGES[STAGES.length - 1];
    if (firstIncomplete !== activeStage) setActiveStage(firstIncomplete);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, completedStages]);

  function goToStage(stage: Stage) {
    if (!isUnlocked(stage)) return;
    setActiveStage(stage);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("stage", stage);
      return params;
    }, { replace: true });
  }

  function handleStageComplete(stage: Stage, result: { fileId: number }) {
    setCompletedStages((prev) => new Set(prev).add(stage));
    if (result.fileId !== activeFileId) setActiveFileId(result.fileId);

    const idx = STAGES.indexOf(stage);
    const next = STAGES[idx + 1];
    if (next) goToStage(next);
  }

  const technicalDone = completedStages.has("technical");

  function handleExportAndClose() {
    if (!technicalDone || activeFileId === null) return;
    const href = `/api/v2/files/${activeFileId}/technical-review/export`;
    if (exportAnchorRef.current) {
      exportAnchorRef.current.href = href;
      exportAnchorRef.current.click();
    }
    setExported(true);
  }

  useEffect(() => {
    if (!exported || normalizedProjectId === null || normalizedChapterId === null) return;
    const timer = setTimeout(() => {
      navigate(uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId));
    }, 1200);
    return () => clearTimeout(timer);
  }, [exported, navigate, normalizedProjectId, normalizedChapterId]);

  if (normalizedProjectId === null || normalizedChapterId === null || normalizedFileId === null || activeFileId === null) {
    return (
      <main className="min-h-screen bg-surface-100 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Invalid review studio route"
            description="The selected project, chapter, or file identifier is not valid."
          />
          <Link to={uiPaths.projects}>
            <Button variant="primary">Back to Projects</Button>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 overflow-hidden font-sans">
      {/* eslint-disable-next-line jsx-a11y/anchor-has-content */}
      <a ref={exportAnchorRef} download style={{ display: "none" }} />

      <div className="h-[52px] shrink-0 flex items-center gap-5 px-5 bg-white border-b border-slate-200">
        <button
          type="button"
          onClick={() => navigate(uiPaths.chapterDetail(normalizedProjectId, normalizedChapterId))}
          className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={16} /> Back to Chapter
        </button>
        <div className="w-px h-6 bg-slate-200" />
        <span className="text-sm font-semibold text-slate-800">Review Studio</span>
        <div className="flex-grow" />
        <div className="flex items-center gap-1.5">
          {STAGES.map((stage, idx) => {
            const unlocked = isUnlocked(stage);
            const done = completedStages.has(stage);
            const active = activeStage === stage;
            const cls = active
              ? "bg-blue-700 text-white"
              : done
                ? "bg-emerald-50 text-emerald-700"
                : unlocked
                  ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  : "bg-slate-50 text-slate-400 cursor-not-allowed";
            return (
              <button
                key={stage}
                type="button"
                disabled={!unlocked}
                onClick={() => goToStage(stage)}
                title={unlocked ? STAGE_LABELS[stage] : `Complete ${STAGE_LABELS[STAGES[idx - 1]]} first`}
                className={`rounded-full px-4 py-1.5 text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors ${cls}`}
              >
                {!unlocked && <Lock size={11} />}
                {unlocked && done && <Check size={12} />}
                {unlocked && !done && (
                  <span className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full bg-black/10 text-[10px]">
                    {idx + 1}
                  </span>
                )}
                {STAGE_LABELS[stage]}
              </button>
            );
          })}
        </div>
        <div className="w-px h-6 bg-slate-200" />
        <Button variant="primary" disabled={!technicalDone} onClick={handleExportAndClose}>
          Export as Word &amp; Close
        </Button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {activeStage === "structuring" && (
          <NewStructuringReviewPage
            projectId={normalizedProjectId}
            chapterId={normalizedChapterId}
            fileId={activeFileId}
            onComplete={(result) => handleStageComplete("structuring", result)}
          />
        )}
        {activeStage === "reference" && (
          <NewReferenceReviewPage
            projectId={normalizedProjectId}
            chapterId={normalizedChapterId}
            fileId={activeFileId}
            onComplete={(result) => handleStageComplete("reference", result)}
          />
        )}
        {activeStage === "technical" && (
          <NewTechnicalReviewPage
            projectId={normalizedProjectId}
            chapterId={normalizedChapterId}
            fileId={activeFileId}
            onComplete={(result) => handleStageComplete("technical", result)}
          />
        )}
      </div>

      {exported && (
        <div className="fixed inset-0 bg-slate-900/45 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl px-10 py-8 text-center shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
              <Check className="text-emerald-600" size={22} />
            </div>
            <h3 className="text-base font-semibold mb-1">Exported as Word</h3>
            <p className="text-sm text-slate-500">Returning to the Chapter File page&hellip;</p>
          </div>
        </div>
      )}
    </div>
  );
}
