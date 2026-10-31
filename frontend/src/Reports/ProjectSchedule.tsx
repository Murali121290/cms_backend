import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Filter,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  ChevronDown,
  X,
  FolderSearch,
  ArrowLeft,
  Download,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  BookOpen,
  Layers,
  ChevronRight,
  TrendingUp,
  RotateCcw,
} from "lucide-react";
import { projectScheduleColumns } from "./projectScheduleConfig";
import api from "@/api/client";
import { projectsApi } from "@/api/projects";
import { chaptersApi } from "@/api/chapters";
import { Spinner } from "@/components/ui/Spinner";
import { Badge, statusToBadge } from "@/components/ui/Badge";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

type ProjectRow = {
  clientName: string;
  projectCode: string;
  projectCodeCompat?: string;
  projectTitle: string;
  chapterCount: number;
  projectManager: string;
  salesPerson: string;
  category: string;
  manuscriptPages: number;
  billingLocation: string;
  billingType: string;
  altText: string;
  accessibility: string;
  copyrightYear: string | number;
  startDate: string;
  dueDate: string;
  remarks: string;
  chapters?: {
    chapterNumber: string;
    stages: Record<string, string>;
    assigneeName?: string;
    currentStage?: string;
    status?: string;
    startDate?: string;
    dueDate?: string;
    manuscriptPages?: number;
    trackType?: "manuscript" | "art" | "design" | "other";
  }[];
  chaptersStatus?: string;
};

// Helper to sort chapters in the required order:
// 1. Manuscript chapters (e.g. 01, 02, 03, 04, ..., FM, BM, Appendices)
// 2. Art chapters (e.g. Ch 01 - Art, Ch 02 - Art, ...)
// 3. CE support
// 4. Design
const sortChaptersInProjectOrder = (a: { chapterNumber: string }, b: { chapterNumber: string }): number => {
  const getChapterSortTuple = (raw: string) => {
    const s = (raw || "").trim();
    const low = s.toLowerCase();

    // 1. Manuscript = 1, Art = 2, CE support = 3, Design = 4
    let group = 1;
    if (low === "design") {
      group = 4;
    } else if (low === "ce support" || low === "cesupport") {
      group = 3;
    } else if (low.includes("art")) {
      group = 2;
    } else {
      group = 1;
    }

    // Extract first integer number if available
    const numMatch = s.match(/\d+/);
    const num = numMatch ? parseInt(numMatch[0], 10) : 999999;

    let subType = 5;
    let subVal = num;
    let subStr = s;

    if (group === 1) {
      if (s.toUpperCase() === "FM") {
        subType = 1;
        subVal = 0;
      } else if (/^\d+$/.test(s)) {
        subType = 2;
        subVal = parseInt(s, 10);
      } else if (s.toUpperCase() === "BM") {
        subType = 3;
        subVal = 0;
      } else if (/^[A-Za-z]$/.test(s)) {
        subType = 4;
        subVal = 0;
        subStr = s.toUpperCase();
      }
    } else if (group === 2) {
      subType = 1;
      subVal = num;
    } else {
      subType = 1;
      subVal = 0;
    }

    return { group, subType, subVal, subStr };
  };

  const aTuple = getChapterSortTuple(a.chapterNumber);
  const bTuple = getChapterSortTuple(b.chapterNumber);

  if (aTuple.group !== bTuple.group) {
    return aTuple.group - bTuple.group;
  }
  if (aTuple.subType !== bTuple.subType) {
    return aTuple.subType - bTuple.subType;
  }
  if (aTuple.subVal !== bTuple.subVal) {
    return aTuple.subVal - bTuple.subVal;
  }
  return aTuple.subStr.localeCompare(bTuple.subStr);
};

// Helper to categorize chapter track
const getChapterTrackType = (chStr: string): "manuscript" | "art" | "design" | "other" => {
  const clean = (chStr || "").trim().toLowerCase();
  if (clean === "design") return "design";
  if (clean === "ce support" || clean === "cesupport") return "other";
  if (clean.includes("art")) return "art";
  return "manuscript";
};

