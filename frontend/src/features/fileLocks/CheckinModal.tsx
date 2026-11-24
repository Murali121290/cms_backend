import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { checkinFile } from "@/api/files";
import { getApiErrorMessage } from "@/api/client";
import { toast } from "@/store/useToastStore";
import { LockElapsed } from "./LockElapsed";
import { formatDuration } from "./lockLabels";

interface Props {
  open: boolean;
  onClose: () => void;
  fileId: number;
  filename: string;
  version: number;
  lockedAt?: string | null;
  stageName?: string | null;
  onDone?: () => void;
}

/** Upload the new version of a file you hold with a download lock; releases the lock and records time taken. */
export function CheckinModal({ open, onClose, fileId, filename, version, lockedAt, stageName, onDone }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";

  const close = () => {
    if (busy) return;
    setFile(null);
    setNote("");
    onClose();
  };

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const res = await checkinFile(fileId, file, note.trim() || undefined);
      const took = res.session?.duration_seconds != null ? ` Time taken: ${formatDuration(res.session.duration_seconds)}.` : "";
      toast.success(`${filename} uploaded as v${res.version}. Lock released.${took}`);
      setFile(null);
      setNote("");
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title="Upload new version & release lock"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={close} className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-surface">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!file || busy}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Uploading…" : `Upload v${version + 1} & release`}
          </button>
        </div>
      }
    >
      <div className="rounded-lg bg-surface border border-border px-3 py-2.5 text-[12.5px] leading-6 mb-4">
        <div className="font-semibold text-text break-all">{filename}</div>
        <div>Version <b>v{version} → v{version + 1}</b></div>
        {stageName && <div>Stage: <b>{stageName}</b></div>}
        {lockedAt && (
          <div>
            Time taken so far: <b><LockElapsed since={lockedAt} /></b>
          </div>
        )}
      </div>
      <label className="block text-xs text-muted mb-1">Updated file</label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
        className="w-full border-2 border-dashed border-border rounded-lg px-4 py-5 text-center text-sm text-muted hover:border-primary hover:text-primary"
      >
        <Upload className="mx-auto mb-1" size={18} />
        {file ? <span className="text-text font-medium break-all">{file.name}</span> : <>Drop the edited file here or <u>browse</u></>}
        <div className="text-[11px] mt-1">The stored name stays <b>{filename}</b>{ext ? `; upload a ${ext} file` : ""}.</div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ext || undefined}
        className="hidden"
        onChange={e => setFile(e.target.files?.[0] ?? null)}
      />
      <label className="block text-xs text-muted mt-4 mb-1">Version note (optional)</label>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={2}
        placeholder="e.g. Language edit complete, 12 author queries raised"
        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
      />
    </Modal>
  );
}
