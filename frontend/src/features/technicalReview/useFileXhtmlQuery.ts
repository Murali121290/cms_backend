import { useQuery } from "@tanstack/react-query";

import { getFileXhtml } from "@/api/technicalReview";

export function useFileXhtmlQuery(fileId: number | null) {
  return useQuery({
    queryKey: ["file-xhtml", fileId],
    queryFn: () => getFileXhtml(fileId as number),
    enabled: fileId !== null,
    staleTime: 60_000,
  });
}
