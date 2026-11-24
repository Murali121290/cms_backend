// TypeScript mirrors of the workspace contract in app/schemas_v2.py.
// Keep in sync with: WorkspaceItem, WorkspaceStats, *WorkspaceData, WorkspacePipeline,
// WorkspaceDashboardResponse and the Workspace*Request / Response models.

export type CustodyStatus =
  | "unassigned"
  | "in_progress"
  | "returned_for_review"
  | "qa_approved"
  | "transitioned";

export type Priority = "Normal" | "High" | "Urgent";

export type WorkspaceRole = "user" | "teamlead" | "manager";

export interface WorkspaceItem {
  id: number;
  client: string;
  project: string;
  chapters: string;
  stage_name: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  stage_status: string;
  delayed: boolean;
  delay_days: number | null;
  remarks: string | null;
  manuscript_pages: number | null;
  ce_pages: number | null;
  project_manager_name: string | null;
  /** "Chapter 01" for numbered chapters, "Book" for 00, otherwise the stored name. */
  chapter_label?: string | null;
  /** Client company name (`client` holds the code, e.g. KLUPA02). Optional for older backends. */
  client_name?: string | null;
  /** PM first name (falls back to username). */
  project_manager_display?: string | null;
  assignee_name: string | null;
  workflow: string | null;
  next_stage: string | null;
  custody_status: CustodyStatus;
  priority: string;
  assigned_by: string | null;
  assignment_notes: string | null;
  handback_notes: string | null;
  handback_at: string | null;
  qa_approved_by: string | null;
  qa_approved_at: string | null;
  rework_notes: string | null;
  rework_count: number;
  completion_delay_days: number | null;
  /** False = a planned row for a stage the chapter hasn't reached yet (Schedule only). */
  live?: boolean;
  /** When not live: the stage the chapter is in now. */
  upcoming_from?: string | null;
  /** Per-row override of the stage's can_manage (PM-owned stages: only the project's PM). null = use the stage's. */
  can_manage?: boolean | null;
  /** Ids for linking to the chapter folder page (uiPaths.chapterDetail). */
  project_id?: number | null;
  chapter_id?: number | null;
}

export interface WorkspaceStats {
  today_assigned: number;
  yesterday_assigned: number;
  delayed_count: number;
  completed_count: number;
  kra_meet_rate: number;
}

export interface UserWorkspaceData {
  stats: WorkspaceStats;
  assignments: WorkspaceItem[];
}

export interface TeamMemberWorkspaceData {
  username: string;
  role: string | null;
  email: string | null;
  display_name?: string | null;
  open_count?: number;
  open_pages?: number;
  stats: WorkspaceStats;
  assignments: WorkspaceItem[];
}

export interface TeamLeadWorkspaceData {
  stats: WorkspaceStats;
  members: TeamMemberWorkspaceData[];
}

export interface StageMetric {
  stage_name: string;
  active_count: number;
  delayed_count: number;
  today_assigned: number;
  yesterday_assigned: number;
  kra_meet_rate: number;
}

export interface ManagerWorkspaceData {
  stats: WorkspaceStats;
  stages: StageMetric[];
  members: TeamMemberWorkspaceData[];
}

export interface WorkspaceStageInfo {
  stage_name: string;
  owner_username: string | null;
  owner_name: string | null;
  /** Owner is each chapter's project PM (Stage Management owner is a PM role). */
  owner_per_project?: boolean;
  group_email: string | null;
  sla_days: number | null;
  can_manage: boolean;
  /** Most common next/previous stage across workflows; individual items carry their own `next_stage`. */
  next_stage?: string | null;
  previous_stage?: string | null;
}

export interface WorkspacePerson {
  username: string;
  display_name: string;
  role: string | null;
  stage_names: string[];
  open_count: number;
  open_pages: number;
  completed_count: number;
}

export interface WorkspacePipeline {
  stages: WorkspaceStageInfo[];
  items: WorkspaceItem[];
  people: WorkspacePerson[];
  completed_window_days: number;
  /** Processes (workflows) with their stages in flow order. Optional for older backends. */
  workflows?: WorkspaceWorkflow[];
}

export interface WorkspaceWorkflow {
  workflow_name: string;
  stages: string[];
}

export interface WorkspaceViewer {
  id: number;
  username: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  roles: string[];
  role?: string | null;
  team?: string | null;
  designation?: string | null;
}

export interface WorkspaceDashboardResponse {
  role: WorkspaceRole;
  viewer: WorkspaceViewer;
  user_workspace: UserWorkspaceData | null;
  teamlead_workspace: TeamLeadWorkspaceData | null;
  manager_workspace: ManagerWorkspaceData | null;
  pipeline: WorkspacePipeline | null;
  generated_at?: string | null;
}

// ── Requests ────────────────────────────────────────────────────────────────

export interface AssignRequest {
  assignee: string | null;
  priority?: Priority;
  planned_end_date?: string | null;
  notes?: string | null;
  notify: boolean;
  expected_custody_status?: CustodyStatus;
}

export interface HandbackRequest {
  notes: string;
  checklist_confirmed: boolean;
  expected_custody_status?: CustodyStatus;
}

export interface ReviewRequest {
  decision: "approve" | "rework";
  notes?: string | null;
  expected_custody_status?: CustodyStatus;
}

export interface MoveNextRequest {
  notify: boolean;
  expected_custody_status?: CustodyStatus;
}

export type BulkAction = "assign" | "approve" | "move_next";

export interface BulkRequest {
  action: BulkAction;
  task_ids: number[];
  assignee?: string | null;
  notify: boolean;
}

export type BulkResultStatus = "ok" | "skipped" | "conflict" | "forbidden" | "error";

export interface BulkResultItem {
  task_id: number;
  status: BulkResultStatus;
  message: string | null;
  item: WorkspaceItem | null;
}

export interface BulkResponse {
  results: BulkResultItem[];
}

export interface ActivityEvent {
  at: string | null;
  actor: string | null;
  kind: string;
  action: string | null;
  text: string;
}

export interface ActivityResponse {
  task: WorkspaceItem;
  events: ActivityEvent[];
}

export interface Recipient {
  username: string | null;
  name: string | null;
  email: string;
}

export interface MoveNextPreview {
  task_id: number;
  from_stage: string;
  next_stage: string | null;
  next_owner_username: string | null;
  next_owner_name: string | null;
  to: Recipient[];
  cc: Recipient[];
  subject: string;
  late_days: number;
}

export interface ScheduleResponse {
  stage_name: string;
  date_from: string;
  date_to: string;
  items: WorkspaceItem[];
  truncated: boolean;
}

/** GET /workspace/chapters/{id}/task — the chapter's task in its current stage (chapter folder page). */
export interface ChapterTaskPerson {
  username: string;
  display_name: string;
  open: number;
  pages: number;
}
export interface ChapterTask {
  chapter_id: number;
  stage_name: string | null;
  item: WorkspaceItem | null;
  can_manage: boolean;
  is_assignee: boolean;
  /** May change the chapter's files (assignee / stage owner or lead / Admin) — same rule the server enforces. */
  can_write: boolean;
  owner_name: string | null;
  people: ChapterTaskPerson[];
}

export interface CustodyConflict {
  message: string;
  current: WorkspaceItem | null;
}
