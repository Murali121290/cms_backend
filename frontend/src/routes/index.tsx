import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { RoleGuard } from '@/components/RoleGuard'
import { LoginPage } from '@/pages/LoginPage'
import { WorkflowPortalPage } from '@/pages/WorkflowPortalPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { Settings } from '@/pages/Settings'
import { UserManagement } from '@/pages/settings/UserManagement'
import { CustomerManagement } from '@/pages/settings/CustomerManagement'
import { StageManagement } from '@/pages/settings/StageManagement'
import { RolesManagement } from '@/pages/settings/RolesManagement'
import { WorkflowManagement } from '@/pages/settings/WorkflowManagement'
import { Clients } from '@/pages/Clients'
import { ClientProjects } from '@/pages/ClientProjects'
import { CreateProjectPage } from '@/pages/CreateProjectPage'
import { ProjectWorkflow } from '@/pages/ProjectWorkflow'
import { ProjectPlanningPage } from '@/pages/ProjectPlanningPage'
import { ChapterEditorPage } from '@/pages/ChapterEditorPage'
import { Placeholder } from '@/pages/Placeholder'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { ChapterFilePage } from '@/pages/ChapterFilePage'
import { ChapterDetailPage } from '@/pages/ChapterDetailPage'
import { TechnicalReviewPage } from '@/pages/TechnicalReviewPage'
import { TechnicalEditorPage } from '@/pages/TechnicalEditorPage'
import { StructuringReviewPage } from '@/pages/StructuringReviewPage'
import { ReferenceValidationReviewPage } from '@/pages/ReferenceValidationReviewPage'
import { FileEditorPage } from '@/pages/FileEditorPage'
import { DocxEditorPage } from '@/pages/DocxEditorPage'
import { StylesheetsPage } from '@/pages/StylesheetsPage'
import { ImageReviewPage } from '@/features/imageReview/ImageReviewPage'
import { ReportsPage } from '@/pages/ReportsPage'
import ScheduleReport from '@/Reports/ScheduleReport'
import TodaySchedule from '@/Reports/TodaySchedule'
import ProjectSchedule from '@/Reports/ProjectSchedule'

const router = createBrowserRouter([
  // ── Public routes ──────────────────────────────────────────────────────────
  { path: '/portal', element: <WorkflowPortalPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },

  // ── Protected routes ───────────────────────────────────────────────────────
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'dashboard', element: <DashboardPage /> },

      { path: 'clients', element: <Clients /> },
      { path: 'clients/:clientId/projects', element: <ClientProjects /> },
      { path: 'clients/:clientId/projects/new', element: <CreateProjectPage /> },

      {
        path: 'clients/:clientId/projects/:projectId',
        element: <ProjectWorkflow />,
      },
      {
        path: 'clients/:clientId/projects/:projectId/chapters/:chapterId',
        element: <ChapterDetailPage />,
      },
      {
        path: 'clients/:clientId/projects/:projectId/chapters/:chapterId/files',
        element: <ChapterDetailPage />,
      },
      {
        path: 'clients/:clientId/projects/:projectId/chapters/:chapterId/view/:subfolder/:filename',
        element: <ChapterEditorPage />,
      },

      { path: 'projects/:projectId', element: <ProjectWorkflow /> },
      { path: 'projects/:projectId/planning', element: <ProjectPlanningPage /> },
      { path: 'projects/:projectId/chapters/:chapterId', element: <ChapterDetailPage /> },
      { path: 'projects/:projectId/chapters/:chapterId/files', element: <ChapterDetailPage /> },
      {
        path: 'projects/:projectId/chapters/:chapterId/view/:subfolder/:filename',
        element: <ChapterEditorPage />,
      },

      // ── File-level pages (projects prefix) ──────────────────────────────────
      { path: 'projects/:projectId/chapters/:chapterId/files/:fileId/edit', element: <FileEditorPage /> },
      { path: 'projects/:projectId/chapters/:chapterId/files/:fileId/wysiwyg', element: <DocxEditorPage /> },
      { path: 'projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review', element: <StructuringReviewPage /> },
      { path: 'projects/:projectId/chapters/:chapterId/files/:fileId/technical-review', element: <TechnicalReviewPage /> },
      { path: 'projects/:projectId/chapters/:chapterId/files/:fileId/technical-editor', element: <TechnicalEditorPage /> },
      { path: 'projects/:projectId/chapters/:chapterId/files/:fileId/reference-review', element: <ReferenceValidationReviewPage /> },

      // ── File-level pages (clients prefix) ───────────────────────────────────
      { path: 'clients/:clientId/projects/:projectId/chapters/:chapterId/files/:fileId/edit', element: <FileEditorPage /> },
      { path: 'clients/:clientId/projects/:projectId/chapters/:chapterId/files/:fileId/wysiwyg', element: <DocxEditorPage /> },
      { path: 'clients/:clientId/projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review', element: <StructuringReviewPage /> },
      { path: 'clients/:clientId/projects/:projectId/chapters/:chapterId/files/:fileId/technical-review', element: <TechnicalReviewPage /> },
      { path: 'clients/:clientId/projects/:projectId/chapters/:chapterId/files/:fileId/technical-editor', element: <TechnicalEditorPage /> },
      { path: 'clients/:clientId/projects/:projectId/chapters/:chapterId/files/:fileId/reference-review', element: <ReferenceValidationReviewPage /> },

      { path: 'projects', element: <ProjectsPage /> },
      { path: 'chapters', element: <Placeholder title="Chapters" /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'reports/schedule', element: <ScheduleReport /> },
      { path: 'reports/today-schedule', element: <TodaySchedule /> },
      { path: 'reports/project-schedule', element: <ProjectSchedule /> },

      // ── Review pages without fileId (legacy patterns) ───────────────────────
      { path: 'projects/:projectId/chapters/:chapterId/technical-review', element: <TechnicalReviewPage /> },
      { path: 'projects/:projectId/chapters/:chapterId/structuring-review', element: <StructuringReviewPage /> },
      { path: 'projects/:projectId/chapters/:chapterId/reference-review', element: <ReferenceValidationReviewPage /> },
      { path: 'projects/:projectId/stylesheets', element: <StylesheetsPage /> },
      { path: 'projects/:projectId/image-review', element: <ImageReviewPage /> },

      // ── Settings: admin + manager only ───────────────────────────────────
      { path: 'settings', element: <RoleGuard allowedRoles={['admin', 'manager']}><Settings /></RoleGuard> },
      { path: 'settings/users', element: <RoleGuard allowedRoles={['admin', 'manager']}><UserManagement /></RoleGuard> },
      { path: 'settings/customers', element: <RoleGuard allowedRoles={['admin', 'manager']}><CustomerManagement /></RoleGuard> },
      { path: 'settings/stages', element: <RoleGuard allowedRoles={['admin', 'manager']}><StageManagement /></RoleGuard> },
      { path: 'settings/roles', element: <RoleGuard allowedRoles={['admin', 'manager']}><RolesManagement /></RoleGuard> },
      { path: 'settings/workflow', element: <RoleGuard allowedRoles={['admin', 'manager']}><WorkflowManagement /></RoleGuard> },
      { path: 'settings/system', element: <RoleGuard allowedRoles={['admin', 'manager']}><Placeholder title="System Settings" /></RoleGuard> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
