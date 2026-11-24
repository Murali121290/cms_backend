import { useState } from "react";
import { Lock, PenLine, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { useRBAC } from "@/hooks/useRBAC";
import type { EditLockState } from "./useFileEditLock";
import { LockElapsed } from "./LockElapsed";
import { lockKindLabel } from "./lockLabels";
import { ForceReleaseModal } from "./ForceReleaseModal";

/**
 * Strip shown at the top of an in-app editor page:
 *  - mine: "Locked to you · <stage> · 12m 03s"
 *  - locked_by_other: read-only notice with holder (+ Force release for admins)
 *  - lost: the lock was released while editing — copy unsaved changes
 */
export function LockBanner({ lock, fileId, filename, compact }: { lock: EditLockState; fileId?: number | null; filename?: string; compact?: boolean }) {
  const { isAdmin } = useRBAC();
  const [releasing, setReleasing] = useState(false);
  fileId = lock.resolvedFileId ?? fileId;
  const base = `flex flex-wrap items-center gap-2 px-3 ${compact ? "py-1" : "py-1.5"} text-[12px] border-b`;

  if (lock.status === "mine" && lock.session) {
    return (
      <div className={`${base} bg-violet-50 text-violet-800 border-violet-200`}>
        <PenLine size={13} />
        <span>
          Locked to you{lock.session.stage_name ? <> · {lock.session.stage_name}</> : null} · time{" "}
          <b><LockElapsed since={lock.session.started_at} /></b>
        </span>
        <span className="text-violet-600/80">Others can view but not change this file until you close the editor.</span>
      </div>
    );
  }

  if (lock.status === "locked_by_other") {
    return (
      <div className={`${base} bg-amber-50 text-amber-800 border-amber-200`}>
        <Lock size={13} />
        <span>
          <b>Read-only.</b> {lock.holder ? <b>{lock.holder}</b> : "Someone else"} has this file ({lockKindLabel(lock.holderKind)})
          {lock.holderSince ? <> for <b><LockElapsed since={lock.holderSince} /></b></> : null}. Saving is disabled.
        </span>
        <button onClick={lock.retry} className="inline-flex items-center gap-1 ml-auto font-semibold hover:underline">
          <RefreshCw size={12} /> Try again
        </button>
        {isAdmin && fileId != null && (
          <button
            onClick={() => setReleasing(true)}
            className="inline-flex items-center gap-1 font-semibold text-red-700 border border-red-300 rounded px-2 py-0.5 hover:bg-red-50"
          >
            <ShieldAlert size={12} /> Force release
          </button>
        )}
        {releasing && fileId != null && (
          <ForceReleaseModal
            open
            onClose={() => setReleasing(false)}
            fileId={fileId}
            filename={filename ?? "this file"}
            holder={lock.holder}
            lockKind={lock.holderKind}
            lockedAt={lock.holderSince}
            onDone={lock.retry}
          />
        )}
      </div>
    );
  }

  if (lock.status === "lost") {
    return (
      <div className={`${base} bg-red-50 text-red-800 border-red-200`}>
        <TriangleAlert size={13} />
        <span><b>Lock lost.</b> {lock.message} Saving is disabled — copy any unsaved changes, then reload.</span>
        <button onClick={lock.retry} className="inline-flex items-center gap-1 ml-auto font-semibold hover:underline">
          <RefreshCw size={12} /> Re-lock
        </button>
      </div>
    );
  }

  if (lock.status === "read_only") {
    return (
      <div className={`${base} bg-slate-50 text-slate-700 border-slate-200`}>
        <Lock size={13} /> <span>{lock.message}</span>
      </div>
    );
  }

  return null;
}
