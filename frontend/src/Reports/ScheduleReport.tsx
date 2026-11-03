import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Filter,
  RefreshCw,
  Download,
  FileText,
  Building2,
  ArrowLeft,
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle2,
  CalendarDays,
  Users,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import api from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useRBAC } from "@/hooks/useRBAC";
import { Spinner } from "@/components/ui/Spinner";
import { Dropdown } from "@/components/ui/Dropdown";

type CategoryTab = "all" | "delay" | "delayYts" | "inProgress" | "yts" | "todayPlanned" | "upcomingPlanned";

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

export interface ChapterInfoRecord {
  id: number;
  client: string;
  project: string;
  chapters: string;
  chapter_title: string | null;
  project_manager_name: string | null;
  due_date: string | null;
  stage_name: string | null;
  current_assignee_name: string | null;
  status: string;
  manuscript_pages: number | null;
  created_at: string;
}

export interface UserLookupItem {
  id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  role: string | null;
}

export interface OperationalRow {
  id: number;
  client: string;
  projectCode: string;
  projectTitle: string;
  chapter: string;
  receivedDate: string;
  dueDate: string;
  mssCount: number | string;
  stage: string;
  assignee: string;
  projectManager: string;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate: string;
  actualEndDate: string;
  status: string;
  delayDays: number;
  // Category flags
  isDelay: boolean;
  isDelayYts: boolean;
  isInProgress: boolean;
  isYTS: boolean;
  isTodayPlanned: boolean;
  isUpcomingPlanned: boolean;
  isCompleted: boolean;
  stageRoles: string[];
  sortPriority: number;
}

const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateOnly = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "—";
  if (dateStr.includes("T")) return dateStr.split("T")[0];
  if (dateStr.includes(" ")) return dateStr.split(" ")[0];
  return dateStr;
};

const PAGE_BATCH_SIZE = 25;

