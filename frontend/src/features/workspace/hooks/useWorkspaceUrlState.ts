import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { TABS, type StatusFilter, type WorkspaceTab } from "../constants";
import { COLUMN_FIELD, EMPTY_FILTERS, type ColumnKey, type QueueFilters } from "../utils/items";

const STATUSES: StatusFilter[] = ["all", "unassigned", "in_progress", "returned_for_review", "qa_approved", "delayed", "done"];
// "|" separates values (client names can contain commas); "_" stands for an empty value.
const list = (v: string | null) => (v ? v.split("|").map((x) => (x === "_" ? "" : x)) : []);
const enc = (vals: string[]) => vals.map((v) => (v === "" ? "_" : v)).join("|");
/** URL parameter for each column filter. */
const COLUMN_PARAM: Record<ColumnKey, string> = {
  chapter: "chs", project: "projects", client: "clients", pm: "pms", stage: "stgs",
  status: "sts", assignee: "assignees", priority: "prios", due: "dues", pages: "pgs",
};
const COLUMN_KEYS = Object.keys(COLUMN_PARAM) as ColumnKey[];

export interface WorkspaceUrlState {
  tab: WorkspaceTab;
  stage: string | null;
  filters: QueueFilters;
}

/** Tab, selected stage and queue filters live in the URL so views can be shared and survive reloads. */
export function useWorkspaceUrlState() {
  const [params, setParams] = useSearchParams();

  const state = useMemo<WorkspaceUrlState>(() => {
    const tab = params.get("tab") as WorkspaceTab | null;
    const status = params.get("status") as StatusFilter | null;
    return {
      tab: tab && TABS.includes(tab) ? tab : "board",
      stage: params.get("stage"),
      filters: {
        q: params.get("q") ?? "",
        status: status && STATUSES.includes(status) ? status : "all",
        stage: params.get("fstage") ?? "all",
        priority: params.get("prio") ?? "all",
        ...(Object.fromEntries(COLUMN_KEYS.map((k) => [COLUMN_FIELD[k], list(params.get(COLUMN_PARAM[k]))])) as Pick<
          QueueFilters, "chapters" | "projects" | "clients" | "pms" | "stages" | "statuses" | "assignees" | "priorities" | "dues" | "pages"
        >),
      },
    };
  }, [params]);

  const update = useCallback(
    (patch: { tab?: WorkspaceTab; stage?: string | null; filters?: Partial<QueueFilters> }) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const set = (k: string, v: string | null | undefined, empty = "") => {
            if (v === undefined) return;
            if (v === null || v === empty) next.delete(k);
            else next.set(k, v);
          };
          set("tab", patch.tab, "board");
          if (patch.stage !== undefined) set("stage", patch.stage);
          const f = patch.filters;
          if (f) {
            set("q", f.q);
            set("status", f.status, "all");
            set("fstage", f.stage, "all");
            set("prio", f.priority, "all");
            for (const k of COLUMN_KEYS) {
              const vals = f[COLUMN_FIELD[k]] as string[] | undefined;
              if (vals) set(COLUMN_PARAM[k], enc(vals));
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clearFilters = useCallback(() => update({ filters: EMPTY_FILTERS }), [update]);

  return { ...state, update, clearFilters };
}
