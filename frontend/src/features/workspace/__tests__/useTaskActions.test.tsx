import type { PropsWithChildren } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "@/test/testUtils";

import type { WorkspaceDashboardResponse, WorkspaceItem } from "../types";
import { leadDashboard, makeItem } from "./fixtures";

const api = vi.hoisted(() => ({
  assign: vi.fn(),
  getDashboard: vi.fn(),
}));
vi.mock("../api", () => ({ workspaceApi: api }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));

import { useTaskActions } from "../hooks/useTaskActions";

const KEY = ["workspace-dashboard", 30] as const;

function setup(data: WorkspaceDashboardResponse) {
  const qc = createTestQueryClient();
  qc.setQueryData(KEY, data);
  api.getDashboard.mockResolvedValue(data);
  const onConflict = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useTaskActions({ queryKey: KEY, onConflict }), { wrapper });
  const itemIn = (id: number) => qc.getQueryData<WorkspaceDashboardResponse>(KEY)?.pipeline?.items.find((i) => i.id === id);
  return { qc, hook, onConflict, itemIn };
}

describe("useTaskActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies the assignment optimistically, then keeps the server's version", async () => {
    const item = makeItem({ custody_status: "unassigned" });
    const { hook, itemIn } = setup(leadDashboard([item]));
    let resolve!: (v: WorkspaceItem) => void;
    api.assign.mockReturnValue(new Promise<WorkspaceItem>((r) => (resolve = r)));

    let p!: Promise<WorkspaceItem | null>;
    await act(async () => {
      p = hook.result.current.assign(item, { assignee: "priya.nair", notify: true });
      await Promise.resolve();
    });
    expect(itemIn(item.id)?.assignee_name).toBe("priya.nair");
    expect(itemIn(item.id)?.custody_status).toBe("in_progress");
    expect(hook.result.current.pending.has(item.id)).toBe(true);
    expect(api.assign).toHaveBeenCalledWith(item.id, { assignee: "priya.nair", notify: true, expected_custody_status: "unassigned" });

    await act(async () => {
      resolve({ ...item, assignee_name: "priya.nair", custody_status: "in_progress", assigned_by: "emily.clark" });
      await p;
    });
    expect(itemIn(item.id)?.assigned_by).toBe("emily.clark");
    expect(hook.result.current.pending.has(item.id)).toBe(false);
  });

  it("rolls back when the server rejects the change", async () => {
    const item = makeItem({ custody_status: "unassigned" });
    const { hook, itemIn } = setup(leadDashboard([item]));
    api.assign.mockRejectedValue(new Error("boom"));
    let result: WorkspaceItem | null = item;
    await act(async () => {
      result = await hook.result.current.assign(item, { assignee: "priya.nair", notify: true });
    });
    expect(result).toBeNull();
    expect(itemIn(item.id)?.assignee_name).toBeNull();
    expect(itemIn(item.id)?.custody_status).toBe("unassigned");
  });

  it("hands a 409 to the conflict dialog and shows the server's current state", async () => {
    const item = makeItem({ custody_status: "unassigned" });
    const current = { ...item, custody_status: "in_progress" as const, assignee_name: "david.miller" };
    const { hook, itemIn, onConflict } = setup(leadDashboard([item]));
    api.assign.mockRejectedValue(
      new AxiosError("conflict", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 409,
        data: { detail: { code: "CUSTODY_CONFLICT", message: "Changed by someone else", current } },
      } as AxiosResponse),
    );
    await act(async () => {
      await hook.result.current.assign(item, { assignee: "priya.nair", notify: true });
    });
    expect(onConflict).toHaveBeenCalledWith({ message: "Changed by someone else", current }, item);
    expect(itemIn(item.id)?.assignee_name).toBe("david.miller");
  });
});
