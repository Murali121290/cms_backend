import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  BookOpen,
  CalendarDays,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  RotateCcw,
  User,
  Users,
  ShieldCheck,
  Briefcase,
  Layers,
  ChevronDown,
  ChevronRight,
  X,
  Sparkles,
  LayoutGrid,
  List,
} from "lucide-react";
import api from "@/api/client";
import { projectsApi } from "@/api/projects";
import { useAuthStore } from "@/store/useAuthStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useRBAC } from "@/hooks/useRBAC";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";

interface StageDetailRecord {
  id: number;
  client: string;
  project: string;
  chapters: string;
  stage_name: string;
  stage_status: string;
  assignee_name: string | null;
  project_manager_name: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  workflow: string | null;
}

interface ProjectRecord {
  id: number;
  code: string;
  title: string;
  client_name: string | null;
  project_manager: string | null;
  status: string;
  created_at: string | null;
  due_date: string | null;
  chapter_count: number;
  manuscript_pages: number | null;
  workflow_name: string | null;
}

interface UserLookup {
  id?: number;
  username: string;
  full_name: string;
  role?: string;
  team?: string;
}

export interface ChapterStageInfo {
  id: number;
  stageName: string;
  stageStatus: string;
  assignee: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string;
  actualEnd: string;
  isDelayed: boolean;
  delayDays: number;
  completedWithDelay: boolean;
  isCompleted: boolean;
  isInProgress: boolean;
  isTodayPlanned: boolean;
  isYts: boolean;
  status: string;
}

export interface ChapterRow {
  chapter: string;
  trackType: "chapter" | "art" | "design" | "support";
  currentStage: string;
  assignee: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string;
  actualEnd: string;
  delayDays: number;
  isDelayed: boolean;
  isInProgress: boolean;
  isCompleted: boolean;
  isYts: boolean;
  isTodayPlanned: boolean;
  status: string;
  delayedStages: { stageName: string; delayDays: number; wasCompletedWithDelay?: boolean }[];
  stages: ChapterStageInfo[];
}

