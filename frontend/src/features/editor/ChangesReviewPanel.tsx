import React, { useEffect, useState, useCallback } from "react";
import { Check, X, User } from "lucide-react";
import { collectChanges } from "./TrackChanges";

interface ChangesReviewPanelProps {
  editor: any;
}

export function ChangesReviewPanel({ editor }: ChangesReviewPanelProps) {
  const [changes, setChanges] = useState<any[]>([]);

  const updateChanges = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    try {
      const docChanges = collectChanges(editor.state.doc);
      setChanges(docChanges);
    } catch (e) {
      console.error("Failed to collect changes", e);
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", updateChanges);
    editor.on("selectionUpdate", updateChanges);
    updateChanges();

    return () => {
      editor.off("update", updateChanges);
      editor.off("selectionUpdate", updateChanges);
    };
  }, [editor, updateChanges]);

  if (!editor) return null;

  const handleJumpTo = (from: number, to: number) => {
    editor.commands.focus();
    editor.commands.setTextSelection({ from, to });
    try {
      const domInfo = editor.view.domAtPos(from);
      const el = domInfo.node.nodeType === Node.TEXT_NODE
        ? domInfo.node.parentElement
        : (domInfo.node as Element);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      // ignore
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col h-full text-slate-200">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
        <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
          Tracked Changes ({changes.length})
        </h4>
        {changes.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                editor.commands.acceptAllChanges();
                updateChanges();
              }}
              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[9px] font-bold uppercase transition-colors cursor-pointer"
            >
              Accept All
            </button>
            <button
              onClick={() => {
                editor.commands.rejectAllChanges();
                updateChanges();
              }}
              className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[9px] font-bold uppercase transition-colors cursor-pointer"
            >
              Reject All
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-0">
        {changes.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs font-semibold">
            No tracked changes found in the document.
          </div>
        ) : (
          changes.map((change, idx) => {
            const isIns = change.type === "ins";
            return (
              <div
                key={idx}
                onClick={() => handleJumpTo(change.from, change.to)}
                className={`p-3 rounded-lg border text-xs cursor-pointer transition-all duration-200 bg-slate-950 ${
                  isIns
                    ? "border-emerald-950/60 hover:border-emerald-500/50"
                    : "border-rose-950/60 hover:border-rose-500/50"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5 font-sans">
                  <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide ${
                    isIns
                      ? "bg-emerald-950/40 text-emerald-400 border border-emerald-800/40"
                      : "bg-rose-950/40 text-rose-400 border border-rose-800/40"
                  }`}>
                    {isIns ? "Inserted" : "Deleted"}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(change.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </span>
                </div>

                <p className="text-slate-200 font-medium mb-3 leading-relaxed break-words font-sans">
                  {change.text || "Empty text"}
                </p>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-900/60 font-sans">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1 font-semibold truncate max-w-[50%]">
                    <User className="w-3 h-3 text-slate-500" />
                    {change.author}
                  </span>
                  <span className="ml-auto" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      editor.commands.acceptChange(change.from);
                      updateChanges();
                    }}
                    className="p-1 hover:bg-slate-800 text-emerald-400 rounded transition-colors cursor-pointer"
                    title="Accept change"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      editor.commands.rejectChange(change.from);
                      updateChanges();
                    }}
                    className="p-1 hover:bg-slate-800 text-rose-400 rounded transition-colors cursor-pointer"
                    title="Reject change"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
