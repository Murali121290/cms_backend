import { Link, useParams } from "react-router-dom";
import { FileText } from "lucide-react";

import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

export function FileEditorPage() {
  const { projectId, chapterId, fileId } = useParams();
  useDocumentTitle(`File Editor — S4 Carlisle CMS`);

  return (
    <main className="page-enter px-6 py-8 max-w-3xl mx-auto w-full">
      <div className="bg-white border border-surface-200 rounded-lg p-8 shadow-sm text-center">
        <div className="w-12 h-12 bg-gold-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FileText className="w-6 h-6 text-gold-600" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-navy-900 mb-2">Document Editor</h1>
        <p className="text-sm text-navy-500 mb-6">
          The document editor for file {fileId} will be available here.
        </p>
        {projectId && chapterId ? (
          <Link
            to={uiPaths.chapterDetail(projectId, chapterId)}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-gold-600 text-white hover:bg-gold-700 border border-gold-600 shadow-subtle transition-all duration-150"
          >
            Back to Chapter
          </Link>
        ) : null}
      </div>
    </main>
  );
}
