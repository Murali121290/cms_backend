import { useMutation } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { registerSession } from "@/api/session";
import type { SessionRegisterRequest } from "@/types/api";

export function useRegister() {
  return useMutation({
    mutationFn: (payload: SessionRegisterRequest) => registerSession(payload),
  });
}

export function getRegisterErrorMessage(error: unknown) {
  return getApiErrorMessage(error, "Registration failed.");
}
