import { createContext, useContext } from "react";

import type { WorkspaceItem, WorkspaceRole, WorkspaceStageInfo } from "./types";
import type { NameOf } from "./utils/items";

export interface WorkspaceOpeners {
  assign: (item: WorkspaceItem) => void;
  handback: (item: WorkspaceItem) => void;
  review: (item: WorkspaceItem, preset?: "approve" | "rework") => void;
  moveNext: (item: WorkspaceItem) => void;
  activity: (item: WorkspaceItem) => void;
  assignWork: (username: string) => void;
}

/** Read-only page state + dialog openers shared by the presentational components. */
export interface WorkspaceUi {
  viewer: string;
  role: WorkspaceRole;
  todayKey: string;
  nowMs: number;
  nameOf: NameOf;
  items: WorkspaceItem[];
  stages: WorkspaceStageInfo[];
  /** Pass the item when there is one: on PM-owned stages a PM manages only their own projects' chapters. */
  canManage: (stage: string, item?: { can_manage?: boolean | null }) => boolean;
  /** Usernames who work in any of the given stages (assignment candidates). */
  peopleFor: (stageNames: string[]) => string[];
  pending: ReadonlySet<number>;
  open: WorkspaceOpeners;
  quickAssign: (item: WorkspaceItem, username: string | null) => void;
}

export const WorkspaceUiContext = createContext<WorkspaceUi | null>(null);

export function useWorkspaceUi(): WorkspaceUi {
  const ctx = useContext(WorkspaceUiContext);
  if (!ctx) throw new Error("useWorkspaceUi must be used inside WorkspaceUiContext");
  return ctx;
}
