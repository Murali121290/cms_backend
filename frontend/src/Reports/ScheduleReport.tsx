import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Filter,
  RefreshCw,
  Printer,
  Download,
  FileText,
  Building2,
  ArrowLeft,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const ScheduleReport = () => {
  const navigate = useNavigate();
  const departments = [
    "Editorial Services",
    "Media Services",
    "Chennai - JBL Team",
    "Wolters Kluwer Health-1",
    "Accessible Team",
    "QBend",
    "Editorial Services 2",
  ];

  const scheduleData: Record<string, any[]> = {
    "Editorial Services": [
      {
        client: "Elsevier",
        project: "Advanced Biology",
        chapter: "Chapter 2",
        receivedDate: "2026-05-27",
        dueDate: "2026-06-04",
        workingCycle: "7 Days",
        mssCount: 250,
        castOff: 180,
        stage: "Copy Editing",
        cell: "Cell A",
        milestone: "Pre-Press",
        completed: "No",
        codeType: "Book",
        platform: "InDesign",
        planner: "David",
        batchId: "B1001",
        printerDate: "2026-06-09",
        remarks: "Awaiting review",
        dueStatus: "Pending",
      },
      {
        client: "Pearson",
        project: "Clinical Notes",
        chapter: "Chapter 5",
        receivedDate: "2026-05-29",
        dueDate: "2026-06-08",
        workingCycle: "10 Days",
        mssCount: 310,
        castOff: 205,
        stage: "First Proofs",
        cell: "Cell B",
        milestone: "Proofing",
        completed: "Yes",
        codeType: "Book",
        platform: "3B2",
        planner: "Keerthi",
        batchId: "B1002",
        printerDate: "2026-06-14",
        remarks: "Completed on time",
        dueStatus: "Completed",
      },
    ],
    "Media Services": [
      {
        client: "Springer",
        project: "Media Science",
        chapter: "Chapter 1",
        receivedDate: "2026-05-28",
        dueDate: "2026-06-06",
        workingCycle: "8 Days",
        mssCount: 420,
        castOff: 260,
        stage: "XML",
        cell: "Cell C",
        milestone: "Conversion",
        completed: "No",
        codeType: "Journal",
        platform: "XML Flow",
        planner: "Smith",
        batchId: "B2001",
        printerDate: "2026-06-12",
        remarks: "In conversion",
        dueStatus: "In Progress",
      },
    ],
    "Chennai - JBL Team": [],
    "Wolters Kluwer Health-1": [],
    "Accessible Team": [],
    QBend: [],
    "Editorial Services 2": [],
  };

  const [searchTerm, setSearchTerm] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [department, setDepartment] = useState("Editorial Services");
  const [clientName, setClientName] = useState("--ALL--");
  const [stageName, setStageName] = useState("--ALL--");
  const [dueDateStatus, setDueDateStatus] = useState("--ALL--");
  const [, setChapterStatus] = useState("--ALL--");
  const [cellChoice, setCellChoice] = useState("--ALL--");
  const [receivedFrom, setReceivedFrom] = useState("");
  const [receivedTo, setReceivedTo] = useState("");
  const [dueAsOn, setDueAsOn] = useState("");
  const [entries, setEntries] = useState("10");

  const currentRows = scheduleData[department] || [];

  const clientOptions = useMemo(() => {
    const uniqueClients = [...new Set(currentRows.map((item) => item.client))];
    return ["--ALL--", ...uniqueClients];
  }, [currentRows]);

  const stageOptions = useMemo(() => {
    const uniqueStages = [...new Set(currentRows.map((item) => item.stage))];
    return ["--ALL--", ...uniqueStages];
  }, [currentRows]);

  const cellOptions = useMemo(() => {
    const uniqueCells = [...new Set(currentRows.map((item) => item.cell))];
    return ["--ALL--", ...uniqueCells];
  }, [currentRows]);

  const filteredRows = useMemo(() => {
    return currentRows.filter((row) => {
      const matchesClient =
        clientName === "--ALL--" || row.client === clientName;

      const matchesStage =
        stageName === "--ALL--" || row.stage === stageName;

      const matchesDueStatus =
        dueDateStatus === "--ALL--" || row.dueStatus === dueDateStatus;

      const matchesCell =
        cellChoice === "--ALL--" || row.cell === cellChoice;

      const matchesProject =
        !projectSearch ||
        row.project.toLowerCase().includes(projectSearch.toLowerCase());

      const matchesSearch =
        !searchTerm ||
        Object.values(row).some((value) =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        );

      const matchesReceivedFrom =
        !receivedFrom || new Date(row.receivedDate) >= new Date(receivedFrom);

      const matchesReceivedTo =
        !receivedTo || new Date(row.receivedDate) <= new Date(receivedTo);

      const matchesDueAsOn =
        !dueAsOn || new Date(row.dueDate) <= new Date(dueAsOn);

      return (
        matchesClient &&
        matchesStage &&
        matchesDueStatus &&
        matchesCell &&
        matchesProject &&
        matchesSearch &&
        matchesReceivedFrom &&
        matchesReceivedTo &&
        matchesDueAsOn
      );
    });
  }, [
    currentRows,
    clientName,
    stageName,
    dueDateStatus,
    cellChoice,
    projectSearch,
    searchTerm,
    receivedFrom,
    receivedTo,
    dueAsOn,
  ]);

  const displayedRows = filteredRows.slice(0, Number(entries));

  const pieChartData = useMemo(() => {
    const grouped = filteredRows.reduce((acc: Record<string, number>, row) => {
      if (!acc[row.stage]) {
        acc[row.stage] = 0;
      }
      acc[row.stage] += row.mssCount;
      return acc;
    }, {});

    return Object.entries(grouped).map(([name, value]) => ({
      name,
      value,
    }));
  }, [filteredRows]);

  const resetFilters = () => {
    setDepartment("Editorial Services");
    setClientName("--ALL--");
    setStageName("--ALL--");
    setDueDateStatus("--ALL--");
    setChapterStatus("--ALL--");
    setCellChoice("--ALL--");
    setProjectSearch("");
    setSearchTerm("");
    setReceivedFrom("");
    setReceivedTo("");
    setDueAsOn("");
    setEntries("10");
  };

  const getStatusBadge = (status: string) => {
    const base =
      "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold";

    if (status === "Completed") {
      return `${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`;
    }

    if (status === "In Progress") {
      return `${base} bg-amber-50 text-amber-700 ring-1 ring-amber-200`;
    }

    return `${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`;
  };

  const COLORS = [
    "#2563eb",
    "#0f766e",
    "#7c3aed",
    "#ea580c",
    "#dc2626",
    "#0891b2",
    "#65a30d",
    "#9333ea",
    "#c2410c",
    "#334155",
  ];

  const handleExportToExcel = () => {
    const exportData = filteredRows.map((row) => ({
      Client: row.client,
      Project: row.project,
      Chapter: row.chapter,
      "Received Date": row.receivedDate,
      "Due Date": row.dueDate,
      "Working Cycle": row.workingCycle,
      "MSS Count": row.mssCount,
      "Cast Off": row.castOff,
      Stage: row.stage,
      Cell: row.cell,
      Milestone: row.milestone,
      Completed: row.completed,
      "Code Type": row.codeType,
      Platform: row.platform,
      Planner: row.planner,
      "Batch ID": row.batchId,
      "Printer Date": row.printerDate,
      Remarks: row.remarks,
      "Due Status": row.dueStatus,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Schedule Report");

    const fileName = `schedule-report-${department
      .toLowerCase()
      .replace(/\s+/g, "-")}.xlsx`;

    XLSX.writeFile(workbook, fileName);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF("l", "mm", "a4");

    doc.setFontSize(16);
    doc.text("Schedule Report", 14, 15);

    doc.setFontSize(10);
    doc.text(`Department: ${department}`, 14, 22);
    doc.text(`Total Visible Rows: ${displayedRows.length}`, 14, 28);

    const tableColumn = [
      "Client",
      "Project",
      "Chapter",
      "Received Date",
      "Due Date",
      "Working Cycle",
      "MSS Count",
      "Cast Off",
      "Stage",
      "Cell",
      "Milestone",
      "Completed",
      "Code Type",
      "Platform",
      "Planner",
      "Batch ID",
      "Printer Date",
      "Remarks",
    ];

    const tableRows = displayedRows.map((row) => [
      row.client,
      row.project,
      row.chapter,
      row.receivedDate,
      row.dueDate,
      row.workingCycle,
      row.mssCount,
      row.castOff,
      row.stage,
      row.cell,
      row.milestone,
      row.completed,
      row.codeType,
      row.platform,
      row.planner,
      row.batchId,
      row.printerDate,
      row.remarks,
    ]);

    autoTable(doc, {
      startY: 34,
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

    doc.save("schedule-report.pdf");
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/reports')}
          className="p-2 rounded-lg hover:bg-card border border-transparent hover:border-border text-muted hover:text-text transition-all"
          aria-label="Back to Reports"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-text">Schedules Report</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            View, filter, export, and monitor current project schedules.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-text hover:bg-muted"
          >
            Reset Filters
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Client Name
            </label>
            <select
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {clientOptions.map((client) => (
                <option key={client} value={client}>
                  {client}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Search Project
            </label>
            <input
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Project name..."
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Stage Name
            </label>
            <select
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {stageOptions.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Due Date Status
            </label>
            <select
              value={dueDateStatus}
              onChange={(e) => setDueDateStatus(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="--ALL--">--ALL--</option>
              <option value="Pending">Pending</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Chapter Status
            </label>
            <select
              onChange={(e) => setChapterStatus(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="--ALL--">--ALL--</option>
              <option value="Open">Open</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Received From
            </label>
            <input
              type="date"
              value={receivedFrom}
              onChange={(e) => setReceivedFrom(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Received To
            </label>
            <input
              type="date"
              value={receivedTo}
              onChange={(e) => setReceivedTo(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Due As On
            </label>
            <input
              type="date"
              value={dueAsOn}
              onChange={(e) => setDueAsOn(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Cell Choice
            </label>
            <select
              value={cellChoice}
              onChange={(e) => setCellChoice(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {cellOptions.map((cell) => (
                <option key={cell} value={cell}>
                  {cell}
                </option>
              ))}
            </select>
          </div>

          <div className="xl:col-span-3">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Department
            </label>
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setClientName("--ALL--");
                setStageName("--ALL--");
                setCellChoice("--ALL--");
              }}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>


      {/* Export section */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleExportToExcel}
          className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-primary bg-accent hover:bg-primary hover:text-white transition-colors px-3 py-1.5"
        >
          <Download size={14} />
          Export To Excel
        </button>

        <button
          onClick={handleExportPDF}
          className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-primary bg-accent hover:bg-primary hover:text-white transition-colors px-3 py-1.5"
        >
          <FileText size={14} />
          Export PDF
        </button>

        <button
          onClick={handlePrint}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-primary bg-accent hover:bg-primary hover:text-white transition-colors px-3 py-1.5"
        >
          <Printer size={14} />
          Print
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-muted-foreground">
            Show
            <select
              value={entries}
              onChange={(e) => setEntries(e.target.value)}
              className="mx-1 rounded-lg border border-border bg-background px-1.5 py-0.5 text-xs outline-none"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
            entries
          </div>

          <div className="relative w-full md:w-64">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search schedules..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1700px] text-xs">
            <thead>
              <tr className="border-b border-border bg-background text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Project</th>
                <th className="px-3 py-2">Chapter</th>
                <th className="px-3 py-2">Received Date</th>
                <th className="px-3 py-2">Due Date</th>
                <th className="px-3 py-2">Working Cycle</th>
                <th className="px-3 py-2">MSS Count</th>
                <th className="px-3 py-2">Cast Off</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Cell</th>
                <th className="px-3 py-2">Milestone</th>
                <th className="px-3 py-2">Completed</th>
                <th className="px-3 py-2">Code Type</th>
                <th className="px-3 py-2">Platform</th>
                <th className="px-3 py-2">Planner</th>
                <th className="px-3 py-2">Batch ID</th>
                <th className="px-3 py-2">Printer Date</th>
                <th className="px-3 py-2">Remarks</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {displayedRows.length > 0 ? (
                displayedRows.map((row, index) => (
                  <tr key={index} className="hover:bg-background/60 transition-colors text-text">
                    <td className="px-3 py-2">{row.client}</td>
                    <td className="px-3 py-2 font-medium">
                      {row.project}
                    </td>
                    <td className="px-3 py-2">{row.chapter}</td>
                    <td className="px-3 py-2">{row.receivedDate}</td>
                    <td className="px-3 py-2">{row.dueDate}</td>
                    <td className="px-3 py-2">{row.workingCycle}</td>
                    <td className="px-3 py-2">{row.mssCount}</td>
                    <td className="px-3 py-2">{row.castOff}</td>
                    <td className="px-3 py-2">{row.stage}</td>
                    <td className="px-3 py-2">{row.cell}</td>
                    <td className="px-3 py-2">{row.milestone}</td>
                    <td className="px-3 py-2">{row.completed}</td>
                    <td className="px-3 py-2">{row.codeType}</td>
                    <td className="px-3 py-2">{row.platform}</td>
                    <td className="px-3 py-2">{row.planner}</td>
                    <td className="px-3 py-2">{row.batchId}</td>
                    <td className="px-3 py-2">{row.printerDate}</td>
                    <td className="px-3 py-2">
                      <span className={getStatusBadge(row.dueStatus)}>
                        {row.remarks}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={18} className="px-3 py-10 text-center">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                      <Building2 size={24} className="text-muted-foreground" />
                      <p className="text-xs font-medium">No data available in table</p>
                      <p className="text-[11px] text-muted-foreground">
                        Try changing department or clearing filters.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
          Showing {displayedRows.length === 0 ? 0 : 1} to {displayedRows.length} of{" "}
          {filteredRows.length} entries
        </div>
      </div>
    </div>
  );
};

export default ScheduleReport;
