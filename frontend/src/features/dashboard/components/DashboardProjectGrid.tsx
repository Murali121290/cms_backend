import type { ProjectSummary } from "@/types/api";

interface DashboardProjectGridProps {
  projects: ProjectSummary[];
}

export function DashboardProjectGrid({ projects }: DashboardProjectGridProps) {
  return (
    <div className="project-grid">
      {projects.map((project) => (
        <article className="project-card" key={project.id}>
          <div>
            <div className="project-meta">
              <span className="badge">{project.code}</span>
              <span>{project.xml_standard}</span>
            </div>
            <h3>{project.title}</h3>
          </div>
          <div className="project-meta">
            <span>{project.client_name || "No client name"}</span>
            <span>{project.status}</span>
          </div>
          <div className="project-meta">
            <span>{project.chapter_count} chapters</span>
            <span>{project.file_count} files</span>
          </div>
        </article>
      ))}
    </div>
  );
}
