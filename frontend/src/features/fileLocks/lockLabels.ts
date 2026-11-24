import type { FileLockEndReason, FileLockKind } from "@/types/api";

export const LOCK_KIND_LABELS: Record<FileLockKind, string> = {
  download: "Download lock",
  editor_onlyoffice: "OnlyOffice",
  editor_word: "Word",
  editor_collabora: "Collabora",
  editor_wysiwyg: "WYSIWYG editor",
  editor_tinymce: "TinyMCE editor",
  editor_source: "Source editor",
  processing: "Processing",
};

export const END_REASON_LABELS: Record<FileLockEndReason, string> = {
  checked_in: "Uploaded new version",
  cancelled: "Lock cancelled",
  admin_released: "Released by admin",
  editor_closed: "Editor closed",
  editor_timeout: "Editor idle timeout",
  custody_change: "Chapter custody changed",
};

export function lockKindLabel(kind: string | null | undefined): string {
  if (!kind) return "Locked";
  return LOCK_KIND_LABELS[kind as FileLockKind] ?? kind;
}

export function isEditorLock(kind: string | null | undefined): boolean {
  return !!kind && kind.startsWith("editor_");
}

/** 3725 -> "1h 02m", 75 -> "1m 15s" */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(totalSeconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

export function secondsSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 1000));
}

/** Pull the structured 409 body ({code, message, locked_by, ...}) out of an axios error. */
export function lockErrorDetail(err: unknown): { code?: string; message?: string; locked_by?: string; lock_kind?: string } | null {
  const data = (err as any)?.response?.data;
  const detail = data?.detail ?? data;
  return detail && typeof detail === "object" ? detail : null;
}
