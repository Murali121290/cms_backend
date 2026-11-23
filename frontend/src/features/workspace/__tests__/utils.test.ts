import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";

import { patchDashboard } from "../utils/cache";
import { daysBetween, dueInfo } from "../utils/dates";
import { parseConflict } from "../utils/errors";
import { applyFilters, EMPTY_FILTERS, sortItems, statusCounts, workloadOf } from "../utils/items";
import { availableActions, boardMove } from "../utils/moves";
import { barGeometry, dayCells, makeRange, plannedWindow } from "../utils/schedule";
import { leadDashboard, makeItem } from "./fixtures";

const nameOf = (u: string | null | undefined) => (u ? ({ "priya.nair": "Priya Nair" } as Record<string, string>)[u] ?? u : "Unassigned");

describe("queue filters", () => {
  const items = [
    makeItem({ chapters: "Ch01 Intro", custody_status: "unassigned", priority: "Urgent" }),
    makeItem({ chapters: "Ch02 Maps", custody_status: "in_progress", assignee_name: "priya.nair", delayed: true, delay_days: 2 }),
    makeItem({ chapters: "Ch03 Done", custody_status: "transitioned", client: "WK" }),
  ];

  it("hides completed rows unless the Completed chip is chosen", () => {
    expect(applyFilters(items, EMPTY_FILTERS, nameOf).map((i) => i.chapters)).toEqual(["Ch01 Intro", "Ch02 Maps"]);
    expect(applyFilters(items, { ...EMPTY_FILTERS, status: "done" }, nameOf).map((i) => i.chapters)).toEqual(["Ch03 Done"]);
  });

  it("matches the assignee's display name, not only the username", () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, q: "priya" }, nameOf)).toHaveLength(1);
    expect(applyFilters(items, { ...EMPTY_FILTERS, q: "Nair" }, nameOf)).toHaveLength(1);
  });

  it("supports delayed, priority and secondary column filters", () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, status: "delayed" }, nameOf).map((i) => i.chapters)).toEqual(["Ch02 Maps"]);
    expect(applyFilters(items, { ...EMPTY_FILTERS, priority: "Urgent" }, nameOf)).toHaveLength(1);
    expect(applyFilters(items, { ...EMPTY_FILTERS, assignees: [""] }, nameOf).map((i) => i.chapters)).toEqual(["Ch01 Intro"]);
  });

  it("counts every status chip against the same base filters", () => {
    const c = statusCounts(items, EMPTY_FILTERS, nameOf);
    expect(c).toMatchObject({ all: 2, unassigned: 1, in_progress: 1, delayed: 1, done: 1 });
  });

  it("sorts by priority then due date", () => {
    const sorted = sortItems(items.slice(0, 2), "priority", 1, nameOf);
    expect(sorted[0].priority).toBe("Urgent");
  });

  it("counts workload as in-progress + in-review items", () => {
    const w = workloadOf([...items, makeItem({ assignee_name: "priya.nair", custody_status: "returned_for_review", manuscript_pages: 10 })], "priya.nair");
    expect(w).toEqual({ open: 2, pages: 30 });
  });
});

describe("board moves and actions", () => {
  it("only allows the custody state machine's moves", () => {
    expect(boardMove("unassigned", "in_progress")).toBe("assign");
    expect(boardMove("returned_for_review", "in_progress")).toBe("rework");
    expect(boardMove("unassigned", "qa_approved")).toBeNull();
    expect(boardMove("qa_approved", "unassigned")).toBeNull();
  });

  it("lets an employee hand back only their own work and owners do the rest", () => {
    const wip = makeItem({ custody_status: "in_progress", assignee_name: "priya.nair" });
    expect(availableActions(wip, { viewer: "priya.nair", canManage: false })).toEqual(["handback"]);
    expect(availableActions(wip, { viewer: "someone", canManage: false })).toEqual([]);
    // Leads reassign; only the assignee hands back.
    expect(availableActions(wip, { viewer: "emily", canManage: true })).toEqual(["reassign"]);
    expect(availableActions(wip, { viewer: "priya.nair", canManage: true })).toEqual(["handback", "reassign"]);
    expect(availableActions(makeItem({ custody_status: "qa_approved" }), { viewer: "x", canManage: true })).toEqual(["move_next"]);
  });
});

describe("schedule geometry", () => {
  const today = new Date(2026, 10, 21, 10);
  const range = makeRange(today, 2);

  it("builds a 14-day window starting 6 days back", () => {
    expect(range.days).toBe(14);
    expect(range.startKey).toBe("2026-11-15");
    expect(range.endKey).toBe("2026-11-28");
    const cells = dayCells(range, "2026-11-21");
    expect(cells.find((c) => c.today)?.key).toBe("2026-11-21");
    expect(cells[0].monthLabel).not.toBe("");
  });

  it("positions a bar in percent of the range", () => {
    const start = new Date(2026, 10, 15).getTime();
    const end = new Date(2026, 10, 22).getTime();
    const g = barGeometry(range, start, end);
    expect(g?.left).toBeCloseTo(0);
    expect(g?.width).toBeCloseTo(50);
  });

  it("clips bars at the edges and drops bars fully outside", () => {
    const g = barGeometry(range, new Date(2026, 10, 10).getTime(), new Date(2026, 10, 16).getTime());
    expect(g?.left).toBe(0);
    expect(g?.clippedStart).toBe(true);
    expect(barGeometry(range, new Date(2026, 9, 1).getTime(), new Date(2026, 9, 5).getTime())).toBeNull();
  });

  it("uses the whole planned end day", () => {
    const item = makeItem({ planned_start_date: "2026-11-16T09:00:00", planned_end_date: "2026-11-18T09:00:00" });
    const [s, e] = plannedWindow(item) ?? [0, 0];
    expect(new Date(s).getDate()).toBe(16);
    expect(new Date(e).getDate()).toBe(19);
  });
});

