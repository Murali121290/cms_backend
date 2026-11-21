import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";

import { getApiErrorMessage } from "@/api/client";
import { useUsersStore } from "@/stores/usersStore";
import { getUserDisplayName } from "@/utils/userUtils";

import { BulkActionBar } from "./components/BulkActionBar";
import { Freshness } from "./components/Header";
import { rankPeople } from "./components/AssigneePicker";
import { ErrorPanel, StatePanel, WorkspaceSkeleton } from "./components/Primitives";
import { COMPLETED_WINDOW_DAYS, TABS, type StatusFilter } from "./constants";
import { useNow } from "./hooks/useNow";
import { useShortcuts } from "./hooks/useShortcuts";
import { useTaskActions } from "./hooks/useTaskActions";
import { dashboardQueryKey, useWorkspaceDashboard } from "./hooks/useWorkspaceDashboard";
import { useWorkspaceUrlState } from "./hooks/useWorkspaceUrlState";
import { ActivityDrawer } from "./modals/ActivityDrawer";
import { BulkConfirmModal, BulkResultsModal } from "./modals/BulkModals";
import { AssignTaskModal, AssignWorkModal, ConflictModal, HandbackModal, MoveNextModal, ReviewModal, ShortcutsModal } from "./modals/TaskModals";
import type { BulkAction, BulkResultItem, CustodyConflict, WorkspaceItem } from "./types";
import { itemsOf } from "./utils/cache";
import { isOpen, toDayKey } from "./utils/dates";
import { exportQueueToExcel } from "./utils/exportQueue";
import { chapterOf, workloadOf } from "./utils/items";
import { EmployeeView } from "./views/EmployeeView";
import { LeadView } from "./views/LeadView";
import { WorkspaceUiContext, type WorkspaceUi } from "./WorkspaceContext";

type Dialog =
  | { kind: "assign"; item: WorkspaceItem }
  | { kind: "assignWork"; username: string }
  | { kind: "handback"; item: WorkspaceItem }
  | { kind: "review"; item: WorkspaceItem; preset?: "approve" | "rework" }
  | { kind: "moveNext"; item: WorkspaceItem }
  | { kind: "activity"; item: WorkspaceItem }
  | { kind: "bulkConfirm"; action: BulkAction; ids: number[]; assignee: string | null }
  | { kind: "bulkResults"; results: BulkResultItem[] }
  | { kind: "conflict"; seen: WorkspaceItem; conflict: CustodyConflict }
  | { kind: "help" }
  | null;

