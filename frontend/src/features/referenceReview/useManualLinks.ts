import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteManualLink,
  listManualLinks,
  upsertManualLink,
  type ManualLink,
  type ManualLinkUpsertRequest,
} from "@/api/referenceReview";

const manualLinksKey = (fileId: number | null) => ["reference-review", "manual-links", fileId];

export function useManualLinks(fileId: number | null) {
  return useQuery<ManualLink[]>({
    queryKey: manualLinksKey(fileId),
    queryFn: () => listManualLinks(fileId as number),
    enabled: fileId !== null,
    staleTime: 0,
  });
}

export function useUpsertManualLink(fileId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ManualLinkUpsertRequest) => upsertManualLink(fileId as number, data),
    onSuccess: () => {
      // Refresh both the manual-links cache and the parent reference-review query
      // so counts (Matched / Missing) and citation_pair statuses reflect the merge.
      qc.invalidateQueries({ queryKey: manualLinksKey(fileId) });
      qc.invalidateQueries({ queryKey: ["reference-review", fileId] });
    },
  });
}

export function useDeleteManualLink(fileId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookmarkName: string) => deleteManualLink(fileId as number, bookmarkName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: manualLinksKey(fileId) });
      qc.invalidateQueries({ queryKey: ["reference-review", fileId] });
    },
  });
}
