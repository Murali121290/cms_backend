import axios, { AxiosError } from "axios";

import type { ErrorResponse } from "@/types/api";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api/v2";

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: {
    Accept: "application/json",
  },
});

export function getApiErrorMessage(error: unknown, fallback = "Request failed") {
  if (error instanceof AxiosError) {
    const payload = error.response?.data as ErrorResponse | undefined;
    if (payload?.message) {
      return payload.message;
    }

    if (error.message) {
      return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}
