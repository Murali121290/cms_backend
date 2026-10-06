import React from "react";
import { ArrowLeft, Maximize2, Minimize2, Save, LayoutDashboard, FileText } from "lucide-react";
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
}: TechnicalReviewHeaderProps) {
  const percent =
    totalFindings > 0 ? Math.min(100, Math.round((reviewedCount / totalFindings) * 100)) : 0;

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between shrink-0 z-20 shadow-xs">
      {/* Left: Navigation & Manuscript Metadata */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onBack}
          className="w-8.5 h-8.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors shrink-0 shadow-xs"
          title="Return to Chapter"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
          {chapterTitle && (
            <>
              <span className="text-slate-500 font-medium truncate hidden md:inline">
                {chapterTitle}
              </span>
              <span className="text-slate-300 hidden md:inline">/</span>
            </>
          )}
          <span className="font-bold text-slate-900 truncate" title={filename}>
            {filename}
          </span>
        </div>

        {activeStylesheetName ? (
          <div className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold shrink-0">
            <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
            <span className="truncate max-w-[180px]">{activeStylesheetName}</span>
          </div>
        ) : (
          <div className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-xs font-medium shrink-0">
            <span>No Active Stylesheet</span>
          </div>
        )}
      </div>

      {/* Live Review Progress Bar */}
      {totalFindings > 0 && (
        <div className="hidden xl:flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-full">
          <div className="w-44">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="font-semibold text-slate-700">QC Verified</span>
              <span className="font-bold text-violet-600">
                {reviewedCount} / {totalFindings} ({percent}%)
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-violet-600 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Right: Tabs & Workbench Actions */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* View Switcher Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-full border border-slate-200">
          <button
            onClick={() => onTabChange("dashboard")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-full flex items-center gap-1.5 transition-all ${
              activeTab === "dashboard"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-800 bg-transparent"
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Overview</span>
          </button>
          <button
            onClick={() => onTabChange("reviewer")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-full flex items-center gap-1.5 transition-all ${
              activeTab === "reviewer"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-800 bg-transparent"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Workspace</span>
          </button>
        </div>

        {/* Fullscreen Button */}
        <Button
          variant="secondary"
          size="sm"
          onClick={onToggleFullscreen}
          leftIcon={isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          className="hidden md:inline-flex rounded-full"
        >
          {isFullscreen ? "Exit" : "Fullscreen"}
        </Button>

        {/* Optional Save manuscript button */}
        {canSave && onSave && (
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={isSaving}
            leftIcon={isSaving ? <span className="animate-spin">⟳</span> : <Save className="w-3.5 h-3.5" />}
            className="rounded-full bg-violet-600 hover:bg-violet-500"
          >
            {isSaving ? "Saving..." : "Save Manuscript"}
          </Button>
        )}
      </div>
    </header>
  );
}
