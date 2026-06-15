import { useState } from "react";
import { GitBranch } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/useToast";
import { useUpdateProjectWorkflow } from "@/features/workflow/useWorkflowMutations";
import { WORKFLOW_DEFINITIONS, getWorkflowDefinition } from "@/features/workflow/workflowDefinitions";

interface ProjectWorkflowPanelProps {
  projectId: number;
  workflowType: string | null;
}

export function ProjectWorkflowPanel({ projectId, workflowType }: ProjectWorkflowPanelProps) {
  const mutation = useUpdateProjectWorkflow();
  const { addToast } = useToast();
  const [assignValue, setAssignValue] = useState("");

  const definition = getWorkflowDefinition(workflowType);

  function assign() {
    if (!assignValue) return;
    mutation.mutate(
      { projectId, workflowName: assignValue },
      {
        onSuccess: () => addToast({ title: `Workflow ${assignValue} assigned`, variant: "success" }),
        onError: () => addToast({ title: "Failed to assign workflow", variant: "error" }),
      },
    );
  }

  // —— Not assigned ——————————————————————————————————————————————
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
              <option value="">Select workflow…</option>
              {WORKFLOW_DEFINITIONS.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.id} · {wf.title}
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

  // —— Assigned ——————————————————————————————————————————————————
  return (
    <section className="bg-white rounded-lg shadow-card p-4 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-4 h-4 text-primary shrink-0" />
          <Badge variant="default">
            {definition.id} {definition.title}
          </Badge>
        </div>
      </div>
      <div className="mt-3">
        <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide mb-1.5">Workflow Stages</h4>
        <div className="flex flex-wrap gap-2">
          {definition.stages.map((s) => (
            <span key={s.no} className="text-xs px-2.5 py-1 bg-background border border-border rounded-md text-text">
              {s.no} · {s.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
