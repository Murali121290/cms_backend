import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { apiClient } from "@/api/client";
import { uiPaths } from "@/utils/appPaths";

interface EditorPageState {
  collabora_url: string;
  filename: string;
}

async function getEditorState(fileId: string) {
  const response = await apiClient.get<EditorPageState>(`/files/${fileId}/editor`);
  return response.data;
}

export function FileEditorPage() {
  const { projectId, chapterId, fileId } = useParams();
  const query = useQuery({
    queryKey: ["editor", fileId],
    queryFn: () => getEditorState(fileId!),
    enabled: !!fileId,
  });
  useDocumentTitle(query.data ? `${query.data.filename} â€” Editor` : "Editor â€” S4 Carlisle CMS");

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
          {query.data?.filename ?? "Loadingâ€¦"}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-xs text-emerald-600 font-medium">Auto-saving</span>
          </div>
          <span className="text-xs text-muted">Collabora Online</span>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {query.isPending && (
          <div className="flex items-center justify-center h-full gap-2 text-muted text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            Loading editorâ€¦
          </div>
        )}
        {query.isError && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-sm">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-text">Failed to load editor.</p>
            <button
              className="px-4 py-2 rounded-md bg-primary text-white text-sm hover:bg-primary"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          </div>
        )}
        {query.data?.collabora_url && (
          <iframe
            src={query.data.collabora_url}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            allowFullScreen
            title="Document Editor"
          />
        )}
      </div>
    </div>
  );
}
