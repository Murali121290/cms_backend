import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

interface CommentDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialText?: string;
  quotedText?: string;
  author?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function CommentDialog({
  open,
  mode,
  initialText = "",
  quotedText,
  author,
  onSubmit,
  onCancel,
  onDelete,
}: CommentDialogProps) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText(initialText);
      // Focus on next tick so the textarea exists in the DOM.
      const t = setTimeout(() => textareaRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, initialText]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-bold text-slate-800">
            {mode === "create" ? "Add Comment" : "Edit Comment"}
          </h3>
          {author && (
            <p className="text-[11px] text-slate-500 mt-0.5">as {author}</p>
          )}
        </div>
        <div className="p-4 space-y-3">
          {quotedText && (
            <blockquote className="text-xs text-slate-600 italic border-l-2 border-amber-400 pl-2 max-h-20 overflow-y-auto">
              "{quotedText.length > 200 ? quotedText.slice(0, 200) + "…" : quotedText}"
            </blockquote>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (text.trim()) onSubmit(text.trim());
              }
            }}
            placeholder="Write your comment…"
            rows={5}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
          />
          <p className="text-[10px] text-slate-400">⌘/Ctrl + Enter to save · Esc to cancel</p>
        </div>
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          {mode === "edit" && onDelete ? (
            <Button variant="ghost" onClick={onDelete} className="text-rose-600 hover:bg-rose-50">
              Delete
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => text.trim() && onSubmit(text.trim())}
              disabled={!text.trim()}
            >
              {mode === "create" ? "Add" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
