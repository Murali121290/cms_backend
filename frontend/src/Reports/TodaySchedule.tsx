import React, { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  CalendarDays,
  Building2,
  ArrowLeft,
  Filter,
  RotateCcw,
  Download,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Layers,
  ChevronDown,
  ChevronUp,
  X,
  Users,
  ShieldCheck,
  Calendar,
  Sparkles,
} from "lucide-react";
import api from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useRBAC } from "@/hooks/useRBAC";
import { Spinner } from "@/components/ui/Spinner";
import * as XLSX from "xlsx";

type ActiveTab = "all" | "today" | "delayed" | "inProgress" | "yts" | "completed";

export interface StageDetailRecord {
  id: number;
  client: string;
  project: string;
  chapters: string;
  project_manager_name: string | null;
  assignee_name: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  stage_name: string;
  workflow: string;
  complexity_level: string | null;
  stage_level: number | null;
  sla: number | null;
  stage_status: string;
  delayed: boolean;
  delay_days: number | null;
  remarks: string | null;
}

export interface StageMasterRecord {
  id: number;
  stage_name: string;
  description?: string;
  roles: string[];
}

export interface OperationalRow {
  id: number;
  client: string;
  projectCode: string;
  projectTitle: string;
  chapterNumber: string;
  stageName: string;
  currentStage: string;
  workflow: string;
  assignee: string;
  projectManager: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string;
  actualEnd: string;
  stageStatus: string;
  isTodayPlanned: boolean;
  isDelayed: boolean;
  isYTS: boolean;
  isInProgress: boolean;
  delayDays: number;
  isCompleted: boolean;
  roles: string[];
}

