import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { listFiles, type ListFilesParams } from "@/api/files";

export function useFilesQuery(params: ListFilesParams) {
  return useQuery({
    queryKey: ["files", params.offset ?? 0, params.limit ?? 50, params.category ?? "", params.q ?? ""],
    queryFn: () => listFiles(params),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}
