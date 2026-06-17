import { apiClient } from "@/api/client";
import type {
  SessionDeleteResponse,
  SessionGetResponse,
  SessionLoginRequest,
  SessionLoginResponse,
  SessionRegisterRequest,
  SessionRegisterResponse,
} from "@/types/api";

export async function getSession() {
  const response = await apiClient.get<SessionGetResponse>("/session");
  return response.data;
}

export async function loginSession(payload: SessionLoginRequest) {
  const response = await apiClient.post<SessionLoginResponse>("/session/login", payload);
  return response.data;
}

export async function registerSession(payload: SessionRegisterRequest) {
  const response = await apiClient.post<SessionRegisterResponse>("/session/register", payload);
  return response.data;
}

export async function deleteSession() {
  const response = await apiClient.delete<SessionDeleteResponse>("/session");
  return response.data;
}
