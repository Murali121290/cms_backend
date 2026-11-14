import React from "react";
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  Save,
  LayoutDashboard,
  FileText,
  CheckCheck,
  PanelRightClose,
  PanelRightOpen,
  Eye,
  FileCode,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface TechnicalReviewHeaderProps {
  filename: string;
  chapterTitle?: string;
  activeStylesheetName?: string | null;
  activeTab: "dashboard" | "reviewer";
  onTabChange: (tab: "dashboard" | "reviewer") => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onBack: () => void;
  isSaving?: boolean;
  onSave?: () => void;
  canSave?: boolean;
  reviewedCount?: number;
  totalFindings?: number;
  displayMode?: "highlights" | "diff" | "clean";
  onDisplayModeChange?: (mode: "highlights" | "diff" | "clean") => void;
  batchFixCount?: number;
  onBatchFix?: () => void;
  onToggleRightSidebar?: () => void;
  rightSidebarCollapsed?: boolean;
  /** Occurrences already in house style (hidden from the list by the backend). */
  compliantHidden?: number;
  /** Where the rules came from: "stylesheet.json" | "database" | "preset". */
  stylesheetSource?: string | null;
}

export function TechnicalReviewHeader({
  filename,
  chapterTitle,
  activeStylesheetName,
  activeTab,
  onTabChange,
  isFullscreen,
  onToggleFullscreen,
  onBack,
  isSaving = false,
  onSave,
  canSave = false,
  reviewedCount = 0,
  totalFindings = 0,
  displayMode = "highlights",
  onDisplayModeChange,
  batchFixCount = 0,
  onBatchFix,
  onToggleRightSidebar,
  rightSidebarCollapsed = false,
  compliantHidden = 0,
  stylesheetSource = null,
}: TechnicalReviewHeaderProps) {
  const percent =
    totalFindings > 0 ? Math.min(100, Math.round((reviewedCount / totalFindings) * 100)) : 0;

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-3 sm:px-5 flex items-center justify-between shrink-0 z-30 shadow-xs">
      {/* Left: Navigation & Manuscript Metadata */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          onClick={onBack}
          className="w-8.5 h-8.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors shrink-0 shadow-xs cursor-pointer"
          title="Return to Chapter"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
          {chapterTitle && (
            <>
              <span className="text-slate-500 font-medium truncate hidden md:inline max-w-[140px]">
                {chapterTitle}
              </span>
              <span className="text-slate-300 hidden md:inline">/</span>
            </>
          )}
          <span className="font-bold text-slate-900 truncate max-w-[200px]" title={filename}>
            {filename}
          </span>
        </div>

        {activeStylesheetName ? (
          <div className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="truncate max-w-[180px]" title={stylesheetSource ? `Rules from ${stylesheetSource}` : undefined}>
              {activeStylesheetName}
            </span>
          </div>
        ) : (
          <div className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-medium shrink-0">
            <span>No Active Stylesheet</span>
          </div>
        )}
        {compliantHidden > 0 && (
          <div
            className="hidden lg:inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600 text-[11px] font-medium shrink-0"
            title="Occurrences already in the selected house style are not listed"
          >
            {compliantHidden} already in house style (hidden)
          </div>
        )}
      </div>

      {/* Center: Live QC Progress Meter */}
      {totalFindings > 0 && (
        <div className="hidden xl:flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-full shadow-2xs">
          <div className="w-40">
            <div className="flex justify-between text-[10.5px] mb-1">
              <span className="font-semibold text-slate-700">QC Verified</span>
              <span className="font-bold text-indigo-600">
                {reviewedCount} / {totalFindings} ({percent}%)
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-indigo-600 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Right: Display Modes & Workbench Actions */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* Three Display Modes Switcher (Highlights / Diff / Clean) */}
        {activeTab === "reviewer" && onDisplayModeChange && (
          <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-semibold">
            <button
              type="button"
              onClick={() => onDisplayModeChange("highlights")}
              className={`px-2.5 py-1 rounded text-[11px] transition-all cursor-pointer ${
                displayMode === "highlights"
                  ? "bg-white text-slate-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="View manuscript with interactive finding highlights"
            >
              Highlights
            </button>
            <button
              type="button"
              onClick={() => onDisplayModeChange("diff")}
              className={`px-2.5 py-1 rounded text-[11px] transition-all cursor-pointer ${
                displayMode === "diff"
                  ? "bg-white text-slate-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Track changes view showing additions and deletions"
            >
              Track Changes (Diff)
            </button>
            <button
              type="button"
              onClick={() => onDisplayModeChange("clean")}
              className={`px-2.5 py-1 rounded text-[11px] transition-all cursor-pointer ${
                displayMode === "clean"
                  ? "bg-white text-slate-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Clean preview of the manuscript with accepted house style fixes"
            >
              Clean View
            </button>
          </div>
        )}

        {/* Batch Auto-Fix Button */}
        {activeTab === "reviewer" && onBatchFix && batchFixCount > 0 && (
          <button
            type="button"
            onClick={onBatchFix}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer"
            title={`Auto-apply house style fixes for ${batchFixCount} routine occurrences`}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Batch Auto-Fix</span>
            <span className="bg-emerald-500/50 px-1 rounded text-[10px]">{batchFixCount}</span>
          </button>
        )}

        {/* Workspace vs Overview Switcher */}
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => onTabChange("reviewer")}
            className={`px-2.5 py-1 text-xs font-bold rounded flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "reviewer"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden md:inline">Workspace</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange("dashboard")}
            className={`px-2.5 py-1 text-xs font-bold rounded flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "dashboard"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Overview</span>
          </button>
        </div>

        {/* Save / Apply Manuscript Button */}
        {canSave && onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            title="Save edits directly to DOCX file"
          >
            {isSaving ? (
              <span className="animate-spin text-emerald-400">⟳</span>
            ) : (
              <Save className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className="hidden sm:inline">Apply &amp; Export</span>
          </button>
        )}

        {/* Fullscreen Button */}
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer hidden md:flex items-center justify-center"
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* Toggle Right Dock Collapse */}
        {onToggleRightSidebar && (
          <button
            type="button"
            onClick={onToggleRightSidebar}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            title={rightSidebarCollapsed ? "Expand Right Tools Dock" : "Collapse Right Tools Dock"}
          >
            {rightSidebarCollapsed ? (
              <PanelRightOpen className="w-4 h-4 text-indigo-600" />
            ) : (
              <PanelRightClose className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </header>
  );
}
