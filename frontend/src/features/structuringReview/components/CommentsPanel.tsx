import { useState, type RefObject } from "react";
import { Check, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useCommentsQuery, useCommentMutations } from "@/features/editor/useComments";
import type { WysiwygEditorHandle } from "@/features/editor";

interface CommentsPanelProps {
  fileId: number | null;
  editorRef: RefObject<WysiwygEditorHandle | null>;
}

function formatTimestamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export function CommentsPanel({ fileId, editorRef }: CommentsPanelProps) {
  const query = useCommentsQuery(fileId);
  const mutations = useCommentMutations(fileId);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");

  const comments = query.data ?? [];

  const scrollTo = (commentUuid: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const span = dom.querySelector(`span[data-comment-id="${commentUuid}"]`);
    if (span) {
      span.scrollIntoView({ behavior: "smooth", block: "center" });
      (span as HTMLElement).style.outline = "2px solid #f97316";
      setTimeout(() => {
        (span as HTMLElement).style.outline = "";
      }, 1200);
    }
  };

  const handleDelete = (commentUuid: string) => {
    const editor = editorRef.current?.editor;
    editor?.chain().focus().removeComment(commentUuid).run();
    mutations.remove.mutate({ commentUuid });
  };

  const NewCommentButton = (
    <button
      type="button"
      onClick={() => editorRef.current?.triggerCommentDialog()}
      className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-sky-600 text-white text-xs font-medium hover:bg-sky-700"
      title="Add a comment on the currently selected text"
    >
      <Plus className="w-3.5 h-3.5" /> New comment from selection
    </button>
  );

  if (query.isLoading) {
    return (
      <div className="flex flex-col">
        <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">{NewCommentButton}</div>
        <div className="px-3 py-4 text-xs text-slate-500">Loading comments…</div>
      </div>
    );
  }
  if (!comments.length) {
    return (
      <div className="flex flex-col">
        <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">{NewCommentButton}</div>
        <div className="px-3 py-6 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
          <MessageSquare className="w-6 h-6 text-slate-300" />
          <span>No comments yet. Select text in the editor first, then click the button above.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 sticky top-0 z-10">{NewCommentButton}</div>
      <div className="flex flex-col divide-y divide-slate-200">
      {comments.map((c) => {
        const isEditing = editingUuid === c.comment_uuid;
        return (
          <div key={c.comment_uuid} className={`px-3 py-2.5 ${c.resolved ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-700 truncate">
                    {c.author_name || "Unknown"}
                  </span>
                  <span className="text-[10px] text-slate-400">{formatTimestamp(c.created_at)}</span>
                  {c.resolved && (
                    <span className="text-[9px] uppercase tracking-wider bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                      Resolved
                    </span>
                  )}
                </div>
                {isEditing ? (
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={3}
                    className="mt-1.5 w-full text-xs px-2 py-1.5 border border-slate-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                ) : (
                  <p
                    className="mt-1 text-xs text-slate-700 whitespace-pre-wrap break-words cursor-pointer hover:text-slate-900"
                    onClick={() => scrollTo(c.comment_uuid)}
                    title="Jump to this comment in the document"
                  >
                    {c.text || <span className="italic text-slate-400">(empty)</span>}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[11px]">
              {isEditing ? (
                <>
                  <button
                    onClick={() => {
                      if (draftText.trim()) {
                        mutations.update.mutate({ commentUuid: c.comment_uuid, text: draftText.trim() });
                      }
                      setEditingUuid(null);
                    }}
                    className="px-2 py-0.5 rounded bg-sky-600 text-white hover:bg-sky-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingUuid(null)}
                    className="px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setEditingUuid(c.comment_uuid);
                      setDraftText(c.text || "");
                    }}
                    className="px-1.5 py-0.5 rounded hover:bg-slate-100 text-slate-600 inline-flex items-center gap-1"
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  <button
                    onClick={() =>
                      mutations.update.mutate({ commentUuid: c.comment_uuid, resolved: !c.resolved })
                    }
                    className="px-1.5 py-0.5 rounded hover:bg-slate-100 text-slate-600 inline-flex items-center gap-1"
                    title={c.resolved ? "Reopen" : "Mark resolved"}
                  >
                    <Check className="w-3 h-3" /> {c.resolved ? "Reopen" : "Resolve"}
                  </button>
                  <button
                    onClick={() => handleDelete(c.comment_uuid)}
                    className="px-1.5 py-0.5 rounded hover:bg-rose-50 text-rose-600 inline-flex items-center gap-1 ml-auto"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
