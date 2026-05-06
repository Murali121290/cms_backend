import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { deleteSession } from "@/api/session";
import { useSessionStore } from "@/stores/sessionStore";
import { uiPaths } from "@/utils/appPaths";

export function useLogout() {
  const clear = useSessionStore((state) => state.clear);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: deleteSession,
    onSuccess: () => {
      clear();
      queryClient.clear();
      navigate(uiPaths.login, { replace: true });
    },
  });
}
