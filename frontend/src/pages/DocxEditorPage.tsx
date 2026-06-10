import { useState, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";

import { WysiwygEditor, type WysiwygEditorHandle } from "@/features/editor";
import { getFileXhtmlRuns, saveFileXhtmlRuns } from "@/api/technicalReview";
import { getApiErrorMessage } from "@/api/client";
import { useToast } from "@/components/ui/useToast";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";
import { useParagraphStyles } from "@/features/editor/useParagraphStyles";
import { StylesPanel } from "@/features/structuringReview/components/EditorStylesPanel";

export function DocxEditorPage() {
  const { projectId, chapterId, fileId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const numericFileId = Number.parseInt(fileId ?? "", 10);
  const hasValidFile = Number.isInteger(numericFileId) && numericFileId > 0;

  const editorRef = useRef<WysiwygEditorHandle>(null);
  const stylesQuery = useParagraphStyles();
  const [customStyles, setCustomStyles] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["file-xhtml-runs", numericFileId],
    queryFn: () => getFileXhtmlRuns(numericFileId),
    enabled: hasValidFile,
    staleTime: 0,
  });

  useDocumentTitle(query.data ? `${query.data.filename} — Editor` : "Editor — S4 Carlisle CMS");

  const publisherStyles = stylesQuery.data || [];
  const allStyles = [...publisherStyles, ...customStyles].sort();

  const handleAddStyle = (style: string) => {
    if (!customStyles.includes(style)) {
      setCustomStyles((prev) => [...prev, style].sort());
    }
  };

  const saveMutation = useMutation({
    mutationFn: (html: string) => saveFileXhtmlRuns(numericFileId, html),
    onSuccess: (result) => {
      addToast({ title: "Saved — changes applied to a new DOCX version", variant: "success" });
      // The save creates a new file version; navigate to it so further edits chain correctly.
      if (result.file_id && result.file_id !== numericFileId && projectId && chapterId) {
        navigate(uiPaths.docxEditor(projectId, chapterId, result.file_id), { replace: true });
      } else {
        void query.refetch();
      }
    },
    onError: (error) => {
      addToast({ title: getApiErrorMessage(error, "Failed to save document"), variant: "error" });
    },
  });

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 h-12 bg-white border-b border-border flex-shrink-0">
        {projectId && chapterId && (
          <Link
            to={uiPaths.chapterDetail(projectId, chapterId)}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-text transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        )}
        <span className="text-sm font-medium text-text truncate">
          {query.data?.filename ?? "Loading…"}
        </span>
        <span className="ml-auto text-xs text-muted">Formatting-preserving editor</span>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {!hasValidFile ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-sm">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-text">Invalid file.</p>
          </div>
        ) : query.isPending ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            Loading document…
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-sm">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-text">{getApiErrorMessage(query.error, "Failed to load document.")}</p>
            <button
              className="px-4 py-2 rounded-md bg-primary text-white text-sm hover:bg-primary"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          </div>
        ) : (
          <WysiwygEditor
            ref={editorRef}
            key={numericFileId}
            initialContent={query.data?.content ?? ""}
            onSave={async (html) => {
              await saveMutation.mutateAsync(html);
            }}
            isSaving={saveMutation.isPending}
            saveLabel="Save changes to DOCX"
            documentTitle={query.data?.filename}
            height="calc(100vh - 48px)"
            styles={allStyles}
            onAddStyle={handleAddStyle}
            sidePanel={
              <div className="flex flex-col gap-4 h-full min-h-0">
                <div className="flex-1 min-h-0">
                  <StylesPanel styles={allStyles} editorRef={editorRef} onAddStyle={handleAddStyle} />
                </div>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

