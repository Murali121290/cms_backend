import { Link } from "react-router-dom";

import type { ProjectSummary } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

interface ProjectsTableProps {
  projects: ProjectSummary[];
}

export function ProjectsTable({ projects }: ProjectsTableProps) {
  return (
    <div className="panel">
      <table className="list-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Title</th>
            <th>Client</th>
            <th>Status</th>
            <th>Chapters</th>
            <th>Files</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>{project.code}</td>
              <td>
                <Link className="table-link" to={uiPaths.projectDetail(project.id)}>
                  {project.title}
                </Link>
              </td>
              <td>{project.client_name || "No client"}</td>
              <td>{project.status}</td>
              <td>{project.chapter_count}</td>
              <td>{project.file_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
