import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { RoleGuard } from '@/components/RoleGuard'
import { LoginPage } from '@/pages/LoginPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { Dashboard } from '@/pages/Dashboard'
import { Settings } from '@/pages/Settings'
import { UserManagement } from '@/pages/settings/UserManagement'
import { CustomerManagement } from '@/pages/settings/CustomerManagement'
import { StageManagement } from '@/pages/settings/StageManagement'
import { RolesManagement } from '@/pages/settings/RolesManagement'
import { WorkflowManagement } from '@/pages/settings/WorkflowManagement'
import { Clients } from '@/pages/Clients'
import { ClientProjects } from '@/pages/ClientProjects'
import { ProjectWorkflow } from '@/pages/ProjectWorkflow'
import { ProjectPlanningPage } from '@/pages/ProjectPlanningPage'
import { ChapterDetailPage } from '@/pages/ChapterDetailPage'
import { ChapterEditorPage } from '@/pages/ChapterEditorPage'
import { Placeholder } from '@/pages/Placeholder'
import { TechnicalReviewPage } from '@/pages/TechnicalReviewPage'
import { StructuringReviewPage } from '@/pages/StructuringReviewPage'
import { ReferenceValidationReviewPage } from '@/pages/ReferenceValidationReviewPage'
import { StylesheetsPage } from '@/pages/StylesheetsPage'

const router = createBrowserRouter([
  // ── Public routes ──────────────────────────────────────────────────────────
  { path: '/login',           element: <LoginPage /> },
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
      { index: true, element: <Dashboard /> },

      { path: 'clients',                    element: <Clients /> },
      { path: 'clients/:clientId/projects', element: <ClientProjects /> },

      {
        path: 'clients/:clientId/projects/:projectId',
        element: <ProjectWorkflow />,
      },
      {
        path: 'clients/:clientId/projects/:projectId/chapters/:chapterId',
        element: <ChapterDetailPage />,
      },
      {
        path: 'clients/:clientId/projects/:projectId/chapters/:chapterId/view/:subfolder/:filename',
        element: <ChapterEditorPage />,
      },

      { path: 'projects/:projectId',          element: <ProjectWorkflow /> },
      { path: 'projects/:projectId/planning', element: <ProjectPlanningPage /> },
      {
        path: 'projects/:projectId/chapters/:chapterId/view/:subfolder/:filename',
        element: <ChapterEditorPage />,
      },

      { path: 'projects', element: <Placeholder title="Projects" /> },
      { path: 'chapters', element: <Placeholder title="Chapters" /> },
      { path: 'reports',  element: <Placeholder title="Reports" /> },

      // ── Review pages (cms_backend specific) ─────────────────────────────────
      { path: 'ui/projects/:id/chapters/:chapterId/technical-review', element: <TechnicalReviewPage /> },
      { path: 'ui/projects/:id/chapters/:chapterId/structuring-review', element: <StructuringReviewPage /> },
      { path: 'ui/projects/:id/chapters/:chapterId/reference-review', element: <ReferenceValidationReviewPage /> },
      { path: 'ui/projects/:id/stylesheets', element: <StylesheetsPage /> },

      // ── Settings: admin + manager only ───────────────────────────────────
      { path: 'settings',           element: <RoleGuard allowedRoles={['admin','manager']}><Settings /></RoleGuard> },
      { path: 'settings/users',     element: <RoleGuard allowedRoles={['admin','manager']}><UserManagement /></RoleGuard> },
      { path: 'settings/customers', element: <RoleGuard allowedRoles={['admin','manager']}><CustomerManagement /></RoleGuard> },
      { path: 'settings/stages',    element: <RoleGuard allowedRoles={['admin','manager']}><StageManagement /></RoleGuard> },
      { path: 'settings/roles',     element: <RoleGuard allowedRoles={['admin','manager']}><RolesManagement /></RoleGuard> },
      { path: 'settings/workflow',  element: <RoleGuard allowedRoles={['admin','manager']}><WorkflowManagement /></RoleGuard> },
      { path: 'settings/system',    element: <RoleGuard allowedRoles={['admin','manager']}><Placeholder title="System Settings" /></RoleGuard> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
