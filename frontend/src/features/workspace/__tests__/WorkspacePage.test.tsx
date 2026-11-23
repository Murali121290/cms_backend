import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderRoute } from "@/test/testUtils";

import { employeeDashboard, leadDashboard, makeItem, stage } from "./fixtures";

const api = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  assign: vi.fn(),
  handback: vi.fn(),
  review: vi.fn(),
  moveNextPreview: vi.fn(),
  moveNext: vi.fn(),
  activity: vi.fn(),
  bulk: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("../api", () => ({ workspaceApi: api }));
const exporter = vi.hoisted(() => ({ exportQueueToExcel: vi.fn() }));
vi.mock("../utils/exportQueue", () => exporter);
vi.mock("@/api/users", () => ({ usersApi: { list: vi.fn().mockResolvedValue([]) } }));

import { WorkspacePage } from "../WorkspacePage";

const renderAt = (entry = "/workspace") => renderRoute({ path: "/workspace", initialEntry: entry, element: <WorkspacePage /> });

describe("WorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.schedule.mockResolvedValue({ stage_name: "Copyediting", date_from: "", date_to: "", items: [], truncated: false });
  });

  it("shows an error with Retry, then recovers", async () => {
    api.getDashboard.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(employeeDashboard([]));
    renderAt();
    expect(await screen.findByText("We couldn't load your workspace")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/Nothing on your desk/)).toBeInTheDocument();
  });

  it("renders the employee view with sections and validates hand-back", async () => {
    const wip = makeItem({ chapters: "Ch03 Vector Spaces", custody_status: "in_progress", assignee_name: "priya.nair" });
    const rework = makeItem({ chapters: "Ch04 Pharmacology", custody_status: "in_progress", assignee_name: "priya.nair", rework_count: 1, rework_notes: "Fix refs" });
    api.getDashboard.mockResolvedValue(employeeDashboard([wip, rework]));
    api.handback.mockResolvedValue({ ...wip, custody_status: "returned_for_review" });
    renderAt();

    expect(await screen.findByRole("heading", { name: /Needs rework/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Waiting for owner review/ })).toBeInTheDocument();
    expect(screen.getByText("Fix refs")).toBeInTheDocument();

    const card = screen.getByRole("article", { name: "Ch03 Vector Spaces" });
    await userEvent.click(within(card).getByRole("button", { name: "Hand back" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Hand back for review" });
    expect(submit).toBeDisabled();
    for (const box of within(dialog).getAllByRole("checkbox")) await userEvent.click(box);
    await userEvent.type(within(dialog).getByRole("textbox"), "too short");
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), " — 2 queries added");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() =>
      expect(api.handback).toHaveBeenCalledWith(wip.id, expect.objectContaining({ checklist_confirmed: true, expected_custody_status: "in_progress" })),
    );
  });

  it("renders the team lead board with the four custody columns", async () => {
    api.getDashboard.mockResolvedValue(
      leadDashboard([
        makeItem({ chapters: "Ch01 Introduction" }),
        makeItem({ chapters: "Ch05 Eigenvalues", custody_status: "returned_for_review", assignee_name: "priya.nair", handback_notes: "2 AQs" }),
      ]),
    );
    renderAt();
    expect(await screen.findByRole("region", { name: /Inbound, 1 items/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Returned for review, 1 items/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Ready to move, 0 items/ })).toBeInTheDocument();
    expect(screen.getByText("2 AQs")).toBeInTheDocument();
  });

  it("renders manager stage cards and switches stage on click", async () => {
    api.getDashboard.mockResolvedValue(
      leadDashboard([makeItem({ stage_name: "Copyediting" }), makeItem({ stage_name: "Typesetting", chapters: "Ch09 Layout" })], {
        role: "manager",
        stages: [stage("Copyediting"), stage("Typesetting", { owner_name: "Li Wei" })],
      }),
    );
    renderAt();
    expect(await screen.findByText("Production overview")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Typesetting.*active/ }));
    expect(await screen.findByRole("article", { name: "Ch09 Layout" })).toBeInTheDocument();
  });

  it("lets admins/managers pick a process and hide idle stages", async () => {
    const dash = leadDashboard([makeItem({ stage_name: "Typesetting", chapters: "Ch09 Layout" })], {
      role: "manager",
      stages: [stage("Copyediting"), stage("Typesetting"), stage("Quality Control")],
    });
    api.getDashboard.mockResolvedValue({
      ...dash,
      pipeline: dash.pipeline ? { ...dash.pipeline, workflows: [{ workflow_name: "Books", stages: ["Quality Control", "Typesetting"] }] } : null,
    });
    renderAt();
    const overview = await screen.findByRole("region", { name: "Stage overview" });
    const cards = () => within(overview).getAllByRole("button", { name: /active/ }).map((b) => b.textContent ?? "");
    expect(cards()).toHaveLength(3);
    await userEvent.selectOptions(within(overview).getByLabelText(/Process/), "Books");
    expect(cards()[0]).toMatch(/^1\.Quality Control/);
    expect(cards()[1]).toMatch(/^2\.Typesetting/);
    await userEvent.click(within(overview).getByRole("button", { name: /With work \(1\)/ }));
    expect(cards()).toHaveLength(1);
    localStorage.removeItem("workspace.overview");
  });

  it("explains when a lead has no mapped stages", async () => {
    api.getDashboard.mockResolvedValue(leadDashboard([], { stages: [] }));
    renderAt();
    expect(await screen.findByText("No stages to show")).toBeInTheDocument();
  });

  it("filters the queue by search and the Completed chip (URL-synced)", async () => {
    api.getDashboard.mockResolvedValue(
      leadDashboard([
        makeItem({ chapters: "Ch01 Introduction" }),
        makeItem({ chapters: "Ch02 Linear Maps", custody_status: "in_progress", assignee_name: "priya.nair" }),
        makeItem({ chapters: "Ch00 Preface", custody_status: "transitioned", actual_end_date: "2026-11-10T10:00:00Z", completion_delay_days: 0 }),
      ]),
    );
    renderAt("/workspace?tab=queue");
    expect(await screen.findByText("Ch01 Introduction")).toBeInTheDocument();
    expect(screen.queryByText("Ch00 Preface")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: /search the queue/i }), { target: { value: "linear" } });
    await waitFor(() => expect(screen.queryByText("Ch01 Introduction")).not.toBeInTheDocument());
    expect(screen.getByText("Ch02 Linear Maps")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Completed/ }));
    expect(await screen.findByText("Ch00 Preface")).toBeInTheDocument();
    expect(screen.queryByText("Ch01 Introduction")).not.toBeInTheDocument();
  });

  it("shows columns in order, filters any column from its header and exports only the filtered rows", async () => {
    api.getDashboard.mockResolvedValue(
      leadDashboard([
        makeItem({ chapters: "01", project: "P1", client: "KLUPA02", client_name: "Wolters Kluwer Health" }),
        makeItem({ chapters: "02", project: "P2", client: "SPRNY00", client_name: "Springer Publishing" }),
        makeItem({ chapters: "03", project: "P2", client: "SPRNY00", client_name: "Springer Publishing" }),
      ]),
    );
    renderAt("/workspace?tab=queue");
    expect(await screen.findByText("Chapter 01")).toBeInTheDocument();

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "").filter(Boolean);
    expect(headers.slice(0, 6).map((h) => h.replace(/[↑↓]/g, "").trim())).toEqual(["Client", "Project code", "PM", "Chapter", "Stage", "Due date"]);

    await userEvent.click(screen.getByRole("button", { name: "Filter Client" }));
    const panel = await screen.findByRole("dialog", { name: "Filter Client" });
    expect(within(panel).getByText("Springer Publishing").nextSibling?.textContent).toBe("2");
    await userEvent.click(within(panel).getByRole("checkbox", { name: /Wolters Kluwer Health/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.queryByText("Chapter 01")).not.toBeInTheDocument());
    expect(screen.getByText("Chapter 02")).toBeInTheDocument();
    expect(screen.getByLabelText("Active column filters")).toHaveTextContent("Client: Springer Publishing");
    expect(screen.getByRole("button", { name: "Filter Client (1 selected)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Export 2 rows \(filtered\)/ }));
    expect(exporter.exportQueueToExcel).toHaveBeenCalledTimes(1);
    const [rows, , filtered] = exporter.exportQueueToExcel.mock.calls[0];
    expect((rows as { chapters: string }[]).map((r) => r.chapters)).toEqual(["02", "03"]);
    expect(filtered).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Remove Client filter" }));
    expect(await screen.findByText("Chapter 01")).toBeInTheDocument();
  });

  it("lists stages A-Z in a searchable picker", async () => {
    api.getDashboard.mockResolvedValue(
      leadDashboard([makeItem({ stage_name: "Typesetting", chapters: "Ch09 Layout" })], {
        role: "manager",
        stages: [stage("Typesetting"), stage("Copyediting"), stage("AQ Resolution")],
      }),
    );
    renderAt();
    await screen.findByText("Production overview");
    const trigger = document.getElementById("workspace-stage");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    await userEvent.click(trigger as HTMLElement);
    const list = await screen.findByRole("listbox", { name: "Stages" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent?.replace(/\d+$/, ""))).toEqual(["AQ Resolution", "Copyediting", "Typesetting"]);
    await userEvent.type(screen.getByRole("combobox", { name: "Search stages" }), "type");
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("article", { name: "Ch09 Layout" })).toBeInTheDocument();
  });

  it("chapter list follows the selected stage; All stages shows everything", async () => {
    api.getDashboard.mockResolvedValue(
      leadDashboard(
        [makeItem({ stage_name: "Typesetting", chapters: "05" }), makeItem({ stage_name: "Copyediting", chapters: "06" })],
        { role: "manager", stages: [stage("Copyediting"), stage("Typesetting")] },
      ),
    );
    renderAt("/workspace?tab=queue&stage=Typesetting");
    expect(await screen.findByText("Chapter 05")).toBeInTheDocument();
    expect(screen.queryByText("Chapter 06")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Chapters · Typesetting/ })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Stage" }), "all");
    expect(await screen.findByText("Chapter 06")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /All chapters/ })).toBeInTheDocument();
  });

  it("asks for confirmation before a bulk approve and shows per-item results", async () => {
    const a = makeItem({ chapters: "Ch05 Eigenvalues", custody_status: "returned_for_review", assignee_name: "priya.nair" });
    const b = makeItem({ chapters: "Ch01 Introduction" });
    api.getDashboard.mockResolvedValue(leadDashboard([a, b]));
    api.bulk.mockResolvedValue({ results: [{ task_id: a.id, status: "ok", message: null, item: { ...a, custody_status: "qa_approved" } }] });
    renderAt("/workspace?tab=queue");

    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Ch05 Eigenvalues" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Ch01 Introduction" }));
    await userEvent.click(within(screen.getByRole("region", { name: "Bulk actions" })).getByRole("button", { name: /Approve \(1\)/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Approve 1 chapter")).toBeInTheDocument();
    expect(within(dialog).getByText(/will be skipped/)).toBeInTheDocument();
    expect(api.bulk).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(api.bulk).toHaveBeenCalledWith({ action: "approve", task_ids: [a.id, b.id], assignee: null, notify: true }));
    expect(await screen.findByText("1 done")).toBeInTheDocument();
  });

  it("shows the conflict dialog when the task changed on the server (409)", async () => {
    const item = makeItem({ chapters: "Ch05 Eigenvalues", custody_status: "returned_for_review", assignee_name: "priya.nair" });
    api.getDashboard.mockResolvedValue(leadDashboard([item]));
    api.review.mockRejectedValue(
      new AxiosError("conflict", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 409,
        data: { detail: { code: "CUSTODY_CONFLICT", message: "Already approved by Hannah", current: { ...item, custody_status: "qa_approved" } } },
      } as AxiosResponse),
    );
    renderAt();
    const card = await screen.findByRole("article", { name: "Ch05 Eigenvalues" });
    await userEvent.click(within(card).getByRole("button", { name: "Review" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve" }));

    expect(await screen.findByText("This task changed while you were looking at it")).toBeInTheDocument();
    expect(screen.getByText("Already approved by Hannah")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh to see latest" })).toBeInTheDocument();
  });

  it("requires notes before sending work back for rework", async () => {
    const item = makeItem({ custody_status: "returned_for_review", assignee_name: "priya.nair" });
    api.getDashboard.mockResolvedValue(leadDashboard([item]));
    renderAt();
    const card = await screen.findByRole("article", { name: item.chapters });
    await userEvent.click(within(card).getByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Send back for rework", { selector: "b" }));
    expect(within(dialog).getByRole("button", { name: "Send back for rework" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "Fix the tables");
    expect(within(dialog).getByRole("button", { name: "Send back for rework" })).toBeEnabled();
  });
});
