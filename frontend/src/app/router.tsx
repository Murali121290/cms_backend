import { Navigate, createBrowserRouter } from "react-router-dom";

import { AppLayout } from "@/components/layout/AppLayout";
import { AdminGate } from "@/features/session/AdminGate";
import { SessionGate } from "@/features/session/SessionGate";
import { AdminDashboardPage } from "@/pages/AdminDashboardPage";
import { AdminUsersPage } from "@/pages/AdminUsersPage";
import { ChapterDetailPage } from "@/pages/ChapterDetailPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { FileEditorPage } from "@/pages/FileEditorPage";
import { DocxEditorPage } from "@/pages/DocxEditorPage";
import { ProjectCreatePage } from "@/pages/ProjectCreatePage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { StylesheetsPage } from "@/pages/StylesheetsPage";
import { StructuringReviewPage } from "@/pages/StructuringReviewPage";
import { TechnicalReviewPage } from "@/pages/TechnicalReviewPage";
import { TechnicalEditorPage } from "@/pages/TechnicalEditorPage";
import { ReferenceValidationReviewPage } from "@/pages/ReferenceValidationReviewPage";
import { ActivitiesPage } from "@/pages/ActivitiesPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { QualityControlPage } from "@/pages/QualityControlPage";
import { FilesPage } from "@/pages/FilesPage";
import { WorkflowPage } from "@/pages/WorkflowPage";
import ClientsPage from "@/pages/ClientsPage";
import WorkflowStagesPage from "@/pages/WorkflowStagesPage";
import { UserManagement } from "@/pages/settings/UserManagement";
import { RolesManagement } from "@/pages/settings/RolesManagement";
import { StageManagement } from "@/pages/settings/StageManagement";
import { CustomerManagement } from "@/pages/settings/CustomerManagement";
import { WorkflowManagement } from "@/pages/settings/WorkflowManagement";
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
    path: "/forgot-password",
    element: <ForgotPasswordPage />,
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
        element: <AdminGate><AdminDashboardPage /></AdminGate>,
      },
      {
        path: "admin/users",
        element: <AdminGate><AdminUsersPage /></AdminGate>,
      },
      {
        path: "settings",
        element: <AdminGate><Navigate replace to="/settings/users" /></AdminGate>,
      },
      {
        path: "settings/users",
        element: <AdminGate><UserManagement /></AdminGate>,
      },
      {
        path: "settings/roles",
        element: <AdminGate><RolesManagement /></AdminGate>,
      },
      {
        path: "settings/stages",
        element: <AdminGate><StageManagement /></AdminGate>,
      },
      {
        path: "settings/customers",
        element: <AdminGate><CustomerManagement /></AdminGate>,
      },
      {
        path: "settings/workflow",
        element: <AdminGate><WorkflowManagement /></AdminGate>,
      },
      {
        path: "projects",
        element: <ProjectsPage />,
      },
      {
        path: "projects/create",
        element: <ProjectCreatePage />,
      },
      {
        path: "projects/:projectId",
        element: <ProjectDetailPage />,
      },
      {
        path: "projects/:projectId/stylesheets",
        element: <StylesheetsPage />,
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
        path: "projects/:projectId/chapters/:chapterId/files/:fileId/technical-editor",
        element: <TechnicalEditorPage />,
      },
      {
        path: "projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review",
        element: <StructuringReviewPage />,
      },
      {
        path: "projects/:projectId/chapters/:chapterId/files/:fileId/reference-review",
        element: <ReferenceValidationReviewPage />,
      },
      {
        path: "projects/:projectId/chapters/:chapterId/files/:fileId/edit",
        element: <FileEditorPage />,
      },
      {
        path: "projects/:projectId/chapters/:chapterId/files/:fileId/wysiwyg",
        element: <DocxEditorPage />,
      },
      { path: "workflow", element: <WorkflowPage /> },
      { path: "workflow/stages", element: <WorkflowStagesPage /> },
      { path: "clients", element: <ClientsPage /> },
      { path: "files", element: <FilesPage /> },
      { path: "quality-control", element: <QualityControlPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "activities", element: <ActivitiesPage /> },
    ],
  },
  {
    path: "*",
    element: <Navigate replace to={uiPaths.root} />,
  },
]);
