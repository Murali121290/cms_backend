import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { deleteSession } from "@/api/session";
import { useAuthStore } from "@/store/useAuthStore";
import { useSessionStore } from "@/stores/sessionStore";
import { uiPaths } from "@/utils/appPaths";

export function useLogout() {
  const clear = useSessionStore((state) => state.clear);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: deleteSession,
    onSuccess: () => {
      clear();
      clearAuth();
      queryClient.clear();
      navigate(uiPaths.login, { replace: true });
    },
    onError: () => {
      // Even if server-side logout fails, clear local session and navigate
      clear();
      clearAuth();
      queryClient.clear();
      navigate(uiPaths.login, { replace: true });
    },
  });
}
