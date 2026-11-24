import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { getFileLockSessions } from "@/api/files";
import { formatDateTime } from "@/utils/dateUtils";
import { LockElapsed } from "./LockElapsed";
import { END_REASON_LABELS, formatDuration } from "./lockLabels";

const fmt = (iso: string | null) =>
  iso ? formatDateTime(iso, "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/** Who held a file, at which stage, for how long, and what version it produced. */
export function FileLockHistoryModal({ fileId, filename, onClose }: { fileId: number | null; filename?: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["file-lock-sessions", fileId],
    queryFn: () => getFileLockSessions(fileId!),
    enabled: fileId != null,
  });
  const sessions = q.data?.sessions ?? [];

  return (
    <Modal isOpen={fileId != null} onClose={onClose} title={`Lock & time log · ${q.data?.filename ?? filename ?? ""}`} size="xl">
      {q.isLoading ? (
        <div className="flex items-center gap-2 text-muted text-sm"><Loader2 className="animate-spin" size={14} /> Loading…</div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted">Nobody has locked this file yet.</p>
      ) : (
        <ol className="border-l-2 border-border ml-2 pl-4 space-y-4">
          {sessions.map(s => (
            <li key={s.id} className="relative">
              <span
                className={`absolute -left-[23px] top-1 w-3 h-3 rounded-full border-2 bg-card ${s.active ? "border-amber-500" : "border-primary"}`}
              />
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <b className="text-text">{s.user ?? "Unknown"}</b>
                <span className="text-[10.5px] px-1.5 py-0.5 rounded border border-border bg-surface text-muted">{s.lock_kind_label}</span>
                {s.stage_name && (
                  <span className="text-[10.5px] px-1.5 py-0.5 rounded border border-border bg-surface text-muted">{s.stage_name}</span>
                )}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {fmt(s.started_at)} → {s.active ? <b className="text-amber-700">still locked</b> : fmt(s.ended_at)} ·{" "}
                <b className="text-text">
                  {s.active ? <LockElapsed since={s.started_at} /> : formatDuration(s.duration_seconds)}
                </b>
              </div>
              <div className="text-xs text-muted">
                {s.active ? "Active" : END_REASON_LABELS[s.end_reason!] ?? s.end_reason} · v{s.from_version}
                {s.to_version ? <> → <b className="text-text">v{s.to_version}</b></> : null}
                {s.released_by && s.end_reason === "admin_released" ? ` · by ${s.released_by}` : ""}
                {s.release_note ? <> · “{s.release_note}”</> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
