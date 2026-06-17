import api from './client'

export interface StageDetail {
  id: number
  client: string
  project: string
  chapters: string
  project_manager_name: string | null
  assignee_name: string | null
  planned_start_date: string | null
  planned_end_date: string | null
  actual_start_date: string | null
  actual_end_date: string | null
  stage_name: string
  stage_activity: string | null
  total_time_taken: number | null
  workflow: string
  complexity_level: string | null
  stage_level: number | null
  sla: number | null
  stage_status: string
  stage_activity_status: string
  delayed: boolean
  delay_days: number | null
  remarks: string | null
  created_at: string
  updated_at: string
}

export interface PlanningItem {
  chapters: string
  stage_name: string
  planned_start_date: string  // ISO string
  planned_end_date: string    // ISO string
  sla: number | null
}

export interface PlanningPayload {
  client: string               // division_code
  project: string              // project_code
  workflow: string
  complexity_level: string | null
  project_manager_name: string | null
  items: PlanningItem[]
}

export const stageDetailsApi = {
  /** Insert one row per chapter × stage when planning is approved. */
  createPlanningRows: (payload: PlanningPayload) =>
    api.post<StageDetail[]>('/api/v1/stage-details/plan', payload).then(r => r.data),

  listByProject: (project: string) =>
    api.get<StageDetail[]>(`/api/v1/stage-details/project/${encodeURIComponent(project)}`).then(r => r.data),

  listByChapter: (project: string, chapters: string) =>
    api.get<StageDetail[]>(
      `/api/v1/stage-details/project/${encodeURIComponent(project)}/chapter/${encodeURIComponent(chapters)}`
    ).then(r => r.data),

  /**
   * Assignee changed: closes the current open row (actual_end_date=now, status=Completed)
   * and creates a new row for the new assignee (actual_start_date=now, status=In-progress).
   */
  assignToStage: (project: string, chapters: string, stageName: string, assigneeName: string | null) =>
    api.post<StageDetail | null>(
      `/api/v1/stage-details/project/${encodeURIComponent(project)}/chapter/${encodeURIComponent(chapters)}/stage/${encodeURIComponent(stageName)}/assign`,
      { assignee_name: assigneeName, dt: new Date().toISOString() },
    ).then(r => r.data),

  /**
   * Stage moved: closes the old stage row (Completed) and opens the new stage row
   * (assignee=null, actual_start_date=now, status=In-progress).
   */
  stageTransition: (project: string, chapters: string, fromStage: string, toStage: string) =>
    api.post<StageDetail | null>(
      `/api/v1/stage-details/project/${encodeURIComponent(project)}/chapter/${encodeURIComponent(chapters)}/stage-transition`,
      { from_stage: fromStage, to_stage: toStage, dt: new Date().toISOString() },
    ).then(r => r.data),

  /**
   * Shift planned_start_date and planned_end_date forward by `days` days for all
   * subsequent stages when a stage is completed late (cascade delay).
   */
  shiftPlannedDates: (project: string, chapters: string, stageNames: string[], days: number) =>
    api.post<{ ok: boolean }>(
      `/api/v1/stage-details/project/${encodeURIComponent(project)}/shift-planned-dates`,
      { chapters, stage_names: stageNames, days },
    ).then(r => r.data),
}

