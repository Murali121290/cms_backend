import api from "@/api/client";

import type {
  ActivityResponse,
  AssignRequest,
  BulkRequest,
  BulkResponse,
  HandbackRequest,
  MoveNextPreview,
  MoveNextRequest,
  ReviewRequest,
  ScheduleResponse,
  WorkspaceDashboardResponse,
  WorkspaceItem,
} from "./types";

const task = (id: number) => `/workspace/tasks/${encodeURIComponent(String(id))}`;

export const workspaceApi = {
  getDashboard: (completedDays: number) =>
    api
      .get<WorkspaceDashboardResponse>("/dashboard/workspaces", { params: { completed_days: completedDays } })
      .then((r) => r.data),

  assign: (id: number, body: AssignRequest) =>
    api.post<WorkspaceItem>(`${task(id)}/assign`, body).then((r) => r.data),

  handback: (id: number, body: HandbackRequest) =>
    api.post<WorkspaceItem>(`${task(id)}/handback`, body).then((r) => r.data),

  review: (id: number, body: ReviewRequest) =>
    api.post<WorkspaceItem>(`${task(id)}/review`, body).then((r) => r.data),

  moveNextPreview: (id: number) =>
    api.get<MoveNextPreview>(`${task(id)}/move-next/preview`).then((r) => r.data),

  moveNext: (id: number, body: MoveNextRequest) =>
    api.post<WorkspaceItem>(`${task(id)}/move-next`, body).then((r) => r.data),

  activity: (id: number) => api.get<ActivityResponse>(`${task(id)}/activity`).then((r) => r.data),

  bulk: (body: BulkRequest) => api.post<BulkResponse>("/workspace/tasks/bulk", body).then((r) => r.data),

  schedule: (stageName: string, dateFrom: string, dateTo: string, includeCompleted: boolean) =>
    api
      .get<ScheduleResponse>(`/workspace/stages/${encodeURIComponent(stageName)}/schedule`, {
        params: { date_from: dateFrom, date_to: dateTo, include_completed: includeCompleted },
      })
      .then((r) => r.data),
};

export type WorkspaceApi = typeof workspaceApi;
