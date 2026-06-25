import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Filter,
  Calendar,
  Clock,
  CheckCircle,
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
} from "lucide-react";
import { projectScheduleColumns } from "./projectScheduleConfig";
import api from "@/api/client";
import { projectsApi } from "@/api/projects";
import { Spinner } from "@/components/ui/Spinner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

type ProjectRow = {
  clientName: string;
  projectCode: string;
  projectCodeCompat?: string; // fallback
  projectTitle: string;
  chapterCount: number;
  projectManager: string;
  salesPerson: string;
  category: string;
  manuscriptPages: number;
  billingLocation: string;
  copyrightYear: string | number;
  startDate: string;
  dueDate: string;
  remarks: string;
  chapters?: {
    chapterNumber: string;
    stages: Record<string, string>; // stageName -> status
    assigneeName?: string;
    currentStage?: string;
    status?: string;
    startDate?: string;
    dueDate?: string;
    manuscriptPages?: number;
  }[];
  chaptersStatus?: string;
}; const ProjectSchedule = () => {
  const navigate = useNavigate();
  const [projectData, setProjectData] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjectData = async () => {
      try {
        setLoading(true);
        const [projectsRes, stageDetails, chaptersList] = await Promise.all([
          projectsApi.list(0, 1000),
          api.get<any[]>("/api/v1/stage-details").then(r => r.data),
          api.get<any[]>("/chapters/").then(r => r.data)
        ]);

        const projects = projectsRes.projects || [];
        const mapped: ProjectRow[] = projects.map((p: any) => {
          const projectCode = p.code || p.project_code || "";

          // Group stage details by chapter for this project
          const detailsForProject = stageDetails.filter((d: any) => d.project === projectCode);
          const projectChaptersList = chaptersList.filter((c: any) => c.project === projectCode);

          // Get all unique chapter numbers from the actual chapters list
          const allChapterNums = new Set<string>();
          projectChaptersList.forEach(c => {
            if (c.chapters) allChapterNums.add(String(c.chapters));
          });

          const chapters = Array.from(allChapterNums).map((chapterNumber) => {
            const stages: Record<string, string> = {};
            detailsForProject
              .filter(d => String(d.chapters) === chapterNumber)
              .forEach(d => {
                stages[d.stage_name] = d.stage_status === "In-progress" ? "In Progress" : d.stage_status;
              });

            const chRecord = projectChaptersList.find((c: any) => String(c.chapters) === chapterNumber);
            return {
              chapterNumber,
              stages,
              assigneeName: chRecord?.current_assignee_name || "",
              currentStage: chRecord?.stage_name || "",
              status: chRecord?.status || "",
              startDate: chRecord?.created_at ? chRecord.created_at.split("T")[0] : "",
              dueDate: chRecord?.due_date ? chRecord.due_date.split("T")[0] : "",
              manuscriptPages: chRecord?.manuscript_pages || 0
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
            copyrightYear: p.copyright_year || "",
            startDate: p.created_at ? p.created_at.split("T")[0] : "",
            dueDate: p.due_date || "",
            remarks: p.status || "Pending",
            chaptersStatus: `${chapters.filter(ch => ch.status.toLowerCase() === "complete" || ch.status.toLowerCase() === "completed").length}/${chapters.length}`,
            chapters
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

  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" | null }>({
    key: "",
    direction: null,
  });
  const [selectedProject, setSelectedProject] = useState<ProjectRow | null>(null);

  const clientOptions = useMemo(() => {
    const clients = new Set<string>();
    projectData.forEach((row) => {
      if (row.clientName) {
        clients.add(row.clientName);
      }
    });
    return ["--ALL--", ...Array.from(clients)];
  }, [projectData]);

  const filteredData = useMemo(() => {
    if (selectedProject) return [selectedProject];

    let data = projectData.filter((row) => {
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
  }, [colFilters, sortConfig, selectedProject, projectData]);

  const uniqueClientsCount = useMemo(() => {
    return new Set(filteredData.map((d) => d.clientName).filter(Boolean)).size;
  }, [filteredData]);

  const projectsCount = useMemo(() => {
    return filteredData.length;
  }, [filteredData]);

  const projectStages = useMemo(() => {
    if (!selectedProject || !selectedProject.chapters) return [];
    const stagesSet = new Set<string>();
    selectedProject.chapters.forEach((ch) => {
      Object.keys(ch.stages).forEach((stage) => {
        stagesSet.add(stage);
      });
    });
    return Array.from(stagesSet);
  }, [selectedProject]);

  const hasActiveFilters = useMemo(() => {
    const hasFilters = Object.values(colFilters).some((val) => val && val !== "--ALL--");
    const hasSort = sortConfig.key !== "";
    return hasFilters || hasSort;
  }, [colFilters, sortConfig]);

  const handleClearFilters = () => {
    setColFilters({});
    setSortConfig({ key: "", direction: null });
  };

  const getRemarksStyles = (remarks: string) => {
    const styles: Record<string, string> = {
      Completed: "text-success",
      complete: "text-success",
      "In Progress": "text-info",
      "In-progress": "text-info",
      "Pending Review": "text-warning",
      Pending: "text-warning",
      Hold: "text-warning",
      "In-query": "text-warning",
      Assigned: "text-primary",
      Received: "text-primary",
      "Ready For Print": "text-warning",
      Draft: "text-muted",
    };
    return styles[remarks] || "text-muted";
  };

  const getRemarksIcon = (remarks: string) => {
    const icons: Record<string, React.ReactNode> = {
      Completed: <CheckCircle size={14} />,
      "In Progress": <Clock size={14} />,
      "Pending Review": <AlertCircle size={14} />,
      Assigned: <FileText size={14} />,
      "Ready For Print": <Calendar size={14} />,
    };
    return icons[remarks] || <FileText size={14} />;
  };

  const renderCell = (row: ProjectRow, col: typeof projectScheduleColumns[number]) => {
    if (col.source === "project") {
      const val = row[col.fieldKey as keyof ProjectRow];
      if (col.id === "project_title") {
        return (
          <span className="text-sm font-semibold text-text">
            {row.projectTitle}
          </span>
        );
      }
      if (col.id === "status") {
        return (
          <span className={`text-xs font-medium ${getRemarksStyles(String(val))}`}>
            {String(val)}
          </span>
        );
      }
      return <span className="text-text">{String(val)}</span>;
    } else if (col.source === "chapter_stage") {
      if (!row.chapters || row.chapters.length === 0) return <span className="text-muted-foreground">-</span>;
      return (
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {row.chapters.map((ch) => {
            const status = ch.stages[col.fieldKey] || "Pending";
            return (
              <span
                key={ch.chapterNumber}
                title={`${ch.chapterNumber}: ${status}`}
                className={`text-[10px] font-semibold ${getRemarksStyles(status)}`}
              >
                {ch.chapterNumber}: {status}
              </span>
            );
          })}
        </div>
      );
    } else if (col.source === "custom") {
      if (col.id === "chapters_status") {
        return <span className="text-text">{row.chaptersStatus || "0/0"}</span>;
      }
      return <span className="text-muted-foreground">-</span>;
    }
    return <span className="text-muted-foreground">-</span>;
  };

  const renderColumnFilter = (col: typeof projectScheduleColumns[number]) => {
    const value = colFilters[col.id] || "";
    const onChange = (val: string) => {
      setColFilters((prev) => ({ ...prev, [col.id]: val }));
    };

    if (col.id === "client") {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border bg-background px-1 py-0.5 text-xs outline-none focus:border-primary text-text font-sans font-normal"
        >
          {clientOptions.map((item) => (
            <option key={item} value={item}>
              {item === "--ALL--" ? "All" : item}
            </option>
          ))}
        </select>
      );
    }

    if (col.id === "status") {
      const statuses = ["--ALL--", ...Array.from(new Set(projectData.map((row) => row.remarks).filter(Boolean)))];
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border bg-background px-1 py-0.5 text-xs outline-none focus:border-primary text-text font-sans font-normal"
        >
          {statuses.map((item) => (
            <option key={item} value={item}>
              {item === "--ALL--" ? "All" : item}
            </option>
          ))}
        </select>
      );
    }

    if (col.id === "project_manager") {
      const managers = ["--ALL--", ...Array.from(new Set(projectData.map((row) => row.projectManager).filter(Boolean)))];
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border bg-background px-1 py-0.5 text-xs outline-none focus:border-primary text-text font-sans font-normal"
        >
          {managers.map((item) => (
            <option key={item} value={item}>
              {item === "--ALL--" ? "All" : item}
            </option>
          ))}
        </select>
      );
    }

    if (col.id === "sales_person") {
      const salesPersons = ["--ALL--", ...Array.from(new Set(projectData.map((row) => row.salesPerson).filter(Boolean)))];
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border bg-background px-1 py-0.5 text-xs outline-none focus:border-primary text-text font-sans font-normal"
        >
          {salesPersons.map((item) => (
            <option key={item} value={item}>
              {item === "--ALL--" ? "All" : item}
            </option>
          ))}
        </select>
      );
    }

    if (col.id === "start_date" || col.id === "due_date") {
      return null;
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
        className="w-full rounded border border-border bg-background px-2 py-0.5 text-xs outline-none focus:border-primary text-text font-sans font-normal placeholder:text-muted-foreground/60"
      />
    );
  };

  const visibleColumns = useMemo(() => projectScheduleColumns.filter((c) => c.visible), []);

  const handleExportExcel = () => {
    if (selectedProject) {
      const chaptersData = (selectedProject.chapters || []).map((ch) => ({
        "Client": selectedProject.clientName,
        "Project Code": selectedProject.projectCode,
        "Project Title": selectedProject.projectTitle,
        "Chapter Count": selectedProject.chapterCount,
        "Project Manager": selectedProject.projectManager,
        "Sales Person": selectedProject.salesPerson,
        "Category": selectedProject.category,
        "Project Manuscript Pages": selectedProject.manuscriptPages,
        "Billing Location": selectedProject.billingLocation,
        "Copyright Year": selectedProject.copyrightYear,
        "Project Start Date": selectedProject.startDate,
        "Project Due Date": selectedProject.dueDate,
        "Project Status": selectedProject.remarks,
        "Chapter": `Chapter ${ch.chapterNumber}`,
        "Assignee": ch.assigneeName || "-",
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
        "Copy Year",
        "Chapter",
        "Assignee",
        "Start Date",
        "Due Date",
        "Mss Pages",
        "Stage",
        "Status"
      ];
      
      const tableRows = (selectedProject.chapters || []).map((ch) => [
        selectedProject.clientName,
        selectedProject.projectCode,
        selectedProject.projectTitle,
        selectedProject.projectManager,
        selectedProject.salesPerson,
        selectedProject.category,
        selectedProject.billingLocation,
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

    const tableColumn = visibleColumns.map(col => col.label);
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
      styles: { fontSize: 8 },
      theme: "striped",
    });

    doc.save("book-info-report.pdf");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/reports')}
            className="p-2 rounded-lg hover:bg-card border border-transparent hover:border-border text-muted hover:text-text transition-all"
            aria-label="Back to Reports"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-text">Book Info</h2>
          </div>
        </div>

        {/* Actions (Exports & Clear) */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-text hover:bg-muted hover:text-primary transition-all duration-200"
            title="Export to Excel"
          >
            <Download size={14} />
            Excel
          </button>
          <button
            onClick={handleExportPDF}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-text hover:bg-muted hover:text-primary transition-all duration-200"
            title="Export to PDF"
          >
            <FileText size={14} className="text-muted-foreground" />
            PDF
          </button>
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline transition-colors px-2 py-1.5 ml-2"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 border border-border bg-card rounded-lg min-h-[300px] shadow-sm">
          <Spinner size="lg" />
          <span className="text-sm text-muted-foreground mt-3 font-medium">Loading project schedule data...</span>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-background text-left text-xs font-semibold uppercase tracking-wide text-muted select-none">
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
                          className={`px-4 py-3 ${isSortable ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}`}
                        >
                          <div className="flex items-center gap-1">
                            <span>
                              {col.id === "client"
                                ? `${col.label} (${uniqueClientsCount})`
                                : col.id === "project_code"
                                  ? `${col.label} (${projectsCount})`
                                  : col.label}
                            </span>
                            {isSortable && (
                              <span className="inline-flex text-muted-foreground/60">
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
                  <tr className="border-b border-border bg-muted/10">
                    {visibleColumns.map((col) => (
                      <td key={`filter-${col.id}`} className="px-3 py-1.5">
                        {renderColumnFilter(col)}
                      </td>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {filteredData.length > 0 ? (
                    filteredData.map((row) => (
                      <tr
                        key={`${row.projectCode}-${row.chapterCount}`}
                        onClick={() => setSelectedProject(prev => prev?.projectCode === row.projectCode ? null : row)}
                        className="cursor-pointer hover:bg-background/60 transition-colors"
                      >
                        {visibleColumns.map((col) => (
                          <td key={col.id} className="px-4 py-2.5">
                            {renderCell(row, col)}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={visibleColumns.length} className="px-4 py-10 text-center">
                        <div className="mx-auto flex max-w-sm flex-col items-center">
                          <div className="rounded-full bg-muted p-3 text-muted-foreground">
                            <FileText size={28} />
                          </div>
                          <h3 className="mt-3 text-sm font-semibold text-text">
                            No projects found
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Try changing the client filter or search text.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedProject && (
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-text">
                    Chapters Progress ({selectedProject.projectCode})
                  </h3>
                </div>

                {selectedProject.chapters && selectedProject.chapters.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-muted/50 border-b border-border text-muted-foreground font-semibold uppercase tracking-wider">
                          <th className="px-3 py-2 text-[10px]">Chapter</th>
                          <th className="px-3 py-2 text-[10px]">Assignee</th>
                          <th className="px-3 py-2 text-[10px]">Start Date</th>
                          <th className="px-3 py-2 text-[10px]">Due Date</th>
                          <th className="px-3 py-2 text-[10px]">Manuscript Pages</th>
                          <th className="px-3 py-2 text-[10px]">Current Stage</th>
                          <th className="px-3 py-2 text-[10px]">Overall Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedProject.chapters.map((ch) => (
                          <tr key={ch.chapterNumber} className="hover:bg-muted/10">
                            <td className="px-3 py-2.5 font-medium text-text">
                              Chapter {ch.chapterNumber}
                            </td>
                            <td className="px-3 py-2.5 text-text">
                              {ch.assigneeName || "-"}
                            </td>
                            <td className="px-3 py-2.5 text-text">
                              {ch.startDate || "-"}
                            </td>
                            <td className="px-3 py-2.5 text-text">
                              {ch.dueDate || "-"}
                            </td>
                            <td className="px-3 py-2.5 text-text">
                              {ch.manuscriptPages || 0}
                            </td>
                            <td className="px-3 py-2.5 text-text">
                              {ch.currentStage || "-"}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`text-xs font-semibold ${getRemarksStyles(
                                  ch.status || ""
                                )}`}
                              >
                                {ch.status || "-"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">No chapters found.</p>
                )}
              </div>
            </div>
          )}
        </>
      )}  </div>
  );
};

export default ProjectSchedule;
