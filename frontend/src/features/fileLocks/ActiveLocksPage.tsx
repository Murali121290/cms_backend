import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, ShieldAlert } from "lucide-react";
import { getActiveFileLocks } from "@/api/files";
import { formatDateTime } from "@/utils/dateUtils";
import type { FileLockSession } from "@/types/api";
import { LockElapsed } from "./LockElapsed";
import { ForceReleaseModal } from "./ForceReleaseModal";

/** Every open file lock (admins see all, others only their own), with Force release for admins. */
export function ActiveLocksPage() {
  const [releasing, setReleasing] = useState<FileLockSession | null>(null);
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["active-file-locks"], queryFn: () => getActiveFileLocks(), refetchInterval: 30_000 });
  const locks = (q.data?.locks ?? []).filter(l => {
    if (!filter) return true;
    const hay = `${l.filename} ${l.user} ${l.project_code} ${l.chapter} ${l.stage_name} ${l.lock_kind_label}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold text-text flex items-center gap-2">
          <Lock size={18} /> {q.data?.is_admin ? "Active file locks" : "My locked files"}
        </h1>
        <span className="text-sm text-muted">{q.data ? `${q.data.locks.length} open` : ""}</span>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by file, person, project, stage…"
          className="ml-auto border border-border rounded-lg px-3 py-1.5 text-sm bg-background w-full sm:w-72"
        />
      </div>
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        {q.isLoading ? (
          <div className="p-6 flex items-center gap-2 text-muted text-sm"><Loader2 className="animate-spin" size={14} /> Loading…</div>
        ) : locks.length === 0 ? (
          <div className="p-6 text-sm text-muted">No active locks.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wide text-muted border-b border-border">
                <th className="text-left px-4 py-2.5">File</th>
                <th className="text-left px-4 py-2.5">Project / Chapter</th>
                <th className="text-left px-4 py-2.5">Holder</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Stage</th>
                <th className="text-left px-4 py-2.5">Since</th>
                <th className="text-left px-4 py-2.5">Held for</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {locks.map(l => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-medium text-text break-all">
                    {l.filename}
                    <div className="text-[11px] text-muted">{l.category}</div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{l.project_code ?? "—"} · {l.chapter ?? "—"}</td>
                  <td className="px-4 py-2.5">{l.is_mine ? <b>You</b> : l.user}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                      {l.lock_kind_label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{l.stage_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted whitespace-nowrap">
                    {l.started_at ? formatDateTime(l.started_at, "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-semibold"><LockElapsed since={l.started_at} /></td>
                  <td className="px-4 py-2.5 text-right">
                    {l.can_force_release && l.file_id != null && (
                      <button
                        onClick={() => setReleasing(l)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 border border-red-300 rounded-md px-2 py-1 hover:bg-red-50"
                      >
                        <ShieldAlert size={13} /> Force release
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {releasing && releasing.file_id != null && (
        <ForceReleaseModal
          open
          onClose={() => setReleasing(null)}
          fileId={releasing.file_id}
          filename={releasing.filename ?? ""}
          holder={releasing.user}
          lockKind={releasing.lock_kind}
          lockedAt={releasing.started_at}
          onDone={() => void q.refetch()}
        />
      )}
    </div>
  );
}