describe("dates", () => {
  it("describes due dates and completion lateness", () => {
    expect(daysBetween("2026-11-21", "2026-11-23")).toBe(2);
    expect(dueInfo(makeItem({ planned_end_date: "2026-11-21T10:00:00" }), "2026-11-21").text).toBe("Due today");
    expect(dueInfo(makeItem({ planned_end_date: "2026-11-19T10:00:00", delayed: true, delay_days: 2 }), "2026-11-21")).toEqual({ text: "2d late", tone: "bad" });
    expect(dueInfo(makeItem({ custody_status: "transitioned", actual_end_date: "2026-11-20T10:00:00", completion_delay_days: 0 }), "2026-11-21").text).toMatch(/on time/);
  });
});

describe("errors and cache", () => {
  it("reads a 409 custody conflict", () => {
    const current = makeItem({ custody_status: "returned_for_review" });
    const err = new AxiosError("conflict", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 409,
      data: { detail: { code: "CUSTODY_CONFLICT", message: "Changed", current } },
    } as AxiosResponse);
    expect(parseConflict(err)).toEqual({ message: "Changed", current });
    expect(parseConflict(new Error("x"))).toBeNull();
  });

  it("patches a task everywhere in the cached dashboard", () => {
    const item = makeItem();
    const data = leadDashboard([item]);
    const next = patchDashboard(data, item.id, (i) => ({ ...i, assignee_name: "priya.nair" }));
    expect(next.pipeline?.items[0].assignee_name).toBe("priya.nair");
    expect(data.pipeline?.items[0].assignee_name).toBeNull();
  });
});

describe("chapter labels", () => {
  it("names numbered chapters and keeps everything else", async () => {
    const { chapterLabel, chapterOf } = await import("../utils/items");
    expect(chapterLabel("01")).toBe("Chapter 01");
    expect(chapterLabel("10")).toBe("Chapter 10");
    expect(chapterLabel("00")).toBe("Book");
    expect(chapterLabel("Ch 02 - Art")).toBe("Ch 02 - Art");
    expect(chapterOf({ chapters: "03", chapter_label: null } as Parameters<typeof chapterOf>[0])).toBe("Chapter 03");
  });
});

describe("column filters", () => {
  it("filters any column and lists only values still possible under the other filters", async () => {
    const { applyFilters, columnOptions, EMPTY_FILTERS } = await import("../utils/items");
    const { makeItem } = await import("./fixtures");
    const items = [
      makeItem({ project: "P1", client_name: "Wolters", priority: "High" }),
      makeItem({ project: "P2", client_name: "Springer" }),
      makeItem({ project: "P3", client_name: "Springer" }),
    ];
    const nameOf = (u: string | null | undefined) => u ?? "Unassigned";
    const f = { ...EMPTY_FILTERS, clients: ["Springer"] };
    expect(applyFilters(items, f, nameOf).map((i) => i.project)).toEqual(["P2", "P3"]);
    expect(columnOptions(items, f, "project", nameOf).map((o) => o.value)).toEqual(["P2", "P3"]);
    // The column's own filter is ignored when listing its values (so you can re-tick Wolters)
    expect(columnOptions(items, f, "client", nameOf).map((o) => [o.value, o.count])).toEqual([["Springer", 2], ["Wolters", 1]]);
    expect(applyFilters(items, { ...EMPTY_FILTERS, priorities: ["High"] }, nameOf)).toHaveLength(1);
  });
});

describe("409 handling", () => {
  it("opens the conflict dialog only for custody races; NOT_AT_STAGE is shown as a message", async () => {
    const { AxiosError } = await import("axios");
    const { parseConflict } = await import("../utils/errors");
    const err = (detail: unknown) =>
      new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { detail }, statusText: "", headers: {}, config: {} as never });
    expect(parseConflict(err({ code: "CUSTODY_CONFLICT", message: "changed", current: null }))?.message).toBe("changed");
    expect(parseConflict(err({ code: "NOT_AT_STAGE", message: "Chapter 03 is still in Manuscript Analysis." }))).toBeNull();
  });
});

describe("team per stage", () => {
  it("lists people mapped to the stage or holding its work; Admins only where they hold work", async () => {
    const { stagePeople } = await import("../components/TeamTable");
    const { makeItem } = await import("./fixtures");
    const person = (username: string, role: string, stage_names: string[]) => ({ username, display_name: username, role, stage_names, open_count: 0, open_pages: 0, completed_count: 0 });
    const people = [
      person("priya", "Pre-editor", ["Pre-editing"]),
      person("vinoth", "Copyeditor", ["Language Editing"]),
      person("admin", "Admin", ["Pre-editing", "Language Editing"]),
      person("admin_hema", "Admin", ["Pre-editing", "Language Editing"]),
      person("pm", "Project Manager", []),
    ];
    const items = [makeItem({ stage_name: "Pre-editing", assignee_name: "admin_hema" }), makeItem({ stage_name: "Pre-editing", assignee_name: "pm" })];
    expect(stagePeople(people, items, "Pre-editing").map((p) => p.username)).toEqual(["priya", "admin_hema", "pm"]);
    expect(stagePeople(people, items, "Language Editing").map((p) => p.username)).toEqual(["vinoth"]);
  });
});
