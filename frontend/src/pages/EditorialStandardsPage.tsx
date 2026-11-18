import React, { useMemo } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Sparkles,
  BookMarked,
  CheckCircle2,
  Layers,
  User,
  Shield,
  ExternalLink,
} from "lucide-react";

import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useProjectDetailQuery } from "@/features/projects/useProjectDetailQuery";
import { useStylesheetsQuery } from "@/features/stylesheets/useStylesheetsQuery";
import { uiPaths } from "@/utils/appPaths";

import { StylesheetsPage } from "./StylesheetsPage";
import { ProjectRulesPage } from "./ProjectRulesPage";
import { ProjectTermListsPage } from "./ProjectTermListsPage";

export type EditorialTab = "stylesheets" | "rules" | "terms";

export function EditorialStandardsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const parsedProjectId = Number.parseInt(projectId ?? "", 10);
  const isValidProjectId = Number.isInteger(parsedProjectId) && parsedProjectId > 0;
  const normalizedProjectId = isValidProjectId ? parsedProjectId : null;

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab")?.toLowerCase();
  const activeTab: EditorialTab =
    rawTab === "rules" || rawTab === "terms" ? rawTab : "stylesheets";

  const projectQuery = useProjectDetailQuery(normalizedProjectId);
  const stylesheetsQuery = useStylesheetsQuery(normalizedProjectId);

  const project = projectQuery.data?.project;
  const stylesheets = stylesheetsQuery.data?.stylesheets || [];
  const activeStylesheet = stylesheetsQuery.data?.active_stylesheet;

  useDocumentTitle(
    `${activeTab === "rules"
      ? "Language Rules"
      : activeTab === "terms"
        ? "Term Lists"
        : "Stylesheets"
    } — Editorial Hub`
  );

  const handleTabChange = (tab: EditorialTab) => {
    setSearchParams({ tab });
  };

  const actualProjectCode = project?.code || project?.project_code || "";
  const projectTitle = project?.project_title || project?.title || "";

  return (
    <div className="min-h-screen bg-slate-50/50 flex flex-col">
      {/* 1. TOP HUB HEADER BAR */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Left: Back button + Project details */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => navigate(uiPaths.projectDetail(normalizedProjectId || 0))}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0"
                title="Back to Project Workflow"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 truncate">
                  <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                    Editorial Hub
                  </h1>
                  {projectTitle && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs sm:text-sm font-medium text-slate-600 truncate" title={projectTitle}>
                        {projectTitle}
                      </span>
                    </>
                  )}
                  {project?.status && (
                    <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 shrink-0">
                      {project.status}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5 sm:gap-3 text-xs text-slate-500 mt-0.5 truncate">
                  {actualProjectCode ? (
                    <span>Code: <strong className="font-mono text-slate-800">{actualProjectCode}</strong></span>
                  ) : null}
                  {actualProjectCode && project?.workflow_name ? (
                    <span className="text-slate-300">•</span>
                  ) : null}
                  {project?.workflow_name ? (
                    <span className="truncate">Workflow: <strong>{project.workflow_name}</strong></span>
                  ) : null}
                  {(actualProjectCode || project?.workflow_name) && project?.project_manager ? (
                    <span className="text-slate-300">•</span>
                  ) : null}
                  {project?.project_manager ? (
                    <span>PM: <strong>{project.project_manager}</strong></span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Right: Active Stylesheet Pill + Quick link to workflow */}
            <div className="flex items-center gap-3 shrink-0">
              {activeStylesheet ? (
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-emerald-800 font-medium">Active Stylesheet:</span>
                  <strong className="text-emerald-950 truncate max-w-[200px]">{activeStylesheet.name}</strong>
                </div>
              ) : (
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>No active stylesheet chosen</span>
                </div>
              )}

              <Link
                to={uiPaths.projectDetail(normalizedProjectId || 0)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs"
              >
                <span>Workflow Chapters</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </Link>
            </div>
          </div>

          {/* 2. MAIN HUB TAB BAR */}
          <div className="flex space-x-1 border-t border-slate-200 pt-1 -mb-px overflow-x-auto scrollbar-none">
            {/* TAB 1: STYLESHEETS */}
            <button
              type="button"
              onClick={() => handleTabChange("stylesheets")}
              className={`inline-flex items-center gap-2 px-4 py-3 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "stylesheets"
                ? "border-sky-600 text-sky-800 bg-sky-50/50"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                }`}
            >
              <BookOpen className={`w-4 h-4 ${activeTab === "stylesheets" ? "text-sky-600" : "text-slate-400"}`} />
              <span>Stylesheets &amp; CE Profiles</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${activeTab === "stylesheets"
                  ? "bg-sky-200 text-sky-900"
                  : "bg-slate-100 text-slate-600"
                  }`}
              >
                {stylesheets.length}
              </span>
            </button>

            {/* TAB 2: RULES */}
            <button
              type="button"
              onClick={() => handleTabChange("rules")}
              className={`inline-flex items-center gap-2 px-4 py-3 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "rules"
                ? "border-amber-600 text-amber-900 bg-amber-50/50"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                }`}
            >
              <Sparkles className={`w-4 h-4 ${activeTab === "rules" ? "text-amber-600" : "text-slate-400"}`} />
              <span>Language Editing Rules</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${activeTab === "rules"
                  ? "bg-amber-200 text-amber-900"
                  : "bg-slate-100 text-slate-600"
                  }`}
              >
                Catalog
              </span>
            </button>

            {/* TAB 3: TERM LISTS */}
            <button
              type="button"
              onClick={() => handleTabChange("terms")}
              className={`inline-flex items-center gap-2 px-4 py-3 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${activeTab === "terms"
                ? "border-emerald-600 text-emerald-900 bg-emerald-50/50"
                : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                }`}
            >
              <BookMarked className={`w-4 h-4 ${activeTab === "terms" ? "text-emerald-600" : "text-slate-400"}`} />
              <span>Term Lists &amp; Glossaries</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${activeTab === "terms"
                  ? "bg-emerald-200 text-emerald-900"
                  : "bg-slate-100 text-slate-600"
                  }`}
              >
                Assigned
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* 3. ACTIVE TAB PANE CONTENT */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === "stylesheets" && <StylesheetsPage embedded={true} />}
        {activeTab === "rules" && <ProjectRulesPage embedded={true} />}
        {activeTab === "terms" && <ProjectTermListsPage embedded={true} />}
      </div>
    </div>
  );
}

