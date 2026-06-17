import { useQuery } from "@tanstack/react-query";
import { getStructuredContent } from "@/api/structuredContent";

export function useStructuredContentQuery(fileId: number | null) {
  return useQuery({
    queryKey: ["structured-content", fileId],
    queryFn: () => {
      if (fileId === null) throw new Error("fileId is required");
      return getStructuredContent(fileId);
    },
    enabled: fileId !== null,
    staleTime: 60_000,
  });
}
