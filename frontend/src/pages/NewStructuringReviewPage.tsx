import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/SkeletonLoader";
import { WysiwygEditor, useEditorSaveRuns, type WysiwygEditorHandle } from "@/features/editor";
import { useParagraphStyles } from "@/features/editor/useParagraphStyles";
import { LeftStructuringSidebar } from "@/features/structuringReview/components/LeftStructuringSidebar";
import { useStructuringReviewQuery } from "@/features/structuringReview/useStructuringReviewQuery";
import { useFileXhtmlRunsQuery } from "@/features/technicalReview/useFileXhtmlRunsQuery";
import { useSessionStore } from "@/stores/sessionStore";
import { uiPaths } from "@/utils/appPaths";

interface NewStructuringReviewPageProps {
  projectId: number;
  chapterId: number;
  fileId: number;
  onComplete: (result: { fileId: number }) => void;
}

// Sub-view rendered by UnifiedReviewEditorPage for the Structuring stage.
// Reuses the exact hooks/components StructuringReviewPage.tsx uses (that page
// itself is never imported or modified) so this stage has full feature parity:
// the same WYSIWYG editor, paragraph-style margin badges, and PARA/CHAR/GROUP/
// HISTORY/COMMENTS toolbar buttons.
export function NewStructuringReviewPage({ projectId, chapterId, fileId, onComplete }: NewStructuringReviewPageProps) {
  const navigate = useNavigate();
  const editorRef = useRef<WysiwygEditorHandle>(null);
  const reviewQuery = useStructuringReviewQuery(fileId);
  const xhtmlQuery = useFileXhtmlRunsQuery(fileId);
  const editorSave = useEditorSaveRuns(fileId);
  const stylesQuery = useParagraphStyles(fileId);
  const currentUser = useSessionStore((s) => s.viewer)?.username;
  const [customStyles, setCustomStyles] = useState<string[]>([]);

  if (reviewQuery.isPending) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <SkeletonCard />
      </div>
    );
  }

  if (reviewQuery.isError || !reviewQuery.data) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <div className="bg-white rounded-lg shadow-card p-10 max-w-md w-full text-center space-y-4">
          <EmptyState
            title="Structuring review unavailable"
            description={getApiErrorMessage(
              reviewQuery.error,
              "The structuring review contract returned no data.",
            )}
          />
          <Button variant="primary" onClick={() => void reviewQuery.refetch()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  const review = reviewQuery.data;
  const publisherStyles = stylesQuery.data || [];
  const baseStyles = publisherStyles.length > 0 ? publisherStyles : (review.styles || []);
  const allStyles = Array.from(new Set([...baseStyles, ...customStyles])).sort();

  const handleAddStyle = (newStyleName: string) => {
    if (!customStyles.includes(newStyleName)) {
      setCustomStyles((prev) => [...prev, newStyleName]);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {editorSave.errorMessage && (
        <div className="px-4 py-2 text-sm font-medium border bg-error-100 border-error-100 text-error-600">
          {editorSave.errorMessage}
        </div>
      )}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {xhtmlQuery.isPending ? (
          <div style={{ padding: 24, textAlign: "center" }}>Loading document…</div>
        ) : (
          <WysiwygEditor
            ref={editorRef}
            key={`unified-structuring-${fileId}`}
            initialContent={xhtmlQuery.data?.content ?? ""}
            onSave={async (html) => {
              const res = await editorSave.save(html);
              onComplete({ fileId: res && res.file_id ? res.file_id : fileId });
            }}
            isSaving={editorSave.isPending}
            saveLabel="Save & Convert to DOCX"
            documentTitle={review.file.filename}
            height="100%"
            styles={allStyles}
            onAddStyle={handleAddStyle}
            currentUser={currentUser}
            fileId={fileId.toString()}
            leftSidebarSlot={
              <LeftStructuringSidebar
                fileId={fileId}
                allStyles={allStyles}
                charStyles={review.char_styles}
                onAddStyle={handleAddStyle}
                editorRef={editorRef}
                onOpenVersion={(versionId) => {
                  navigate(uiPaths.unifiedReview(projectId, chapterId, versionId));
                }}
              />
            }
          />
        )}
      </div>
    </div>
  );
}
