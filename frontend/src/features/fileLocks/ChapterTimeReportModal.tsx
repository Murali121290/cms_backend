import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { getChapterTimeReport } from "@/api/files";
import { formatDuration } from "./lockLabels";

/** Time taken per stage (and per person / file) for a chapter, from file lock sessions. */
export function ChapterTimeReportModal({
  open,
  onClose,
  projectId,
  chapterId,
  chapterLabel,
  currentStage,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  chapterId: number;
  chapterLabel?: string;
  currentStage?: string;
}) {
  const q = useQuery({
    queryKey: ["chapter-time-report", projectId, chapterId],
    queryFn: () => getChapterTimeReport(projectId, chapterId),
    enabled: open && !!projectId && !!chapterId,
    refetchInterval: open ? 30_000 : false,
  });
  const stages = q.data?.stages ?? [];
  const max = Math.max(1, ...stages.map(s => s.seconds));
  const cur = stages.find(s => s.stage_name === currentStage);

  return (
    <Modal isOpen={open} onClose={onClose} title={`Time taken · ${chapterLabel ?? ""}`} size="lg">
      {q.isLoading ? (
        <div className="flex items-center gap-2 text-muted text-sm"><Loader2 className="animate-spin" size={14} /> Loading…</div>
      ) : stages.length === 0 ? (
        <p className="text-sm text-muted">No lock sessions yet. Time is counted when someone downloads a file with lock or opens it in an editor.</p>
      ) : (
        <>
          {cur && (
            <div className="grid grid-cols-3 gap-2 mb-5">
              <Stat value={formatDuration(cur.seconds)} label={`${cur.stage_name} total`} />
              <Stat value={String(cur.sessions)} label="lock sessions" />
              <Stat value={String(cur.running)} label="running now" />
            </div>
          )}
          <div className="space-y-4">
            {stages.map(st => (
              <div key={st.stage_name}>
                <div className="flex justify-between text-sm">
                  <b className="text-text">{st.stage_name}</b>
                  <span className="tabular-nums">
                    {formatDuration(st.seconds)}
                    {st.running ? <span className="text-xs text-muted"> ({st.running} running)</span> : null}
                  </span>
                </div>
                <div className="h-2 rounded bg-primary my-1.5" style={{ width: `${(st.seconds / max) * 100}%`, minWidth: 2 }} />
                {st.users.map(u => (
                  <div key={`${st.stage_name}-${u.user_id}`} className="flex justify-between text-xs text-muted">
                    <span>{u.user}</span>
                    <span className="tabular-nums">{formatDuration(u.seconds)} · {u.sessions} session{u.sessions === 1 ? "" : "s"}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="text-[11.5px] text-muted mt-5">
            Wall-clock time from when a lock is taken (download with lock, or file opened in an editor) until it is
            released (new version uploaded, editor closed, lock cancelled or released by an admin). Running locks count up to now.
          </p>
        </>
      )}
    </Modal>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border border-border rounded-lg px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-text">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
