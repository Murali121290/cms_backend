import { BookOpen, File } from "lucide-react";
import { Link } from "react-router-dom";

import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ProjectSummary } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

interface DashboardProjectGridProps {
  projects: ProjectSummary[];
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      to={uiPaths.projectDetail(project.id)}
      className="group bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-all duration-150 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono text-muted">{project.code}</p>
          <p className="font-semibold text-text text-sm leading-snug mt-0.5 line-clamp-2" title={project.title}>
            {project.title}
          </p>
        </div>
        <StatusBadge status={project.status} size="sm" />
      </div>

      {project.client_name && (
        <p className="text-xs text-muted truncate">{project.client_name}</p>
      )}

      <div className="flex items-center gap-3 mt-auto pt-2 border-t border-border">
        <span className="flex items-center gap-1 text-xs text-muted">
          <BookOpen size={11} /> {project.chapter_count} ch
        </span>
        <span className="flex items-center gap-1 text-xs text-muted">
          <File size={11} /> {project.file_count} files
        </span>
        {project.workflow_name && (
          <span className="ml-auto text-[10px] font-medium text-muted truncate max-w-[80px]">
            {project.workflow_name}
          </span>
        )}
      </div>
    </Link>
  );
}

export function DashboardProjectGrid({ projects }: DashboardProjectGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {projects.map(p => <ProjectCard key={p.id} project={p} />)}
    </div>
  );
}
