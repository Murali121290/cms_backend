import type { TeamMemberWorkspaceData, WorkspaceDashboardResponse, WorkspaceItem } from "../types";

type Patch = (item: WorkspaceItem) => WorkspaceItem;

const mapItems = (items: WorkspaceItem[], id: number, fn: Patch) => items.map((i) => (i.id === id ? fn(i) : i));
const mapMembers = (members: TeamMemberWorkspaceData[], id: number, fn: Patch) =>
  members.map((m) => ({ ...m, assignments: mapItems(m.assignments, id, fn) }));

/** Apply a change to one task everywhere it appears in the cached dashboard response. */
export function patchDashboard(data: WorkspaceDashboardResponse, id: number, fn: Patch): WorkspaceDashboardResponse {
  return {
    ...data,
    pipeline: data.pipeline ? { ...data.pipeline, items: mapItems(data.pipeline.items, id, fn) } : null,
    user_workspace: data.user_workspace
      ? { ...data.user_workspace, assignments: mapItems(data.user_workspace.assignments, id, fn) }
      : null,
    teamlead_workspace: data.teamlead_workspace
      ? { ...data.teamlead_workspace, members: mapMembers(data.teamlead_workspace.members, id, fn) }
      : null,
    manager_workspace: data.manager_workspace
      ? { ...data.manager_workspace, members: mapMembers(data.manager_workspace.members, id, fn) }
      : null,
  };
}

/** All tasks the viewer can see (pipeline for leads/managers, own assignments for employees). */
export function itemsOf(data: WorkspaceDashboardResponse): WorkspaceItem[] {
  if (data.pipeline) return data.pipeline.items;
  return data.user_workspace?.assignments ?? [];
}
