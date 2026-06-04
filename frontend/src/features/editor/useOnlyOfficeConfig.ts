import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

export function useOnlyOfficeConfig(fileId: number | null, mode: "structuring" | "original") {
  return useQuery({
    queryKey: ["onlyoffice-config", fileId, mode],
    queryFn: async () => {
      const response = await apiClient.get<any>(`/files/${fileId}/onlyoffice-config?mode=${mode}`);
      return response.data;
    },
    enabled: fileId !== null,
    staleTime: 0, // Always fetch fresh to ensure single-use version key and valid token
  });
}
