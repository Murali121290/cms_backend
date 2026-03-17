import { Navigate, createBrowserRouter } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { SessionGate } from "@/features/session/SessionGate";
import { AdminDashboardPage } from "@/pages/AdminDashboardPage";
import { AdminUsersPage } from "@/pages/AdminUsersPage";
import { ChapterDetailPage } from "@/pages/ChapterDetailPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { StructuringReviewPage } from "@/pages/StructuringReviewPage";
import { TechnicalReviewPage } from "@/pages/TechnicalReviewPage";
import { uiPaths } from "@/utils/appPaths";

function UiRouteLayout() {
  return (
    <SessionGate>
      <AppLayout />
    </SessionGate>
  );
}

export const router = createBrowserRouter([
  {
    path: uiPaths.login,
    element: <LoginPage />,
  },
  {
    path: uiPaths.register,
    element: <RegisterPage />,
  },
  {
    path: uiPaths.root,
    element: <UiRouteLayout />,
    children: [
      {
        index: true,
        element: <Navigate replace to={uiPaths.dashboard} />,
      },
      {
        path: "dashboard",
        element: <DashboardPage />,
      },
      {
        path: "admin",
        element: <AdminDashboardPage />,
      },
      {
        path: "admin/users",
        element: <AdminUsersPage />,
      },
      {
        path: "projects",
        element: <ProjectsPage />,
      },
      {
        path: "projects/:projectId",
        element: <ProjectDetailPage />,
      },
      {
        path: "projects/:projectId/chapters/:chapterId",
        element: <ChapterDetailPage />,
      },
      {
        path: "projects/:projectId/chapters/:chapterId/files/:fileId/technical-review",
        element: <TechnicalReviewPage />,
      },
      {
        path: "projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review",
        element: <StructuringReviewPage />,
      },
    ],
  },
  {
    path: "*",
    element: <Navigate replace to={uiPaths.root} />,
  },
]);
