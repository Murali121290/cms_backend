export interface ColumnConfig {
  id: string;
  label: string;
  source: "project" | "chapter_stage" | "custom";
  fieldKey: string; // Maps to database field or specific stage name
  visible: boolean;
}

export const projectScheduleColumns: ColumnConfig[] = [
  { id: "client", label: "Client", source: "project", fieldKey: "clientName", visible: true },
  { id: "project_code", label: "Project Code", source: "project", fieldKey: "projectCode", visible: true },
  { id: "project_title", label: "Project Title", source: "project", fieldKey: "projectTitle", visible: true },
  { id: "chapter_count", label: "Chapter Count", source: "project", fieldKey: "chapterCount", visible: true },
  { id: "chapters_status", label: "Chapters Status", source: "custom", fieldKey: "chaptersStatus", visible: true },
  { id: "project_manager", label: "Project Manager", source: "project", fieldKey: "projectManager", visible: true },
  { id: "sales_person", label: "Sales Person", source: "project", fieldKey: "salesPerson", visible: true },
  { id: "category", label: "Category", source: "project", fieldKey: "category", visible: true },
  { id: "manuscript_pages", label: "Manuscript Pages", source: "project", fieldKey: "manuscriptPages", visible: true },
  { id: "billing_location", label: "Billing Location", source: "project", fieldKey: "billingLocation", visible: true },
  { id: "copyright_year", label: "Copyright Year", source: "project", fieldKey: "copyrightYear", visible: true },
  { id: "start_date", label: "Start Date", source: "project", fieldKey: "startDate", visible: true },
  { id: "due_date", label: "Due Date", source: "project", fieldKey: "dueDate", visible: true },
  { id: "status", label: "Status", source: "project", fieldKey: "remarks", visible: true },
];
