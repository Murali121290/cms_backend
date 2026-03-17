import { NavLink, Outlet } from "react-router-dom";

import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import { useLogout } from "@/features/session/useLogout";
import { useSessionStore } from "@/stores/sessionStore";
import { uiPaths } from "@/utils/appPaths";

export function AppLayout() {
  const viewer = useSessionStore((state) => state.viewer);
  const logoutMutation = useLogout();
  const isAdmin = viewer?.roles.includes("Admin") ?? false;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">CMS UI</div>
        <nav className="topbar-nav">
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            to={uiPaths.dashboard}
          >
            Dashboard
          </NavLink>
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            to={uiPaths.projects}
          >
            Projects
          </NavLink>
          {isAdmin ? (
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              to={uiPaths.adminDashboard}
            >
              Admin
            </NavLink>
          ) : null}
        </nav>
        <div className="topbar-actions">
          <NotificationBell />
          {viewer ? <span className="viewer-chip">{viewer.username}</span> : null}
          <button
            className="button button--secondary"
            disabled={logoutMutation.isPending}
            type="button"
            onClick={() => logoutMutation.mutate()}
          >
            {logoutMutation.isPending ? "Signing out..." : "Logout"}
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
