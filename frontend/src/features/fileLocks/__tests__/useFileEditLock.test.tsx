import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/api/client", () => ({ apiClient: client, default: client }));

import { useFileEditLock } from "../useFileEditLock";
import { formatDuration } from "../lockLabels";

const session = { id: 42, file_id: 7, started_at: new Date().toISOString(), stage_name: "Copyediting" };

function conflict(detail: Record<string, unknown>, status = 409) {
  return Object.assign(new Error("conflict"), { response: { status, data: { detail } } });
}

describe("useFileEditLock", () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client.post.mockReset();
    beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it("takes the lock on open and releases it with a beacon on unmount", async () => {
    client.post.mockResolvedValueOnce({ data: { status: "ok", session, lock: { is_checked_out: true } } });
    const { result, unmount } = renderHook(() => useFileEditLock({ fileId: 7 }, { kind: "editor_wysiwyg" }));

    await waitFor(() => expect(result.current.status).toBe("mine"));
    expect(result.current.canEdit).toBe(true);
    expect(client.post).toHaveBeenCalledWith("/files/7/editor-session", expect.objectContaining({ kind: "editor_wysiwyg" }));

    act(() => result.current.markSaved());
    unmount();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toMatch(/\/api\/v2\/editor-sessions\/42\/close\?client_id=.+&saved=true$/);
  });

  it("goes read-only with the holder when someone else has the file", async () => {
    client.post.mockRejectedValueOnce(conflict({
      code: "LOCKED_BY_OTHER", message: "ch01.docx is locked by Priya (Download lock).",
      locked_by: "Priya", lock_kind: "download", locked_at: "2026-11-24T09:00:00", file_id: 7,
    }));
    const { result } = renderHook(() => useFileEditLock({ fileId: 7 }, { kind: "editor_wysiwyg" }));

    await waitFor(() => expect(result.current.status).toBe("locked_by_other"));
    expect(result.current.canEdit).toBe(false);
    expect(result.current.holder).toBe("Priya");
    expect(result.current.holderKind).toBe("download");
    expect(result.current.resolvedFileId).toBe(7);
  });

  it("is read-only for users who can't write the chapter", async () => {
    client.post.mockRejectedValueOnce(conflict({ code: "CHAPTER_READ_ONLY", message: "View only" }, 403));
    const { result } = renderHook(() => useFileEditLock({ fileId: 7 }, { kind: "editor_wysiwyg" }));
    await waitFor(() => expect(result.current.status).toBe("read_only"));
    expect(result.current.canEdit).toBe(false);
  });

  it("does nothing while disabled (e.g. overview tab) and releases when disabled again", async () => {
    client.post.mockResolvedValue({ data: { status: "ok", session, lock: null } });
    const { result, rerender } = renderHook(
      ({ enabled }) => useFileEditLock({ fileId: 7 }, { kind: "editor_wysiwyg", enabled }),
      { initialProps: { enabled: false } },
    );
    expect(client.post).not.toHaveBeenCalled();
    expect(result.current.canEdit).toBe(true);

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.status).toBe("mine"));
    rerender({ enabled: false });
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("marks the lock lost when a heartbeat is refused", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client.post
      .mockResolvedValueOnce({ data: { status: "ok", session, lock: null } })
      .mockRejectedValueOnce(conflict({ code: "LOCK_LOST", message: "Your lock on this file was released by an administrator." }));
    const { result } = renderHook(() => useFileEditLock({ fileId: 7 }, { kind: "editor_wysiwyg" }));
    await waitFor(() => expect(result.current.status).toBe("mine"));

    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    await waitFor(() => expect(result.current.status).toBe("lost"));
    expect(result.current.canEdit).toBe(false);
    expect(result.current.message).toMatch(/administrator/);
  });

  it("locks by folder path for pages that don't know the file id", async () => {
    client.post.mockResolvedValueOnce({ data: { status: "ok", session, lock: null } });
    renderHook(() => useFileEditLock(
      { byPath: { projectId: 3, chapterId: 9, chapter: "01", subfolder: "XML", filename: "ch01.xml" } },
      { kind: "editor_source" },
    ));
    await waitFor(() => expect(client.post).toHaveBeenCalled());
    expect(client.post).toHaveBeenCalledWith("/editor-session/by-path", expect.objectContaining({
      project_id: 3, chapter_id: 9, filename: "ch01.xml", kind: "editor_source",
    }));
  });
});

describe("formatDuration", () => {
  it("formats seconds as h/m or m/s", () => {
    expect(formatDuration(75)).toBe("1m 15s");
    expect(formatDuration(3725)).toBe("1h 02m");
    expect(formatDuration(null)).toBe("0m 00s");
  });
});
