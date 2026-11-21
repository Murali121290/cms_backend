import type { CustodyStatus, WorkspaceItem } from "../types";

export type BoardMove = "assign" | "handback" | "approve" | "rework";

/** Drag-and-drop moves the custody state machine allows on the board. */
export const BOARD_MOVES: Partial<Record<`${CustodyStatus}>${CustodyStatus}`, BoardMove>> = {
  "unassigned>in_progress": "assign",
  "in_progress>returned_for_review": "handback",
  "returned_for_review>qa_approved": "approve",
  "returned_for_review>in_progress": "rework",
};

export function boardMove(from: CustodyStatus, to: CustodyStatus): BoardMove | null {
  return BOARD_MOVES[`${from}>${to}`] ?? null;
}

export interface ActionContext {
  viewer: string;
  canManage: boolean;
}

export type CardAction = "assign" | "reassign" | "handback" | "review" | "move_next";

/** Buttons a card/row shows for the current viewer. Mirrors the backend permission rules. */
export function availableActions(item: WorkspaceItem, ctx: ActionContext): CardAction[] {
  const out: CardAction[] = [];
  switch (item.custody_status) {
    case "unassigned":
      if (ctx.canManage) out.push("assign");
      break;
    case "in_progress":
      if (item.assignee_name === ctx.viewer || ctx.canManage) out.push("handback");
      if (ctx.canManage) out.push("reassign");
      break;
    case "returned_for_review":
      if (ctx.canManage) out.push("review");
      break;
    case "qa_approved":
      if (ctx.canManage) out.push("move_next");
      break;
    default:
      break;
  }
  return out;
}
