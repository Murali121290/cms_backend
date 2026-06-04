import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateProjectWorkflow } from "@/api/projects";

export function useUpdateProjectWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      workflowType,
      stageNo,
    }: {
      projectId: number;
      workflowType?: string | null;
      stageNo?: string | null;
    }) =>
      updateProjectWorkflow(projectId, {
        ...(workflowType !== undefined ? { workflow_type: workflowType } : {}),
        ...(stageNo !== undefined ? { workflow_stage_no: stageNo } : {}),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-detail", variables.projectId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
