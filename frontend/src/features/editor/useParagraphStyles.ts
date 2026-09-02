import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

export function useParagraphStyles(fileId?: number | null, client?: string) {
  return useQuery({
    queryKey: ["paragraph-styles", fileId, client],
    queryFn: async () => {
      const params: Record<string, any> = {};
      if (fileId) params.file_id = fileId;
      if (client) params.client = client;
      const response = await apiClient.get<string[]>("/paragraph-styles", { params });
      return response.data;
    },
    staleTime: Infinity,
  });
}
