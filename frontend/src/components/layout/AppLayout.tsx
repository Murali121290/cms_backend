import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Files,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  Loader2,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";

import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { useLogout } from "@/features/session/useLogout";
import { useSessionStore } from "@/stores/sessionStore";
import { useSidebarStore } from "@/stores/useSidebarStore";
import { uiPaths } from "@/utils/appPaths";

// ─── Types ──────────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  end?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function segmentToLabel(segment: string): string {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Crumb {
  label: string;
  path: string;
}

function buildBreadcrumbs(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Home", path: "/" }];

  const stripped = pathname.replace(/^\/ui\/?/, "");
  if (!stripped) return crumbs;

  const segments = stripped.split("/").filter(Boolean);

  const labelMap: Record<string, string> = {
    dashboard: "Dashboard",
    admin: "Admin Dashboard",
    users: "Users",
    projects: "Projects",
    chapters: "Chapter",
    files: "File",
    "technical-review": "Technical Review",
    "structuring-review": "Structuring Review",
  };

  let accPath = "/ui";
  for (const seg of segments) {
    accPath = `${accPath}/${seg}`;
    if (/^\d+$/.test(seg)) {
      const prev = crumbs[crumbs.length - 1];
      crumbs[crumbs.length - 1] = {
        ...prev,
        label: `${prev.label} #${seg}`,
      };
    } else {
      crumbs.push({
        label: labelMap[seg] ?? segmentToLabel(seg),
        path: accPath,
      });
    }
  }

  return crumbs;
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

interface SidebarProps {
  isAdmin: boolean;
  username: string;
  role: string;
  viewerInitial: string;
  isPendingLogout: boolean;
  onLogout: () => void;
}

function Sidebar({
  isAdmin,
  username,
  role,
  viewerInitial,
  isPendingLogout,
  onLogout,
}: SidebarProps) {
  const { collapsed, toggle } = useSidebarStore();
  const [logoError, setLogoError] = useState(false);

  const primaryNavItems: NavItem[] = [
    {
      label: "Dashboard",
      to: uiPaths.dashboard,
      icon: <LayoutDashboard className="w-[18px] h-[18px] flex-shrink-0" />,
      end: false,
    },
    {
      label: "Projects",
      to: uiPaths.projects,
      icon: <FolderOpen className="w-[18px] h-[18px] flex-shrink-0" />,
      end: false,
    },
    {
      label: "Workflow",
      to: "/workflow",
      icon: <GitBranch className="w-[18px] h-[18px] flex-shrink-0" />,
      end: false,
    },
    {
      label: "Files",
      to: "/files",
      icon: <Files className="w-[18px] h-[18px] flex-shrink-0" />,
      end: false,
    },
    {
      label: "Quality Control",
      to: "/quality-control",
      icon: <ShieldCheck className="w-[18px] h-[18px] flex-shrink-0" />,
      end: false,
    },
    {
      label: "Reports",
      to: "/reports",
      icon: <BarChart3 className="w-[18px] h-[18px] flex-shrink-0" />,
      end: false,
    },
    {
      label: "Activities",
      to: "/activities",
      icon: <Activity className="w-[18px] h-[18px] flex-shrink-0" />,
      end: false,
    },
  ];

  const adminNavItems: NavItem[] = [
    {
      label: "Admin Dashboard",
      to: uiPaths.adminDashboard,
      icon: <BarChart3 className="w-[18px] h-[18px] flex-shrink-0" />,
    },
    {
      label: "Users",
      to: uiPaths.adminUsers,
      icon: <Users className="w-[18px] h-[18px] flex-shrink-0" />,
    },
  ];

  return (
    <aside
      className={`fixed left-0 top-0 z-20 h-screen bg-sidebar border-r border-white/10 flex flex-col transition-all duration-300 ${
        collapsed ? "w-16" : "w-60"
      }`}
      aria-label="Application sidebar"
    >
      {/* Logo area */}
      <div className="h-16 px-4 border-b border-white/10 flex items-center justify-center">
        {!collapsed && !logoError ? (
          <img
            alt="PubCMS logo"
            className="h-6 w-auto object-contain"
            src="/logo.png"
            onError={() => setLogoError(true)}
          />
        ) : !collapsed ? (
          <span className="font-semibold text-sm text-white">PubCMS</span>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-xs">
            P
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2" aria-label="Primary navigation">
        {!collapsed && (
          <p className="px-4 pt-5 pb-1 text-[10px] font-medium uppercase tracking-widest text-sidebar-text">
            Main
          </p>
        )}
        {primaryNavItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-2"} py-2.5 mx-1 rounded-lg transition-colors duration-150 ${
                isActive
                  ? "bg-primary text-white"
                  : "text-sidebar-text hover:bg-white/8 hover:text-white"
              }`
            }
            title={collapsed ? item.label : undefined}
          >
            {item.icon}
            {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
          </NavLink>
        ))}

        {isAdmin && (
          <>
            {!collapsed && (
              <p className="px-4 pt-5 pb-1 text-[10px] font-medium uppercase tracking-widest text-sidebar-text">
                Admin
              </p>
            )}
            {adminNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-2"} py-2.5 mx-1 rounded-lg transition-colors duration-150 ${
                    isActive
                      ? "bg-primary text-white"
                      : "text-sidebar-text hover:bg-white/8 hover:text-white"
                  }`
                }
                title={collapsed ? item.label : undefined}
              >
                {item.icon}
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* Bottom user section */}
      <div className="mt-auto px-2 py-4 border-t border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
            {viewerInitial}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{username}</p>
              <p className="text-xs text-sidebar-text truncate">{role}</p>
            </div>
          )}
        </div>

        {!collapsed && (
          <>
            <button
              className="flex items-center gap-2 text-xs mt-3 w-full px-2 py-2 rounded-lg bg-transparent border-none text-sidebar-text hover:bg-white/8 hover:text-white transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isPendingLogout}
              type="button"
              onClick={onLogout}
            >
              {isPendingLogout ? (
                <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4 flex-shrink-0" />
              )}
              <span>{isPendingLogout ? "Signing out…" : "Logout"}</span>
            </button>

            <div className="mt-2 pt-2 border-t border-white/10">
              <ThemeSwitcher />
              <button
                onClick={toggle}
                className="flex items-center justify-center w-full mt-2 p-2 rounded-lg text-sidebar-text hover:bg-white/8 hover:text-white transition-colors duration-150"
                title="Toggle sidebar"
              >
                <ChevronLeft size={18} />
              </button>
            </div>
          </>
        )}

        {collapsed && (
          <button
            onClick={toggle}
            className="flex items-center justify-center w-full mt-2 p-2 rounded-lg text-sidebar-text hover:bg-white/8 hover:text-white transition-colors duration-150"
            title="Toggle sidebar"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </aside>
  );
}

// ─── TopBar ──────────────────────────────────────────────────────────────────

interface TopBarProps {
  username: string;
  viewerInitial: string;
}

function TopBar({ username, viewerInitial }: TopBarProps) {
  const location = useLocation();
  const crumbs = buildBreadcrumbs(location.pathname);

  return (
    <header className="h-14 flex-shrink-0 flex items-center justify-between px-6 bg-card border-b border-border">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1 text-sm">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <li key={crumb.path} className="flex items-center gap-1">
                {index > 0 && (
                  <ChevronRight
                    aria-hidden="true"
                    className="text-muted"
                    size={14}
                  />
                )}
                {isLast ? (
                  <span className="font-medium text-text" aria-current="page">
                    {crumb.label}
                  </span>
                ) : (
                  <span className="text-muted">{crumb.label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex items-center gap-4">
        <div className="relative">
          <NotificationBell />
        </div>

        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-background text-sm font-medium text-text transition-colors cursor-pointer"
          type="button"
          aria-label={`Signed in as ${username}`}
        >
          <div className="w-6 h-6 rounded-lg bg-primary text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
            {viewerInitial}
          </div>
          <span>{username}</span>
        </button>
      </div>
    </header>
  );
}

// ─── AppLayout ───────────────────────────────────────────────────────────────

function resolveRoleName(role: unknown): string {
  if (typeof role === "string") {
    if (role.startsWith("<") && role.endsWith(">")) return "User";
    return role;
  }
  if (role && typeof role === "object" && "name" in role) {
    return String((role as { name: unknown }).name);
  }
  return "User";
}

export function AppLayout() {
  const viewer = useSessionStore((state) => state.viewer);
  const { collapsed } = useSidebarStore();
  const logoutMutation = useLogout();

  const resolvedRoles = (viewer?.roles ?? []).map(resolveRoleName).filter(Boolean);
  const isAdmin = resolvedRoles.includes("Admin");
  const username = viewer?.username ?? "User";
  const viewerInitial = username[0]?.toUpperCase() ?? "U";
  const primaryRole = resolvedRoles[0] ?? "Viewer";

  return (
    <div className="h-screen overflow-hidden bg-background">
      <Sidebar
        isAdmin={isAdmin}
        isPendingLogout={logoutMutation.isPending}
        role={primaryRole}
        username={username}
        viewerInitial={viewerInitial}
        onLogout={() => logoutMutation.mutate()}
      />

      <div
        className={`flex flex-col h-screen overflow-hidden transition-all duration-300 ${
          collapsed ? "ml-16" : "ml-60"
        }`}
      >
        <TopBar username={username} viewerInitial={viewerInitial} />
        <main className="flex-1 overflow-y-auto p-6 page-enter">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
