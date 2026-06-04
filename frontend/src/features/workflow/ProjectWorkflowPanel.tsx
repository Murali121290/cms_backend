import { useState } from "react";
import { GitBranch } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToast } from "@/components/ui/useToast";
import { useUpdateProjectWorkflow } from "@/features/workflow/useWorkflowMutations";
import { WORKFLOW_DEFINITIONS, getWorkflowDefinition } from "@/features/workflow/workflowDefinitions";

interface ProjectWorkflowPanelProps {
  projectId: number;
  workflowType: string | null;
  workflowStageNo: string | null;
}

export function ProjectWorkflowPanel({ projectId, workflowType, workflowStageNo }: ProjectWorkflowPanelProps) {
  const mutation = useUpdateProjectWorkflow();
  const { addToast } = useToast();
  const [assignValue, setAssignValue] = useState("");

  const definition = getWorkflowDefinition(workflowType);

  function assign() {
    if (!assignValue) return;
    mutation.mutate(
      { projectId, workflowType: assignValue },
      {
        onSuccess: () => addToast({ title: `Workflow ${assignValue} assigned`, variant: "success" }),
        onError: () => addToast({ title: "Failed to assign workflow", variant: "error" }),
      },
    );
  }

  function setStage(stageNo: string) {
    mutation.mutate(
      { projectId, stageNo },
      {
        onSuccess: () => addToast({ title: "Stage updated", variant: "success" }),
        onError: () => addToast({ title: "Failed to update stage", variant: "error" }),
      },
    );
  }

  // â”€â”€ Not assigned â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!definition) {
    return (
      <section className="bg-white rounded-lg shadow-card p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-text">
            <GitBranch className="w-4 h-4 text-muted" />
            {workflowType ? (
              <span>
                Unknown workflow <Badge variant="warning">{workflowType}</Badge>
              </span>
            ) : (
              <span>No production workflow assigned.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={assignValue}
              onChange={(e) => setAssignValue(e.target.value)}
              className="h-9 px-2 text-sm bg-white border border-border rounded-md text-text focus:outline-none focus:border-text"
            >
              <option value="">Select workflowâ€¦</option>
              {WORKFLOW_DEFINITIONS.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.id} Â· {wf.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={assign}
              disabled={!assignValue || mutation.isPending}
              className="h-9 px-3 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary disabled:opacity-40 transition-colors"
            >
              Assign
            </button>
          </div>
        </div>
      </section>
    );
  }

  // â”€â”€ Assigned â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const currentIdx = Math.max(0, definition.stages.findIndex((s) => s.no === workflowStageNo));
  const currentStage = definition.stages[currentIdx];
  const progress = Math.round(((currentIdx + 1) / definition.stages.length) * 100);
  const nextStage = definition.stages[currentIdx + 1];

  return (
    <section className="bg-white rounded-lg shadow-card p-4 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-4 h-4 text-primary shrink-0" />
          <Badge variant="default">
            {definition.id} {definition.title}
          </Badge>
          <span className="text-xs text-muted">
            Stage {currentStage?.no} of {definition.stages.length}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={currentStage?.no ?? ""}
            onChange={(e) => setStage(e.target.value)}
            disabled={mutation.isPending}
            className="h-9 px-2 text-sm bg-white border border-border rounded-md text-text focus:outline-none focus:border-text"
          >
            {definition.stages.map((s) => (
              <option key={s.no} value={s.no}>
                {s.no} Â· {s.name}
              </option>
            ))}
          </select>
          {nextStage && (
            <button
              type="button"
              onClick={() => setStage(nextStage.no)}
              disabled={mutation.isPending}
              className="h-9 px-3 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary disabled:opacity-50 transition-colors"
            >
              Advance
            </button>
          )}
        </div>
      </div>
      <ProgressBar value={progress} color="gold" size="md" showValue label={currentStage?.name} />
      <p className="text-xs text-muted mt-2">
        Owner: <span className="text-text font-medium">{currentStage?.owner}</span> Â· Deliverable:{" "}
        <span className="text-text font-medium">{currentStage?.out}</span>
      </p>
    </section>
  );
}
