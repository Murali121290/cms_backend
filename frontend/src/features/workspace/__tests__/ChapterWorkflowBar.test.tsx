import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderRoute } from "@/test/testUtils";

import type { ChapterTask, WorkspaceItem } from "../types";
import { makeItem } from "./fixtures";

const api = vi.hoisted(() => ({
  chapterTask: vi.fn(),
  assign: vi.fn(),
  handback: vi.fn(),
  review: vi.fn(),
  moveNext: vi.fn(),
  moveNextPreview: vi.fn(),
  activity: vi.fn(),
}));
vi.mock("../api", () => ({ workspaceApi: api }));
vi.mock("@/api/users", () => ({ usersApi: { list: vi.fn().mockResolvedValue([]) } }));

import { ChapterWorkflowBar } from "../components/ChapterWorkflowBar";

const task = (item: Partial<WorkspaceItem>, over: Partial<ChapterTask> = {}): ChapterTask => ({
  chapter_id: 7,
  stage_name: "Pre-editing",
  item: makeItem({ stage_name: "Pre-editing", next_stage: "Language Editing", live: true, ...item }),
  can_manage: false,
  is_assignee: false,
  can_write: false,
  owner_name: "Selva Bharath P",
  people: [],
  ...over,
});

const render = (onTaskLoaded = vi.fn()) =>
  renderRoute({ path: "/c", initialEntry: "/c", element: <ChapterWorkflowBar chapterId={7} onTaskLoaded={onTaskLoaded} /> });

describe("ChapterWorkflowBar (chapter folder page)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the assignee hand back to the lead, and shows the step", async () => {
    api.chapterTask.mockResolvedValue(task({ custody_status: "in_progress", assignee_name: "priya" }, { is_assignee: true }));
    const loaded = vi.fn();
    render(loaded);
    expect(await screen.findByRole("button", { name: "Hand back to lead" })).toBeInTheDocument();
    expect(screen.getByText("With employee")).toHaveAttribute("aria-current", "step");
    expect(screen.queryByRole("button", { name: /Move to/ })).not.toBeInTheDocument();
    await waitFor(() => expect(loaded).toHaveBeenCalledWith(true));
  });

  it("lead: no Hand back while the employee works — Reassign and who is working on it", async () => {
    api.chapterTask.mockResolvedValue(task({ custody_status: "in_progress", assignee_name: "priya" }, { can_manage: true, people: [{ username: "priya", display_name: "Priya V", open: 1, pages: 9 }] }));
    render();
    expect(await screen.findByRole("button", { name: "Reassign" })).toBeInTheDocument();
    expect(screen.getByText("Priya V is working on it")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hand back/ })).not.toBeInTheDocument();
  });

  it("lead review: Approve or Send back for rework", async () => {
    api.chapterTask.mockResolvedValue(task({ custody_status: "returned_for_review", assignee_name: "priya", handback_notes: "Done" }, { can_manage: true }));
    render();
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send back for rework" })).toBeInTheDocument();
  });

  it("only the lead reviews; after approval only the lead moves it on", async () => {
    api.chapterTask.mockResolvedValue(task({ custody_status: "returned_for_review", assignee_name: "priya", handback_notes: "Done" }));
    render();
    expect(await screen.findByText(/Waiting for Selva Bharath P's review/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
  });

  it("lead: Move to next stage once approved", async () => {
    api.chapterTask.mockResolvedValue(task({ custody_status: "qa_approved", assignee_name: "priya" }, { can_manage: true }));
    api.moveNextPreview.mockResolvedValue({ task_id: 1, from_stage: "Pre-editing", next_stage: "Language Editing", next_owner_username: null, next_owner_name: null, to: [], cc: [], subject: "s", late_days: 0 });
    api.moveNext.mockResolvedValue(makeItem({ custody_status: "transitioned" }));
    render();
    await userEvent.click(await screen.findByRole("button", { name: /Move to Language Editing/ }));
    const confirm = await screen.findAllByRole("button", { name: /Move to Language Editing|Move|Confirm/ });
    await userEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(api.moveNext).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ expected_custody_status: "qa_approved" })));
  });

  it("shows nothing for a chapter without a workspace task", async () => {
    const loaded = vi.fn();
    api.chapterTask.mockResolvedValue(task({}, { item: null }));
    render(loaded);
    await waitFor(() => expect(loaded).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("region", { name: "Chapter workflow" })).not.toBeInTheDocument();
  });
});
