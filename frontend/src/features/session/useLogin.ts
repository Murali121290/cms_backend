import { useMutation, useQueryClient } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/api/client";
import { loginSession } from "@/api/session";
import { useSessionStore } from "@/stores/sessionStore";
import type { SessionGetResponse, SessionLoginRequest } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

function toSessionGetResponse(payload: Awaited<ReturnType<typeof loginSession>>): SessionGetResponse {
  return {
    authenticated: true,
    viewer: payload.viewer,
    auth: {
      mode: payload.session.auth_mode,
      expires_at: payload.session.expires_at,
    },
  };
}

export function useLogin() {
  const queryClient = useQueryClient();
  const setAuthenticated = useSessionStore((state) => state.setAuthenticated);

  return useMutation({
    mutationFn: (payload: SessionLoginRequest) => loginSession(payload),
    onSuccess: (payload) => {
      const session = toSessionGetResponse(payload);
      setAuthenticated(session);
      queryClient.setQueryData(["session"], session);
    },
    meta: {
      successRedirect: uiPaths.dashboard,
    },
  });
}

export function getLoginErrorMessage(error: unknown) {
  return getApiErrorMessage(error, "Login failed.");
}
