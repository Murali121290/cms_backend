import type { ProjectDetail } from "@/types/api";

interface ProjectMetadataPanelProps {
  project: ProjectDetail;
}

function MetaCard({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <article className="project-detail-meta__card">
      <strong>{label}</strong>
      <span>{value}</span>
    </article>
  );
}

export function ProjectMetadataPanel({ project }: ProjectMetadataPanelProps) {
  return (
    <div className="project-detail-meta">
      <div className="project-detail-meta__header">
        <div>
          <h1 className="project-detail-meta__title">{project.title}</h1>
          <p className="project-detail-meta__subtitle">{project.code}</p>
        </div>
      </div>

      <div className="project-detail-meta__grid">
        <MetaCard label="Client" value={project.client_name} />
        <MetaCard label="Status" value={project.status} />
        <MetaCard label="XML Standard" value={project.xml_standard} />
        <MetaCard label="Chapters" value={project.chapter_count} />
        <MetaCard label="Files" value={project.file_count} />
        <MetaCard label="Workflow" value={project.workflow_type ?? project.workflow_name} />
        <MetaCard label="Stage" value={project.workflow_stage_no} />
        <MetaCard label="Project Manager" value={project.project_manager} />
        <MetaCard label="Priority" value={project.priority} />
        <MetaCard label="Category" value={project.category} />
        <MetaCard label="Composition" value={project.composition} />
        <MetaCard label="Due Date" value={project.due_date} />
        <MetaCard label="Edition" value={project.edition} />
        <MetaCard label="Color" value={project.color} />
        <MetaCard label="Trim Size" value={project.trim_size} />
        <MetaCard label="Copyright Year" value={project.copyright_year} />
        <MetaCard label="Manuscript Pages" value={project.manuscript_pages} />
        <MetaCard label="Estimated Pages" value={project.estimated_pages} />
        <MetaCard label="Actual Pages" value={project.actual_pages} />
        <MetaCard label="ISBN" value={project.isbn_no} />
        <MetaCard label="Billing Location" value={project.billing_location} />
        <MetaCard label="Sales Person" value={project.sales_person} />
        <MetaCard label="Division Code" value={project.division_code} />
        <MetaCard label="Customer Contact" value={project.customer_contact} />
      </div>
    </div>
  );
}
