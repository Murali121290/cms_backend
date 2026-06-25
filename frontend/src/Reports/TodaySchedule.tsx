import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CalendarDays, Building2, ArrowLeft } from "lucide-react";

type MilestoneStatus = "Pending" | "In Progress" | "Completed";

type ScheduleRow = {
  client: string;
  projectNumber: string;
  projectName: string;
  author: string;
  batch: string;
  chapter: string;
  cell: string;
  mssCount: number;
  receivedDate: string;
  dueDate: string;
  projectType: string;
  stage: string;
  planner: string;
  projectedPrinterDate: string;
  milestoneStatus: MilestoneStatus;
};

const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const TodaySchedule = () => {
  const navigate = useNavigate();
  const currentUser = {
    name: "Selva Bharath",
    team: "Copywriting",
  };

  const departmentData: Record<string, ScheduleRow[]> = {
    Copywriting: [
      {
        client: "Elsevier",
        projectNumber: "PRJ101",
        projectName: "Medical Science Draft",
        author: "John",
        batch: "B001",
        chapter: "Chapter 1",
        cell: "Cell A",
        mssCount: 250,
        receivedDate: getTodayDate(),
        dueDate: "2026-06-05",
        projectType: "Book",
        stage: "Copy Writing",
        planner: "David",
        projectedPrinterDate: "2026-06-10",
        milestoneStatus: "In Progress",
      },
      {
        client: "Pearson",
        projectNumber: "PRJ102",
        projectName: "Learning Content",
        author: "Arun",
        batch: "B002",
        chapter: "Chapter 3",
        cell: "Cell B",
        mssCount: 180,
        receivedDate: getTodayDate(),
        dueDate: "2026-06-06",
        projectType: "Book",
        stage: "Drafting",
        planner: "Keerthi",
        projectedPrinterDate: "2026-06-09",
        milestoneStatus: "Pending",
      },
    ],
    "Pre Editing": [
      {
        client: "Springer",
        projectNumber: "PRJ201",
        projectName: "Pre Edit Research",
        author: "Robert",
        batch: "B010",
        chapter: "Chapter 5",
        cell: "Cell C",
        mssCount: 420,
        receivedDate: getTodayDate(),
        dueDate: "2026-06-08",
        projectType: "Journal",
        stage: "Pre Editing",
        planner: "Smith",
        projectedPrinterDate: "2026-06-12",
        milestoneStatus: "In Progress",
      },
    ],
    "Editorial Services": [],
    "Chennai - JBL Team-1": [],
    "Chennai - Data Team": [],
    "Chennai - Wolters Kluwer": [],
    "Wolters Kluwer Health": [],
    "Chennai - Art Team": [],
    "Chennai - Production Control": [],
  };

  const currentRows = departmentData[currentUser.team] || [];

  const [search, setSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [status, setStatus] = useState<"--ALL--" | MilestoneStatus>("--ALL--");
  const [cell, setCell] = useState("--ALL--");
  const [clientName, setClientName] = useState("--ALL--");
  const [receivedFrom, setReceivedFrom] = useState(getTodayDate());
  const [receivedTo, setReceivedTo] = useState(getTodayDate());
  const [entries, setEntries] = useState("10");

  const teamStage = currentUser.team;

  const clientOptions = useMemo(() => {
    const uniqueClients = [...new Set(currentRows.map((item) => item.client))];
    return ["--ALL--", ...uniqueClients];
  }, [currentRows]);

  const cellOptions = useMemo(() => {
    const uniqueCells = [...new Set(currentRows.map((item) => item.cell))];
    return ["--ALL--", ...uniqueCells];
  }, [currentRows]);

  const filteredRows = useMemo(() => {
    return currentRows.filter((row) => {
      const matchesClient = clientName === "--ALL--" || row.client === clientName;
      const matchesStatus =
        status === "--ALL--" || row.milestoneStatus.toLowerCase() === status.toLowerCase();
      const matchesCell = cell === "--ALL--" || row.cell === cell;
      const matchesProjectSearch =
        !projectSearch ||
        row.projectName.toLowerCase().includes(projectSearch.toLowerCase()) ||
        row.projectNumber.toLowerCase().includes(projectSearch.toLowerCase());
      const matchesHeaderSearch =
        !search ||
        Object.values(row).some((value) =>
          String(value).toLowerCase().includes(search.toLowerCase())
        );
      const matchesReceivedFrom =
        !receivedFrom || new Date(row.receivedDate) >= new Date(receivedFrom);
      const matchesReceivedTo =
        !receivedTo || new Date(row.receivedDate) <= new Date(receivedTo);

      return (
        matchesClient &&
        matchesStatus &&
        matchesCell &&
        matchesProjectSearch &&
        matchesHeaderSearch &&
        matchesReceivedFrom &&
        matchesReceivedTo
      );
    });
  }, [currentRows, clientName, status, cell, projectSearch, search, receivedFrom, receivedTo]);

  const displayedRows = filteredRows.slice(0, Number(entries));

  const stageSummary = useMemo(() => {
    const summaryMap = filteredRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.stage] = (acc[row.stage] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(summaryMap).map(([stage, count]) => ({
      stage,
      count,
    }));
  }, [filteredRows]);

  const resetFilters = () => {
    setStatus("--ALL--");
    setCell("--ALL--");
    setClientName("--ALL--");
    setProjectSearch("");
    setReceivedFrom(getTodayDate());
    setReceivedTo(getTodayDate());
    setSearch("");
    setEntries("10");
  };

  const getStatusBadge = (statusValue: MilestoneStatus) => {
    const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold";
    if (statusValue === "Completed") return `${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`;
    if (statusValue === "In Progress") return `${base} bg-amber-50 text-amber-700 ring-1 ring-amber-200`;
    return `${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`;
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
          <h2 className="text-lg font-bold text-text">Today&apos;s Team Schedule</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Showing work for the logged-in team only.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            Team: <span className="font-semibold text-text">{currentUser.team}</span>
            <span className="mx-2 text-border">|</span>
            Logged in: <span className="font-semibold text-text">{currentUser.name}</span>
          </div>
          <button
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-text hover:bg-muted"
            onClick={resetFilters}
            type="button"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Client Name</label>
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
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "--ALL--" | MilestoneStatus)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="--ALL--">--ALL--</option>
              <option value="Pending">Pending</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Cell</label>
            <select
              value={cell}
              onChange={(e) => setCell(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {cellOptions.map((cellOption) => (
                <option key={cellOption} value={cellOption}>
                  {cellOption}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Team</label>
            <input
              value={teamStage}
              readOnly
              className="w-full rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-text outline-none opacity-80"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Search Project</label>
            <input
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              placeholder="Project name or number..."
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Received From</label>
            <input
              type="date"
              value={receivedFrom}
              onChange={(e) => setReceivedFrom(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Received To</label>
            <input
              type="date"
              value={receivedTo}
              onChange={(e) => setReceivedTo(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      </div>

      {/* Stage Summary */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Stage Summary</h2>
            <p className="text-xs text-muted-foreground">Stage-wise workload for the selected team.</p>
          </div>
          <CalendarDays size={16} className="text-muted-foreground" />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {stageSummary.map((item) => (
            <div key={item.stage} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-text">{item.stage}</p>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-text ring-1 ring-border">
                  {item.count}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
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
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search in table..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1500px] text-xs">
            <thead>
              <tr className="border-b border-border bg-background text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="border-b border-border px-3 py-2">Client</th>
                <th className="border-b border-border px-3 py-2">Project Number</th>
                <th className="border-b border-border px-3 py-2">Project Name</th>
                <th className="border-b border-border px-3 py-2">Author</th>
                <th className="border-b border-border px-3 py-2">Batch</th>
                <th className="border-b border-border px-3 py-2">Chapter</th>
                <th className="border-b border-border px-3 py-2">Cell</th>
                <th className="border-b border-border px-3 py-2">MSS Count</th>
                <th className="border-b border-border px-3 py-2">Received Date</th>
                <th className="border-b border-border px-3 py-2">Due Date</th>
                <th className="border-b border-border px-3 py-2">Project Type</th>
                <th className="border-b border-border px-3 py-2">Stage</th>
                <th className="border-b border-border px-3 py-2">Planner</th>
                <th className="border-b border-border px-3 py-2">Projected Printer Date</th>
                <th className="border-b border-border px-3 py-2">Milestone / Due Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {displayedRows.length > 0 ? (
                displayedRows.map((row, index) => (
                  <tr key={index} className="hover:bg-background/60 transition-colors text-text">
                    <td className="px-3 py-2">{row.client}</td>
                    <td className="px-3 py-2 font-medium">
                      {row.projectNumber}
                    </td>
                    <td className="px-3 py-2">{row.projectName}</td>
                    <td className="px-3 py-2">{row.author}</td>
                    <td className="px-3 py-2">{row.batch}</td>
                    <td className="px-3 py-2">{row.chapter}</td>
                    <td className="px-3 py-2">{row.cell}</td>
                    <td className="px-3 py-2">{row.mssCount}</td>
                    <td className="px-3 py-2">{row.receivedDate}</td>
                    <td className="px-3 py-2">{row.dueDate}</td>
                    <td className="px-3 py-2">{row.projectType}</td>
                    <td className="px-3 py-2">{row.stage}</td>
                    <td className="px-3 py-2">{row.planner}</td>
                    <td className="px-3 py-2">{row.projectedPrinterDate}</td>
                    <td className="px-3 py-2">
                      <span className={getStatusBadge(row.milestoneStatus)}>
                        {row.milestoneStatus}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={15} className="px-3 py-10 text-center">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                      <Building2 size={24} className="text-muted-foreground" />
                      <p className="text-xs font-medium">No schedules found</p>
                      <p className="text-[11px] text-muted-foreground">
                        Try changing filters or check the team mapping.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
          Showing {displayedRows.length === 0 ? 0 : 1} to {displayedRows.length} of {filteredRows.length} entries
        </div>
      </div>
    </div>
  );
};

export default TodaySchedule;
