import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { ProjectsTable } from "@/features/projects/components/ProjectsTable";
import { useProjectsQuery } from "@/features/projects/useProjectsQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getSsrUrl, ssrPaths } from "@/utils/appPaths";

export function ProjectsPage() {
  useDocumentTitle("CMS UI Projects");
  const [searchTerm, setSearchTerm] = useState("");
  const projectsQuery = useProjectsQuery(0, 100);

  const filteredProjects = useMemo(() => {
    const projects = projectsQuery.data?.projects ?? [];
    const normalized = searchTerm.trim().toLowerCase();

    if (!normalized) {
      return projects;
    }

    return projects.filter((project) => {
      const haystack = [
        project.code,
        project.title,
        project.client_name ?? "",
        project.status,
        project.xml_standard,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalized);
    });
  }, [projectsQuery.data?.projects, searchTerm]);

  if (projectsQuery.isPending) {
    return (
      <LoadingState
        title="Loading projects"
        message="Fetching the projects list from /api/v2/projects."
      />
    );
  }

  if (projectsQuery.isError) {
    return (
      <ErrorState
        title="Projects unavailable"
        message="The frontend shell could not load the projects list contract."
        actions={
          <>
            <button className="button" onClick={() => projectsQuery.refetch()}>
              Retry
            </button>
            <a className="button button--secondary" href={getSsrUrl(ssrPaths.projects)}>
              Open SSR projects
            </a>
          </>
        }
      />
    );
  }

  return (
    <main className="page stack">
      <header className="page-header">
        <h1>Projects</h1>
        <p>Read-only frontend list using the current /api/v2 projects contract.</p>
      </header>

      <section className="panel stack">
        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Filter by code, title, client, status, or XML standard"
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <span className="helper-text">
            {projectsQuery.data.pagination.total} total project{projectsQuery.data.pagination.total === 1 ? "" : "s"}
          </span>
        </div>

        {projectsQuery.data.projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            message="This frontend page is wired correctly, but there are no project rows to display."
            actions={
              <a className="button" href={getSsrUrl(ssrPaths.projectCreate)}>
                Open SSR project creation
              </a>
            }
          />
        ) : filteredProjects.length === 0 ? (
          <EmptyState
            title="No matching projects"
            message="Try a different search term or clear the filter."
          />
        ) : (
          <ProjectsTable projects={filteredProjects} />
        )}
      </section>
    </main>
  );
}
