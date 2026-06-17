import axios from "axios";

import { apiClient } from "@/api/client";
import type { StructuringReviewResponse, StructuringSaveResponse } from "@/types/api";

export async function getStructuringReview(fileId: number) {
  const response = await apiClient.get<StructuringReviewResponse>(`/files/${fileId}/structuring-review`);
  return response.data;
}

export async function saveStructuringReview(saveEndpoint: string, changes: Record<string, unknown>) {
  const response = await axios.post<StructuringSaveResponse>(
    saveEndpoint,
    { changes },
    {
      withCredentials: true,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
  );
  return response.data;
}
