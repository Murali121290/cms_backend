import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateProjectWorkflow } from "@/api/projects";

export function useUpdateProjectWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      workflowName,
    }: {
      projectId: number;
      workflowName?: string | null;
    }) =>
      updateProjectWorkflow(projectId, {
        ...(workflowName !== undefined ? { workflow_name: workflowName } : {}),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-detail", variables.projectId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
