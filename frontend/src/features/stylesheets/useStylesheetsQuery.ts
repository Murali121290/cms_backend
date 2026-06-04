import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateStylesheet,
  analyzeFilesForStylesheet,
  createStylesheet,
  deleteStylesheet,
  getIATemplate,
  getProjectStylesheets,
  updateStylesheet,
} from "@/api/stylesheets";
import type { StylesheetCreateRequest, StylesheetUpdateRequest } from "@/types/api";

export function useStylesheetsQuery(projectId: number | null) {
  return useQuery({
    queryKey: ["project-stylesheets", projectId],
    queryFn: () => getProjectStylesheets(projectId as number),
    enabled: projectId !== null,
    staleTime: 30_000,
  });
}

export function useIATemplateQuery() {
  return useQuery({
    queryKey: ["ia-template"],
    queryFn: getIATemplate,
    staleTime: Infinity,
  });
}

export function useStylesheetMutations(projectId: number) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["project-stylesheets", projectId] });

  const create = useMutation({
    mutationFn: (payload: StylesheetCreateRequest) =>
      createStylesheet(projectId, payload),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: StylesheetUpdateRequest }) =>
      updateStylesheet(projectId, id, payload),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (stylesheetId: number) => deleteStylesheet(projectId, stylesheetId),
    onSuccess: invalidate,
  });

  const activate = useMutation({
    mutationFn: (stylesheetId: number) => activateStylesheet(projectId, stylesheetId),
    onSuccess: invalidate,
  });

  return { create, update, remove, activate };
}

export function useAnalyzeFilesMutation(projectId: number) {
  return useMutation({
    mutationFn: (fileIds: number[]) => analyzeFilesForStylesheet(projectId, fileIds),
  });
}
