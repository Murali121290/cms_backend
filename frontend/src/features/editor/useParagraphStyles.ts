import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

export function useParagraphStyles() {
  return useQuery({
    queryKey: ["paragraph-styles"],
    queryFn: async () => {
      const response = await apiClient.get<string[]>("/paragraph-styles");
      return response.data;
    },
    staleTime: Infinity, // Styles don't change during session
  });
}
