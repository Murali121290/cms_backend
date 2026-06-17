import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonTable } from "@/components/ui/SkeletonLoader";
import type { ActivitiesResponse } from "@/types/api";

async function getActivities() {
  const response = await apiClient.get<ActivitiesResponse>("/activities", { params: { limit: 100 } });
  return response.data;
}

export function ActivitiesPage() {
  useDocumentTitle("Activities â€” S4 Carlisle CMS");
  const query = useQuery({ queryKey: ["activities"], queryFn: getActivities });
  const activities = query.data?.activities ?? [];

  return (
    <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
      <PageHeader
        title="Activities"
        subtitle={query.data ? `${query.data.summary.total} recent activities` : ""}
      />
      <div className="bg-white rounded-lg shadow-card overflow-hidden mt-6">
        {query.isPending ? (
          <SkeletonTable rows={8} cols={5} />
        ) : query.isError ? (
          <div className="p-8 text-center text-sm text-muted">
            Failed to load activities.{" "}
            <button className="text-primary underline" onClick={() => void query.refetch()}>Retry</button>
          </div>
        ) : activities.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No activities yet.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="bg-background border-b border-border">
              <tr>
                <th className="text-xs font-semibold text-muted uppercase tracking-wide px-4 py-3 text-left">Type</th>
                <th className="text-xs font-semibold text-muted uppercase tracking-wide px-4 py-3 text-left">Title</th>
                <th className="text-xs font-semibold text-muted uppercase tracking-wide px-4 py-3 text-left">Project</th>
                <th className="text-xs font-semibold text-muted uppercase tracking-wide px-4 py-3 text-left">Chapter</th>
                <th className="text-xs font-semibold text-muted uppercase tracking-wide px-4 py-3 text-left">Time</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id} className="border-b border-border hover:bg-background transition-colors">
                  <td className="px-4 py-3 text-sm">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary capitalize">
                      {a.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-text font-medium">{a.title}</td>
                  <td className="px-4 py-3 text-sm text-text">{a.project?.title ?? "â€”"}</td>
                  <td className="px-4 py-3 text-sm text-text">{a.chapter?.title ?? "â€”"}</td>
                  <td className="px-4 py-3 text-sm text-muted">{new Date(a.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
