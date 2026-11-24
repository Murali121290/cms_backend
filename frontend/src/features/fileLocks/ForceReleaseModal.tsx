import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { forceReleaseFileLock } from "@/api/files";
import { getApiErrorMessage } from "@/api/client";
import { toast } from "@/store/useToastStore";
import { LockElapsed } from "./LockElapsed";
import { lockKindLabel } from "./lockLabels";

interface Props {
  open: boolean;
  onClose: () => void;
  fileId: number;
  filename: string;
  holder?: string | null;
  lockKind?: string | null;
  lockedAt?: string | null;
  onDone?: () => void;
}

/** Admin-only: release someone else's lock. A reason is required and sent to the holder. */
export function ForceReleaseModal({ open, onClose, fileId, filename, holder, lockKind, lockedAt, onDone }: Props) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!note.trim() || busy) return;
    setBusy(true);
    try {
      await forceReleaseFileLock(fileId, note.trim());
      toast.success(`Lock on ${filename} released. ${holder ?? "The holder"} has been notified.`);
      setNote("");
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not release the lock"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => !busy && onClose()}
      title="Force release lock"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-surface">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!note.trim() || busy}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <ShieldAlert size={14} /> {busy ? "Releasing…" : "Force release"}
          </button>
        </div>
      }
    >
      <div className="rounded-lg bg-amber-50 text-amber-800 border border-amber-200 px-3 py-2.5 text-[12.5px] mb-4 leading-6">
        <b className="break-all">{filename}</b> is locked by <b>{holder || "another user"}</b> ({lockKindLabel(lockKind)})
        {lockedAt && <> for <b><LockElapsed since={lockedAt} /></b></>}.
        Changes they haven't uploaded or saved yet will not be kept.
      </div>
      <label className="block text-xs text-muted mb-1">Reason (required, sent to the holder)</label>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={3}
        autoFocus
        placeholder="e.g. Holder on leave, file needed for Technical Edit"
        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
      />
      <p className="text-[11.5px] text-muted mt-2">
        Time is recorded up to now with reason <b>Released by admin</b>. No new version is created.
      </p>
    </Modal>
  );
}