const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const TodaySchedule = () => {
  const navigate = useNavigate();
  const { user: authUser } = useAuthStore();
  const sessionViewer = useSessionStore((s) => s.viewer);
  const rbac = useRBAC();

  const [loading, setLoading] = useState(true);
  const [stageDetails, setStageDetails] = useState<StageDetailRecord[]>([]);
  const [stagesMaster, setStagesMaster] = useState<StageMasterRecord[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);

  // Filtering states
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [globalSearch, setGlobalSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState("--ALL--");
  const [selectedStage, setSelectedStage] = useState("--ALL--");
  const [selectedTeam, setSelectedTeam] = useState<string>("auto");
  const [statusFilter, setStatusFilter] = useState("--ALL--");
  const [startDateFrom, setStartDateFrom] = useState("");
  const [startDateTo, setStartDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(true);

  // Sorting
  const [sortKey, setSortKey] = useState<keyof OperationalRow>("plannedEnd");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Fetch all initial operational data
  useEffect(() => {
    let isMounted = true;
    const fetchOperationsData = async () => {
      try {
        setLoading(true);
        const [detailsRes, stagesRes, projectsRes] = await Promise.all([
          api.get<StageDetailRecord[]>("/api/v1/stage-details?limit=1000000").then((r) => r.data).catch(() => []),
          api.get<StageMasterRecord[]>("/api/v1/stages?limit=100000").then((r) => r.data).catch(() => []),
          api.get<any>("/projects/?limit=100000").then((r) => r.data?.projects || r.data || []).catch(() => []),
        ]);

        if (isMounted) {
          setStageDetails(detailsRes);
          setStagesMaster(stagesRes);
          setProjectsList(Array.isArray(projectsRes) ? projectsRes : []);
        }
      } catch (err) {
        console.error("Failed to load Daily Operations data:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchOperationsData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Determine user identity, roles & admin status accurately across auth stores
  const userInfo = useMemo(() => {
    // 1. Combine roles from both sessionStore and authStore
    const sessionRoles = sessionViewer?.roles || [];
    const authStoreRoles = (authUser?.roles || []).map((r) =>
      typeof r === "string" ? r : r.name || ""
    );
    const userRoleStr = (authUser as any)?.role || (sessionViewer as any)?.role || "";
    const allRoles = Array.from(new Set([...sessionRoles, ...authStoreRoles, userRoleStr])).filter(Boolean);

    // 2. Check admin / lead permissions
    const isAdmin =
      rbac.isAdmin ||
      rbac.isManager ||
      rbac.isTeamLead ||
      allRoles.some((r) => {
        const low = r.toLowerCase();
        return (
          low.includes("admin") ||
          low.includes("management") ||
          low.includes("project manager") ||
          low.includes("senior project manager") ||
          low.includes("lead")
        );
      });

    const userTeamStr = sessionViewer?.team || (authUser as any)?.team || (isAdmin ? "Administration" : "");
    const fullName =
      [sessionViewer?.first_name || authUser?.first_name, sessionViewer?.last_name || authUser?.last_name]
        .filter(Boolean)
        .join(" ") ||
      sessionViewer?.username ||
      authUser?.username ||
      "Logged In User";

    const username = sessionViewer?.username || authUser?.username || "";

    return {
      name: fullName,
      username,
      team: userTeamStr || "All Departments",
      roles: allRoles,
      isAdmin,
    };
  }, [authUser, sessionViewer, rbac]);

  // Stage name to roles map
  const stageRolesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const sm of stagesMaster) {
      if (sm.stage_name) {
        map.set(sm.stage_name.toLowerCase().trim(), sm.roles || []);
      }
    }
    return map;
  }, [stagesMaster]);

  // Project code to title lookup
  const projectTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsList) {
      const code = p.code || p.project_code || "";
      const title = p.title || p.project_title || "";
      if (code) map.set(code, title);
    }
    return map;
  }, [projectsList]);

  // Current chapter stage lookup (first uncompleted stage in workflow sequence)
  const currentChapterStageMap = useMemo(() => {
    const map = new Map<string, string>();
    // Group stage details by project:::chapters
    const groups = new Map<string, StageDetailRecord[]>();
    for (const item of stageDetails) {
      const key = `${item.project}:::${item.chapters}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    groups.forEach((items, key) => {
      // Find the first stage where stage_status is not Completed
      const sorted = [...items].sort((a, b) => {
        const pStartA = a.planned_start_date || "";
        const pStartB = b.planned_start_date || "";
        if (pStartA && pStartB && pStartA !== pStartB) return pStartA.localeCompare(pStartB);
        return a.id - b.id;
      });
      const activeStage = sorted.find((s) => {
        const low = (s.stage_status || "").toLowerCase().trim();
        return low !== "completed" && low !== "complete";
      });
      map.set(key, activeStage ? activeStage.stage_name : "Completed");
    });

    return map;
  }, [stageDetails]);

  // Normalised operational rows strictly according to Daily Operations specifications:
  // Today planned -> total planned_start_date = today
  // delayed -> planned_end_date < today AND stage_status != 'Completed'
  // in-progress -> (planned_start_date <= today OR actual_start_date is not null) AND planned_end_date >= today AND stage_status != 'Completed'
  // completed -> actual_end_date = today
  const allOperationalRows = useMemo<OperationalRow[]>(() => {
    const todayStr = getTodayDateString();
    const todayDate = new Date(`${todayStr}T00:00:00`);

    return stageDetails
      .filter((item) => {
        const pStart = item.planned_start_date ? item.planned_start_date.split("T")[0] : "";
        const pEnd = item.planned_end_date ? item.planned_end_date.split("T")[0] : "";
        const aStart = item.actual_start_date ? item.actual_start_date.split("T")[0] : "";
        const aEnd = item.actual_end_date ? item.actual_end_date.split("T")[0] : "";
        const statusLow = (item.stage_status || "").toLowerCase().trim();
        const isCompleted = statusLow === "completed" || statusLow === "complete";

        // Condition 1: Today planned
        const isTodayPlanned = pStart === todayStr;

        // Condition 2: Delayed (planned_end_date < today AND !completed)
        const isDelayed = !isCompleted && pEnd && pEnd < todayStr;

        // Condition 3: In-Progress / YTS (active work: scheduled on/before today or started, deadline ahead)
        const isInProgressOrYTS =
          !isCompleted &&
          pEnd &&
          pEnd >= todayStr &&
          ((pStart && pStart <= todayStr) || Boolean(aStart));

        // Condition 4: Completed (actual_end_date = today)
        const isTodayCompleted = aEnd === todayStr;

        return isTodayPlanned || isDelayed || isInProgressOrYTS || isTodayCompleted;
      })
      .map((item) => {
        const sStart = item.planned_start_date ? item.planned_start_date.split("T")[0] : "";
        const sEnd = item.planned_end_date ? item.planned_end_date.split("T")[0] : "";
        const aStart = item.actual_start_date ? item.actual_start_date.split("T")[0] : "";
        const aEnd = item.actual_end_date ? item.actual_end_date.split("T")[0] : "";
        const statusLow = (item.stage_status || "Pending").toLowerCase().trim();
        const isCompleted = aEnd === todayStr || statusLow === "completed" || statusLow === "complete";

        // 1. Delayed check: planned_end_date < today AND !completed
        let isDelayed = false;
        let delayDays = 0;
        if (!isCompleted && sEnd && sEnd < todayStr) {
          isDelayed = true;
          const endDate = new Date(`${sEnd}T00:00:00`);
          const diffTime = todayDate.getTime() - endDate.getTime();
          delayDays = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
        }

        // 2. YTS (Yet to Start): planned end is not a past date (sEnd >= today), but there is no actual start date
        const isYTS = !isCompleted && !isDelayed && !aStart && Boolean(sEnd && sEnd >= todayStr);

        // 3. In-Progress check: work has actually started (aStart present) AND not completed AND sEnd >= today
        const isInProgress = !isCompleted && !isDelayed && Boolean(aStart) && Boolean(sEnd && sEnd >= todayStr);

        // 4. Today's planned check: planned_start_date = today
        const isTodayPlanned = sStart === todayStr;

        // 5. Completed check: actual_end_date = today
        const isCompletedToday = aEnd === todayStr;

        const stageLow = (item.stage_name || "").toLowerCase().trim();
        const matchedRoles = stageRolesMap.get(stageLow) || [];

        // Lookup current chapter stage
        const chapterKey = `${item.project}:::${item.chapters}`;
        const currentStage = currentChapterStageMap.get(chapterKey) || item.stage_name;

        return {
          id: item.id,
          client: item.client || "—",
          projectCode: item.project || "—",
          projectTitle: projectTitleMap.get(item.project) || "—",
          chapterNumber: item.chapters || "—",
          stageName: item.stage_name || "—",
          currentStage,
          workflow: item.workflow || "—",
          assignee: item.assignee_name || "Unassigned",
          projectManager: item.project_manager_name || "—",
          plannedStart: sStart || "—",
          plannedEnd: sEnd || "—",
          actualStart: aStart || "—",
          actualEnd: aEnd || "—",
          stageStatus: isCompletedToday ? "Completed" : isDelayed ? "Delayed" : isYTS ? "YTS" : "In-progress",
          isTodayPlanned,
          isDelayed,
          isYTS,
          isInProgress,
          delayDays,
          isCompleted: isCompletedToday,
          roles: matchedRoles,
        };
      });
  }, [stageDetails, stageRolesMap, projectTitleMap, currentChapterStageMap]);

  // Match row against user team/role
  const matchesUserTeamRole = (row: OperationalRow): boolean => {
    // If specific team filter is chosen
    if (selectedTeam !== "auto" && selectedTeam !== "--ALL--") {
      const target = selectedTeam.toLowerCase();
      const stageMatch = row.stageName.toLowerCase().includes(target);
      const roleMatch = row.roles.some((r) => r.toLowerCase().includes(target));
      return stageMatch || roleMatch;
    }

    // Admin / Manager / Lead sees all operational tasks across the organisation
    if (userInfo.isAdmin) return true;

    // If user's team or role is not yet known or not assigned, don't blank out everything
    if (userInfo.roles.length === 0 && (!userInfo.team || userInfo.team === "All Departments" || userInfo.team === "Operations")) {
      return true;
    }

    // Auto team/role matching for departmental team members
    const userRoles = userInfo.roles.map((r) => r.toLowerCase());
    const userTeam = userInfo.team.toLowerCase();

    // Check if stage roles intersect with user roles
    const hasRoleMatch = row.roles.some((r) => {
      const rLow = r.toLowerCase();
      return userRoles.some((ur) => ur.includes(rLow) || rLow.includes(ur));
    });

    // Check if stage name matches team or role (e.g. "Pre-editing" matches "Pre Editor" or "Editorial")
    const stageLow = row.stageName.toLowerCase();
    const hasStageMatch =
      userRoles.some((ur) => {
        if (ur.includes("pre") && stageLow.includes("pre-edit")) return true;
        if (ur.includes("copy") && stageLow.includes("copyedit")) return true;
        if (ur.includes("composit") && (stageLow.includes("typeset") || stageLow.includes("correct"))) return true;
        if (ur.includes("xml") && (stageLow.includes("xml") || stageLow.includes("digital"))) return true;
        if (ur.includes("art") || ur.includes("graphic")) return stageLow.includes("art");
        if (ur.includes("quality") || ur.includes("qc")) return stageLow.includes("qc") || stageLow.includes("proof");
        if (ur.includes("project manager") || ur.includes("initiat") || ur.includes("analysis")) {
          return stageLow.includes("initiat") || stageLow.includes("analysis") || stageLow.includes("delivery");
        }
        return false;
      }) ||
      (userTeam && userTeam !== "operations" && userTeam !== "all departments" && stageLow.includes(userTeam.replace("team", "").trim()));

    // Assignee match
    const isAssignedToUser =
      (Boolean(userInfo.username) && row.assignee.toLowerCase() === userInfo.username.toLowerCase()) ||
      (Boolean(userInfo.name) && row.assignee.toLowerCase() === userInfo.name.toLowerCase());

    return hasRoleMatch || hasStageMatch || isAssignedToUser;
  };

  // Base rows filtered by team / role context
  const teamScopedRows = useMemo(() => {
    return allOperationalRows.filter(matchesUserTeamRole);
  }, [allOperationalRows, userInfo, selectedTeam]);

  // Available unique stages & clients from the user's mapped/scoped workload
  const allUniqueStages = useMemo(() => {
    return Array.from(new Set(teamScopedRows.map((r) => r.stageName).filter(Boolean))).sort();
  }, [teamScopedRows]);

  const allUniqueClients = useMemo(() => {
    return Array.from(new Set(teamScopedRows.map((r) => r.client).filter(Boolean))).sort();
  }, [teamScopedRows]);

  // Filtered operational rows based on filters (Client, Stage, Status, Date, Global Search)
  // excluding the activeTab filter, so that the KPI cards and tabs show accurate counts
  // for the current active filters (e.g. Stage = "Manuscript Analysis").
  const filteredBaseRows = useMemo(() => {
    return teamScopedRows.filter((row) => {
      // 1. Global search
      if (globalSearch.trim()) {
        const q = globalSearch.toLowerCase();
        const matches =
          row.projectCode.toLowerCase().includes(q) ||
          row.projectTitle.toLowerCase().includes(q) ||
          row.chapterNumber.toLowerCase().includes(q) ||
          row.stageName.toLowerCase().includes(q) ||
          row.assignee.toLowerCase().includes(q) ||
          row.client.toLowerCase().includes(q) ||
          row.workflow.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // 2. Client filter
      if (selectedClient !== "--ALL--" && row.client !== selectedClient) return false;

      // 3. Stage filter
      if (selectedStage !== "--ALL--" && row.stageName !== selectedStage) return false;

      // 4. Status filter
      if (statusFilter !== "--ALL--") {
        if (statusFilter === "Delayed" && !row.isDelayed) return false;
        if (statusFilter === "In-progress" && !row.isInProgress) return false;
        if (statusFilter === "YTS" && !row.isYTS) return false;
        if (statusFilter === "Completed" && !row.isCompleted) return false;
      }

      // 5. Planned Date Range
      if (startDateFrom && row.plannedStart !== "—" && row.plannedStart < startDateFrom) return false;
      if (startDateTo && row.plannedStart !== "—" && row.plannedStart > startDateTo) return false;

      return true;
    });
  }, [
    teamScopedRows,
    globalSearch,
    selectedClient,
    selectedStage,
    statusFilter,
    startDateFrom,
    startDateTo,
  ]);

  // Overall KPI counts dynamically updated based on the current filters:
  // Today planned -> total planned_start_date = today
  // delayed -> planned_end_date < today AND stage_status != 'Completed'
  // in-progress -> planned_end_date > today AND stage_status != 'Completed'
  // completed -> actual_end_date = today
  const kpis = useMemo(() => {
    const total = filteredBaseRows.length;
    const todayPlanned = filteredBaseRows.filter((r) => r.isTodayPlanned).length;
    const delayed = filteredBaseRows.filter((r) => r.isDelayed).length;
    const inProgress = filteredBaseRows.filter((r) => r.isInProgress).length;
    const yts = filteredBaseRows.filter((r) => r.isYTS).length;
    const completed = filteredBaseRows.filter((r) => r.isCompleted).length;
    const activeProjects = new Set(filteredBaseRows.map((r) => r.projectCode)).size;

    return {
      total,
      todayPlanned,
      delayed,
      inProgress,
      yts,
      completed,
      activeProjects,
    };
  }, [filteredBaseRows]);

  // Final filtered list based on active tab and sorted
  const filteredRows = useMemo(() => {
    let result = filteredBaseRows.filter((row) => {
      if (activeTab === "today" && !row.isTodayPlanned) return false;
      if (activeTab === "delayed" && !row.isDelayed) return false;
      if (activeTab === "inProgress" && !row.isInProgress) return false;
      if (activeTab === "yts" && !row.isYTS) return false;
      if (activeTab === "completed" && !row.isCompleted) return false;
      return true;
    });

    // Sort result
    result.sort((a, b) => {
      let valA = a[sortKey] as any;
      let valB = b[sortKey] as any;

      if (valA === "—") valA = "";
      if (valB === "—") valB = "";

      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [filteredBaseRows, activeTab, sortKey, sortDirection]);

  const hasActiveFilters = useMemo(() => {
    return (
      globalSearch.trim() !== "" ||
      selectedClient !== "--ALL--" ||
      selectedStage !== "--ALL--" ||
      statusFilter !== "--ALL--" ||
      startDateFrom !== "" ||
      startDateTo !== "" ||
      (selectedTeam !== "auto" && userInfo.isAdmin)
    );
  }, [
    globalSearch,
    selectedClient,
    selectedStage,
    statusFilter,
    startDateFrom,
    startDateTo,
    selectedTeam,
    userInfo.isAdmin,
  ]);

  const handleResetFilters = () => {
    setGlobalSearch("");
    setSelectedClient("--ALL--");
    setSelectedStage("--ALL--");
    setStatusFilter("--ALL--");
    setStartDateFrom("");
    setStartDateTo("");
    setSelectedTeam("auto");
    setActiveTab("all");
    setSortKey("plannedEnd");
    setSortDirection("asc");
  };

  const handleSort = (key: keyof OperationalRow) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    const exportData = filteredRows.map((r) => ({
      Client: r.client,
      "Project Code": r.projectCode,
      "Project Title": r.projectTitle,
      Chapter: r.chapterNumber,
      "Planned Stage": r.stageName,
      "Current Stage": r.currentStage,
      Assignee: r.assignee,
      "Project Manager": r.projectManager,
      "Planned Start": r.plannedStart,
      "Planned End": r.plannedEnd,
      "Actual Start": r.actualStart,
      "Actual End": r.actualEnd,
      "Stage Status": r.stageStatus,
      "Today Planned": r.isTodayPlanned ? "Yes" : "No",
      Delayed: r.isDelayed ? `Yes (${r.delayDays} days)` : "No",
      Workflow: r.workflow,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Daily Operations");
    XLSX.writeFile(
      workbook,
      `daily-operations-${userInfo.team.toLowerCase().replace(/\s+/g, "-")}-${getTodayDateString()}.xlsx`
    );
  };

  return (
    <div className="space-y-5 p-1 max-w-[1700px] mx-auto animate-in fade-in duration-300">
      {/* ── Top Header Banner ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-card via-card to-violet-500/5 p-5 rounded-2xl border border-border shadow-sm">
        <div className="flex items-center gap-3.5">
          <button
            onClick={() => navigate("/reports")}
            className="p-2.5 rounded-xl bg-surface hover:bg-card border border-border text-muted hover:text-text transition-all hover:scale-105 active:scale-95 shadow-xs"
            aria-label="Back to Reports"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-text">Daily Operations Dashboard</h1>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 flex items-center gap-1">
                <CalendarDays size={12} />
                Today: {getTodayDateString()}
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              Today&apos;s planned and delayed chapters tailored for your team&apos;s active workflow.
            </p>
          </div>
        </div>

        {/* User Context & Admin Role Switcher */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-3.5 py-2 text-xs shadow-xs">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              {userInfo.isAdmin ? <ShieldCheck size={15} /> : <Users size={15} />}
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-text">{userInfo.name}</span>
                {userInfo.isAdmin && (
                  <span className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.2 rounded border border-emerald-500/20">
                    Admin (All Teams)
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted">
                Role: <strong>{userInfo.roles[0] || "Team Member"}</strong> | Team: <strong>{userInfo.team}</strong>
              </span>
            </div>
          </div>

          {/* Team Scope Switcher - Only visible to Admins/Managers to view other team workloads */}
          {userInfo.isAdmin && (
            <div className="flex items-center gap-1.5 bg-surface border border-border rounded-xl px-3 py-1.5 shadow-xs">
              <span className="text-[11px] font-semibold text-muted">Team Scope:</span>
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="bg-transparent text-xs font-semibold text-text outline-none cursor-pointer"
              >
                <option value="auto">All Teams (Admin Overview)</option>
                <option value="--ALL--">Show All Company Stages</option>
                <option value="initiat">Job Initiation</option>
                <option value="pre-edit">Pre-editing Team</option>
                <option value="editorial">Editorial / Copyediting</option>
                <option value="typesetting">Typesetting / Composition</option>
                <option value="xml">XML Conversion / Digital</option>
                <option value="art">Art &amp; Graphics</option>
                <option value="proof">Proofreading &amp; QC</option>
                <option value="project manager">Project Management</option>
              </select>
            </div>
          )}

          <button
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-text hover:bg-card hover:text-emerald-600 transition-all shadow-xs"
            title="Export view to Excel"
          >
            <Download size={13} className="text-emerald-500" />
            Excel
          </button>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 text-white font-semibold shadow-sm hover:bg-rose-700 active:scale-95 px-3 py-2 text-xs transition-all ring-2 ring-rose-500/20"
              title="Reset all filters"
            >
              <RotateCcw size={13} />
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* ── KPI Metric Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        {/* Today's Planned */}
        <div
          onClick={() => setActiveTab(activeTab === "today" ? "all" : "today")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            activeTab === "today" ? "border-violet-500 ring-2 ring-violet-500/20 bg-violet-500/5" : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Today&apos;s Planned</p>
            <p className="text-2xl font-bold text-violet-600 dark:text-violet-400 mt-1">{kpis.todayPlanned}</p>
            <span className="text-[10px] text-muted font-medium">planned_start = today</span>
          </div>
          <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-600 border border-violet-500/20">
            <CalendarDays size={20} />
          </div>
        </div>

        {/* Delayed / Overdue */}
        <div
          onClick={() => setActiveTab(activeTab === "delayed" ? "all" : "delayed")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            activeTab === "delayed" ? "border-rose-500 ring-2 ring-rose-500/20 bg-rose-500/5" : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Delayed</p>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">{kpis.delayed}</p>
            <span className="text-[10px] text-rose-500/90 font-medium">planned_end &lt; today</span>
          </div>
          <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-600 border border-rose-500/20">
            <AlertTriangle size={20} />
          </div>
        </div>

        {/* In-Progress */}
        <div
          onClick={() => setActiveTab(activeTab === "inProgress" ? "all" : "inProgress")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            activeTab === "inProgress" ? "border-sky-500 ring-2 ring-sky-500/20 bg-sky-500/5" : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">In-Progress</p>
            <p className="text-2xl font-bold text-sky-600 dark:text-sky-400 mt-1">{kpis.inProgress}</p>
            <span className="text-[10px] text-muted font-medium">actual_start is set</span>
          </div>
          <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-600 border border-sky-500/20">
            <Clock size={20} />
          </div>
        </div>

        {/* YTS (Yet to Start) */}
        <div
          onClick={() => setActiveTab(activeTab === "yts" ? "all" : "yts")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            activeTab === "yts" ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-500/5" : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">YTS</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{kpis.yts}</p>
            <span className="text-[10px] text-muted font-medium">no start &amp; end &gt;= today</span>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20">
            <Clock size={20} />
          </div>
        </div>

        {/* Completed */}
        <div
          onClick={() => setActiveTab(activeTab === "completed" ? "all" : "completed")}
          className={`cursor-pointer bg-card border rounded-2xl p-4 shadow-xs transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-between ${
            activeTab === "completed" ? "border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/5" : "border-border/80"
          }`}
        >
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Completed</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{kpis.completed}</p>
            <span className="text-[10px] text-muted font-medium">actual_end = today</span>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
            <CheckCircle2 size={20} />
          </div>
        </div>
      </div>

      {/* ── Interactive Filter & Tab Toolbar ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-card p-4 rounded-2xl border border-border shadow-xs">
        {/* Tab Pills */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-surface rounded-xl border border-border/80">
          <button
            onClick={() => setActiveTab("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "all"
                ? "bg-card text-text shadow-xs border border-border font-bold"
                : "text-muted hover:text-text"
            }`}
          >
            All Workload ({kpis.total})
          </button>
          <button
            onClick={() => setActiveTab("today")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === "today"
                ? "bg-violet-600 text-white shadow-xs font-bold"
                : "text-muted hover:text-violet-600"
            }`}
          >
            <CalendarDays size={12} />
            Today&apos;s Planned ({kpis.todayPlanned})
          </button>
          <button
            onClick={() => setActiveTab("delayed")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === "delayed"
                ? "bg-rose-600 text-white shadow-xs font-bold"
                : "text-muted hover:text-rose-600"
            }`}
          >
            <AlertTriangle size={12} />
            Delayed ({kpis.delayed})
          </button>
          <button
            onClick={() => setActiveTab("inProgress")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === "inProgress"
                ? "bg-sky-600 text-white shadow-xs font-bold"
                : "text-muted hover:text-sky-600"
            }`}
          >
            <Clock size={12} />
            In-Progress ({kpis.inProgress})
          </button>
          <button
            onClick={() => setActiveTab("yts")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === "yts"
                ? "bg-amber-600 text-white shadow-xs font-bold"
                : "text-muted hover:text-amber-600"
            }`}
          >
            <Clock size={12} />
            YTS ({kpis.yts})
          </button>
          <button
            onClick={() => setActiveTab("completed")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === "completed"
                ? "bg-emerald-600 text-white shadow-xs font-bold"
                : "text-muted hover:text-emerald-600"
            }`}
          >
            <CheckCircle2 size={12} />
            Completed ({kpis.completed})
          </button>
        </div>

        {/* Global Search & Filter Toggle */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search code, title, stage, assignee..."
              className="w-full bg-surface border border-border rounded-xl pl-9 pr-8 py-2 text-xs text-text placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-xs transition-all"
            />
            {globalSearch && (
              <button
                onClick={() => setGlobalSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all shadow-xs ${showFilters
              ? "bg-primary/10 text-primary border-primary/30"
              : "bg-surface border-border text-text hover:bg-card"
              }`}
          >
            <Filter size={14} />
            Filters
            {hasActiveFilters && (
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* ── Collapsible Column Filters Row ── */}
      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-4 bg-card rounded-2xl border border-border shadow-xs animate-in fade-in duration-200">
          {/* Client Filter */}
          <div>
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">Client</label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary shadow-xs"
            >
              <option value="--ALL--">All Clients</option>
              {allUniqueClients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Stage Filter */}
          <div>
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">Stage</label>
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary shadow-xs"
            >
              <option value="--ALL--">All Stages</option>
              {allUniqueStages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary shadow-xs"
            >
              <option value="--ALL--">All Statuses</option>
              <option value="Delayed">Delayed / Overdue</option>
              <option value="In-progress">In-Progress</option>
              <option value="YTS">YTS (Yet to Start)</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          {/* Planned Start From */}
          <div>
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">Planned Start From</label>
            <input
              type="date"
              value={startDateFrom}
              onChange={(e) => setStartDateFrom(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary shadow-xs"
            />
          </div>

          {/* Planned Start To */}
          <div>
            <label className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-1">Planned Start To</label>
            <input
              type="date"
              value={startDateTo}
              onChange={(e) => setStartDateTo(e.target.value)}
              className="w-full rounded-lg border border-border/80 bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-primary shadow-xs"
            />
          </div>
        </div>
      )}

      {/* ── Operational Workload Table ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-24 border border-border bg-card rounded-2xl min-h-[350px] shadow-sm">
          <Spinner size="lg" />
          <span className="text-xs text-muted mt-3 font-medium tracking-wide">
            Loading today&apos;s operational schedule details…
          </span>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl shadow-xs overflow-hidden flex flex-col">
          {/* Scrollable Container with sticky header */}
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-320px)] scrollbar-thin scrollbar-thumb-border/60 hover:scrollbar-thumb-border">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-20 shadow-xs bg-card">
                <tr className="border-b border-border bg-card text-left text-[11px] font-bold uppercase tracking-wider text-muted select-none">
                  <th
                    onClick={() => handleSort("client")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Client
                  </th>
                  <th
                    onClick={() => handleSort("projectCode")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Project Code
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap bg-card">Project Title</th>
                  <th
                    onClick={() => handleSort("chapterNumber")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Chapter
                  </th>
                  <th
                    onClick={() => handleSort("workflow")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Workflow
                  </th>
                  <th
                    onClick={() => handleSort("stageName")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Planned Stage
                  </th>
                  <th
                    onClick={() => handleSort("currentStage")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Current Stage
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap bg-card">Assignee</th>
                  <th
                    onClick={() => handleSort("plannedStart")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Planned Start
                  </th>
                  <th
                    onClick={() => handleSort("plannedEnd")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Planned End
                  </th>
                  <th
                    onClick={() => handleSort("actualStart")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Actual Start
                  </th>
                  <th
                    onClick={() => handleSort("actualEnd")}
                    className="px-3.5 py-3 whitespace-nowrap cursor-pointer hover:bg-muted/20 transition-colors bg-card"
                  >
                    Actual End
                  </th>
                  <th className="px-3.5 py-3 whitespace-nowrap bg-card">Operational Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border/60 text-xs">
                {filteredRows.length > 0 ? (
                  filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`hover:bg-surface/60 transition-colors ${row.isDelayed
                        ? "bg-rose-500/5 hover:bg-rose-500/10"
                        : row.isTodayPlanned
                          ? "bg-violet-500/5 hover:bg-violet-500/10"
                          : ""
                        }`}
                    >
                      {/* Client */}
                      <td className="px-3.5 py-3 font-semibold text-text whitespace-nowrap">
                        {row.client}
                      </td>

                      {/* Project Code */}
                      <td className="px-3.5 py-3 font-bold text-text whitespace-nowrap">
                        <span className="font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20">
                          {row.projectCode}
                        </span>
                      </td>

                      {/* Project Title */}
                      <td className="px-3.5 py-3 text-text font-medium max-w-[260px] truncate" title={row.projectTitle}>
                        {row.projectTitle}
                      </td>

                      {/* Chapter */}
                      <td className="px-3.5 py-3 font-semibold text-text whitespace-nowrap">
                        {row.chapterNumber.startsWith("Ch ") ||
                          row.chapterNumber.toLowerCase().includes("design") ||
                          row.chapterNumber.toLowerCase().includes("ce support")
                          ? row.chapterNumber
                          : `Chapter ${row.chapterNumber}`}
                      </td>

                      {/* Workflow */}
                      <td className="px-3.5 py-3 text-muted whitespace-nowrap text-[11px]">
                        {row.workflow}
                      </td>

                      {/* Planned Stage Name */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-semibold text-text">
                          {row.stageName}
                        </span>
                      </td>

                      {/* Current Stage Name */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-secondary/10 text-secondary border border-secondary/20">
                          {row.currentStage}
                        </span>
                      </td>

                      {/* Assignee */}
                      <td className="px-3.5 py-3 text-text whitespace-nowrap">
                        {row.assignee !== "Unassigned" ? (
                          <span className="font-medium">{row.assignee}</span>
                        ) : (
                          <span className="text-muted italic">Unassigned</span>
                        )}
                      </td>

                      {/* Planned Start */}
                      <td className="px-3.5 py-3 text-muted whitespace-nowrap font-mono">
                        {row.plannedStart}
                      </td>

                      {/* Planned End */}
                      <td className="px-3.5 py-3 whitespace-nowrap font-mono">
                        <span
                          className={
                            row.isDelayed
                              ? "text-rose-600 font-bold"
                              : row.isTodayPlanned
                                ? "text-violet-600 font-bold"
                                : "text-muted"
                          }
                        >
                          {row.plannedEnd}
                        </span>
                      </td>

                      {/* Actual Start */}
                      <td className="px-3.5 py-3 text-muted whitespace-nowrap font-mono">
                        {row.actualStart !== "—" ? (
                          <span className="text-text font-medium">{row.actualStart}</span>
                        ) : (
                          <span className="text-muted/60">—</span>
                        )}
                      </td>

                      {/* Actual End */}
                      <td className="px-3.5 py-3 whitespace-nowrap font-mono">
                        {row.actualEnd !== "—" ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            {row.actualEnd}
                          </span>
                        ) : (
                          <span className="text-muted/60">—</span>
                        )}
                      </td>

                      {/* Status Badges */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {row.isDelayed && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                              <AlertTriangle size={11} />
                              Delayed ({row.delayDays}d)
                            </span>
                          )}

                          {row.isTodayPlanned && !row.isDelayed && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30">
                              <Clock size={11} />
                              Today Planned
                            </span>
                          )}

                          {row.isCompleted && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 size={11} />
                              Completed
                            </span>
                          )}

                          {row.isYTS && !row.isDelayed && !row.isCompleted && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                              <Clock size={11} />
                              YTS
                            </span>
                          )}

                          {!row.isDelayed && !row.isTodayPlanned && !row.isCompleted && !row.isYTS && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface text-muted border border-border">
                              {row.stageStatus}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={13} className="px-4 py-16 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center">
                        <div className="rounded-2xl bg-surface p-4 text-muted border border-border shadow-xs">
                          <CalendarDays size={32} />
                        </div>
                        <h3 className="mt-3.5 text-sm font-semibold text-text">No operational tasks match your criteria</h3>
                        <p className="mt-1 text-xs text-muted">
                          Try switching to another tab, clearing active filters, or expanding the team scope.
                        </p>
                        {hasActiveFilters && (
                          <button
                            onClick={handleResetFilters}
                            className="mt-3.5 text-xs font-semibold text-primary hover:underline"
                          >
                            Reset all filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="px-4 py-2.5 border-t border-border bg-surface-subtle/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-muted">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Showing <strong className="text-text font-semibold">{filteredRows.length}</strong> tasks
                {filteredRows.length !== teamScopedRows.length && (
                  <span> (out of {teamScopedRows.length} team tasks)</span>
                )}
              </span>
              {hasActiveFilters && (
                <button
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold border border-rose-500/20 transition-all cursor-pointer"
                >
                  <RotateCcw size={11} />
                  Clear filters
                </button>
              )}
            </div>
            <span className="text-[11px]">
              Active Team Scope: <strong className="text-text">{selectedTeam === "auto" ? (userInfo.isAdmin ? "All Departments" : userInfo.team) : selectedTeam}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TodaySchedule;
