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
          <tr className="border-b border-surface-300">
            <th className="text-left px-4 py-3 text-xs font-medium text-navy-500 uppercase tracking-wide">
              Title
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-navy-500 uppercase tracking-wide">
              Publisher
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-navy-500 uppercase tracking-wide">
              Chapters
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-navy-500 uppercase tracking-wide">
              Files
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-navy-500 uppercase tracking-wide">
              Status
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-navy-500 uppercase tracking-wide sr-only">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr
              className="border-b border-surface-200 hover:bg-surface-100 transition-colors"
              key={project.id}
            >
              <td className="px-4 py-3">
                <div>
                  <span className="text-xs text-navy-400 font-mono">
                    {project.code}
                  </span>
                  <p className="font-medium text-navy-900 mt-0.5 leading-snug">
                    {project.title}
                  </p>
                </div>
              </td>
              <td className="px-4 py-3 text-navy-600">
                {project.client_name ?? (
                  <span className="text-navy-400 italic">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-navy-600 font-mono">
                {project.chapter_count}
              </td>
              <td className="px-4 py-3 text-navy-600 font-mono">
                {project.file_count}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={project.status} size="sm" />
              </td>
              <td className="px-4 py-3">
                <Link
                  aria-label={`Open ${project.title}`}
                  className="inline-flex items-center gap-1 text-navy-400 hover:text-gold-600 transition-colors"
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
