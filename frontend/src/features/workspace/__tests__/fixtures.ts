import type {
  WorkspaceDashboardResponse,
  WorkspaceItem,
  WorkspacePerson,
  WorkspaceStageInfo,
  WorkspaceStats,
} from "../types";

let seq = 100;

export function makeItem(over: Partial<WorkspaceItem> = {}): WorkspaceItem {
  seq += 1;
  return {
    id: seq,
    client: "CUP",
    project: "CUP-MATH-26",
    chapters: `Ch${seq}`,
    stage_name: "Copyediting",
    planned_start_date: "2026-11-18T00:00:00Z",
    planned_end_date: "2026-11-25T12:00:00Z",
    actual_start_date: null,
    actual_end_date: null,
    stage_status: "In-progress",
    delayed: false,
    delay_days: 0,
    remarks: null,
    manuscript_pages: 20,
    ce_pages: 0,
    project_manager_name: "pm.user",
    assignee_name: null,
    workflow: "Workflow1",
    next_stage: "Typesetting",
    custody_status: "unassigned",
    priority: "Normal",
    assigned_by: null,
    assignment_notes: null,
    handback_notes: null,
    handback_at: null,
    qa_approved_by: null,
    qa_approved_at: null,
    rework_notes: null,
    rework_count: 0,
    completion_delay_days: null,
    ...over,
  };
}

export const stats = (over: Partial<WorkspaceStats> = {}): WorkspaceStats => ({
  today_assigned: 1,
  yesterday_assigned: 0,
  delayed_count: 0,
  completed_count: 0,
  kra_meet_rate: 95,
  ...over,
});

export const viewer = (username: string) => ({
  id: 1,
  username,
  email: `${username}@example.com`,
  first_name: username.split(".")[0],
  last_name: "Tester",
  roles: ["Editor"],
  role: "Copyeditor",
  team: "Copyediting Team",
});

export function employeeDashboard(items: WorkspaceItem[], username = "priya.nair"): WorkspaceDashboardResponse {
  return {
    role: "user",
    viewer: viewer(username),
    user_workspace: { stats: stats(), assignments: items },
    teamlead_workspace: null,
    manager_workspace: null,
    pipeline: null,
  };
}

export const stage = (name: string, over: Partial<WorkspaceStageInfo> = {}): WorkspaceStageInfo => ({
  stage_name: name,
  owner_username: "emily.clark",
  owner_name: "Emily Clark",
  group_email: "copyediting@example.com",
  sla_days: 4,
  can_manage: true,
  ...over,
});

export const person = (username: string, display: string, stageNames = ["Copyediting"]): WorkspacePerson => ({
  username,
  display_name: display,
  role: "Copyeditor",
  stage_names: stageNames,
  open_count: 0,
  open_pages: 0,
  completed_count: 0,
});

export function leadDashboard(
  items: WorkspaceItem[],
  { role = "teamlead", stages = [stage("Copyediting")] }: { role?: "teamlead" | "manager"; stages?: WorkspaceStageInfo[] } = {},
): WorkspaceDashboardResponse {
  const legacy = { stats: stats(), members: [] };
  return {
    role,
    viewer: viewer("emily.clark"),
    user_workspace: null,
    teamlead_workspace: role === "teamlead" ? legacy : null,
    manager_workspace: role === "manager" ? { ...legacy, stages: [] } : null,
    pipeline: {
      stages,
      items,
      people: [person("priya.nair", "Priya Nair"), person("david.miller", "David Miller")],
      completed_window_days: 30,
    },
  };
}
