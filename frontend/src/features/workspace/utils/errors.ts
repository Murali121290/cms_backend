import axios from "axios";

import type { CustodyConflict, WorkspaceItem } from "../types";

interface ConflictDetail {
  code?: string;
  message?: string;
  current?: WorkspaceItem | null;
}

/** 409 {detail:{code:'CUSTODY_CONFLICT', message, current}} → conflict info, otherwise null. */
export function parseConflict(error: unknown): CustodyConflict | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null;
  const data = error.response.data as { detail?: ConflictDetail | string } | undefined;
  const detail = data?.detail;
  if (detail && typeof detail === "object") {
    // Other 409s (e.g. NOT_AT_STAGE: chapter isn't in this stage yet) are rules, not races: show them as a message.
    if (detail.code && detail.code !== "CUSTODY_CONFLICT") return null;
    return { message: detail.message ?? "This task was changed by someone else.", current: detail.current ?? null };
  }
  return { message: typeof detail === "string" ? detail : "This task was changed by someone else.", current: null };
}