export function WorkspacePage() {
  const completedDays = COMPLETED_WINDOW_DAYS;
  const queryKey = useMemo(() => dashboardQueryKey(completedDays), [completedDays]);
  const query = useWorkspaceDashboard(completedDays);
  const url = useWorkspaceUrlState();
  const nowMs = useNow(5000);
  const todayKey = toDayKey(new Date(nowMs));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const usersByUsername = useUsersStore((s) => s.usersByUsername);
  const fetchUsers = useUsersStore((s) => s.fetchUsers);
  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const data = query.data;
  const items = useMemo(() => (data ? itemsOf(data) : []), [data]);
  const viewer = data?.viewer.username ?? "";

  const names = useMemo(() => {
    const m = new Map<string, string>();
    Object.entries(usersByUsername).forEach(([u, rec]) => m.set(u, getUserDisplayName(rec)));
    [data?.teamlead_workspace?.members, data?.manager_workspace?.members].forEach((ms) =>
      ms?.forEach((x) => x.display_name && m.set(x.username, x.display_name)),
    );
    data?.pipeline?.people.forEach((p) => m.set(p.username, p.display_name));
    data?.pipeline?.stages.forEach((s) => s.owner_username && s.owner_name && m.set(s.owner_username, s.owner_name));
    if (data) {
      const v = data.viewer;
      const full = [v.first_name, v.last_name].filter(Boolean).join(" ");
      if (full) m.set(v.username, full);
    }
    return m;
  }, [usersByUsername, data]);
  const nameOf = useCallback((u: string | null | undefined) => (u ? names.get(u) ?? u : "Unassigned"), [names]);

  const stages = useMemo(() => data?.pipeline?.stages ?? [], [data]);
  const manageable = useMemo(() => new Set(stages.filter((s) => s.can_manage).map((s) => s.stage_name)), [stages]);
  const canManage = useCallback((stage: string) => manageable.has(stage), [manageable]);
  const peopleFor = useCallback(
    (stageNames: string[]) => (data?.pipeline?.people ?? []).filter((p) => p.stage_names.some((s) => stageNames.includes(s))).map((p) => p.username),
    [data],
  );

  const onConflict = useCallback((conflict: CustodyConflict, seen: WorkspaceItem) => setDialog({ kind: "conflict", seen, conflict }), []);
  const actions = useTaskActions({ queryKey, onConflict });

  // Drop selections that are no longer open/manageable after a refetch.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const ok = new Set(items.filter((i) => isOpen(i) && manageable.has(i.stage_name)).map((i) => i.id));
      const next = new Set([...prev].filter((id) => ok.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items, manageable]);

  const quickAssign = useCallback(
    async (item: WorkspaceItem, username: string | null) => {
      if ((item.assignee_name ?? null) === username) return;
      const prev = item.assignee_name;
      const updated = await actions.assign(item, { assignee: username, notify: true });
      if (!updated) return;
      toast.success(`${chapterOf(item)} ${username ? `assigned to ${nameOf(username)}` : "unassigned"}.`, {
        action: {
          label: "Undo",
          onClick: () => {
            void actions.assign(updated, { assignee: prev, notify: false }).then((r) => r && toast.info("Change undone."));
          },
        },
      });
    },
    [actions, nameOf],
  );

  const ui: WorkspaceUi | null = data
    ? {
        viewer,
        role: data.role,
        todayKey,
        nowMs,
        nameOf,
        items,
        stages,
        canManage,
        peopleFor,
        pending: actions.pending,
        quickAssign: (i, u) => void quickAssign(i, u),
        open: {
          assign: (item) => setDialog({ kind: "assign", item }),
          handback: (item) => setDialog({ kind: "handback", item }),
          review: (item, preset) => setDialog({ kind: "review", item, preset }),
          moveNext: (item) => setDialog({ kind: "moveNext", item }),
          activity: (item) => setDialog({ kind: "activity", item }),
          assignWork: (username) => setDialog({ kind: "assignWork", username }),
        },
      }
    : null;

  const isLead = Boolean(data?.pipeline && (data.role === "teamlead" || data.role === "manager"));
  const stageInfo = useMemo(() => {
    if (!stages.length) return null;
    return stages.find((s) => s.stage_name === url.stage) ?? stages.find((s) => s.can_manage) ?? stages[0];
  }, [stages, url.stage]);

  useShortcuts(
    {
      "/": (e) => {
        const el = document.getElementById("workspace-search");
        if (el) {
          e.preventDefault();
          el.focus();
        }
      },
      "?": () => setDialog({ kind: "help" }),
      r: () => void query.refetch(),
      Escape: () => setSelected((s) => (s.size ? new Set() : s)),
      ...(isLead
        ? Object.fromEntries(TABS.map((t, i) => [String(i + 1), () => url.update({ tab: t })]))
        : {}),
    },
    Boolean(data),
  );

  const close = () => setDialog(null);
  const selectedItems = items.filter((i) => selected.has(i.id));
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const runBulk = async (action: BulkAction, ids: number[], assignee: string | null) => {
    close();
    const res = await actions.bulk({ action, task_ids: ids, assignee, notify: true });
    if (!res) return;
    setSelected(new Set());
    setDialog({ kind: "bulkResults", results: res.results });
  };

  const onJump = (status: StatusFilter, stage: string) =>
    url.update({ tab: "queue", filters: { status, stage: stages.length > 1 ? stage : "all", q: "" } });

  const renderDialog = () => {
    if (!dialog || !ui) return null;
    switch (dialog.kind) {
      case "assign":
        return (
          <AssignTaskModal
            item={dialog.item}
            people={rankPeople(peopleFor([dialog.item.stage_name]), items)}
            nameOf={nameOf}
            todayKey={todayKey}
            onClose={close}
            onSubmit={async (body) => {
              const item = dialog.item;
              const prev = item.assignee_name;
              close();
              const updated = await actions.assign(item, body);
              if (updated) {
                toast.success(`${chapterOf(item)} assigned to ${nameOf(body.assignee)}${body.notify ? " · email sent" : ""}.`, {
                  action: { label: "Undo", onClick: () => void actions.assign(updated, { assignee: prev, notify: false }).then((r) => r && toast.info("Change undone.")) },
                });
              }
            }}
          />
        );
      case "assignWork": {
        const person = data?.pipeline?.people.find((p) => p.username === dialog.username);
        const stageNames = person?.stage_names ?? [];
        const inbound = items.filter((i) => i.custody_status === "unassigned" && stageNames.includes(i.stage_name) && canManage(i.stage_name));
        return (
          <AssignWorkModal
            username={dialog.username}
            nameOf={nameOf}
            stageNames={stageNames}
            inbound={inbound}
            load={workloadOf(items, dialog.username)}
            todayKey={todayKey}
            onClose={close}
            onSubmit={async (ids, notify) => {
              const who = dialog.username;
              close();
              const res = await actions.bulk({ action: "assign", task_ids: ids, assignee: who, notify });
              if (!res) return;
              const ok = res.results.filter((r) => r.status === "ok").length;
              const failed = res.results.length - ok;
              if (failed) toast.warning(`${ok} assigned to ${nameOf(who)}. ${failed} failed — someone else changed them; refresh and retry.`);
              else toast.success(`${ok} chapter${ok === 1 ? "" : "s"} assigned to ${nameOf(who)}${notify ? " · email sent" : ""}.`);
            }}
          />
        );
      }
      case "handback": {
        const owner = stages.find((s) => s.stage_name === dialog.item.stage_name);
        return (
          <HandbackModal
            item={dialog.item}
            ownerName={owner?.owner_name ?? owner?.owner_username ?? "the stage owner"}
            onClose={close}
            onSubmit={async (body) => {
              const item = dialog.item;
              close();
              const r = await actions.handback(item, body);
              if (r) toast.success(`${chapterOf(item)} handed back for review.`);
            }}
          />
        );
      }
      case "review":
        return (
          <ReviewModal
            item={dialog.item}
            preset={dialog.preset}
            nameOf={nameOf}
            onClose={close}
            onSubmit={async (body) => {
              const item = dialog.item;
              close();
              const r = await actions.review(item, body);
              if (!r) return;
              if (body.decision === "rework") toast.warning(`${chapterOf(item)} sent back to ${nameOf(item.assignee_name)} with your notes.`);
              else toast.success(`${chapterOf(item)} approved — ready to move to ${item.next_stage ?? "completion"}.`);
            }}
          />
        );
      case "moveNext":
        return (
          <MoveNextModal
            item={dialog.item}
            onClose={close}
            onConfirm={async () => {
              const item = dialog.item;
              close();
              const r = await actions.moveNext(item, { notify: true });
              if (r) toast.success(item.next_stage ? `${chapterOf(item)} moved to ${item.next_stage}. The next stage was emailed.` : `${chapterOf(item)} marked complete.`);
            }}
          />
        );
      case "activity":
        return <ActivityDrawer item={dialog.item} nameOf={nameOf} todayKey={todayKey} onClose={close} />;
      case "bulkConfirm":
        return (
          <BulkConfirmModal
            action={dialog.action}
            items={dialog.ids.map((id) => byId.get(id)).filter((i): i is WorkspaceItem => Boolean(i))}
            assignee={dialog.assignee}
            assigneeLoad={dialog.assignee ? workloadOf(items, dialog.assignee) : undefined}
            nameOf={nameOf}
            onClose={close}
            onConfirm={() => void runBulk(dialog.action, dialog.ids, dialog.assignee)}
          />
        );
      case "bulkResults":
        return <BulkResultsModal results={dialog.results} byId={byId} onClose={close} onRefresh={() => { close(); void query.refetch(); }} />;
      case "conflict":
        return <ConflictModal seen={dialog.seen} conflict={dialog.conflict} nameOf={nameOf} onClose={close} onRefresh={() => { close(); void query.refetch(); }} />;
      case "help":
        return <ShortcutsModal onClose={close} showTabs={isLead} />;
    }
  };

  let body: JSX.Element;
  if (query.isLoading) body = <WorkspaceSkeleton />;
  else if (query.isError || !data || !ui) {
    body = <ErrorPanel message={getApiErrorMessage(query.error, "The server didn't respond.")} onRetry={() => void query.refetch()} />;
  } else if (isLead && data.pipeline && stageInfo) {
    body = (
      <LeadView
        data={data}
        pipeline={data.pipeline}
        stage={stageInfo}
        tab={url.tab}
        filters={url.filters}
        viewerName={nameOf(viewer)}
        selected={selected}
        onTab={(t) => url.update({ tab: t })}
        onStage={(s) => { setSelected(new Set()); url.update({ stage: s }); }}
        onFilters={(f) => url.update({ filters: f })}
        onClearFilters={url.clearFilters}
        onJump={onJump}
        onSelected={setSelected}
        onExport={(rows, filtered) => {
          try {
            exportQueueToExcel(rows, nameOf, filtered);
            toast.info(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}${filtered ? " matching your filters" : ""}.`);
          } catch (err) {
            toast.error(getApiErrorMessage(err, "Export failed."));
          }
        }}
      />
    );
  } else if (isLead) {
    body = <StatePanel title="No stages to show" body="None of your roles is mapped to a stage in Stage Master yet. Ask an admin to map your role to the stages you manage." />;
  } else if (data.role === "user" && data.user_workspace) {
    const v = data.viewer;
    body = <EmployeeView data={data.user_workspace} viewerName={nameOf(viewer)} subtitle={[v.role || v.designation, v.team].filter(Boolean).join(" · ") || "My work"} />;
  } else {
    body = <StatePanel title="No workspace for your role" body="Your account doesn't have a workspace view yet. Contact an administrator if you think this is wrong." />;
  }

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-28">
      <Toaster position="bottom-right" richColors closeButton />
      <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
        <span className="text-sm font-semibold text-text">My Workspace</span>
        {data && <Freshness updatedAt={query.dataUpdatedAt} nowMs={nowMs} fetching={query.isFetching} onRefresh={() => void query.refetch()} onHelp={() => setDialog({ kind: "help" })} />}
      </div>
      {ui ? <WorkspaceUiContext.Provider value={ui}>{body}{renderDialog()}
        {isLead && url.tab === "queue" && (
          <BulkActionBar
            selected={selectedItems}
            onClear={() => setSelected(new Set())}
            onAssign={(u) => setDialog({ kind: "bulkConfirm", action: "assign", ids: [...selected], assignee: u })}
            onApprove={() => setDialog({ kind: "bulkConfirm", action: "approve", ids: [...selected], assignee: null })}
            onMoveNext={() => setDialog({ kind: "bulkConfirm", action: "move_next", ids: [...selected], assignee: null })}
          />
        )}
      </WorkspaceUiContext.Provider> : body}
    </div>
  );
}

export default WorkspacePage;