const ScheduleReport = () => {
  const navigate = useNavigate();
  const { user: authUser } = useAuthStore();
  const sessionViewer = useSessionStore((s) => s.viewer);
  const rbac = useRBAC();

  const [loading, setLoading] = useState(true);
  const [stageDetails, setStageDetails] = useState<StageDetailRecord[]>([]);
  const [stagesMaster, setStagesMaster] = useState<StageMasterRecord[]>([]);
  const [chapterInfos, setChapterInfos] = useState<ChapterInfoRecord[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [usersLookup, setUsersLookup] = useState<UserLookupItem[]>([]);

  // Filtering states
  const [activeTab, setActiveTab] = useState<CategoryTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [clientFilter, setClientFilter] = useState("--ALL--");
  const [stageFilter, setStageFilter] = useState("--ALL--");
  const [statusFilter, setStatusFilter] = useState("--ALL--");
  const [receivedFrom, setReceivedFrom] = useState("");
  const [receivedTo, setReceivedTo] = useState("");
  const [dueAsOn, setDueAsOn] = useState("");
  const [showFilters, setShowFilters] = useState(true);

  // Lazy loading state: number of items currently rendered
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_BATCH_SIZE);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Admin team scope selector
  const [selectedTeamScope, setSelectedTeamScope] = useState<string>("auto");

  // Fetch live data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [detailsRes, stagesRes, chaptersRes, projectsRes, usersRes] = await Promise.all([
        api.get<StageDetailRecord[]>("/api/v1/stage-details?limit=1000000").then((r) => r.data).catch(() => []),
        api.get<StageMasterRecord[]>("/api/v1/stages?limit=100000").then((r) => r.data).catch(() => []),
        api.get<ChapterInfoRecord[]>("/api/v1/chapter-infos?skip=0&limit=10000").then((r) => r.data).catch(() => []),
        api.get<any>("/projects?limit=100000").then((r) => r.data?.projects || r.data || []).catch(() => []),
        api.get<UserLookupItem[]>("/api/v1/users-lookup").then((r) => r.data).catch(() => []),
      ]);

      setStageDetails(detailsRes || []);
      setStagesMaster(stagesRes || []);
      setChapterInfos(chaptersRes || []);
      setProjectsList(Array.isArray(projectsRes) ? projectsRes : []);
      setUsersLookup(usersRes || []);
    } catch (err) {
      console.error("Failed to load Schedules Report data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // User display name helper
  const getUserDisplayName = useCallback(
    (identifier: string | null | undefined): string => {
      if (!identifier || identifier === "—" || identifier.toLowerCase() === "unassigned") {
        return "—";
      }
      const raw = identifier.trim();
      const match = usersLookup.find(
        (u) =>
          u.username.toLowerCase() === raw.toLowerCase() ||
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

  // Determine user identity, roles & admin status
  const userInfo = useMemo(() => {
    const sessionRoles = sessionViewer?.roles || [];
    const authStoreRoles = (authUser?.roles || []).map((r) =>
      typeof r === "string" ? r : r.name || ""
    );
    const userRoleStr = (authUser as any)?.role || (sessionViewer as any)?.role || "";
    const allRoles = Array.from(new Set([...sessionRoles, ...authStoreRoles, userRoleStr])).filter(Boolean);

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

  // Stage name to roles mapping
  const stageRolesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const sm of stagesMaster) {
      if (sm.stage_name) {
        map.set(sm.stage_name.toLowerCase().trim(), sm.roles || []);
      }
    }
    return map;
  }, [stagesMaster]);

  // Project code to title mapping
  const projectTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsList) {
      const code = p.code || p.project_code || "";
      const title = p.title || p.project_title || "";
      if (code) map.set(code, title);
    }
    return map;
  }, [projectsList]);

  // Chapter details mapping keyed by project:::chapters
  const chapterDetailsMap = useMemo(() => {
    const map = new Map<string, ChapterInfoRecord>();
    for (const ch of chapterInfos) {
      const key = `${ch.project}:::${ch.chapters}`;
      map.set(key, ch);
    }
    return map;
  }, [chapterInfos]);

  // Team to stages mapping (for team scope dropdown for admin)
  const teamStageMapping: Record<string, string[]> = useMemo(
    () => ({
      "Job Initiation": ["Job Initiation"],
      "Pre-editing Team": ["Manuscript Analysis", "Pre-editing", "Non-XML Processing"],
      "Editorial / Copyediting": ["Copyediting", "Reprint", "Corrections & 2P"],
      "Typesetting / Composition": ["Template Processing", "Typesetting", "Proofreading"],
      "XML Conversion / Digital": ["AQ Resolution", "XML"],
      "Art & Graphics": ["Art Processing"],
      "Proofreading & QC": ["Proofreading"],
      "Project Management": ["Delivery", "Job Initiation"],
    }),
    []
  );

  // Check if a stage matches the user's role strictly
  const matchesUserTeamRole = useMemo(() => {
    return (stageName: string, itemAssignee?: string | null) => {
      const lowStage = (stageName || "").toLowerCase().trim();
      const mappedRoles = stageRolesMap.get(lowStage) || [];

      // If Admin and specific team scope chosen
      if (userInfo.isAdmin) {
        if (selectedTeamScope === "all" || selectedTeamScope === "auto") {
          return true;
        }
        const allowedStages = teamStageMapping[selectedTeamScope];
        if (allowedStages) {
          return allowedStages.some((s) => s.toLowerCase() === lowStage);
        }
        return true;
      }

      // Check direct assignment
      if (
        (itemAssignee && userInfo.username && itemAssignee.toLowerCase() === userInfo.username.toLowerCase()) ||
        (itemAssignee && userInfo.name && itemAssignee.toLowerCase() === userInfo.name.toLowerCase())
      ) {
        return true;
      }

      // If user has roles, strictly match mapped roles for that stage in stage_master
      const userRoles = userInfo.roles.map((r) => r.toLowerCase().trim()).filter(Boolean);
      if (userRoles.length > 0) {
        const hasRoleMatch = mappedRoles.some((mr) => {
          const mrLow = mr.toLowerCase().trim();
          return userRoles.some((ur) => ur === mrLow || ur.includes(mrLow) || mrLow.includes(ur));
        });
        return hasRoleMatch;
      }

      // Fallback: If user has no roles defined, fall back to team match
      const teamLow = userInfo.team.toLowerCase();
      if (teamLow.includes("pre-edit") && lowStage.includes("pre-edit")) return true;
      if (teamLow.includes("editorial") && (lowStage.includes("pre-edit") || lowStage.includes("copyedit"))) return true;
      if (teamLow.includes("typeset") && (lowStage.includes("typeset") || lowStage.includes("template"))) return true;
      if (teamLow.includes("art") && lowStage.includes("art")) return true;
      if (teamLow.includes("xml") && (lowStage.includes("xml") || lowStage.includes("digital"))) return true;

      return false;
    };
  }, [userInfo, selectedTeamScope, stageRolesMap, teamStageMapping]);

  // Construct operational rows
  const allRows: OperationalRow[] = useMemo(() => {
    const todayStr = getTodayDateString();

    return stageDetails.map((detail) => {
      const sStart = formatDateOnly(detail.planned_start_date);
      const sEnd = formatDateOnly(detail.planned_end_date);
      const aStart = formatDateOnly(detail.actual_start_date);
      const aEnd = formatDateOnly(detail.actual_end_date);

      const statusLow = (detail.stage_status || "").toLowerCase().trim();
      const isCompleted = statusLow === "completed" || statusLow === "complete";

      // Match chapter info
      const chKey = `${detail.project}:::${detail.chapters}`;
      const chInfo = chapterDetailsMap.get(chKey);

      const receivedDate = chInfo ? formatDateOnly(chInfo.created_at) : "—";
      const dueDate = chInfo ? formatDateOnly(chInfo.due_date) : "—";
      const mssCount = chInfo?.manuscript_pages != null ? chInfo.manuscript_pages : "—";

      // Operational categorization:
      // 1. Delay: planned_end < today && actual_start is set && !isCompleted
      const isDelay = sEnd !== "—" && sEnd < todayStr && aStart !== "—" && !isCompleted;

      // 2. Delay YTS: planned_end < today && actual_start is NOT set && !isCompleted
      const isDelayYts = sEnd !== "—" && sEnd < todayStr && aStart === "—" && !isCompleted;

      // 3. In-Progress: planned_end >= today && actual_start is set && !isCompleted
      const isInProgress = (sEnd === "—" || sEnd >= todayStr) && aStart !== "—" && !isCompleted;

      // 4. Today Planned: planned_start === today
      const isTodayPlanned = sStart !== "—" && sStart === todayStr;

      // 5. Upcoming Planned: planned_start > today && actual_start is NOT set && !isCompleted
      const isUpcomingPlanned = sStart !== "—" && sStart > todayStr && aStart === "—" && !isCompleted;

      // 6. YTS (Yet To Start): not started, not completed, deadline is not passed (sEnd >= today), but planned_start < today
      const isYTS = !isCompleted && !isDelay && !isDelayYts && aStart === "—" && (sEnd === "—" || sEnd >= todayStr) && sStart !== "—" && sStart < todayStr;

      // Operational Status string & sort priority:
      // Requested Priority order: Delay (1) -> Delay YTS (2) -> In-Progress (3) -> YTS (4) -> Today Planned (5) -> Upcoming Planned (6) -> Completed (7)
      let displayStatus = "Planned";
      let delayDays = detail.delay_days || 0;
      let sortPriority = 6;

      if (isDelay) {
        sortPriority = 1;
        if (!delayDays && sEnd !== "—") {
          const diffMs = new Date(todayStr).getTime() - new Date(sEnd).getTime();
          delayDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        }
        displayStatus = `Delay (${delayDays}d)`;
      } else if (isDelayYts) {
        sortPriority = 2;
        if (!delayDays && sEnd !== "—") {
          const diffMs = new Date(todayStr).getTime() - new Date(sEnd).getTime();
          delayDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        }
        displayStatus = `Delay YTS (${delayDays}d)`;
      } else if (isInProgress) {
        sortPriority = 3;
        displayStatus = "In-Progress";
      } else if (isYTS) {
        sortPriority = 4;
        displayStatus = "YTS";
      } else if (isTodayPlanned) {
        sortPriority = 5;
        displayStatus = "Today Planned";
      } else if (isUpcomingPlanned) {
        sortPriority = 6;
        displayStatus = "Upcoming Planned";
      } else if (isCompleted) {
        sortPriority = 7;
        displayStatus = "Completed";
      } else if (aStart === "—" && (sEnd === "—" || sEnd >= todayStr)) {
        sortPriority = 4;
        displayStatus = "YTS";
      }

      const lowStage = (detail.stage_name || "").toLowerCase().trim();
      const roles = stageRolesMap.get(lowStage) || [];
      const projectTitle = projectTitleMap.get(detail.project) || "—";

      // Formatted user names (Ann Mary Francis, Muthukumar S, etc.)
      const assigneeFormatted = detail.assignee_name
        ? getUserDisplayName(detail.assignee_name)
        : "Unassigned";
      const pmFormatted = detail.project_manager_name
        ? getUserDisplayName(detail.project_manager_name)
        : "—";

      return {
        id: detail.id,
        client: detail.client || "—",
        projectCode: detail.project,
        projectTitle,
        chapter: detail.chapters || "—",
        receivedDate,
        dueDate,
        mssCount,
        stage: detail.stage_name,
        assignee: assigneeFormatted,
        projectManager: pmFormatted,
        plannedStartDate: sStart,
        plannedEndDate: sEnd,
        actualStartDate: aStart,
        actualEndDate: aEnd,
        status: displayStatus,
        delayDays,
        isDelay,
        isDelayYts,
        isInProgress,
        isYTS,
        isTodayPlanned,
        isUpcomingPlanned,
        isCompleted,
        stageRoles: roles,
        sortPriority,
      };
    });
  }, [stageDetails, chapterDetailsMap, projectTitleMap, stageRolesMap, getUserDisplayName]);

  // Filter rows by user's mapped roles (or admin team scope)
  const scopedRows = useMemo(() => {
    return allRows.filter((row) => matchesUserTeamRole(row.stage, row.assignee));
  }, [allRows, matchesUserTeamRole]);

  // Role-scoped stage options for dropdown
  const stageOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of scopedRows) {
      if (r.stage) set.add(r.stage);
    }
    return ["--ALL--", ...Array.from(set).sort()];
  }, [scopedRows]);

  // Client options based on scoped rows
  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of scopedRows) {
      if (r.client && r.client !== "—") set.add(r.client);
    }
    return ["--ALL--", ...Array.from(set).sort()];
  }, [scopedRows]);

  // Status options
  const statusOptions = useMemo(() => {
    return [
      "--ALL--",
      "Delay",
      "Delay YTS",
      "In-Progress",
      "YTS",
      "Today Planned",
      "Upcoming Planned",
      "Completed",
    ];
  }, []);

  // Category counts for KPI cards and tabs
  const categoryCounts = useMemo(() => {
    let delay = 0;
    let delayYts = 0;
    let inProgress = 0;
    let yts = 0;
    let todayPlanned = 0;
    let upcomingPlanned = 0;

    for (const r of scopedRows) {
      if (r.isDelay) delay++;
      if (r.isDelayYts) delayYts++;
      if (r.isInProgress) inProgress++;
      if (r.isYTS) yts++;
      if (r.isTodayPlanned) todayPlanned++;
      if (r.isUpcomingPlanned) upcomingPlanned++;
    }

    return {
      all: scopedRows.length,
      delay,
      delayYts,
      inProgress,
      yts,
      todayPlanned,
      upcomingPlanned,
    };
  }, [scopedRows]);

  // Filter by active tab, dropdowns, dates, and search;
  // Always sorted strictly by: Delay -> Delay YTS -> In-Progress -> Today Planned -> Upcoming Planned -> YTS -> Completed
  const filteredRows = useMemo(() => {
    const rows = scopedRows.filter((row) => {
      // 1. Tab filter
      if (activeTab === "delay" && !row.isDelay) return false;
      if (activeTab === "delayYts" && !row.isDelayYts) return false;
      if (activeTab === "inProgress" && !row.isInProgress) return false;
      if (activeTab === "yts" && !row.isYTS) return false;
      if (activeTab === "todayPlanned" && !row.isTodayPlanned) return false;
      if (activeTab === "upcomingPlanned" && !row.isUpcomingPlanned) return false;

      // 2. Client filter
      if (clientFilter !== "--ALL--" && row.client !== clientFilter) return false;

      // 3. Stage filter
      if (stageFilter !== "--ALL--" && row.stage !== stageFilter) return false;

      // 4. Status filter
      if (statusFilter !== "--ALL--") {
        if (statusFilter === "Delay" && !row.isDelay) return false;
        if (statusFilter === "Delay YTS" && !row.isDelayYts) return false;
        if (statusFilter === "In-Progress" && !row.isInProgress) return false;
        if (statusFilter === "YTS" && !row.isYTS) return false;
        if (statusFilter === "Today Planned" && !row.isTodayPlanned) return false;
        if (statusFilter === "Upcoming Planned" && !row.isUpcomingPlanned) return false;
        if (statusFilter === "Completed" && !row.isCompleted) return false;
      }

      // 5. Received Date range filter
      if (receivedFrom && row.receivedDate !== "—" && row.receivedDate < receivedFrom) {
        return false;
      }
      if (receivedTo && row.receivedDate !== "—" && row.receivedDate > receivedTo) {
        return false;
      }

      // 6. Due as on filter
      if (dueAsOn && row.dueDate !== "—" && row.dueDate > dueAsOn) {
        return false;
      }

      // 7. Global Search
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matches =
          row.client.toLowerCase().includes(query) ||
          row.projectCode.toLowerCase().includes(query) ||
          row.projectTitle.toLowerCase().includes(query) ||
          row.chapter.toLowerCase().includes(query) ||
          row.stage.toLowerCase().includes(query) ||
          row.assignee.toLowerCase().includes(query) ||
          row.projectManager.toLowerCase().includes(query) ||
          row.status.toLowerCase().includes(query);
        if (!matches) return false;
      }

      return true;
    });

    // Sort order: Delay -> Delay YTS -> In-Progress -> Today Planned -> Upcoming Planned
    return [...rows].sort((a, b) => {
      if (a.sortPriority !== b.sortPriority) {
        return a.sortPriority - b.sortPriority;
      }
      // If both are delays, sort by highest delay days first
      if (a.sortPriority === 1 || a.sortPriority === 2) {
        return b.delayDays - a.delayDays;
      }
      // Secondary sort by planned end date
      const endA = a.plannedEndDate || "";
      const endB = b.plannedEndDate || "";
      if (endA && endB && endA !== endB) return endA.localeCompare(endB);
      return a.id - b.id;
    });
  }, [scopedRows, activeTab, clientFilter, stageFilter, statusFilter, receivedFrom, receivedTo, dueAsOn, searchTerm]);

  // Reset visibleCount whenever the active tab, filters, or search term change
  useEffect(() => {
    setVisibleCount(PAGE_BATCH_SIZE);
  }, [activeTab, clientFilter, stageFilter, statusFilter, receivedFrom, receivedTo, dueAsOn, searchTerm]);

  // Displayed rows per lazy-loaded window
  const displayedRows = useMemo(() => {
    return filteredRows.slice(0, visibleCount);
  }, [filteredRows, visibleCount]);

  // Infinite scroll listener on table viewport container
  const handleScroll = useCallback(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // When user scrolls within 180px of the bottom, load the next batch
    if (scrollHeight - scrollTop - clientHeight < 180) {
      setVisibleCount((prev) => {
        if (prev < filteredRows.length) {
          return Math.min(prev + PAGE_BATCH_SIZE, filteredRows.length);
        }
        return prev;
      });
    }
  }, [filteredRows.length]);

  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Reset all filters
  const resetFilters = () => {
    setActiveTab("all");
    setClientFilter("--ALL--");
    setStageFilter("--ALL--");
    setStatusFilter("--ALL--");
    setReceivedFrom("");
    setReceivedTo("");
    setDueAsOn("");
    setSearchTerm("");
    setVisibleCount(PAGE_BATCH_SIZE);
  };

  // Status Badge styling
  const renderStatusBadge = (row: OperationalRow) => {
    if (row.isCompleted) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
          <CheckCircle2 size={11} /> Completed
        </span>
      );
    }
    if (row.isDelay) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 ring-1 ring-red-300">
          <AlertTriangle size={11} /> Delay {row.delayDays > 0 ? `(${row.delayDays}d)` : ""}
        </span>
      );
    }
    if (row.isDelayYts) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 ring-1 ring-rose-200">
          <AlertTriangle size={11} /> Delay YTS {row.delayDays > 0 ? `(${row.delayDays}d)` : ""}
        </span>
      );
    }
    if (row.isInProgress) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
          <Clock size={11} /> In-Progress
        </span>
      );
    }
    if (row.isTodayPlanned) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-violet-50 text-violet-700 ring-1 ring-violet-200">
          <CalendarDays size={11} /> Today Planned
        </span>
      );
    }
    if (row.isUpcomingPlanned) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200">
          <Calendar size={11} /> Upcoming Planned
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200">
        <Clock size={11} /> YTS
      </span>
    );
  };

  // Excel Export
  const handleExportToExcel = () => {
    const exportData = filteredRows.map((row) => ({
      Client: row.client,
      Project: row.projectCode,
      "Project Title": row.projectTitle,
      Chapter: row.chapter,
      "Received Date": row.receivedDate,
      "Due Date": row.dueDate,
      "MSS Count": row.mssCount,
      Stage: row.stage,
      Assignee: row.assignee,
      PM: row.projectManager,
      "Planned Start Date": row.plannedStartDate,
      "Planned End Date": row.plannedEndDate,
      "Actual Start Date": row.actualStartDate,
      "Actual End Date": row.actualEndDate,
      Status: row.status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Schedules Report");

    const today = getTodayDateString();
    XLSX.writeFile(workbook, `Schedules_Report_${today}.xlsx`);
  };

  // PDF Export
  const handleExportPDF = () => {
    const doc = new jsPDF("l", "mm", "a4");

    doc.setFontSize(16);
    doc.text("Schedules Report & Exporter", 14, 15);

    doc.setFontSize(10);
    doc.text(`User: ${userInfo.name} (${userInfo.team}) | Role: ${userInfo.roles.join(", ") || "User"}`, 14, 22);
    doc.text(`Generated Date: ${getTodayDateString()} | Total Records: ${filteredRows.length}`, 14, 27);

    const tableColumn = [
      "Client",
      "Project",
      "Chapter",
      "Received Date",
      "Due Date",
      "MSS Count",
      "Stage",
      "Assignee",
      "PM",
      "Planned Start",
      "Planned End",
      "Actual Start",
      "Actual End",
      "Status",
    ];

    const tableRows = filteredRows.map((row) => [
      row.client,
      row.projectCode,
      row.chapter,
      row.receivedDate,
      row.dueDate,
      String(row.mssCount),
      row.stage,
      row.assignee,
      row.projectManager,
      row.plannedStartDate,
      row.plannedEndDate,
      row.actualStartDate,
      row.actualEndDate,
      row.status,
    ]);

    autoTable(doc, {
      startY: 32,
      head: [tableColumn],
      body: tableRows,
      styles: {
        fontSize: 7,
        cellPadding: 2,
      },
      headStyles: {
        fillColor: [30, 41, 59],
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      margin: { top: 20, left: 10, right: 10, bottom: 10 },
    });

    doc.save(`Schedules_Report_${getTodayDateString()}.pdf`);
  };

  return (
    <div className="space-y-4">
      {/* Top Header Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/reports")}
              className="p-2 rounded-xl hover:bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-800 transition-all shadow-sm"
              aria-label="Back to Reports"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  Schedules Report & Exporter
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                  <Calendar size={12} /> Today: {getTodayDateString()}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Role-scoped project and stage schedules monitoring, filtering, and export.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* User Scope Info Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200/80 bg-slate-50/80 text-xs">
              <div className="h-6 w-6 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-700">
                {userInfo.isAdmin ? <ShieldCheck size={14} /> : <Users size={14} />}
              </div>
              <div>
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  {userInfo.name}
                  {userInfo.isAdmin && (
                    <span className="text-[10px] font-medium bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded-md">
                      Admin
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  Role: <span className="font-medium text-slate-700">{userInfo.roles[0] || "User"}</span> | Team:{" "}
                  <span className="font-medium text-slate-700">{userInfo.team}</span>
                </div>
              </div>
            </div>

            {/* Admin Team Scope Selector */}
            {userInfo.isAdmin && (
              <div className="flex items-center gap-1 text-xs bg-white rounded-xl border border-slate-200 px-2 py-1 shadow-sm">
                <span className="text-slate-500 text-[11px] pl-1 font-medium">Team Scope:</span>
                <select
                  value={selectedTeamScope}
                  onChange={(e) => setSelectedTeamScope(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-800 outline-none pr-1 cursor-pointer"
                >
                  <option value="auto">All Teams (Admin Overview)</option>
                  {Object.keys(teamStageMapping).map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Action buttons */}
            <button
              onClick={handleExportToExcel}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 shadow-sm transition-all"
            >
              <Download size={14} />
              Excel
            </button>
            <button
              onClick={handleExportPDF}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 shadow-sm transition-all"
            >
              <FileText size={14} />
              PDF
            </button>
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 shadow-sm transition-all"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Operational KPI Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Delay Card (Red) */}
        <div
          onClick={() => setActiveTab(activeTab === "delay" ? "all" : "delay")}
          className={`cursor-pointer rounded-2xl border p-4 shadow-sm transition-all ${activeTab === "delay"
              ? "border-red-500 bg-red-100 ring-2 ring-red-400"
              : "border-slate-200/80 bg-white hover:border-red-300 hover:bg-red-50/40"
            }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-red-700">Delay</span>
            <div className="rounded-xl bg-red-200/70 p-2 text-red-700">
              <AlertTriangle size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-red-800">{categoryCounts.delay}</div>
          <p className="mt-1 text-[11px] text-slate-500">Started but passed planned end</p>
        </div>

        {/* Delay YTS Card (Rose) */}
        <div
          onClick={() => setActiveTab(activeTab === "delayYts" ? "all" : "delayYts")}
          className={`cursor-pointer rounded-2xl border p-4 shadow-sm transition-all ${activeTab === "delayYts"
              ? "border-rose-400 bg-rose-50/80 ring-2 ring-rose-300"
              : "border-slate-200/80 bg-white hover:border-rose-200 hover:bg-rose-50/30"
            }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Delay YTS</span>
            <div className="rounded-xl bg-rose-100 p-2 text-rose-600">
              <Clock size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-rose-700">{categoryCounts.delayYts}</div>
          <p className="mt-1 text-[11px] text-slate-500">Not started & passed planned end</p>
        </div>

        {/* In-Progress Card */}
        <div
          onClick={() => setActiveTab(activeTab === "inProgress" ? "all" : "inProgress")}
          className={`cursor-pointer rounded-2xl border p-4 shadow-sm transition-all ${activeTab === "inProgress"
              ? "border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-300"
              : "border-slate-200/80 bg-white hover:border-indigo-200 hover:bg-indigo-50/20"
            }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">In-Progress</span>
            <div className="rounded-xl bg-indigo-100 p-2 text-indigo-600">
              <Clock size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-indigo-700">{categoryCounts.inProgress}</div>
          <p className="mt-1 text-[11px] text-slate-500">Actively being worked on</p>
        </div>

        {/* YTS Card (Amber - before Today Planned) */}
        <div
          onClick={() => setActiveTab(activeTab === "yts" ? "all" : "yts")}
          className={`cursor-pointer rounded-2xl border p-4 shadow-sm transition-all ${activeTab === "yts"
              ? "border-amber-400 bg-amber-50/80 ring-2 ring-amber-300"
              : "border-slate-200/80 bg-white hover:border-amber-200 hover:bg-amber-50/20"
            }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600">YTS</span>
            <div className="rounded-xl bg-amber-100 p-2 text-amber-600">
              <Clock size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-amber-700">{categoryCounts.yts}</div>
          <p className="mt-1 text-[11px] text-slate-500">Yet to start & deadline ahead</p>
        </div>

        {/* Today Planned Card */}
        <div
          onClick={() => setActiveTab(activeTab === "todayPlanned" ? "all" : "todayPlanned")}
          className={`cursor-pointer rounded-2xl border p-4 shadow-sm transition-all ${activeTab === "todayPlanned"
              ? "border-violet-400 bg-violet-50/70 ring-2 ring-violet-300"
              : "border-slate-200/80 bg-white hover:border-violet-200 hover:bg-violet-50/20"
            }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Today Planned</span>
            <div className="rounded-xl bg-violet-100 p-2 text-violet-600">
              <CalendarDays size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-violet-700">{categoryCounts.todayPlanned}</div>
          <p className="mt-1 text-[11px] text-slate-500">Planned start is today</p>
        </div>

        {/* Upcoming Planned Card */}
        <div
          onClick={() => setActiveTab(activeTab === "upcomingPlanned" ? "all" : "upcomingPlanned")}
          className={`cursor-pointer rounded-2xl border p-4 shadow-sm transition-all ${activeTab === "upcomingPlanned"
              ? "border-cyan-400 bg-cyan-50/70 ring-2 ring-cyan-300"
              : "border-slate-200/80 bg-white hover:border-cyan-200 hover:bg-cyan-50/20"
            }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-600">Upcoming Planned</span>
            <div className="rounded-xl bg-cyan-100 p-2 text-cyan-600">
              <Calendar size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-cyan-700">{categoryCounts.upcomingPlanned}</div>
          <p className="mt-1 text-[11px] text-slate-500">Planned start in the future</p>
        </div>
      </div>

      {/* Tabs and Search Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm md:flex-row md:items-center md:justify-between">
        {/* Navigation Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveTab("all")}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-sm transition-all ${activeTab === "all"
                ? "border-slate-800 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
          >
            All Workload ({categoryCounts.all})
          </button>
          <button
            onClick={() => setActiveTab("delay")}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === "delay"
                ? "bg-red-600 text-white shadow-sm"
                : "bg-red-50 text-red-700 hover:bg-red-100/70"
              }`}
          >
            Delay ({categoryCounts.delay})
          </button>
          <button
            onClick={() => setActiveTab("delayYts")}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === "delayYts"
                ? "bg-rose-600 text-white shadow-sm"
                : "bg-rose-50 text-rose-700 hover:bg-rose-100/70"
              }`}
          >
            Delay YTS ({categoryCounts.delayYts})
          </button>
          <button
            onClick={() => setActiveTab("inProgress")}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === "inProgress"
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100/70"
              }`}
          >
            In-Progress ({categoryCounts.inProgress})
          </button>
          <button
            onClick={() => setActiveTab("yts")}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === "yts"
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100/70"
              }`}
          >
            YTS ({categoryCounts.yts})
          </button>
          <button
            onClick={() => setActiveTab("todayPlanned")}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === "todayPlanned"
                ? "bg-violet-600 text-white shadow-sm"
                : "bg-violet-50 text-violet-700 hover:bg-violet-100/70"
              }`}
          >
            Today Planned ({categoryCounts.todayPlanned})
          </button>
          <button
            onClick={() => setActiveTab("upcomingPlanned")}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === "upcomingPlanned"
                ? "bg-cyan-600 text-white shadow-sm"
                : "bg-cyan-50 text-cyan-700 hover:bg-cyan-100/70"
              }`}
          >
            Upcoming Planned ({categoryCounts.upcomingPlanned})
          </button>
        </div>

        {/* Search & Toggle Filters Button */}
        <div className="flex items-center gap-2">
          <div className="relative w-full md:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search code, title, stage, PM, Assignee..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-1.5 pl-8 pr-3 text-xs outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${showFilters
              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
          >
            <Filter size={13} />
            Filters
          </button>
        </div>
      </div>

      {/* Advanced Filter Bar with Modern Dropdowns */}
      {showFilters && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm animate-in fade-in duration-200">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 items-end">
            {/* Client Filter */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Client
              </label>
              <Dropdown
                options={clientOptions.map((c) => ({
                  value: c,
                  label: c === "--ALL--" ? "All Clients" : c,
                }))}
                value={clientFilter}
                onChange={(val) => setClientFilter(val)}
                className="w-full text-xs"
              />
            </div>

            {/* Role-Mapped Stage Filter */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Stage
              </label>
              <Dropdown
                options={stageOptions.map((s) => ({
                  value: s,
                  label: s === "--ALL--" ? "All Stages" : s,
                }))}
                value={stageFilter}
                onChange={(val) => setStageFilter(val)}
                className="w-full text-xs"
              />
            </div>

            {/* Status Filter */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Status
              </label>
              <Dropdown
                options={statusOptions.map((st) => ({
                  value: st,
                  label: st === "--ALL--" ? "All Statuses" : st,
                }))}
                value={statusFilter}
                onChange={(val) => setStatusFilter(val)}
                className="w-full text-xs"
              />
            </div>

            {/* Received From */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Received From
              </label>
              <input
                type="date"
                value={receivedFrom}
                onChange={(e) => setReceivedFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* Received To */}
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Received To
              </label>
              <input
                type="date"
                value={receivedTo}
                onChange={(e) => setReceivedTo(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* Due As On & Reset */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Due As On
                </label>
                <input
                  type="date"
                  value={dueAsOn}
                  onChange={(e) => setDueAsOn(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <button
                onClick={resetFilters}
                className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all"
                title="Reset Filters"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden flex flex-col">
        {/* Table Top Controls & Lazy Loading Count */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">
              Showing {displayedRows.length} of {filteredRows.length} items
            </span>
            <span className="text-[11px] text-slate-400">
              (Ordered by Delay → Delay YTS → In-Progress → Today Planned → Upcoming Planned)
            </span>
          </div>

          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Scroll table to dynamically load more</span>
          </div>
        </div>

        {/* Table Viewport with Infinite Scrolling */}
        <div
          ref={tableContainerRef}
          className="overflow-x-auto overflow-y-auto max-h-[640px] relative divide-y divide-slate-100 scroll-smooth"
        >
          {loading ? (
            <div className="py-24 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Spinner size="lg" />
              <p className="text-xs font-medium">Loading schedule records...</p>
            </div>
          ) : (
            <table className="min-w-[1550px] w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 shadow-sm">
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 backdrop-blur">
                  <th className="px-3.5 py-3">Client</th>
                  <th className="px-3.5 py-3">Project</th>
                  <th className="px-3.5 py-3">Chapter</th>
                  <th className="px-3.5 py-3">Received Date</th>
                  <th className="px-3.5 py-3">Due Date</th>
                  <th className="px-3.5 py-3 text-center">MSS Count</th>
                  <th className="px-3.5 py-3">Stage</th>
                  <th className="px-3.5 py-3">Assignee</th>
                  <th className="px-3.5 py-3">PM</th>
                  <th className="px-3.5 py-3">Planned Start Date</th>
                  <th className="px-3.5 py-3">Planned End Date</th>
                  <th className="px-3.5 py-3">Actual Start Date</th>
                  <th className="px-3.5 py-3">Actual End Date</th>
                  <th className="px-3.5 py-3 text-center">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {displayedRows.length > 0 ? (
                  displayedRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-50/80 transition-colors ${row.isDelay
                        ? "bg-red-50/30"
                        : row.isDelayYts
                          ? "bg-rose-50/30"
                          : ""
                        }`}
                    >
                      {/* 1. Client */}
                      <td className="px-3.5 py-2.5 font-medium text-slate-800">{row.client}</td>

                      {/* 2. Project */}
                      <td className="px-3.5 py-2.5">
                        <span className="font-semibold text-indigo-700 bg-indigo-50/80 px-1.5 py-0.5 rounded text-[11px]">
                          {row.projectCode}
                        </span>
                        {row.projectTitle !== "—" && (
                          <div className="text-[10px] text-slate-400 truncate max-w-[140px]" title={row.projectTitle}>
                            {row.projectTitle}
                          </div>
                        )}
                      </td>

                      {/* 3. Chapter */}
                      <td className="px-3.5 py-2.5 font-medium text-slate-800">{row.chapter}</td>

                      {/* 4. Received Date */}
                      <td className="px-3.5 py-2.5 text-slate-600 font-mono text-[11px]">
                        {row.receivedDate}
                      </td>

                      {/* 5. Due Date */}
                      <td className="px-3.5 py-2.5 text-slate-600 font-mono text-[11px]">
                        {row.dueDate}
                      </td>

                      {/* 6. MSS Count */}
                      <td className="px-3.5 py-2.5 text-center font-semibold text-slate-700">
                        {row.mssCount}
                      </td>

                      {/* 7. Stage */}
                      <td className="px-3.5 py-2.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-800">
                          {row.stage}
                        </span>
                      </td>

                      {/* 8. Assignee (First + Last Name format) */}
                      <td className="px-3.5 py-2.5 text-slate-700 font-medium">
                        {row.assignee === "Unassigned" || row.assignee === "—" ? (
                          <span className="text-slate-400 italic">Unassigned</span>
                        ) : (
                          <span className="font-semibold text-slate-800">{row.assignee}</span>
                        )}
                      </td>

                      {/* 9. PM (First + Last Name format) */}
                      <td className="px-3.5 py-2.5 text-slate-700 font-semibold">
                        {row.projectManager}
                      </td>

                      {/* 10. Planned Start Date */}
                      <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-600">
                        {row.plannedStartDate}
                      </td>

                      {/* 11. Planned End Date */}
                      <td
                        className={`px-3.5 py-2.5 font-mono text-[11px] font-medium ${row.isDelay ? "text-red-600 font-bold" : row.isDelayYts ? "text-rose-600 font-bold" : "text-slate-600"
                          }`}
                      >
                        {row.plannedEndDate}
                      </td>

                      {/* 12. Actual Start Date */}
                      <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-600">
                        {row.actualStartDate}
                      </td>

                      {/* 13. Actual End Date */}
                      <td
                        className={`px-3.5 py-2.5 font-mono text-[11px] ${row.actualEndDate !== "—" ? "text-emerald-700 font-semibold" : "text-slate-400"
                          }`}
                      >
                        {row.actualEndDate}
                      </td>

                      {/* 14. Status */}
                      <td className="px-3.5 py-2.5 text-center">
                        {renderStatusBadge(row)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={14} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center justify-center gap-2 text-slate-400">
                        <Building2 size={32} className="text-slate-300" />
                        <p className="text-sm font-semibold text-slate-700">No matching schedules found</p>
                        <p className="text-xs text-slate-400 max-w-sm">
                          There are no schedules matching your current stage role mapping and filter criteria.
                        </p>
                        <button
                          onClick={resetFilters}
                          className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
                        >
                          Reset all filters
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {/* Lazy loading bottom indicator */}
          {displayedRows.length < filteredRows.length && (
            <div className="py-3 text-center text-xs text-slate-400 bg-slate-50/50 border-t border-slate-100 flex items-center justify-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              <span>Loading more records as you scroll...</span>
            </div>
          )}
        </div>

        {/* Table Footer */}
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs text-slate-500 gap-2">
          <div>
            Showing {displayedRows.length} of {filteredRows.length} entries
          </div>
          <div className="text-[11px] text-slate-400">
            Schedules automatically synchronized with live workflow stages and chapter details.
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduleReport;
