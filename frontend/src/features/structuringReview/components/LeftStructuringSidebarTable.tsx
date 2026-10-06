import { useContext, useEffect, useLayoutEffect, useRef, useState, createContext } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Clock, FileText, Layers, MessageSquare, X } from "lucide-react";

import type { WysiwygEditorHandle } from "@/features/editor";
import { CommentsPanel } from "./CommentsPanel";
import { StylesPanel } from "./EditorStylesPanel";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

// Same toolbar-popover pattern used by StructuringReviewPage.tsx (PARA / CHAR /
// GROUP / HISTORY / COMMENTS buttons). That page keeps this helper local and
// unexported, so it's reproduced here rather than importing it — the legacy
// page itself stays untouched.
const ToolbarPopoverContext = createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
}>({ openId: null, setOpenId: () => {} });

function ToolbarPopoverGroup({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ToolbarPopoverContext.Provider value={{ openId, setOpenId }}>
      {children}
    </ToolbarPopoverContext.Provider>
  );
}

interface ToolbarPopoverProps {
  id: string;
  icon: React.ReactNode;
  label: string;
  title?: string;
  sticky?: boolean;
  width?: number;
  hideHeader?: boolean;
  children: React.ReactNode;
}

function ToolbarPopover({ id, icon, label, title, sticky, width = 320, hideHeader, children }: ToolbarPopoverProps) {
  const { openId, setOpenId } = useContext(ToolbarPopoverContext);
  const open = openId === id;
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + 6;
    const maxHeight = Math.max(200, window.innerHeight - top - 24);
    setPos({ top, right: window.innerWidth - rect.right, maxHeight });
  }, [open]);

  useEffect(() => {
    if (!open || sticky) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpenId(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, sticky, setOpenId]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpenId(open ? null : id)}
        title={title ?? label}
        className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border shrink-0 inline-flex items-center gap-1.5 transition-all duration-150 cursor-pointer ${
          open
            ? "bg-amber-600 text-white border-amber-500"
            : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-slate-100"
        }`}
      >
        {icon}
        {label}
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, right: pos.right, width, maxHeight: pos.maxHeight }}
          className="z-50 bg-white border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        >
          {!hideHeader && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-slate-50 shrink-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text inline-flex items-center gap-1.5">
                {icon}
                {title ?? label}
              </span>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="p-1 rounded hover:bg-slate-200 text-muted hover:text-text cursor-pointer border-none bg-transparent"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

interface LeftStructuringSidebarTableProps {
  fileId: number | null;
  allStyles: string[];
  charStyles?: string[];
  onAddStyle: (newStyle: string) => void;
  editorRef: RefObject<WysiwygEditorHandle | null>;
  onOpenVersion: (versionId: number) => void;
}

// Same PARA / CHAR / GROUP / HISTORY / COMMENTS toolbar buttons as
// StructuringReviewPage.tsx, packaged for use as the new unified page's
// `toolbarExtras`. Full feature parity by reusing the same panel components.
export function LeftStructuringSidebarTable({
  fileId,
  allStyles,
  charStyles,
  onAddStyle,
  editorRef,
  onOpenVersion,
}: LeftStructuringSidebarTableProps) {
  return (
    <ToolbarPopoverGroup>
      <ToolbarPopover id="comments" icon={<MessageSquare className="w-3.5 h-3.5" />} label="Comments" title="Comments" sticky width={360}>
        <CommentsPanel fileId={fileId} editorRef={editorRef} />
      </ToolbarPopover>
      <ToolbarPopover id="para" icon={<FileText className="w-3.5 h-3.5" />} label="Para" title="Paragraph Styles" sticky width={320}>
        <StylesPanel
          styles={allStyles}
          editorRef={editorRef}
          onAddStyle={onAddStyle}
          fileId={fileId}
          charStyles={charStyles}
          visibleTabs={["paragraph"]}
        />
      </ToolbarPopover>
      <ToolbarPopover id="char" icon={<BookOpen className="w-3.5 h-3.5" />} label="Char" title="Character Styles" sticky width={320}>
        <StylesPanel
          styles={allStyles}
          editorRef={editorRef}
          onAddStyle={onAddStyle}
          fileId={fileId}
          charStyles={charStyles}
          visibleTabs={["character"]}
        />
      </ToolbarPopover>
      <ToolbarPopover id="group" icon={<Layers className="w-3.5 h-3.5" />} label="Group" title="Document Elements" sticky width={360}>
        <StylesPanel
          styles={allStyles}
          editorRef={editorRef}
          onAddStyle={onAddStyle}
          fileId={fileId}
          charStyles={charStyles}
          visibleTabs={["group"]}
        />
      </ToolbarPopover>
      <ToolbarPopover id="history" icon={<Clock className="w-3.5 h-3.5" />} label="History" title="Version History" width={320} hideHeader>
        <VersionHistoryPanel
          fileId={fileId}
          currentFileId={fileId ?? 0}
          defaultExpanded
          onOpenVersion={onOpenVersion}
        />
      </ToolbarPopover>
    </ToolbarPopoverGroup>
  );
}
