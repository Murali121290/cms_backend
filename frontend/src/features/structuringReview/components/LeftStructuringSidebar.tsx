import { useState, type RefObject } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Clock, FileText, Layers, MessageSquare, X } from "lucide-react";

import type { WysiwygEditorHandle } from "@/features/editor";
import { CommentsPanel } from "./CommentsPanel";
import { StylesPanel } from "./EditorStylesPanel";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

export type StructuringTabId = "comments" | "para" | "char" | "group" | "history";

export interface LeftStructuringSidebarProps {
  fileId: number | null;
  allStyles: string[];
  charStyles?: string[];
  onAddStyle: (newStyle: string) => void;
  editorRef: RefObject<WysiwygEditorHandle | null>;
  onOpenVersion: (versionId: number) => void;
  defaultActiveTab?: StructuringTabId | null;
  className?: string;
}

export function LeftStructuringSidebar({
  fileId,
  allStyles,
  charStyles,
  onAddStyle,
  editorRef,
  onOpenVersion,
  defaultActiveTab = "comments",
  className = "",
}: LeftStructuringSidebarProps) {
  const [activeTab, setActiveTab] = useState<StructuringTabId | null>(defaultActiveTab);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  const handleTabClick = (tabId: StructuringTabId) => {
    if (activeTab === tabId && !isCollapsed) {
      setIsCollapsed(true);
    } else {
      setActiveTab(tabId);
      setIsCollapsed(false);
    }
  };

  const toggleCollapse = () => {
    setIsCollapsed((prev) => !prev);
  };

  const isPanelOpen = activeTab !== null && !isCollapsed;

  const getTabTitle = (tab: StructuringTabId) => {
    switch (tab) {
      case "comments":
        return { title: "Comments & Annotations", icon: <MessageSquare className="w-4 h-4 text-blue-600" /> };
      case "para":
        return { title: "Paragraph Styles", icon: <FileText className="w-4 h-4 text-purple-600" /> };
      case "char":
        return { title: "Character Styles", icon: <BookOpen className="w-4 h-4 text-emerald-600" /> };
      case "group":
        return { title: "Document Elements", icon: <Layers className="w-4 h-4 text-amber-600" /> };
      case "history":
        return { title: "Version History", icon: <Clock className="w-4 h-4 text-slate-600" /> };
    }
  };

  return (
    <aside className={`flex shrink-0 bg-slate-900 border-r border-slate-800 text-slate-300 shadow-xl z-20 select-none ${className}`}>
      {/* 1. Vertical Icon Rail */}
      <div className="w-14 bg-[#090d16] flex flex-col items-center py-3 gap-2.5 border-r border-slate-800 shrink-0">
        <div className="text-[9px] font-bold text-slate-500 tracking-wider uppercase mb-1">Tabs</div>

        <button
          type="button"
          onClick={() => handleTabClick("comments")}
          title="Comments"
          className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold uppercase transition-all cursor-pointer ${
            activeTab === "comments" && !isCollapsed
              ? "bg-blue-600 text-white shadow-md shadow-blue-900/40"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Comments</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabClick("para")}
          title="Paragraph Styles"
          className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold uppercase transition-all cursor-pointer ${
            activeTab === "para" && !isCollapsed
              ? "bg-purple-600 text-white shadow-md shadow-purple-900/40"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Para</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabClick("char")}
          title="Character Styles"
          className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold uppercase transition-all cursor-pointer ${
            activeTab === "char" && !isCollapsed
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/40"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Char</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabClick("group")}
          title="Document Elements & Grouping"
          className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold uppercase transition-all cursor-pointer ${
            activeTab === "group" && !isCollapsed
              ? "bg-amber-600 text-white shadow-md shadow-amber-900/40"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Group</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabClick("history")}
          title="Version History"
          className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold uppercase transition-all cursor-pointer ${
            activeTab === "history" && !isCollapsed
              ? "bg-slate-700 text-white shadow-md shadow-slate-900/40"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>History</span>
        </button>

        <div className="mt-auto pt-2 border-t border-slate-800/80 w-full flex justify-center">
          <button
            type="button"
            onClick={toggleCollapse}
            title={isCollapsed ? "Expand Sidebar Panel" : "Collapse Sidebar Panel"}
            className="w-10 h-10 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer border-none bg-transparent"
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 2. Docked Active Panel Drawer */}
      <div
        className={`transition-all duration-200 ease-in-out bg-white text-slate-800 flex flex-col overflow-hidden border-r border-slate-200 ${
          isPanelOpen ? "w-80 opacity-100" : "w-0 opacity-0 border-r-0 pointer-events-none"
        }`}
      >
        {activeTab && (
          <>
            {/* Panel Header */}
            <div className="h-10 px-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
              <span className="font-bold text-[11px] uppercase tracking-wider text-slate-700 inline-flex items-center gap-2">
                {getTabTitle(activeTab).icon}
                {getTabTitle(activeTab).title}
              </span>
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 cursor-pointer border-none bg-transparent"
                title="Collapse Panel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Panel Content Body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {activeTab === "comments" && (
                <CommentsPanel fileId={fileId} editorRef={editorRef} />
              )}
              {activeTab === "para" && (
                <StylesPanel
                  styles={allStyles}
                  editorRef={editorRef}
                  onAddStyle={onAddStyle}
                  fileId={fileId}
                  charStyles={charStyles}
                  visibleTabs={["paragraph"]}
                />
              )}
              {activeTab === "char" && (
                <StylesPanel
                  styles={allStyles}
                  editorRef={editorRef}
                  onAddStyle={onAddStyle}
                  fileId={fileId}
                  charStyles={charStyles}
                  visibleTabs={["character"]}
                />
              )}
              {activeTab === "group" && (
                <StylesPanel
                  styles={allStyles}
                  editorRef={editorRef}
                  onAddStyle={onAddStyle}
                  fileId={fileId}
                  charStyles={charStyles}
                  visibleTabs={["group"]}
                />
              )}
              {activeTab === "history" && (
                <VersionHistoryPanel
                  fileId={fileId}
                  currentFileId={fileId ?? 0}
                  defaultExpanded
                  onOpenVersion={onOpenVersion}
                />
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
