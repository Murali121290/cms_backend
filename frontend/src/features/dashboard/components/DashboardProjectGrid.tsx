import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ProjectSummary } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

interface DashboardProjectGridProps {
  projects: ProjectSummary[];
}

export function DashboardProjectGrid({ projects }: DashboardProjectGridProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
              Title
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
              Publisher
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
              Chapters
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
              Files
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
              Status
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide sr-only">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr
              className="border-b border-border hover:bg-background transition-colors"
              key={project.id}
            >
              <td className="px-4 py-3">
                <div>
                  <span className="text-xs text-muted font-mono">
                    {project.code}
                  </span>
                  <p className="font-medium text-text mt-0.5 leading-snug">
                    {project.title}
                  </p>
                </div>
              </td>
              <td className="px-4 py-3 text-text">
                {project.client_name ?? (
                  <span className="text-muted italic">â€”</span>
                )}
              </td>
              <td className="px-4 py-3 text-text font-mono">
                {project.chapter_count}
              </td>
              <td className="px-4 py-3 text-text font-mono">
                {project.file_count}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={project.status} size="sm" />
              </td>
              <td className="px-4 py-3">
                <Link
                  aria-label={`Open ${project.title}`}
                  className="inline-flex items-center gap-1 text-muted hover:text-primary transition-colors"
                  to={uiPaths.projectDetail(project.id)}
                >
                  <ExternalLink className="w-4 h-4" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
