import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";

import { useSessionStore } from "@/stores/sessionStore";
import { uiPaths } from "@/utils/appPaths";

export function AdminGate({ children }: PropsWithChildren) {
  const viewer = useSessionStore((s) => s.viewer);

  if (!viewer?.roles.includes("Admin")) {
    return <Navigate replace to={uiPaths.dashboard} />;
  }

  return <>{children}</>;
}
