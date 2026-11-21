import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getApiErrorMessage } from "@/api/client";

import { workspaceApi } from "../api";
import { DASHBOARD_QUERY_KEY, SCHEDULE_QUERY_KEY } from "../constants";
import type {
  AssignRequest,
  BulkRequest,
  BulkResponse,
  CustodyConflict,
  HandbackRequest,
  MoveNextRequest,
  ReviewRequest,
  WorkspaceDashboardResponse,
  WorkspaceItem,
} from "../types";
import { patchDashboard } from "../utils/cache";
import { parseConflict } from "../utils/errors";

interface TaskCall {
  item: WorkspaceItem;
  optimistic?: Partial<WorkspaceItem>;
  call: () => Promise<WorkspaceItem>;
}

interface Options {
  queryKey: readonly unknown[];
  onConflict: (conflict: CustodyConflict, seen: WorkspaceItem) => void;
}

/**
 * Task mutations with optimistic updates, per-task pending state, rollback on failure
 * and a 409 hand-off to the conflict dialog. Each action resolves to the updated task, or null.
 */
export function useTaskActions({ queryKey, onConflict }: Options) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());

  const mark = useCallback((id: number, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [DASHBOARD_QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: [SCHEDULE_QUERY_KEY] });
  }, [qc]);

  const run = useCallback(
    async ({ item, optimistic, call }: TaskCall): Promise<WorkspaceItem | null> => {
      await qc.cancelQueries({ queryKey });
      const snapshot = qc.getQueryData<WorkspaceDashboardResponse>(queryKey);
      if (optimistic && snapshot) {
        qc.setQueryData<WorkspaceDashboardResponse>(queryKey, patchDashboard(snapshot, item.id, (i) => ({ ...i, ...optimistic })));
      }
      mark(item.id, true);
      try {
        const updated = await call();
        const current = qc.getQueryData<WorkspaceDashboardResponse>(queryKey);
        if (current) qc.setQueryData<WorkspaceDashboardResponse>(queryKey, patchDashboard(current, item.id, () => updated));
        return updated;
      } catch (error) {
        const conflict = parseConflict(error);
        const base = qc.getQueryData<WorkspaceDashboardResponse>(queryKey) ?? snapshot;
        if (conflict?.current && base) {
          const latest = conflict.current;
          qc.setQueryData<WorkspaceDashboardResponse>(queryKey, patchDashboard(base, item.id, () => latest));
        } else if (snapshot) {
          qc.setQueryData<WorkspaceDashboardResponse>(queryKey, snapshot);
        }
        if (conflict) onConflict(conflict, item);
        else toast.error(getApiErrorMessage(error, "The change could not be saved."));
        return null;
      } finally {
        mark(item.id, false);
        refresh();
      }
    },
    [qc, queryKey, mark, onConflict, refresh],
  );

  const assign = useCallback(
    (item: WorkspaceItem, body: Omit<AssignRequest, "expected_custody_status">) =>
      run({
        item,
        optimistic: {
          assignee_name: body.assignee,
          custody_status: body.assignee
            ? item.custody_status === "unassigned" ? "in_progress" : item.custody_status
            : "unassigned",
          ...(body.priority ? { priority: body.priority } : {}),
        },
        call: () => workspaceApi.assign(item.id, { ...body, expected_custody_status: item.custody_status }),
      }),
    [run],
  );

  const handback = useCallback(
    (item: WorkspaceItem, body: Omit<HandbackRequest, "expected_custody_status">) =>
      run({
        item,
        optimistic: { custody_status: "returned_for_review", handback_notes: body.notes },
        call: () => workspaceApi.handback(item.id, { ...body, expected_custody_status: item.custody_status }),
      }),
    [run],
  );

  const review = useCallback(
    (item: WorkspaceItem, body: Omit<ReviewRequest, "expected_custody_status">) =>
      run({
        item,
        optimistic:
          body.decision === "approve"
            ? { custody_status: "qa_approved" }
            : { custody_status: "in_progress", rework_count: item.rework_count + 1, rework_notes: body.notes ?? null },
        call: () => workspaceApi.review(item.id, { ...body, expected_custody_status: item.custody_status }),
      }),
    [run],
  );

  const moveNext = useCallback(
    (item: WorkspaceItem, body: Omit<MoveNextRequest, "expected_custody_status">) =>
      run({
        item,
        optimistic: { custody_status: "transitioned" },
        call: () => workspaceApi.moveNext(item.id, { ...body, expected_custody_status: item.custody_status }),
      }),
    [run],
  );

  const bulk = useCallback(
    async (body: BulkRequest): Promise<BulkResponse | null> => {
      body.task_ids.forEach((id) => mark(id, true));
      try {
        return await workspaceApi.bulk(body);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "The bulk action failed."));
        return null;
      } finally {
        body.task_ids.forEach((id) => mark(id, false));
        refresh();
      }
    },
    [mark, refresh],
  );

  return { pending, assign, handback, review, moveNext, bulk, refresh };
}

export type TaskActions = ReturnType<typeof useTaskActions>;
