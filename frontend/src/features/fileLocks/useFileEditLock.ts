import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/api/client";
import type { FileLockKind, FileLockSession, LockState } from "@/types/api";
import { lockErrorDetail } from "./lockLabels";

export type EditLockStatus = "idle" | "acquiring" | "mine" | "locked_by_other" | "read_only" | "lost" | "error";

export interface EditLockState {
  status: EditLockStatus;
  /** True when the page may save. False while acquiring, when someone else holds the file, or the lock was lost. */
  canEdit: boolean;
  session: FileLockSession | null;
  lock: LockState | null;
  holder: string | null;
  holderKind: string | null;
  holderSince: string | null;
  message: string | null;
  /** The locked file's id (also known for by-path targets, from the server's answer). */
  resolvedFileId?: number | null;
  /** Mark that a save happened (sent with the close beacon so the session records the new version). */
  markSaved: () => void;
  /** Try again (e.g. after the holder released it). */
  retry: () => void;
}

const HEARTBEAT_MS = 60_000;
const HIDDEN_PAUSE_MS = 10 * 60_000;

function tabClientId(): string {
  try {
    let id = sessionStorage.getItem("file-lock-client-id");
    if (!id) {
      id = (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("file-lock-client-id", id!);
    }
    return id!;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

type Target =
  | { fileId: number | null | undefined }
  | { byPath: { projectId: number; chapter: string; chapterId?: number; subfolder?: string; filename: string } | null };

/**
 * Takes the editor lock while an in-app editor (WYSIWYG / TinyMCE / source) has a file open, keeps it alive with
 * heartbeats, and releases it when the editor closes (unmount, route/tab change, file change, page hide).
 * When someone else holds the file the page should open read-only (canEdit=false) and show <LockBanner/>.
 */
export function useFileEditLock(
  target: Target,
  { kind, enabled = true }: { kind: FileLockKind; enabled?: boolean },
): EditLockState {
  const fileId = "fileId" in target ? target.fileId ?? null : null;
  const byPath = "byPath" in target ? target.byPath : null;
  const key = fileId != null ? `id:${fileId}` : byPath ? `path:${byPath.projectId}/${byPath.chapter}/${byPath.subfolder ?? ""}/${byPath.filename}` : null;

  const [state, setState] = useState<Omit<EditLockState, "canEdit" | "markSaved" | "retry">>({
    status: "idle", session: null, lock: null, holder: null, holderKind: null, holderSince: null, message: null,
  });
  const [attempt, setAttempt] = useState(0);
  const savedRef = useRef(false);
  const sessionIdRef = useRef<number | null>(null);
  const clientId = useRef(tabClientId()).current;

  const close = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid == null) return;
    sessionIdRef.current = null;
    const url = `/api/v2/editor-sessions/${sid}/close?client_id=${encodeURIComponent(clientId)}&saved=${savedRef.current}`;
    // sendBeacon survives page unload; fall back to fetch keepalive.
    const ok = typeof navigator !== "undefined" && navigator.sendBeacon?.(url);
    if (!ok) {
      void fetch(url, { method: "POST", credentials: "include", keepalive: true }).catch(() => undefined);
    }
  }, [clientId]);

  // Acquire on open / file change; release on cleanup.
  useEffect(() => {
    if (!enabled || !key) {
      setState(s => ({ ...s, status: "idle" }));
      return;
    }
    let cancelled = false;
    savedRef.current = false;
    setState(s => ({ ...s, status: "acquiring", message: null }));
    const req = fileId != null
      ? apiClient.post(`/files/${fileId}/editor-session`, { kind, client_id: clientId })
      : apiClient.post(`/editor-session/by-path`, {
          kind, client_id: clientId, project_id: byPath!.projectId, chapter: byPath!.chapter,
          chapter_id: byPath!.chapterId, subfolder: byPath!.subfolder, filename: byPath!.filename,
        });
    req
      .then(res => {
        const data = res.data as { status: string; session: FileLockSession | null; lock: LockState | null };
        if (cancelled) {
          if (data.session) {
            sessionIdRef.current = data.session.id;
            close();
          }
          return;
        }
        if (data.status === "untracked" || !data.session) {
          setState({ status: "mine", session: null, lock: null, holder: null, holderKind: null, holderSince: null, message: null });
          return;
        }
        sessionIdRef.current = data.session.id;
        setState({ status: "mine", session: data.session, lock: data.lock, holder: null, holderKind: null, holderSince: null, message: null,
          resolvedFileId: data.session.file_id });
      })
      .catch(err => {
        if (cancelled) return;
        const status = (err as any)?.response?.status;
        const d = lockErrorDetail(err);
        if (status === 409) {
          setState({
            status: "locked_by_other", session: null, lock: null,
            holder: (d as any)?.locked_by ?? null, holderKind: (d as any)?.lock_kind ?? null,
            holderSince: (d as any)?.locked_at ?? null, message: d?.message ?? "Someone else has this file open.",
            resolvedFileId: (d as any)?.file_id ?? fileId,
          });
        } else if (status === 403) {
          setState({ status: "read_only", session: null, lock: null, holder: null, holderKind: null, holderSince: null,
            message: d?.message ?? "You can view this file but not change it." });
        } else {
          // Don't block editing on a network hiccup; saves are still checked by the server.
          setState({ status: "error", session: null, lock: null, holder: null, holderKind: null, holderSince: null,
            message: d?.message ?? "Could not lock the file for editing." });
        }
      });
    return () => {
      cancelled = true;
      close();
    };
  }, [key, kind, enabled, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeat while mine; pause when the tab is hidden for a long time so idle time stops counting.
  useEffect(() => {
    if (state.status !== "mine" || !state.session) return;
    const sid = state.session.id;
    let hiddenSince: number | null = null;
    const beat = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = hiddenSince ?? Date.now();
        if (Date.now() - hiddenSince > HIDDEN_PAUSE_MS) return;
      } else {
        hiddenSince = null;
      }
      apiClient.post(`/editor-sessions/${sid}/heartbeat`, null, { params: { client_id: clientId } }).catch(err => {
        if ((err as any)?.response?.status === 409) {
          const d = lockErrorDetail(err);
          sessionIdRef.current = null;
          setState(s => ({ ...s, status: "lost", message: d?.message ?? "Your lock on this file was released." }));
        }
      });
    };
    const t = window.setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.status, state.session, clientId]);

  // Release on tab close / reload.
  useEffect(() => {
    const onHide = () => close();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [close]);

  return {
    ...state,
    canEdit: state.status === "mine" || state.status === "error" || state.status === "idle",
    markSaved: useCallback(() => { savedRef.current = true; }, []),
    retry: useCallback(() => setAttempt(a => a + 1), []),
  };
}