export default function MyWorkReport() {
  const navigate = useNavigate();
  const sessionViewer = useSessionStore((s) => s.viewer);
  const authUser = useAuthStore((s) => s.user);
  const rbac = useRBAC();

  const [loading, setLoading] = useState(true);
  const [projectsList, setProjectsList] = useState<ProjectRecord[]>([]);
  const [stageDetails, setStageDetails] = useState<StageDetailRecord[]>([]);
  const [usersLookup, setUsersLookup] = useState<UserLookup[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [adminPmFilter, setAdminPmFilter] = useState<string>("all");
  const [trackFilter, setTrackFilter] = useState<string>("all");
  const [activeModalChapter, setActiveModalChapter] = useState<ChapterRow | null>(null);

  // Track Type categorization helper
  const getTrackType = useCallback((chName: string): "chapter" | "art" | "design" | "support" => {
    const clean = (chName || "").trim().toLowerCase();
    if (clean.includes("art")) return "art";
    if (clean.includes("design")) return "design";
    if (clean.includes("ce support") || clean.includes("support")) return "support";
    return "chapter";
  }, []);

  // Determine user identity & roles
  const userInfo = useMemo(() => {
    const sessionRoles = sessionViewer?.roles || [];
    const authStoreRoles = (authUser?.roles || []).map((r) =>
      typeof r === "string" ? r : (r as any).name || ""
    );
    const userRoleStr = (authUser as any)?.role || (sessionViewer as any)?.role || "";
    const allRoles = Array.from(new Set([...sessionRoles, ...authStoreRoles, userRoleStr])).filter(Boolean);

    const isAdmin =
      rbac.isAdmin ||
      allRoles.some((r) => {
        const low = r.toLowerCase();
        return low.includes("admin");
      });

    const userTeam = sessionViewer?.team || (authUser as any)?.team || "";
    const userDesignation = (sessionViewer as any)?.designation || (authUser as any)?.designation || "";

    const isProjectManagement =
      userTeam.toLowerCase().includes("project management") ||
      userTeam.toLowerCase().includes("management") ||
      allRoles.some((r) => {
        const low = r.toLowerCase();
        return low.includes("project manager") || low.includes("project management") || low.includes("pm");
      }) ||
      userDesignation.toLowerCase().includes("project manager") ||
      userDesignation.toLowerCase().includes("management");

    const fullName =
      [sessionViewer?.first_name || authUser?.first_name, sessionViewer?.last_name || authUser?.last_name]
        .filter(Boolean)
        .join(" ") ||
      sessionViewer?.username ||
      authUser?.username ||
      "Logged In User";

    const username = sessionViewer?.username || authUser?.username || "";
    const userId = sessionViewer?.id || authUser?.id || null;

    return {
      fullName,
      username,
      userId,
      roles: allRoles,
      team: userTeam || (isAdmin ? "Administration" : "Project Management"),
      designation: userDesignation,
      isAdmin,
      isProjectManagement,
      canAccess: isAdmin || isProjectManagement,
    };
  }, [authUser, sessionViewer, rbac]);

  // Fetch data
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      try {
        setLoading(true);
        const [projectsRes, detailsRes, usersRes] = await Promise.all([
          projectsApi.list(0, 1000).catch(() => ({ projects: [] })),
          api.get<StageDetailRecord[]>("/api/v1/stage-details?limit=1000000").then((r) => r.data).catch(() => []),
          api.get<UserLookup[]>("/api/v1/users-lookup").then((r) => r.data).catch(() => []),
        ]);

        if (isMounted) {
          const list = (projectsRes.projects || []) as ProjectRecord[];
          setProjectsList(list);
          setStageDetails(Array.isArray(detailsRes) ? detailsRes : []);
          setUsersLookup(Array.isArray(usersRes) ? usersRes : []);

          // Auto-select first project if available
          if (list.length > 0 && selectedProjectId === null) {
            setSelectedProjectId(list[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to load My Projects data:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Format user display name (First + Last Name)
  const getUserDisplayName = useCallback(
    (identifier: string | null | undefined): string => {
      if (!identifier || identifier === "—" || identifier.toLowerCase() === "unassigned") {
        return "—";
      }
      const raw = identifier.trim();
      const match = usersLookup.find(
        (u) =>
          u.username?.toLowerCase() === raw.toLowerCase() ||
          String(u.id) === raw ||
          (u.full_name && u.full_name.toLowerCase() === raw.toLowerCase())
      );
      if (match && match.full_name) {
        return match.full_name;
      }
      return raw;
    },
    [usersLookup]
  );

  // Filter projects by PM ownership
  const myProjects = useMemo(() => {
    if (!userInfo.canAccess) return [];

    return projectsList.filter((p) => {
      if (userInfo.isAdmin) {
        if (adminPmFilter !== "all") {
          const pmRaw = (p.project_manager || "").trim().toLowerCase();
          return pmRaw === adminPmFilter.toLowerCase();
        }
        return true;
      }

      // Non-admin PM: must match logged-in PM
      const rawPm = (p.project_manager || "").trim().toLowerCase();
      if (!rawPm) return false;

      const currentUsername = userInfo.username.trim().toLowerCase();
      const currentFullName = userInfo.fullName.trim().toLowerCase();
      const currentId = String(userInfo.userId);

      if (rawPm === currentUsername || rawPm === currentFullName || rawPm === currentId) {
        return true;
      }

      // Check if rawPm matches user's lookup info
      const pmUser = usersLookup.find(
        (u) =>
          u.username.toLowerCase() === rawPm ||
          String(u.id) === rawPm ||
          (u.full_name && u.full_name.toLowerCase() === rawPm)
      );

      if (pmUser) {
        if (
          pmUser.username.toLowerCase() === currentUsername ||
          pmUser.full_name.toLowerCase() === currentFullName ||
          String(pmUser.id) === currentId
        ) {
          return true;
        }
      }

      return false;
    });
  }, [projectsList, userInfo, adminPmFilter, usersLookup]);

  // Project code to chapter stages mapping
  const projectStagesMap = useMemo(() => {
    const map = new Map<string, StageDetailRecord[]>();
    for (const d of stageDetails) {
      if (!map.has(d.project)) {
        map.set(d.project, []);
      }
      map.get(d.project)!.push(d);
    }
    return map;
  }, [stageDetails]);

  // Project statistics & computed attributes
  const enrichedProjects = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];

    return myProjects.map((p) => {
      const code = p.code || (p as any).project_code || "";
      const details = projectStagesMap.get(code) || [];

      // Check if any stage is delayed
      const hasDelayedStage = details.some((d) => {
        const sEnd = d.planned_end_date ? d.planned_end_date.split("T")[0] : "";
        const aEnd = d.actual_end_date ? d.actual_end_date.split("T")[0] : "";
        return sEnd && sEnd < todayStr && !aEnd;
      });

      // Chapter counts & completion
      const chapterSet = new Set(details.map((d) => d.chapters).filter(Boolean));
      const totalChapters = p.chapter_count || chapterSet.size || 0;

      // Group stages by chapter to determine active stage per chapter
      const chapterGroups = new Map<string, StageDetailRecord[]>();
      for (const d of details) {
        if (!chapterGroups.has(d.chapters)) chapterGroups.set(d.chapters, []);
        chapterGroups.get(d.chapters)!.push(d);
      }

      let completedChapters = 0;
      let manuscriptCount = 0;
      let artCount = 0;
      let designCount = 0;
      let supportCount = 0;
      let completedManuscripts = 0;

      chapterGroups.forEach((items, chName) => {
        const type = getTrackType(chName);
        const allCompleted = items.length > 0 && items.every((i) => {
          const st = (i.stage_status || "").toLowerCase();
          return st === "completed" || st === "complete" || Boolean(i.actual_end_date);
        });
        if (allCompleted) completedChapters++;

        if (type === "chapter") {
          manuscriptCount++;
          if (allCompleted) completedManuscripts++;
        } else if (type === "art") {
          artCount++;
        } else if (type === "design") {
          designCount++;
        } else if (type === "support") {
          supportCount++;
        }
      });

      const pStatus = (p.status || "").toLowerCase();
      const isPlanning = pStatus === "planning" || (!hasDelayedStage && details.length === 0);
      const isCompleted = !isPlanning && (pStatus === "completed" || pStatus === "complete" || (totalChapters > 0 && completedChapters === totalChapters));
      const isDelayed = !isPlanning && hasDelayedStage && !isCompleted;
      const isInProgress = !isPlanning && !isCompleted && !isDelayed;

      return {
        ...p,
        projectCode: code,
        pmDisplayName: getUserDisplayName(p.project_manager),
        hasDelayedStage,
        completedChapters,
        totalChapters,
        manuscriptCount,
        artCount,
        designCount,
        supportCount,
        completedManuscripts,
        isPlanning,
        isCompleted,
        isDelayed,
        isInProgress,
        details,
      };
    });
  }, [myProjects, projectStagesMap, getUserDisplayName, getTrackType]);

  // Selected project object
  const selectedProject = useMemo(() => {
    if (!selectedProjectId) {
      return enrichedProjects[0] || null;
    }
    return enrichedProjects.find((p) => p.id === selectedProjectId) || enrichedProjects[0] || null;
  }, [enrichedProjects, selectedProjectId]);

  // Overall KPIs
  const kpis = useMemo(() => {
    const total = enrichedProjects.length;
    const planning = enrichedProjects.filter((p) => p.isPlanning).length;
    const delayed = enrichedProjects.filter((p) => p.isDelayed).length;
    const inProgress = enrichedProjects.filter((p) => p.isInProgress).length;
    const completed = enrichedProjects.filter((p) => p.isCompleted).length;

    return { total, planning, delayed, inProgress, completed };
  }, [enrichedProjects]);

  // Filtered list based on search and status
  const filteredProjects = useMemo(() => {
    let result = enrichedProjects;

    if (statusFilter === "inProgress") {
      result = result.filter((p) => p.isInProgress);
    } else if (statusFilter === "delayed") {
      result = result.filter((p) => p.isDelayed);
    } else if (statusFilter === "completed") {
      result = result.filter((p) => p.isCompleted);
    } else if (statusFilter === "planning") {
      result = result.filter((p) => p.isPlanning);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      result = result.filter((p) => {
        return (
          p.projectCode.toLowerCase().includes(q) ||
          p.title.toLowerCase().includes(q) ||
          (p.client_name && p.client_name.toLowerCase().includes(q)) ||
          p.pmDisplayName.toLowerCase().includes(q)
        );
      });
    }

    return result;
  }, [enrichedProjects, statusFilter, searchTerm]);

  // Unique PMs for Admin Filter
  const pmOptions = useMemo(() => {
    const pms = new Set<string>();
    projectsList.forEach((p) => {
      if (p.project_manager) pms.add(p.project_manager);
    });
    return Array.from(pms).map((raw) => ({
      raw,
      displayName: getUserDisplayName(raw),
    }));
  }, [projectsList, getUserDisplayName]);

  // Selected project chapter details breakdown
  const selectedProjectChapterRows = useMemo<ChapterRow[]>(() => {
    if (!selectedProject) return [];
    const todayStr = new Date().toISOString().split("T")[0];
    const details = selectedProject.details || [];

    // Group by chapter
    const groups = new Map<string, StageDetailRecord[]>();
    for (const d of details) {
      const ch = d.chapters || "Main";
      if (!groups.has(ch)) groups.set(ch, []);
      groups.get(ch)!.push(d);
    }

    const rows: ChapterRow[] = [];

    groups.forEach((items, ch) => {
      // Sort by stage sequence / id
      const sorted = [...items].sort((a, b) => (a.id || 0) - (b.id || 0));

      // Process all stages for this chapter
      const chapterStages: ChapterStageInfo[] = sorted.map((s) => {
        const sStart = s.planned_start_date ? s.planned_start_date.split("T")[0] : "—";
        const sEnd = s.planned_end_date ? s.planned_end_date.split("T")[0] : "—";
        const aStart = s.actual_start_date ? s.actual_start_date.split("T")[0] : "—";
        const aEnd = s.actual_end_date ? s.actual_end_date.split("T")[0] : "—";

        // Completed stage delayed check: actualEnd > plannedEnd
        const isCompleted = Boolean(aEnd !== "—" || (s.stage_status || "").toLowerCase() === "completed");
        const completedWithDelay = Boolean(isCompleted && sEnd !== "—" && aEnd !== "—" && aEnd > sEnd);

        // Open stage delayed check: today > plannedEnd and not completed
        const isCurrentlyDelayed = Boolean(!isCompleted && sEnd !== "—" && sEnd < todayStr);

        let delayDays = 0;
        if (isCurrentlyDelayed && sEnd !== "—") {
          const diff = Math.floor((new Date(todayStr).getTime() - new Date(sEnd).getTime()) / (1000 * 60 * 60 * 24));
          delayDays = diff > 0 ? diff : 0;
        } else if (completedWithDelay && sEnd !== "—" && aEnd !== "—") {
          const diff = Math.floor((new Date(aEnd).getTime() - new Date(sEnd).getTime()) / (1000 * 60 * 60 * 24));
          delayDays = diff > 0 ? diff : 0;
        }

        const isDelayed = isCurrentlyDelayed || completedWithDelay;
        const isInProgress = Boolean(aStart !== "—" && !isCompleted);
        const isTodayPlanned = Boolean(sStart === todayStr && aStart === "—" && !isCompleted);
        const isYts = Boolean(aStart === "—" && !isCompleted && sEnd >= todayStr);

        const status = isCurrentlyDelayed
          ? "Delayed"
          : completedWithDelay
          ? "Completed (Delayed)"
          : isCompleted
          ? "Completed"
          : isTodayPlanned
          ? "Today Planned"
          : isInProgress
          ? "In-Progress"
          : isYts
          ? "YTS"
          : "Upcoming Planned";

        return {
          id: s.id,
          stageName: s.stage_name || "Stage",
          stageStatus: s.stage_status || "",
          assignee: getUserDisplayName(s.assignee_name),
          plannedStart: sStart,
          plannedEnd: sEnd,
          actualStart: aStart,
          actualEnd: aEnd,
          isDelayed,
          delayDays,
          completedWithDelay,
          isCompleted,
          isInProgress,
          isTodayPlanned,
          isYts,
          status,
        };
      });

      // Find first uncompleted stage as active stage
      const activeStage = sorted.find((s) => {
        const st = (s.stage_status || "").toLowerCase();
        return st !== "completed" && st !== "complete" && !s.actual_end_date;
      }) || sorted[sorted.length - 1];

      if (activeStage) {
        const sStart = activeStage.planned_start_date ? activeStage.planned_start_date.split("T")[0] : "—";
        const sEnd = activeStage.planned_end_date ? activeStage.planned_end_date.split("T")[0] : "—";
        const aStart = activeStage.actual_start_date ? activeStage.actual_start_date.split("T")[0] : "—";
        const aEnd = activeStage.actual_end_date ? activeStage.actual_end_date.split("T")[0] : "—";

        // Delayed stages list (any stage in this chapter that is currently delayed OR was completed delayed)
        const delayedStagesList = chapterStages.filter((st) => st.isDelayed);
        const isAnyDelayed = delayedStagesList.length > 0;
        const currentIsDelayed = Boolean(sEnd !== "—" && sEnd < todayStr && aEnd === "—");
        const isCompleted = chapterStages.every((st) => st.isCompleted);
        const isInProgress = Boolean(aStart !== "—" && aEnd === "—");
        const isTodayPlanned = Boolean(sStart === todayStr && aStart === "—" && !isCompleted);
        const isYts = Boolean(aStart === "—" && aEnd === "—" && sEnd >= todayStr);

        let delayDays = 0;
        if (delayedStagesList.length > 0) {
          delayDays = Math.max(...delayedStagesList.map((d) => d.delayDays));
        } else if (currentIsDelayed && sEnd !== "—") {
          const diff = Math.floor((new Date(todayStr).getTime() - new Date(sEnd).getTime()) / (1000 * 60 * 60 * 24));
          delayDays = diff > 0 ? diff : 0;
        }

        const status = isAnyDelayed
          ? "Delayed"
          : isCompleted
          ? "Completed"
          : isTodayPlanned
          ? "Today Planned"
          : isInProgress
          ? "In-Progress"
          : isYts
          ? "YTS"
          : "Upcoming Planned";

        rows.push({
          chapter: ch,
          trackType: getTrackType(ch),
          currentStage: activeStage.stage_name || "—",
          assignee: getUserDisplayName(activeStage.assignee_name),
          plannedStart: sStart,
          plannedEnd: sEnd,
          actualStart: aStart,
          actualEnd: aEnd,
          delayDays,
          isDelayed: isAnyDelayed,
          isInProgress,
          isCompleted,
          isYts,
          isTodayPlanned,
          status,
          delayedStages: delayedStagesList.map((d) => ({
            stageName: d.stageName,
            delayDays: d.delayDays,
            wasCompletedWithDelay: d.completedWithDelay,
          })),
          stages: chapterStages,
        });
      }
    });

    const typePriority: Record<string, number> = {
      chapter: 1,
      art: 2,
      design: 3,
      support: 4,
    };

    return rows.sort((a, b) => {
      const pA = typePriority[a.trackType] || 99;
      const pB = typePriority[b.trackType] || 99;
      if (pA !== pB) return pA - pB;
      return a.chapter.localeCompare(b.chapter, undefined, { numeric: true });
    });
  }, [selectedProject, getUserDisplayName, getTrackType]);

  // Track summary counts
  const trackSummary = useMemo(() => {
    let chapters = 0;
    let art = 0;
    let design = 0;
    let support = 0;

    selectedProjectChapterRows.forEach((r) => {
      if (r.trackType === "chapter") chapters++;
      else if (r.trackType === "art") art++;
      else if (r.trackType === "design") design++;
      else if (r.trackType === "support") support++;
    });

    return { chapters, art, design, support, total: selectedProjectChapterRows.length };
  }, [selectedProjectChapterRows]);

  // Filter rows by track type tab
  const displayedChapterRows = useMemo(() => {
    if (trackFilter === "all") return selectedProjectChapterRows;
    return selectedProjectChapterRows.filter((r) => r.trackType === trackFilter);
  }, [selectedProjectChapterRows, trackFilter]);

  // Stage-wise grouping of chapter rows for cards view
  const stageGroupedCards = useMemo(() => {
    const STAGE_ORDER = [
      "Job Initiation",
      "Manuscript Analysis",
      "Pre-editing",
      "Copyediting",
      "AQ Resolution",
      "Non-XML Processing",
      "Typesetting",
      "Proofreading",
      "Indexing",
      "Corrections & 2P",
      "QC & Pre-flight",
      "Delivery",
    ];

    const map = new Map<string, ChapterRow[]>();
    for (const row of displayedChapterRows) {
      const stage = row.currentStage || "Unassigned Stage";
      if (!map.has(stage)) {
        map.set(stage, []);
      }
      map.get(stage)!.push(row);
    }

    const groups = Array.from(map.entries()).map(([stageName, items]) => {
      const delayedCount = items.filter((it) => it.isDelayed).length;
      return {
        stageName,
        items,
        delayedCount,
      };
    });

    return groups.sort((a, b) => {
      const idxA = STAGE_ORDER.findIndex((s) => s.toLowerCase() === a.stageName.toLowerCase());
      const idxB = STAGE_ORDER.findIndex((s) => s.toLowerCase() === b.stageName.toLowerCase());
      const rankA = idxA >= 0 ? idxA : 999;
      const rankB = idxB >= 0 ? idxB : 999;
      if (rankA !== rankB) return rankA - rankB;
      return a.stageName.localeCompare(b.stageName);
    });
  }, [displayedChapterRows]);

  // If user does not have permission
  if (!userInfo.canAccess && !loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 text-center">
        <div className="inline-flex p-4 rounded-2xl bg-amber-500/10 text-amber-600 mb-4 border border-amber-500/20">
          <AlertTriangle size={36} />
        </div>
        <h2 className="text-xl font-bold text-text mb-2">Restricted Access</h2>
        <p className="text-sm text-muted max-w-md mx-auto mb-6">
          The <strong>My Projects</strong> workspace is exclusively available to members of the{" "}
          <strong>Project Management</strong> team and <strong>Administrators</strong>.
        </p>
        <button
          onClick={() => navigate("/reports")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-all shadow-sm"
        >
          <ArrowLeft size={14} /> Back to Reports Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* ── Top Header Banner ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-card via-card to-indigo-500/5 p-5 rounded-2xl border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/reports")}
            className="p-2 rounded-xl border border-border hover:bg-surface text-muted hover:text-text transition-colors"
            title="Back to Reports"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-text">My Projects</h1>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center gap-1">
                <Briefcase size={12} />
                PM Portfolio
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              {userInfo.isAdmin
                ? "Admin Overview: View assigned project portfolios, schedule planning matrices, and stage progress across all Project Managers."
                : `Your personal project portfolio: Tracking managed books where you are designated as the Project Manager.`}
            </p>
          </div>
        </div>

        {/* Identity & Scope Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface border border-border text-xs">
            <User size={14} className="text-primary" />
            <div>
              <span className="font-semibold text-text">{userInfo.fullName}</span>
              <span className="text-[10px] text-muted block">
                Role: {userInfo.roles[0] || (userInfo.isAdmin ? "Admin" : "Project Manager")} | Team: {userInfo.team}
              </span>
            </div>
          </div>

          {/* Admin PM Filter Dropdown */}
          {userInfo.isAdmin && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted font-medium whitespace-nowrap">PM Filter:</span>
              <select
                value={adminPmFilter}
                onChange={(e) => setAdminPmFilter(e.target.value)}
                className="bg-surface border border-border rounded-xl px-2.5 py-1.5 text-xs text-text font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
              >
                <option value="all">All Project Managers ({projectsList.length} books)</option>
                {pmOptions.map((opt) => (
                  <option key={opt.raw} value={opt.raw}>
                    {opt.displayName} ({opt.raw})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── KPI Metric Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        {/* Total Managed Books */}
        <div
          onClick={() => setStatusFilter("all")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            statusFilter === "all" ? "border-primary ring-2 ring-primary/20 bg-primary/5" : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Total Managed</p>
            <p className="text-2xl font-bold text-text mt-1">{kpis.total}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <BookOpen size={20} />
          </div>
        </div>

        {/* Planning (Cyan/Sky) */}
        <div
          onClick={() => setStatusFilter(statusFilter === "planning" ? "all" : "planning")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            statusFilter === "planning"
              ? "border-cyan-500 ring-2 ring-cyan-500/20 bg-cyan-500/5"
              : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Planning</p>
            <p className="text-2xl font-bold text-cyan-600 dark:text-cyan-400 mt-1">{kpis.planning}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-600 border border-cyan-500/20">
            <Calendar size={20} />
          </div>
        </div>

        {/* In-Progress (Indigo) */}
        <div
          onClick={() => setStatusFilter(statusFilter === "inProgress" ? "all" : "inProgress")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            statusFilter === "inProgress"
              ? "border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-500/5"
              : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">In-Progress</p>
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{kpis.inProgress}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
            <Clock size={20} />
          </div>
        </div>

        {/* Delayed (Red) */}
        <div
          onClick={() => setStatusFilter(statusFilter === "delayed" ? "all" : "delayed")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            statusFilter === "delayed" ? "border-red-500 ring-2 ring-red-500/20 bg-red-500/5" : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Delayed</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{kpis.delayed}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-red-500/10 text-red-600 border border-red-500/20">
            <AlertTriangle size={20} />
          </div>
        </div>

        {/* Completed (Emerald) */}
        <div
          onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            statusFilter === "completed"
              ? "border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/5"
              : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Completed</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{kpis.completed}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
            <CheckCircle2 size={20} />
          </div>
        </div>
      </div>

      {/* ── Main Layout: Books List (Left) & Planning Drilldown (Right/Below) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Left Column: Books Portfolio (5 cols) ── */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-card border border-border rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-text flex items-center gap-1.5">
                <BookOpen size={16} className="text-indigo-600" />
                Assigned Books ({filteredProjects.length})
              </h2>
              {statusFilter !== "all" && (
                <button
                  onClick={() => setStatusFilter("all")}
                  className="text-[11px] text-muted hover:text-text font-medium flex items-center gap-1"
                >
                  <RotateCcw size={11} /> Reset Filter
                </button>
              )}
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search code, title, client..."
                className="w-full bg-surface border border-border rounded-xl pl-9 pr-3 py-1.5 text-xs text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
              />
            </div>

            {/* Books Card List */}
            {loading ? (
              <div className="py-12 flex justify-center items-center">
                <Spinner size="md" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-surface border border-border/60">
                <BookOpen size={28} className="mx-auto text-muted/60 mb-2" />
                <p className="text-xs font-semibold text-text">No Books Found</p>
                <p className="text-[11px] text-muted mt-1">
                  {userInfo.isAdmin
                    ? "No projects match the selected PM or search filter."
                    : "No projects are currently assigned to you as Project Manager."}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1 scrollbar-thin">
                {filteredProjects.map((p) => {
                  const isSelected = selectedProjectId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProjectId(p.id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                        isSelected
                          ? "bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-500 ring-2 ring-indigo-500/20 shadow-sm"
                          : "bg-surface hover:bg-card border-border hover:border-border/80"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                              {p.projectCode}
                            </span>
                            {p.client_name && (
                              <span className="text-[11px] text-muted font-medium">
                                • {p.client_name}
                              </span>
                            )}
                          </div>
                          <h3
                            className="text-xs font-bold text-text mt-1.5 line-clamp-1"
                            title={p.title}
                          >
                            {p.title}
                          </h3>
                        </div>

                        {/* Status Badge */}
                        <div>
                          {p.isPlanning ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
                              <Calendar size={10} /> Planning
                            </span>
                          ) : p.isCompleted ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 size={10} /> Completed
                            </span>
                          ) : p.isDelayed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
                              <AlertTriangle size={10} /> Delayed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">
                              <Clock size={10} /> In-Progress
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Meta stats */}
                      <div className="mt-3 space-y-1.5 border-t border-border/40 pt-2 text-[11px]">
                        <div className="flex items-center justify-between text-muted">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-text">
                              {p.manuscriptCount} Chapters
                            </span>
                            {p.artCount > 0 && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                                {p.artCount} Art
                              </span>
                            )}
                            {p.designCount > 0 && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                {p.designCount} Design
                              </span>
                            )}
                          </div>
                          {p.due_date && (
                            <span className="font-mono text-muted">
                              Due: <strong className="text-text">{p.due_date.split("T")[0]}</strong>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted">
                          <span>
                            Progress: <strong className="text-text">{p.completedChapters}/{p.totalChapters} tracks done</strong>
                          </span>
                          <span className="text-indigo-600 dark:text-indigo-400 font-semibold flex items-center gap-0.5">
                            {isSelected ? "Active View" : "Click to view"}
                            <ArrowRight size={11} />
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right Column: Planning & Current Status (7 cols) ── */}
        <div className="lg:col-span-7 space-y-4">
          {selectedProject ? (
            <div className="bg-card border border-border rounded-2xl p-5 shadow-xs space-y-5">
              {/* Selected Book Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/80 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-md border border-primary/20">
                      {selectedProject.projectCode}
                    </span>
                    <span className="text-xs font-semibold text-muted">
                      {selectedProject.client_name || "Client"}
                    </span>
                    {selectedProject.isPlanning ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
                        <Calendar size={11} /> Planning
                      </span>
                    ) : selectedProject.isCompleted ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 size={11} /> Completed
                      </span>
                    ) : selectedProject.isDelayed ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
                        <AlertTriangle size={11} /> Delayed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">
                        <Clock size={11} /> In-Progress
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-bold text-text mt-1">{selectedProject.title}</h2>
                  <p className="text-xs text-muted mt-0.5">
                    Assigned PM: <strong className="text-text">{selectedProject.pmDisplayName}</strong> | Workflow:{" "}
                    <strong className="text-text">{selectedProject.workflow_name || "Standard Book Workflow"}</strong>
                  </p>
                </div>

                {/* Quick Link Navigation Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => navigate(`/projects/${selectedProject.id}/planning`, { state: { from: "/reports/my-work" } })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-700 active:scale-95 transition-all shadow-xs"
                    title="Open Full Schedule Planning Grid"
                  >
                    <Calendar size={13} />
                    Full Planning Board
                  </button>
                  <button
                    onClick={() => navigate(`/projects/${selectedProject.id}`, { state: { from: "/reports/my-work" } })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-surface hover:bg-card text-text font-semibold text-xs transition-all shadow-xs"
                    title="Open Project Workflow View"
                  >
                    <ExternalLink size={13} />
                    Workflow Board
                  </button>
                </div>
              </div>

              {/* Book Metadata Mini-Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-surface p-3.5 rounded-xl border border-border/60 text-xs">
                <div>
                  <span className="text-muted text-[11px] block">Start Date</span>
                  <span className="font-mono font-medium text-text mt-0.5 block">
                    {selectedProject.created_at ? selectedProject.created_at.split("T")[0] : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted text-[11px] block">Target Due Date</span>
                  <span className="font-mono font-bold text-text mt-0.5 block">
                    {selectedProject.due_date ? selectedProject.due_date.split("T")[0] : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted text-[11px] block">Manuscript Pages</span>
                  <span className="font-medium text-text mt-0.5 block">
                    {selectedProject.manuscript_pages ? `${selectedProject.manuscript_pages} pages` : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted text-[11px] block">Tracks Breakdown</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5 block">
                    {selectedProject.manuscriptCount} Chs • {selectedProject.artCount} Art • {selectedProject.designCount} Design
                  </span>
                </div>
              </div>

              {/* Chapter-wise Planning & Current Status Table / Cards */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
                      <Layers size={14} className="text-indigo-600" />
                      Milestones, Planning &amp; Current Status
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted flex-wrap">
                      <span>Breakdown:</span>
                      <span className="inline-flex items-center px-1.5 py-0.2 rounded font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        {trackSummary.chapters} Chapters
                      </span>
                      {trackSummary.art > 0 && (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                          {trackSummary.art} Art
                        </span>
                      )}
                      {trackSummary.design > 0 && (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          {trackSummary.design} Design
                        </span>
                      )}
                      {trackSummary.support > 0 && (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                          {trackSummary.support} Support
                        </span>
                      )}
                      <span>({trackSummary.total} tracks total)</span>
                    </div>
                  </div>

                  {/* Track Filter Pills */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      onClick={() => setTrackFilter("all")}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                        trackFilter === "all"
                          ? "bg-text text-card shadow-xs font-bold"
                          : "text-muted hover:text-text bg-surface border border-border"
                      }`}
                    >
                      All ({trackSummary.total})
                    </button>
                    {trackSummary.chapters > 0 && (
                      <button
                        onClick={() => setTrackFilter("chapter")}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                          trackFilter === "chapter"
                            ? "bg-blue-600 text-white shadow-xs font-bold"
                            : "text-muted hover:text-blue-600 bg-surface border border-border"
                        }`}
                      >
                        Chapters ({trackSummary.chapters})
                      </button>
                    )}
                    {trackSummary.art > 0 && (
                      <button
                        onClick={() => setTrackFilter("art")}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                          trackFilter === "art"
                            ? "bg-purple-600 text-white shadow-xs font-bold"
                            : "text-muted hover:text-purple-600 bg-surface border border-border"
                        }`}
                      >
                        Art ({trackSummary.art})
                      </button>
                    )}
                    {trackSummary.design > 0 && (
                      <button
                        onClick={() => setTrackFilter("design")}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                          trackFilter === "design"
                            ? "bg-amber-600 text-white shadow-xs font-bold"
                            : "text-muted hover:text-amber-600 bg-surface border border-border"
                        }`}
                      >
                        Design ({trackSummary.design})
                      </button>
                    )}
                  </div>
                </div>

                {selectedProject.isPlanning ? (
                  <div className="text-center py-12 px-4 bg-cyan-500/5 rounded-2xl border border-cyan-500/20 space-y-3.5 my-2">
                    <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto text-cyan-600 dark:text-cyan-400 shadow-xs">
                      <Calendar size={26} />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-text">Project is Currently in Planning Phase</h4>
                      <p className="text-xs text-muted max-w-md mx-auto">
                        Track schedules and stage progression have not been finalized or approved yet. You can configure and approve the schedule on the planning board.
                      </p>
                    </div>
                    <button
                      onClick={() => navigate(`/projects/${selectedProject.id}/planning`, { state: { from: "/reports/my-work" } })}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-700 active:scale-95 transition-all shadow-sm"
                    >
                      <Calendar size={13} />
                      Open Full Planning Board
                    </button>
                  </div>
                ) : displayedChapterRows.length === 0 ? (
                  <div className="text-center py-10 bg-surface rounded-xl border border-border/60">
                    <Clock size={24} className="mx-auto text-muted/60 mb-2" />
                    <p className="text-xs font-semibold text-text">No tracks match filter</p>
                  </div>
                ) : (
                  /* ── Stage-wise Chapter List Display ── */
                  <div className="space-y-4 max-h-[580px] overflow-y-auto pr-1 scrollbar-thin">
                    {stageGroupedCards.map((group) => (
                      <div
                        key={group.stageName}
                        className="rounded-xl border border-border/80 bg-surface/30 p-3.5 space-y-3 shadow-xs"
                      >
                        {/* Stage Section Header */}
                        <div className="flex items-center justify-between pb-1 border-b border-border/50">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-text">{group.stageName}</span>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                              {group.items.length}
                            </span>
                          </div>

                          {group.delayedCount > 0 && (
                            <span className="text-[11px] font-bold text-red-600 dark:text-red-400 bg-red-500/10 px-2.5 py-0.5 rounded-full border border-red-500/20 flex items-center gap-1">
                              <AlertTriangle size={11} /> {group.delayedCount} Delayed
                            </span>
                          )}
                        </div>

                        {/* Chapter Rows List in Stage */}
                        <div className="space-y-2">
                          {group.items.map((item) => (
                            <div
                              key={item.chapter}
                              onClick={() => setActiveModalChapter(item)}
                              className={`p-3 rounded-xl border transition-all cursor-pointer hover:shadow-sm hover:border-border/80 flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                                item.isDelayed
                                  ? "bg-red-500/5 hover:bg-red-500/10 border-red-500/30"
                                  : item.isTodayPlanned
                                  ? "bg-violet-500/5 hover:bg-violet-500/10 border-violet-500/30"
                                  : item.isInProgress
                                  ? "bg-indigo-500/5 hover:bg-indigo-500/10 border-indigo-500/30"
                                  : item.isCompleted
                                  ? "bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/30"
                                  : "bg-card hover:bg-surface border-border/80"
                              }`}
                            >
                              {/* Left Info: Name & Type & Assignee & Target Due Date */}
                              <div className="flex flex-col gap-1 min-w-[220px]">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-xs text-text">
                                    {item.trackType === "chapter" && !item.chapter.startsWith("Ch ")
                                      ? `Chapter ${item.chapter}`
                                      : item.chapter}
                                  </span>
                                  {item.trackType === "art" && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                                      Art
                                    </span>
                                  )}
                                  {item.trackType === "design" && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                      Design
                                    </span>
                                  )}
                                  {item.assignee !== "—" ? (
                                    <span className="text-[11px] text-muted font-medium truncate max-w-[140px]" title={item.assignee}>
                                      • {item.assignee}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-muted/70 italic">• Unassigned</span>
                                  )}
                                </div>

                                {/* Target Due Date placed directly below */}
                                <div className="flex items-center gap-1.5 text-xs text-muted">
                                  <span className="text-[11px]">Target Due Date:</span>
                                  <span
                                    className={`font-mono font-semibold ${
                                      item.isDelayed
                                        ? "text-red-600 font-bold"
                                        : item.isTodayPlanned
                                        ? "text-violet-600 font-bold"
                                        : "text-text"
                                    }`}
                                  >
                                    {item.plannedEnd}
                                  </span>
                                </div>
                              </div>

                              {/* Right: Delayed Stages Tag & Status Badge */}
                              <div className="flex items-center gap-2 flex-wrap justify-end">
                                {/* Explicit Delayed Stage Tag */}
                                {item.isDelayed && item.delayedStages.length > 0 && (
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <span className="text-[10px] text-muted font-semibold">Delayed at:</span>
                                    {item.delayedStages.map((ds, idx) => (
                                      <span
                                        key={idx}
                                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 whitespace-nowrap"
                                      >
                                        {ds.stageName} {ds.delayDays > 0 ? `(${ds.delayDays}d)` : ""}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* Status Badge */}
                                <div>
                                  {item.isDelayed ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 whitespace-nowrap">
                                      <AlertTriangle size={10} /> Delayed
                                    </span>
                                  ) : item.isCompleted ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
                                      <CheckCircle2 size={10} /> Completed
                                    </span>
                                  ) : item.isTodayPlanned ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30 whitespace-nowrap">
                                      <Clock size={10} /> Today
                                    </span>
                                  ) : item.isInProgress ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 whitespace-nowrap">
                                      <Clock size={10} /> In-Progress
                                    </span>
                                  ) : item.isYts ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 whitespace-nowrap">
                                      <Clock size={10} /> YTS
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface text-muted border border-border whitespace-nowrap">
                                      {item.status}
                                    </span>
                                  )}
                                </div>

                                <ArrowRight size={13} className="text-muted/60 hover:text-indigo-600 shrink-0 hidden md:block" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl p-12 text-center">
              <BookOpen size={36} className="mx-auto text-muted/50 mb-3" />
              <h3 className="text-sm font-bold text-text">Select a book to inspect</h3>
              <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                Choose any assigned book from the left portfolio list to view its real-time planning schedule and current stage milestones.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Interactive Modal: Chapter Stage-wise Drilldown ── */}
      {activeModalChapter && (
        <Modal
          isOpen={Boolean(activeModalChapter)}
          onClose={() => setActiveModalChapter(null)}
          title={`Stage Progression: ${
            activeModalChapter.trackType === "chapter" && !activeModalChapter.chapter.startsWith("Ch ")
              ? `Chapter ${activeModalChapter.chapter}`
              : activeModalChapter.chapter
          }`}
          size="xl"
        >
          <div className="space-y-4">
            {/* Modal Summary Banner */}
            <div className="p-3.5 rounded-xl bg-surface border border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-text">
                    {activeModalChapter.trackType === "chapter" && !activeModalChapter.chapter.startsWith("Ch ")
                      ? `Chapter ${activeModalChapter.chapter}`
                      : activeModalChapter.chapter}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                    {activeModalChapter.trackType.toUpperCase()}
                  </span>
                  {selectedProject && (
                    <span className="font-mono text-muted">• {selectedProject.projectCode}</span>
                  )}
                </div>
                <p className="text-muted mt-1">
                  Active Stage: <strong className="text-text">{activeModalChapter.currentStage}</strong> | Due Date:{" "}
                  <strong className="text-text font-mono">{activeModalChapter.plannedEnd}</strong>
                </p>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-2 flex-wrap">
                {activeModalChapter.delayedStages.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
                    <AlertTriangle size={13} />{" "}
                    {activeModalChapter.delayedStages.length === 1
                      ? "1 stage delayed"
                      : `${activeModalChapter.delayedStages.length} stages delayed`}
                  </span>
                )}
                {activeModalChapter.isCompleted ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    <CheckCircle2 size={13} /> All Stages Completed
                  </span>
                ) : activeModalChapter.isTodayPlanned ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30">
                    <Clock size={13} /> Today Planned
                  </span>
                ) : !activeModalChapter.isDelayed ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">
                    <Clock size={13} /> In-Progress
                  </span>
                ) : null}
              </div>
            </div>

            {/* Delay Warning Callout (if any stage delayed) */}
            {activeModalChapter.isDelayed && activeModalChapter.delayedStages.length > 0 && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
                <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">
                    {activeModalChapter.delayedStages.length === 1
                      ? "1 stage delayed:"
                      : `${activeModalChapter.delayedStages.length} stages delayed:`}
                  </strong>
                  <ul className="list-disc list-inside mt-1 space-y-0.5 font-medium">
                    {activeModalChapter.delayedStages.map((ds, idx) => (
                      <li key={idx}>
                        <span className="font-bold">{ds.stageName}</span>:{" "}
                        {ds.wasCompletedWithDelay
                          ? `Completed with ${ds.delayDays} day${ds.delayDays === 1 ? "" : "s"} delay`
                          : ds.delayDays > 0
                          ? `${ds.delayDays} day${ds.delayDays === 1 ? "" : "s"} overdue`
                          : "Planned end date has passed"}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Stage-wise Sequential Cards Flow */}
            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1 scrollbar-thin">
              <h4 className="text-[11px] font-bold text-muted uppercase tracking-wider">
                Sequential Stages Workflow ({activeModalChapter.stages.length} steps)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {activeModalChapter.stages.map((st, idx) => (
                  <div
                    key={st.id || idx}
                    className={`p-3 rounded-xl border text-xs transition-all ${
                      st.isDelayed
                        ? "bg-red-500/5 border-red-500/30 shadow-xs"
                        : st.isCompleted
                        ? "bg-emerald-500/5 border-emerald-500/30 shadow-xs"
                        : st.isTodayPlanned
                        ? "bg-violet-500/5 border-violet-500/30 shadow-xs"
                        : st.isInProgress
                        ? "bg-indigo-500/5 border-indigo-500/30 shadow-xs"
                        : "bg-surface/60 border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] bg-card border border-border text-muted">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-text">{st.stageName}</span>
                      </div>
                      <div>
                        {st.isDelayed ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
                            <AlertTriangle size={9} /> {st.completedWithDelay ? "Completed (Delayed)" : "Delayed"} {st.delayDays > 0 ? `(${st.delayDays}d)` : ""}
                          </span>
                        ) : st.isCompleted ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 size={9} /> Completed
                          </span>
                        ) : st.isTodayPlanned ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30">
                            <Clock size={9} /> Today
                          </span>
                        ) : st.isInProgress ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">
                            <Clock size={9} /> In-Progress
                          </span>
                        ) : st.isYts ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            <Clock size={9} /> YTS
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium bg-card text-muted border border-border">
                            Upcoming
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Stage Details Grid */}
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2.5 pt-2 border-t border-border/40 text-[11px]">
                      <div>
                        <span className="text-muted block text-[10px]">Assignee:</span>
                        <span className="font-medium text-text truncate block" title={st.assignee}>
                          {st.assignee !== "—" ? st.assignee : <span className="italic text-muted">Unassigned</span>}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted block text-[10px]">Planned End (Due):</span>
                        <span
                          className={`font-mono font-medium block ${
                            st.isDelayed
                              ? "text-red-600 font-bold"
                              : st.isTodayPlanned
                              ? "text-violet-600 font-bold"
                              : "text-text"
                          }`}
                        >
                          {st.plannedEnd}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted block text-[10px]">Planned Start:</span>
                        <span className="font-mono text-muted block">{st.plannedStart}</span>
                      </div>
                      <div>
                        <span className="text-muted block text-[10px]">Actual End:</span>
                        <span className="font-mono text-text block">
                          {st.actualEnd !== "—" ? (
                            <span className="text-emerald-600 font-semibold">{st.actualEnd}</span>
                          ) : (
                            "—"
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border/70">
              <button
                onClick={() => setActiveModalChapter(null)}
                className="px-4 py-1.5 rounded-xl border border-border bg-surface hover:bg-card text-text text-xs font-semibold transition-all shadow-xs"
              >
                Close
              </button>
              {selectedProject && (
                <button
                  onClick={() => {
                    navigate(`/projects/${selectedProject.id}/planning`);
                    setActiveModalChapter(null);
                  }}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all shadow-xs inline-flex items-center gap-1.5"
                >
                  <Calendar size={13} />
                  Open Full Planning Board
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

