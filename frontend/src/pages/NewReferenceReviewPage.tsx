import { useRef } from "react";

import { Button } from "@/components/ui/Button";
import { WysiwygEditor, useEditorSaveRuns, type WysiwygEditorHandle } from "@/features/editor";
import { LeftReferenceSidebarTable } from "@/features/referenceReview/components/LeftReferenceSidebarTable";
import { useFileXhtmlRunsQuery } from "@/features/technicalReview/useFileXhtmlRunsQuery";
import { useSessionStore } from "@/stores/sessionStore";

interface NewReferenceReviewPageProps {
  projectId: number;
  chapterId: number;
  fileId: number;
  onComplete: (result: { fileId: number }) => void;
}

// Sub-view rendered by UnifiedReviewEditorPage for the Reference Validation
// stage. Reuses the same WYSIWYG editor plus the real ReferenceReviewSidePanel
// (via LeftReferenceSidebarTable) that StructuringReviewPage.tsx already uses
// for its "Reference Review" toggle — full feature parity (stat tiles,
// citations/issues/missing/marks, Locate links) with no rebuilding.
//
// ReferenceReviewSidePanel is fully self-contained and exposes no save-
// completion callback, so this stage is marked complete by an explicit
// "Mark Complete & Continue" action rather than being inferred from a save
// promise (the editor's own Save button still advances the stage too, since
// it shares the same onComplete callback).
export function NewReferenceReviewPage({ fileId, onComplete }: NewReferenceReviewPageProps) {
  const editorRef = useRef<WysiwygEditorHandle>(null);
  const xhtmlQuery = useFileXhtmlRunsQuery(fileId);
  const editorSave = useEditorSaveRuns(fileId);
  const currentUser = useSessionStore((s) => s.viewer)?.username;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {editorSave.errorMessage && (
        <div className="px-4 py-2 text-sm font-medium border bg-error-100 border-error-100 text-error-600">
          {editorSave.errorMessage}
        </div>
      )}
      <div className="flex-1 min-h-0 flex gap-3 p-3">
        <div className="flex-1 min-w-0 relative">
          {xhtmlQuery.isPending ? (
            <div style={{ padding: 24, textAlign: "center" }}>Loading document…</div>
          ) : (
            <WysiwygEditor
              ref={editorRef}
              key={`unified-reference-${fileId}`}
              initialContent={xhtmlQuery.data?.content ?? ""}
              onSave={async (html) => {
                const res = await editorSave.save(html);
                onComplete({ fileId: res && res.file_id ? res.file_id : fileId });
              }}
              isSaving={editorSave.isPending}
              saveLabel="Save & Convert to DOCX"
              height="100%"
              currentUser={currentUser}
              fileId={fileId.toString()}
            />
          )}
        </div>
        <div
          className="w-[380px] shrink-0 flex flex-col bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden"
        >
          <LeftReferenceSidebarTable fileId={fileId} editorRef={editorRef} />
        </div>
      </div>
      <div className="flex-shrink-0 px-4 py-2.5 bg-white border-t border-slate-200 flex justify-end">
        <Button variant="primary" onClick={() => onComplete({ fileId })}>
          Mark Complete &amp; Continue
        </Button>
      </div>
    </div>
  );
}