const ProjectSchedule = () => {
  const navigate = useNavigate();
  const [projectData, setProjectData] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(true);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" | null }>({
    key: "",
    direction: null,
  });
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  // Custom Date Range Filters (From & To)
  const [startDateFrom, setStartDateFrom] = useState("");
  const [startDateTo, setStartDateTo] = useState("");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");

  // Lazy loading state for table rows
  const INITIAL_VISIBLE_COUNT = 50;
  const CHUNK_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Reset visible rows whenever filters, sorting, or search change
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollTop = 0;
    }
  }, [
    colFilters,
    sortConfig,
    globalSearch,
    selectedProject,
    startDateFrom,
    startDateTo,
    dueDateFrom,
    dueDateTo,
  ]);

  // Infinite scroll trigger handler
  const handleTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 250) {
      setVisibleCount((prev) => prev + CHUNK_SIZE);
    }
  }, []);

  // When a user selects a project row, fetch all chapters for that project via chaptersApi.getByProject
  const handleSelectProject = async (row: ProjectRow) => {
    if (selectedProject?.projectCode === row.projectCode) {
      setSelectedProject(null);
      return;
    }
    // Set initially so the UI responds immediately
    setSelectedProject(row);

    try {
      setDrilldownLoading(true);
      const projChapters = await chaptersApi.getByProject(row.projectCode).catch(() => []);
      if (projChapters && projChapters.length > 0) {
        // Merge project chapters into the selectedProject chapters list
        setSelectedProject((prev) => {
          if (!prev || prev.projectCode !== row.projectCode) return prev;
          const existingChs = prev.chapters || [];
          const updatedChs = [...existingChs];

          projChapters.forEach((ch: any) => {
            const chNum = String(ch.chapters);
            const idx = updatedChs.findIndex((c) => c.chapterNumber === chNum);
            const entry = {
              chapterNumber: chNum,
              stages: idx >= 0 ? updatedChs[idx].stages : {},
              assigneeName: ch.current_assignee_name || (idx >= 0 ? updatedChs[idx].assigneeName : ""),
              currentStage: ch.stage_name || (idx >= 0 ? updatedChs[idx].currentStage : ""),
              status: ch.status || (idx >= 0 ? updatedChs[idx].status : "In-progress"),
              startDate: ch.created_at ? ch.created_at.split("T")[0] : (idx >= 0 ? updatedChs[idx].startDate : ""),
              dueDate: ch.due_date ? ch.due_date.split("T")[0] : (idx >= 0 ? updatedChs[idx].dueDate : ""),
              manuscriptPages: ch.manuscript_pages ?? (idx >= 0 ? updatedChs[idx].manuscriptPages : 0),
              trackType: getChapterTrackType(chNum),
            };
            if (idx >= 0) {
              updatedChs[idx] = { ...updatedChs[idx], ...entry };
            } else {
              updatedChs.push(entry);
            }
          });

          return {
            ...prev,
            chapters: updatedChs.sort(sortChaptersInProjectOrder),
          };
        });
      }
    } catch (err) {
      console.warn("Could not fetch project chapters for drilldown:", err);
    } finally {
      setDrilldownLoading(false);
    }
  };

  useEffect(() => {
    const fetchProjectData = async () => {
      try {
        setLoading(true);
        const [projectsRes, stageDetails, chaptersList] = await Promise.all([
          projectsApi.list(0, 1000),
          api.get<any[]>("/api/v1/stage-details").then((r) => r.data),
          api.get<any[]>("/chapters/").then((r) => r.data),
        ]);

        const projects = projectsRes.projects || [];
        const mapped: ProjectRow[] = projects.map((p: any) => {
          const projectCode = p.code || p.project_code || "";

          const detailsForProject = stageDetails.filter((d: any) => d.project === projectCode);
          const projectChaptersList = chaptersList.filter((c: any) => c.project === projectCode);

          const allChapterNums = new Set<string>();
          // Include chapters from /chapters/ list
          projectChaptersList.forEach((c) => {
            if (c.chapters) allChapterNums.add(String(c.chapters));
          });
          // Also include all chapters that have entries in stages_details for this project
          detailsForProject.forEach((d) => {
            if (d.chapters) allChapterNums.add(String(d.chapters));
          });

          const chapters = Array.from(allChapterNums).map((chapterNumber) => {
            const stages: Record<string, string> = {};
            const chapterStageRows = detailsForProject.filter((d) => String(d.chapters) === chapterNumber);
            chapterStageRows.forEach((d) => {
              stages[d.stage_name] = d.stage_status === "In-progress" ? "In Progress" : d.stage_status;
            });

            const chRecord = projectChaptersList.find((c: any) => String(c.chapters) === chapterNumber);
            const activeStageRow = chapterStageRows.find(
              (d) => d.stage_status === "In-progress" || d.stage_status === "In Progress"
            ) || chapterStageRows[chapterStageRows.length - 1];

            const sortedStageRows = [...chapterStageRows].sort((a, b) => (a.id || 0) - (b.id || 0));
            const firstPlannedStart = sortedStageRows[0]?.planned_start_date
              ? String(sortedStageRows[0].planned_start_date).split("T")[0]
              : "";
            const lastPlannedDue = sortedStageRows[sortedStageRows.length - 1]?.planned_end_date
              ? String(sortedStageRows[sortedStageRows.length - 1].planned_end_date).split("T")[0]
              : "";

            const assignedName =
              chRecord?.current_assignee_name ||
              chapterStageRows.find((d) => d.assignee_name)?.assignee_name ||
              "";

            return {
              chapterNumber,
              stages,
              assigneeName: assignedName,
              currentStage: chRecord?.stage_name || activeStageRow?.stage_name || "",
              status: chRecord?.status || (chapterStageRows.every((d) => d.stage_status === "Completed") ? "Completed" : "In-progress"),
              startDate: chRecord?.created_at ? chRecord.created_at.split("T")[0] : firstPlannedStart,
              dueDate: chRecord?.due_date ? chRecord.due_date.split("T")[0] : lastPlannedDue,
              manuscriptPages: chRecord?.manuscript_pages || 0,
              trackType: getChapterTrackType(chapterNumber),
            };
          });

          return {
            clientName: p.client_name || "",
            projectCode,
            projectTitle: p.title || p.project_title || "",
            chapterCount: p.chapter_count ?? 0,
            projectManager: p.project_manager || "",
            salesPerson: p.sales_person || "",
            category: p.category || "",
            manuscriptPages: p.manuscript_pages ?? 0,
            billingLocation: p.billing_location || "",
            billingType: p.billing_type ? p.billing_type.charAt(0).toUpperCase() + p.billing_type.slice(1) : "",
            altText: p.alt_text ? p.alt_text.charAt(0).toUpperCase() + p.alt_text.slice(1) : "",
            accessibility: p.accessibility ? p.accessibility.charAt(0).toUpperCase() + p.accessibility.slice(1) : "",
            copyrightYear: p.copyright_year || "",
            startDate: p.created_at ? p.created_at.split("T")[0] : "",
            dueDate: p.due_date || "",
            remarks: p.status || "Pending",
            chaptersStatus: `${chapters.filter((ch) => ch.status.toLowerCase() === "complete" || ch.status.toLowerCase() === "completed")
                .length
              }/${chapters.length}`,
            chapters: chapters.sort(sortChaptersInProjectOrder),
          };
        });

        setProjectData(mapped);
      } catch (error) {
        console.error("Failed to fetch project schedule report data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProjectData();
  }, []);

  const clientOptions = useMemo(() => {
    const clients = new Set<string>();
    projectData.forEach((row) => {
      if (row.clientName) clients.add(row.clientName);
    });
    return ["--ALL--", ...Array.from(clients)];
  }, [projectData]);

  const filteredData = useMemo(() => {
    if (selectedProject) return [selectedProject];

    let data = projectData.filter((row) => {
      // Global Search
      if (globalSearch.trim()) {
        const query = globalSearch.toLowerCase();
        const matchesGlobal =
          row.projectCode.toLowerCase().includes(query) ||
          row.projectTitle.toLowerCase().includes(query) ||
          row.clientName.toLowerCase().includes(query) ||
          row.projectManager.toLowerCase().includes(query) ||
          row.category.toLowerCase().includes(query) ||
          row.billingLocation.toLowerCase().includes(query) ||
          row.remarks.toLowerCase().includes(query);
        if (!matchesGlobal) return false;
      }

      // Date Range Filters: Start Date
      if (startDateFrom) {
        if (!row.startDate || row.startDate < startDateFrom) return false;
      }
      if (startDateTo) {
        if (!row.startDate || row.startDate > startDateTo) return false;
      }

      // Date Range Filters: Due Date
      if (dueDateFrom) {
        if (!row.dueDate || row.dueDate < dueDateFrom) return false;
      }
      if (dueDateTo) {
        if (!row.dueDate || row.dueDate > dueDateTo) return false;
      }

      // Column Filters
      for (const col of projectScheduleColumns) {
        if (col.id === "start_date" || col.id === "due_date") continue;

        const filterVal = colFilters[col.id];
        if (!filterVal || filterVal === "--ALL--") continue;

        if (col.source === "project") {
          const rowVal = String(row[col.fieldKey as keyof ProjectRow] ?? "").toLowerCase();
          if (!rowVal.includes(filterVal.toLowerCase())) {
            return false;
          }
        }
      }
      return true;
    });

    if (sortConfig.key && sortConfig.direction) {
      data = [...data].sort((a, b) => {
        const valA = a[sortConfig.key as keyof ProjectRow] ?? "";
        const valB = b[sortConfig.key as keyof ProjectRow] ?? "";
        if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1;
        if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return data;
  }, [
    colFilters,
    sortConfig,
    selectedProject,
    projectData,
    globalSearch,
    startDateFrom,
    startDateTo,
    dueDateFrom,
    dueDateTo,
  ]);

  // Key KPI Metrics
  const stats = useMemo(() => {
    const totalProjects = filteredData.length;
    const completedProjects = filteredData.filter(
      (p) => p.remarks.toLowerCase() === "completed" || p.remarks.toLowerCase() === "complete"
    ).length;
    const inProgressProjects = filteredData.filter(
      (p) => p.remarks.toLowerCase().includes("progress") || p.remarks.toLowerCase() === "active"
    ).length;
    const totalChapters = filteredData.reduce((acc, p) => acc + (p.chapterCount || 0), 0);
    const totalPages = filteredData.reduce((acc, p) => acc + (p.manuscriptPages || 0), 0);
    return {
      totalProjects,
      completedProjects,
      inProgressProjects,
      totalChapters,
      totalPages,
    };
  }, [filteredData]);

  const uniqueClientsCount = useMemo(() => {
    return new Set(filteredData.map((d) => d.clientName).filter(Boolean)).size;
  }, [filteredData]);

  const projectsCount = useMemo(() => {
    return filteredData.length;
  }, [filteredData]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (globalSearch.trim()) count++;
    if (sortConfig.key) count++;
    if (startDateFrom || startDateTo) count++;
    if (dueDateFrom || dueDateTo) count++;
    for (const val of Object.values(colFilters)) {
      if (val && val !== "--ALL--") count++;
    }
    return count;
  }, [colFilters, sortConfig, globalSearch, startDateFrom, startDateTo, dueDateFrom, dueDateTo]);

  const hasActiveFilters = activeFiltersCount > 0;

  const handleClearFilters = () => {
    setColFilters({});
    setGlobalSearch("");
    setSortConfig({ key: "", direction: null });
    setStartDateFrom("");
    setStartDateTo("");
    setDueDateFrom("");
    setDueDateTo("");
  };

  const visibleColumns = useMemo(() => projectScheduleColumns.filter((c) => c.visible), []);

  // Sliced data for lazy loading / high performance rendering
  const displayedData = useMemo(() => {
    return filteredData.slice(0, visibleCount);
  }, [filteredData, visibleCount]);

  const handleExportExcel = () => {
    if (selectedProject) {
      const chaptersData = (selectedProject.chapters || []).map((ch) => ({
        Client: selectedProject.clientName,
        "Project Code": selectedProject.projectCode,
        "Project Title": selectedProject.projectTitle,
        "Chapter Count": selectedProject.chapterCount,
        "Project Manager": selectedProject.projectManager,
        "Sales Person": selectedProject.salesPerson,
        Category: selectedProject.category,
        "Project Manuscript Pages": selectedProject.manuscriptPages,
        "Billing Location": selectedProject.billingLocation,
        "Billing Type": selectedProject.billingType,
        "Alt Text": selectedProject.altText,
        Accessibility: selectedProject.accessibility,
        "Copyright Year": selectedProject.copyrightYear,
        "Project Start Date": selectedProject.startDate,
        "Project Due Date": selectedProject.dueDate,
        "Project Status": selectedProject.remarks,
        Chapter: `Chapter ${ch.chapterNumber}`,
        Assignee: ch.assigneeName || "-",
        "Chapter Start Date": ch.startDate || "-",
        "Chapter Due Date": ch.dueDate || "-",
        "Chapter Manuscript Pages": ch.manuscriptPages || 0,
        "Current Stage": ch.currentStage || "-",
        "Overall Status": ch.status || "-",
      }));
      const worksheet = XLSX.utils.json_to_sheet(chaptersData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Chapters Progress");
      XLSX.writeFile(workbook, `chapters-progress-${selectedProject.projectCode}.xlsx`);
      return;
    }

    const exportData = filteredData.map((row) => {
      const dataObj: Record<string, any> = {};
      visibleColumns.forEach((col) => {
        if (col.source === "project") {
          dataObj[col.label] = row[col.fieldKey as keyof ProjectRow] ?? "";
        } else if (col.source === "custom") {
          if (col.id === "chapters_status") {
            dataObj[col.label] = row.chaptersStatus || "0/0";
          } else {
            dataObj[col.label] = "";
          }
        } else if (col.source === "chapter_stage") {
          if (!row.chapters || row.chapters.length === 0) {
            dataObj[col.label] = "-";
          } else {
            dataObj[col.label] = row.chapters
              .map((ch) => `${ch.chapterNumber}: ${ch.stages[col.fieldKey] || "Pending"}`)
              .join(", ");
          }
        }
      });
      return dataObj;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Book Info Report");
    XLSX.writeFile(workbook, "book-info-report.xlsx");
  };

  const handleExportPDF = () => {
    if (selectedProject) {
      const doc = new jsPDF("l", "mm", "a4");
      doc.setFontSize(14);
      doc.text(`Chapters Progress (${selectedProject.projectCode})`, 14, 12);

      const tableColumn = [
        "Client",
        "Project Code",
        "Project Title",
        "PM",
        "Sales Person",
        "Category",
        "Billing Loc",
        "Billing Type",
        "Alt Text",
        "A11y",
        "Copy Year",
        "Chapter",
        "Assignee",
        "Start Date",
        "Due Date",
        "Mss Pages",
        "Stage",
        "Status",
      ];

      const tableRows = (selectedProject.chapters || []).map((ch) => [
        selectedProject.clientName,
        selectedProject.projectCode,
        selectedProject.projectTitle,
        selectedProject.projectManager,
        selectedProject.salesPerson,
        selectedProject.category,
        selectedProject.billingLocation,
        selectedProject.billingType || "-",
        selectedProject.altText || "-",
        selectedProject.accessibility || "-",
        String(selectedProject.copyrightYear),
        `Chapter ${ch.chapterNumber}`,
        ch.assigneeName || "-",
        ch.startDate || "-",
        ch.dueDate || "-",
        String(ch.manuscriptPages || 0),
        ch.currentStage || "-",
        ch.status || "-",
      ]);

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 18,
        styles: { fontSize: 7, cellPadding: 1.5 },
        theme: "striped",
      });

      doc.save(`chapters-progress-${selectedProject.projectCode}.pdf`);
      return;
    }

    const doc = new jsPDF("l", "mm", "a4");

    doc.setFontSize(16);
    doc.text("Book Info Report", 14, 15);

    doc.setFontSize(10);
    doc.text(`Total Projects: ${filteredData.length}`, 14, 22);

    const tableColumn = visibleColumns.map((col) => col.label);
    const tableRows = filteredData.map((row) => {
      return visibleColumns.map((col) => {
        if (col.source === "project") {
          return String(row[col.fieldKey as keyof ProjectRow] ?? "");
        } else if (col.source === "custom") {
          if (col.id === "chapters_status") {
            return row.chaptersStatus || "0/0";
          }
          return "-";
        } else if (col.source === "chapter_stage") {
          if (!row.chapters || row.chapters.length === 0) return "-";
          return row.chapters
            .map((ch) => `${ch.chapterNumber}: ${ch.stages[col.fieldKey] || "Pending"}`)
            .join("\n");
        }
        return "-";
      });
    });

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 28,
      styles: { fontSize: 7, cellPadding: 1.5 },
      theme: "striped",
    });

    doc.save("book-info-report.pdf");
  };

  const renderCell = (row: ProjectRow, col: (typeof projectScheduleColumns)[number]) => {
    if (col.source === "project") {
      const val = row[col.fieldKey as keyof ProjectRow];

      if (col.id === "project_code") {
        return (
          <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-md inline-block">
            {row.projectCode}
          </span>
        );
      }

      if (col.id === "project_title") {
        return (
          <div className="max-w-[240px]">
            <p className="text-xs font-semibold text-text truncate" title={row.projectTitle}>
              {row.projectTitle || "—"}
            </p>
          </div>
        );
      }

      if (col.id === "status") {
        const badgeVar = statusToBadge(String(val));
        return (
          <Badge variant={badgeVar} size="sm">
            {String(val)}
          </Badge>
        );
      }

      if (col.id === "alt_text" || col.id === "accessibility") {
        const text = String(val);
        const isYes = text.toLowerCase() === "yes";
        const isNo = text.toLowerCase() === "no";
        if (!text || text === "—") return <span className="text-muted text-xs">—</span>;
        return (
          <span
            className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isYes
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : isNo
                  ? "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20"
                  : "bg-surface text-text border-border"
              }`}
          >
            {text}
          </span>
        );
      }

      if (col.id === "billing_type") {
        const text = String(val);
        if (!text || text === "—") return <span className="text-muted text-xs">—</span>;
        return (
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            {text}
          </span>
        );
      }

      if (col.id === "chapter_count" || col.id === "manuscript_pages") {
        return (
          <span className="font-medium text-xs text-text tabular-nums">
            {Number(val).toLocaleString()}
          </span>
        );
      }

      return <span className="text-xs text-text">{val ? String(val) : <span className="text-muted">—</span>}</span>;
    } else if (col.source === "custom" && col.id === "chapters_status") {
      const parts = (row.chaptersStatus || "0/0").split("/");
      const done = Number(parts[0]) || 0;
      const total = Number(parts[1]) || 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return (
        <div className="flex items-center gap-2 min-w-[90px]">
          <div className="flex-1 h-1.5 rounded-full bg-surface-subtle overflow-hidden border border-border/40">
            <div
              className={`h-full rounded-full transition-all duration-300 ${pct === 100 ? "bg-emerald-500" : pct > 0 ? "bg-primary" : "bg-muted"
                }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] font-mono font-medium text-muted whitespace-nowrap">
            {row.chaptersStatus}
          </span>
        </div>
      );
    }
    return <span className="text-muted text-xs">—</span>;
  };

  const renderColumnFilter = (col: (typeof projectScheduleColumns)[number]) => {
    const value = colFilters[col.id] || "";
    const onChange = (val: string) => {
      setColFilters((prev) => ({ ...prev, [col.id]: val }));
    };

    if (col.id === "client") {
      return (
        <div className="flex flex-col gap-1">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-[11px] outline-none focus:border-primary text-text font-normal shadow-sm"
          >
            {clientOptions.map((item) => (
              <option key={item} value={item}>
                {item === "--ALL--" ? "All Clients" : item}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (col.id === "status") {
      const statuses = ["--ALL--", ...Array.from(new Set(projectData.map((row) => row.remarks).filter(Boolean)))];
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-[11px] outline-none focus:border-primary text-text font-normal shadow-sm"
        >
          {statuses.map((item) => (
            <option key={item} value={item}>
              {item === "--ALL--" ? "All Statuses" : item}
            </option>
          ))}
        </select>
      );
    }

    if (col.id === "project_manager") {
      const managers = [
        "--ALL--",
        ...Array.from(new Set(projectData.map((row) => row.projectManager).filter(Boolean))),
      ];
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-[11px] outline-none focus:border-primary text-text font-normal shadow-sm"
        >
          {managers.map((item) => (
            <option key={item} value={item}>
              {item === "--ALL--" ? "All PMs" : item}
            </option>
          ))}
        </select>
      );
    }

    if (col.id === "billing_type") {
      const types = ["--ALL--", ...Array.from(new Set(projectData.map((row) => row.billingType).filter(Boolean)))];
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-[11px] outline-none focus:border-primary text-text font-normal shadow-sm"
        >
          {types.map((item) => (
            <option key={item} value={item}>
              {item === "--ALL--" ? "All Types" : item}
            </option>
          ))}
        </select>
      );
    }

    if (col.id === "alt_text") {
      const options = ["--ALL--", ...Array.from(new Set(projectData.map((row) => row.altText).filter(Boolean)))];
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-[11px] outline-none focus:border-primary text-text font-normal shadow-sm"
        >
          {options.map((item) => (
            <option key={item} value={item}>
              {item === "--ALL--" ? "All" : item}
            </option>
          ))}
        </select>
      );
    }

    if (col.id === "accessibility") {
      const options = [
        "--ALL--",
        ...Array.from(new Set(projectData.map((row) => row.accessibility).filter(Boolean))),
      ];
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-[11px] outline-none focus:border-primary text-text font-normal shadow-sm"
        >
          {options.map((item) => (
            <option key={item} value={item}>
              {item === "--ALL--" ? "All" : item}
            </option>
          ))}
        </select>
      );
    }

    if (col.id === "start_date") {
      const hasDateFilter = Boolean(startDateFrom || startDateTo);
      return (
        <div className="flex flex-col gap-1 min-w-[130px]">
          <div className="flex items-center gap-1 bg-surface border border-border/80 rounded px-1 py-0.5 shadow-2xs focus-within:border-primary">
            <span className="text-[9px] font-semibold text-muted uppercase tracking-wider w-8 shrink-0">From</span>
            <input
              type="date"
              value={startDateFrom}
              onChange={(e) => setStartDateFrom(e.target.value)}
              className="w-full bg-transparent text-[10px] text-text outline-none p-0 cursor-pointer"
              title="Start Date From"
            />
          </div>
          <div className="flex items-center gap-1 bg-surface border border-border/80 rounded px-1 py-0.5 shadow-2xs focus-within:border-primary">
            <span className="text-[9px] font-semibold text-muted uppercase tracking-wider w-8 shrink-0">To</span>
            <input
              type="date"
              value={startDateTo}
              onChange={(e) => setStartDateTo(e.target.value)}
              className="w-full bg-transparent text-[10px] text-text outline-none p-0 cursor-pointer"
              title="Start Date To"
            />
          </div>
          {hasDateFilter && (
            <button
              onClick={() => {
                setStartDateFrom("");
                setStartDateTo("");
              }}
              className="text-[9px] text-rose-500 hover:text-rose-600 hover:underline flex items-center justify-end gap-0.5 mt-0.5 font-medium"
            >
              <X size={10} /> Clear
            </button>
          )}
        </div>
      );
    }

    if (col.id === "due_date") {
      const hasDateFilter = Boolean(dueDateFrom || dueDateTo);
      return (
        <div className="flex flex-col gap-1 min-w-[130px]">
          <div className="flex items-center gap-1 bg-surface border border-border/80 rounded px-1 py-0.5 shadow-2xs focus-within:border-primary">
            <span className="text-[9px] font-semibold text-muted uppercase tracking-wider w-8 shrink-0">From</span>
            <input
              type="date"
              value={dueDateFrom}
              onChange={(e) => setDueDateFrom(e.target.value)}
              className="w-full bg-transparent text-[10px] text-text outline-none p-0 cursor-pointer"
              title="Due Date From"
            />
          </div>
          <div className="flex items-center gap-1 bg-surface border border-border/80 rounded px-1 py-0.5 shadow-2xs focus-within:border-primary">
            <span className="text-[9px] font-semibold text-muted uppercase tracking-wider w-8 shrink-0">To</span>
            <input
              type="date"
              value={dueDateTo}
              onChange={(e) => setDueDateTo(e.target.value)}
              className="w-full bg-transparent text-[10px] text-text outline-none p-0 cursor-pointer"
              title="Due Date To"
            />
          </div>
          {hasDateFilter && (
            <button
              onClick={() => {
                setDueDateFrom("");
                setDueDateTo("");
              }}
              className="text-[9px] text-rose-500 hover:text-rose-600 hover:underline flex items-center justify-end gap-0.5 mt-0.5 font-medium"
            >
              <X size={10} /> Clear
            </button>
          )}
        </div>
      );
    }

    if (col.source === "chapter_stage") {
      return null;
    }

    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter..."
        className="w-full rounded-md border border-border/80 bg-surface px-2 py-1 text-[11px] outline-none focus:border-primary text-text font-normal placeholder:text-muted/60 shadow-sm transition-all"
      />
    );
  };

  return (
    <div className="space-y-5 p-1 max-w-[1700px] mx-auto animate-in fade-in duration-300">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-card via-card to-primary/5 p-5 rounded-2xl border border-border shadow-sm">
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
              <h1 className="text-2xl font-bold tracking-tight text-text">Book Info Report</h1>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                Live Overview
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              Monitor manuscript schedules, accessibility compliance, billing setups, and chapter progression.
            </p>
          </div>
        </div>

        {/* Global Search and Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search code, title, client..."
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
          </button>

          <div className="h-5 w-px bg-border mx-0.5" />

          <button
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-text hover:bg-card hover:text-primary transition-all hover:border-primary/30 shadow-xs"
            title="Export to Excel"
          >
            <Download size={13} className="text-emerald-500" />
            Excel
          </button>
          <button
            onClick={handleExportPDF}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-text hover:bg-card hover:text-primary transition-all hover:border-primary/30 shadow-xs"
            title="Export to PDF"
          >
            <FileText size={13} className="text-rose-500" />
            PDF
          </button>

          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 text-white font-semibold shadow-sm hover:bg-rose-700 active:scale-95 px-3 py-2 text-xs transition-all ring-2 ring-rose-500/20"
              title="Reset all active filters and sortings"
            >
              <RotateCcw size={13} className="text-white" />
              <span>Reset Filters</span>
              {activeFiltersCount > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-white/25 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Summary KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-card border border-border/80 rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Total Projects</p>
            <p className="text-2xl font-bold text-text mt-1">{stats.totalProjects}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <BookOpen size={20} />
          </div>
        </div>

        <div className="bg-card border border-border/80 rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Unique Clients</p>
            <p className="text-2xl font-bold text-text mt-1">{uniqueClientsCount}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
            <Layers size={20} />
          </div>
        </div>

        <div className="bg-card border border-border/80 rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Active In-Progress</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {stats.inProgressProjects}
              </p>
              <span className="text-[10px] text-muted font-medium">({stats.completedProjects} done)</span>
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <CheckCircle2 size={20} />
          </div>
        </div>
      </div>

      {/* ── Active Selection Banner ── */}
      {selectedProject && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/30 rounded-2xl px-5 py-3 shadow-xs animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <span className="flex h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-medium text-text">
              Filtered to selected project:{" "}
              <strong className="text-primary font-bold">{selectedProject.projectCode}</strong> —{" "}
              {selectedProject.projectTitle}
            </span>
          </div>
          <button
            onClick={() => setSelectedProject(null)}
            className="text-xs font-semibold text-primary hover:underline hover:text-primary/80 flex items-center gap-1"
          >
            <X size={13} />
            Show All Projects
          </button>
        </div>
      )}

      {/* ── Table Container ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-24 border border-border bg-card rounded-2xl min-h-[350px] shadow-sm">
          <Spinner size="lg" />
          <span className="text-xs text-muted mt-3 font-medium tracking-wide">
            Loading book info &amp; schedule details…
          </span>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl shadow-xs overflow-hidden flex flex-col">
          {/* Scrollable Container with sticky header & lazy loading scroll detection */}
          <div
            ref={tableContainerRef}
            onScroll={handleTableScroll}
            className={`overflow-x-auto overflow-y-auto ${
              selectedProject ? "max-h-[300px]" : "max-h-[calc(100vh-290px)]"
            } scrollbar-thin scrollbar-thumb-border/60 hover:scrollbar-thumb-border`}
          >
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-20 shadow-xs bg-card">
                <tr className="border-b border-border bg-card text-left text-[11px] font-bold uppercase tracking-wider text-muted select-none">
                  {visibleColumns.map((col) => {
                    const isSortable = col.id === "start_date" || col.id === "due_date";
                    const isSorted = sortConfig.key === col.fieldKey;
                    return (
                      <th
                        key={col.id}
                        onClick={() => {
                          if (!isSortable) return;
                          const nextDir =
                            sortConfig.key === col.fieldKey
                              ? sortConfig.direction === "asc"
                                ? "desc"
                                : sortConfig.direction === "desc"
                                  ? null
                                  : "asc"
                              : "asc";
                          if (!nextDir) {
                            setSortConfig({ key: "", direction: null });
                          } else {
                            setSortConfig({ key: col.fieldKey, direction: nextDir });
                          }
                        }}
                        className={`px-3.5 py-3 whitespace-nowrap bg-card ${isSortable ? "cursor-pointer hover:bg-muted/20 transition-colors" : ""
                          }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>
                            {col.id === "client"
                              ? `${col.label} (${uniqueClientsCount})`
                              : col.id === "project_code"
                                ? `${col.label} (${projectsCount})`
                                : col.label}
                          </span>
                          {isSortable && (
                            <span className="inline-flex text-muted">
                              {isSorted ? (
                                sortConfig.direction === "asc" ? (
                                  <ArrowUp size={12} className="text-primary" />
                                ) : (
                                  <ArrowDown size={12} className="text-primary" />
                                )
                              ) : (
                                <ArrowUpDown size={12} className="opacity-40 hover:opacity-100" />
                              )}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>

                {/* Column Filter Row */}
                {showFilters && (
                  <tr className="border-b border-border bg-card shadow-xs animate-in fade-in duration-200">
                    {visibleColumns.map((col) => (
                      <td key={`filter-${col.id}`} className="px-2.5 py-2 bg-card">
                        {renderColumnFilter(col)}
                      </td>
                    ))}
                  </tr>
                )}
              </thead>

              <tbody className="divide-y divide-border/60">
                {displayedData.length > 0 ? (
                  displayedData.map((row) => {
                    const isSelected = selectedProject?.projectCode === row.projectCode;
                    return (
                      <tr
                        key={`${row.projectCode}-${row.chapterCount}`}
                        onClick={() => handleSelectProject(row)}
                        className={`cursor-pointer transition-colors duration-150 group ${isSelected
                            ? "bg-primary/5 hover:bg-primary/10 border-l-4 border-l-primary"
                            : "hover:bg-surface/60"
                          }`}
                      >
                        {visibleColumns.map((col) => (
                          <td key={col.id} className="px-3.5 py-3 whitespace-nowrap">
                            {renderCell(row, col)}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={visibleColumns.length} className="px-4 py-16 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center">
                        <div className="rounded-2xl bg-surface p-4 text-muted border border-border shadow-xs">
                          <FolderSearch size={32} />
                        </div>
                        <h3 className="mt-3.5 text-sm font-semibold text-text">No matching projects found</h3>
                        <p className="mt-1 text-xs text-muted">
                          Try adjusting your search criteria, clearing column filters, or resetting the view.
                        </p>
                        {hasActiveFilters && (
                          <button
                            onClick={handleClearFilters}
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

          {/* Table Footer Summary */}
          <div className="px-4 py-2.5 border-t border-border bg-surface-subtle/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-muted">
            <div className="flex flex-wrap items-center gap-2.5">
              <span>
                Showing <strong className="text-text font-semibold">{Math.min(displayedData.length, filteredData.length)}</strong> of{" "}
                <strong className="text-text font-semibold">{filteredData.length}</strong> filtered
                {filteredData.length !== projectData.length && (
                  <span> (out of {projectData.length} total)</span>
                )}
              </span>
              {displayedData.length < filteredData.length && (
                <span className="text-[11px] text-primary/80 font-medium bg-primary/10 px-2 py-0.5 rounded-full">
                  Scroll down inside table to load more
                </span>
              )}
              {hasActiveFilters && (
                <button
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold border border-rose-500/20 transition-all cursor-pointer"
                  title="Clear all active filters"
                >
                  <RotateCcw size={11} />
                  Clear all filters
                </button>
              )}
            </div>
            <span className="text-[11px]">Click any row to drill down into chapter-level progression</span>
          </div>
        </div>
      )}

      {/* ── Drill-down Chapters Detail View ── */}
      {selectedProject && (
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-4 animate-in slide-in-from-bottom-3 duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Layers size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text">
                  Chapter Milestones &amp; Progress:{" "}
                  <span className="text-primary">{selectedProject.projectCode}</span>
                </h3>
                <p className="text-xs text-muted">{selectedProject.projectTitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-surface border border-border text-text">
                {selectedProject.chapters?.length || 0} Chapters
              </span>
              <button
                onClick={() => setSelectedProject(null)}
                className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
                title="Close chapter breakdown"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {selectedProject.chapters && selectedProject.chapters.length > 0 ? (
            <div className="overflow-x-auto overflow-y-auto max-h-[460px] rounded-xl border border-border scrollbar-thin scrollbar-thumb-border/60 hover:scrollbar-thumb-border">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-card shadow-xs">
                  <tr className="bg-card border-b border-border text-muted font-bold uppercase tracking-wider text-[10px]">
                    <th className="px-3.5 py-2.5 bg-card">Chapter</th>
                    <th className="px-3.5 py-2.5 bg-card">Assignee</th>
                    <th className="px-3.5 py-2.5 bg-card">Start Date</th>
                    <th className="px-3.5 py-2.5 bg-card">Due Date</th>
                    <th className="px-3.5 py-2.5 bg-card">Manuscript Pages</th>
                    <th className="px-3.5 py-2.5 bg-card">Current Stage</th>
                    <th className="px-3.5 py-2.5 bg-card">Overall Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {selectedProject.chapters.map((ch) => {
                    const badgeVar = statusToBadge(ch.status || "");
                    return (
                      <tr key={ch.chapterNumber} className="hover:bg-surface/50 transition-colors">
                        <td className="px-3.5 py-2.5 font-bold text-text">
                          {ch.chapterNumber.startsWith("Ch ") || ch.chapterNumber.toLowerCase().includes("design") || ch.chapterNumber.toLowerCase().includes("ce support")
                            ? ch.chapterNumber
                            : `Chapter ${ch.chapterNumber}`}
                        </td>
                        <td className="px-3.5 py-2.5 text-text">{ch.assigneeName || <span className="text-muted">—</span>}</td>
                        <td className="px-3.5 py-2.5 text-muted">{ch.startDate || "—"}</td>
                        <td className="px-3.5 py-2.5 text-muted">{ch.dueDate || "—"}</td>
                        <td className="px-3.5 py-2.5 font-mono text-text">{ch.manuscriptPages || 0}</td>
                        <td className="px-3.5 py-2.5">
                          {ch.currentStage ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                              {ch.currentStage}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <Badge variant={badgeVar} size="sm">
                            {ch.status || "Pending"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted text-center py-6">No chapter records found for this project.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectSchedule;
