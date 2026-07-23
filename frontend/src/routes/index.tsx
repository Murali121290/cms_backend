import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { RoleGuard } from '@/components/RoleGuard'
import { LoginPage } from '@/pages/LoginPage'
import { WorkflowPortalPage } from '@/pages/WorkflowPortalPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { WorkspacePage } from '@/pages/WorkspacePage'
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
import { PostProduction } from '@/pages/PostProduction'
import { PostProdWordConversion } from '@/pages/PostProdWordConversion'
import { PostProdChaptersPage } from '@/pages/PostProdChaptersPage'
import { PostProdCssMatcher } from '@/pages/PostProdCssMatcher'
import { PostProdEpubValidator } from '@/pages/PostProdEpubValidator'
import { PostProdEpubValidatorFiles } from '@/pages/PostProdEpubValidatorFiles'
import { PostProdSlideFormatter } from '@/pages/PostProdSlideFormatter'
import { ROLE_PERMISSIONS } from '@/config/rbacConfig'
import { useRBAC } from '@/hooks/useRBAC'

function PostProdGuard({ children }: { children: React.ReactNode }) {
  const { canAccess, viewer } = useRBAC()
  const hasAccess = canAccess(ROLE_PERMISSIONS.access_post_production) || viewer?.team === 'Accessibility Team'
  if (!hasAccess) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

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
      { path: 'workspace', element: <WorkspacePage /> },

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
      { path: 'post-production', element: <PostProdGuard><PostProduction /></PostProdGuard> },
      { path: 'post-production/word-conversion', element: <PostProdGuard><PostProdWordConversion /></PostProdGuard> },
      { path: 'post-production/word-conversion/:projectId', element: <PostProdGuard><PostProdChaptersPage /></PostProdGuard> },
      { path: 'post-production/epub-css-matcher', element: <PostProdGuard><PostProdCssMatcher /></PostProdGuard> },
      { path: 'post-production/epub-validator', element: <PostProdGuard><PostProdEpubValidator /></PostProdGuard> },
      { path: 'post-production/epub-validator/:folderName', element: <PostProdGuard><PostProdEpubValidatorFiles /></PostProdGuard> },
      { path: 'post-production/slide-formatter', element: <PostProdGuard><PostProdSlideFormatter /></PostProdGuard> },
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
      { path: 'settings', element: <RoleGuard allowedRoles={ROLE_PERMISSIONS.access_settings}><Settings /></RoleGuard> },
      { path: 'settings/users', element: <RoleGuard allowedRoles={ROLE_PERMISSIONS.access_settings}><UserManagement /></RoleGuard> },
      { path: 'settings/customers', element: <RoleGuard allowedRoles={ROLE_PERMISSIONS.access_settings}><CustomerManagement /></RoleGuard> },
      { path: 'settings/stages', element: <RoleGuard allowedRoles={ROLE_PERMISSIONS.access_settings}><StageManagement /></RoleGuard> },
      { path: 'settings/roles', element: <RoleGuard allowedRoles={ROLE_PERMISSIONS.access_settings}><RolesManagement /></RoleGuard> },
      { path: 'settings/workflow', element: <RoleGuard allowedRoles={ROLE_PERMISSIONS.access_settings}><WorkflowManagement /></RoleGuard> },
      { path: 'settings/system', element: <RoleGuard allowedRoles={ROLE_PERMISSIONS.access_settings}><Placeholder title="System Settings" /></RoleGuard> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
