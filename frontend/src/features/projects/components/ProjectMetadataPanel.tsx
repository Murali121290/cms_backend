import type { ProjectDetail } from "@/types/api";

interface ProjectMetadataPanelProps {
  project: ProjectDetail;
}

export function ProjectMetadataPanel({ project }: ProjectMetadataPanelProps) {
  return (
    <div className="detail-grid">
      <article className="detail-card">
        <strong>Project code</strong>
        <span>{project.code}</span>
      </article>
      <article className="detail-card">
        <strong>Client</strong>
        <span>{project.client_name || "No client name"}</span>
      </article>
      <article className="detail-card">
        <strong>Status</strong>
        <span>{project.status}</span>
      </article>
      <article className="detail-card">
        <strong>XML standard</strong>
        <span>{project.xml_standard}</span>
      </article>
      <article className="detail-card">
        <strong>Chapter count</strong>
        <span>{project.chapter_count}</span>
      </article>
      <article className="detail-card">
        <strong>File count</strong>
        <span>{project.file_count}</span>
      </article>
    </div>
  );
}
