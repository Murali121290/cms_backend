# CMS Backend - Complete Site Flow & Architecture

## Table of Contents
1. [System Overview](#system-overview)
2. [Navigation Structure](#navigation-structure)
3. [Page Flow & User Journeys](#page-flow--user-journeys)
4. [Core Features](#core-features)
5. [Design System](#design-system)
6. [State Management](#state-management)
7. [Data Flow Architecture](#data-flow-architecture)
8. [Component Hierarchy](#component-hierarchy)

---

## System Overview

**CMS Backend** is a collaborative document management and publishing platform for managing projects, chapters, files, and quality reviews with real-time editing capabilities.

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Python Flask + SQLAlchemy
- **Styling**: Tailwind CSS v4 + WMS Design System
- **State**: Zustand + React Query (TanStack Query)
- **Editors**: TipTap (WYSIWYG), Collabora, OnlyOffice, DOCX
- **Real-time**: WebSocket support for live editing

### Key Technologies
- **Routing**: React Router v6
- **Data Fetching**: TanStack Query v5 (React Query)
- **Form Handling**: React Hook Form
- **Table Display**: TanStack React Table
- **Notifications**: Toast system (custom)
- **Icons**: Lucide React

---

## Navigation Structure

### Main Navigation (Sidebar)
**Authenticated users see:**
```
Dashboard         → /ui/dashboard
Projects          → /ui/projects
Workflow          → /workflow
Files             → /files
Quality Control   → /quality-control
Reports           → /reports
Activities        → /activities
```

**Admin-only (if role = "Admin"):**
```
Admin Dashboard   → /ui/admin/dashboard
Users Management  → /ui/admin/users
```

### Unauthenticated Routes
```
Login             → /login
Register          → /register
```

---

## Page Flow & User Journeys

### 1. Authentication Flow

#### Login Page (`/login`)
- **Entry point**: First-time users or session expired
- **Components**: AuthLayout, AuthCard, AuthInput, AuthButton
- **Actions**:
  - User enters email + password
  - Backend validates credentials
  - Sets `sessionStore` (Zustand) with user data
  - Redirects to `/ui/dashboard`
- **Error handling**: AuthErrorBlock displays validation errors

#### Register Page (if enabled)
- Similar to Login but creates new user
- May be restricted by backend settings

#### Session Gate (`features/session/SessionGate.tsx`)
- **Purpose**: Wraps entire app, redirects unauthenticated users to `/login`
- **Checks**: `sessionStore.viewer` exists
- **Flow**:
  ```
  App Load → SessionGate → Check sessionStore.viewer
           → If null → Redirect to /login
           → If exists → Load AppLayout + routes
  ```

---

### 2. Dashboard Page (`/ui/dashboard`)

**Purpose**: Home page showing quick overview of projects, stats, and recent activity

**Components**:
- `DashboardStatsGrid` - Project count, file count, activity metrics
- `DashboardProjectGrid` - Grid of recent/favorite projects with quick links
- `DashboardAdminShortcuts` - (Admin only) Links to user management, reports

**Data Flow**:
```
DashboardPage
  ├── useProjectsQuery() → Fetch projects list
  ├── DashboardStatsGrid → Display metrics
  └── DashboardProjectGrid → Show project cards with click-to-open
```

**Navigation From**:
- Click project card → `/ui/projects/:id` (ProjectDetailPage)
- Click "Projects" in sidebar → `/ui/projects` (ProjectsPage)

---

### 3. Projects Management

#### Projects List Page (`/ui/projects`)
**Purpose**: Browse all projects with filtering/search

**Components**:
- `ProjectsTable` - Searchable table of all projects
- `ProjectMetadataPanel` - (Sidebar) Project metadata editor
- `PageHeader` - "Projects" title + "New Project" button

**Features**:
- Search by project name
- Sort by columns
- Create new project
- Click row to view details

**Data Flow**:
```
ProjectsPage
  ├── useProjectsQuery() → List all projects
  ├── useProjectDetail() → Get selected project (sidebar)
  ├── ProjectsTable → Render list
  └── Click project → useNavigate() to ProjectDetailPage
```

#### Project Detail Page (`/ui/projects/:id`)
**Purpose**: Manage single project and its chapters

**Layout**:
```
┌─────────────────────────────────────────────┐
│ PageHeader: Project Title + Actions         │
├──────────────┬──────────────────────────────┤
│  Chapter     │   Main Content Area          │
│  Sidebar     │  (Chapters List or Detail)  │
│              │                              │
└──────────────┴──────────────────────────────┘
```

**Components**:
- `PageHeader` - Title + "Add Chapter" button
- `ProjectChaptersTable` - List of chapters in project
- `ProjectMetadataPanel` - (Sidebar) Project metadata
- **If chapter selected**: ChapterDetailPage content

**Actions Available**:
- Add chapter
- Edit project metadata
- Delete project
- View chapter details
- Upload files to chapter

**Data Flow**:
```
ProjectDetailPage
  ├── useProjectDetailQuery(id) → Project info
  ├── useChaptersQuery(projectId) → List chapters
  ├── ProjectChaptersTable → Display chapters
  ├── Click chapter → Navigate to ChapterDetailPage
  └── Click "Add Chapter" → Show AddChapterDrawer
```

---

### 4. Chapter Management

#### Chapter Detail Page (`/ui/projects/:projectId/chapters/:chapterId`)
**Purpose**: Manage chapter files, metadata, and run quality reviews

**Complex Layout**:
```
┌─────────────────────────────────────────────┐
│ ChapterToolbar: Chapter Title + Actions     │
├──────────────┬──────────────────────────────┤
│  Category    │   Files Table / Upload Area  │
│  Sidebar     │                              │
│              │   or Editor View             │
└──────────────┴──────────────────────────────┘
```

**View Modes** (ChapterToolbar):
- **Table View** (`viewMode = "table"`) - ChapterFilesTable
- **Editor View** (`viewMode = "editor"`) - TipTap / Collabora / OnlyOffice editor
- **Upload View** (`viewMode = "upload"`) - ChapterUploadPanel

**Components**:
- `ChapterToolbar` - View mode selector, chapter actions
- `ChapterFilesTable` - List files with status
- `ChapterUploadPanel` - Drag-drop upload area
- `ChapterCategorySummary` - Category breakdown (processing status)
- Editors (see **Editor Section**)

**File Actions**:
- **Right-click or menu**:
  - View/Download
  - Delete
  - Move to different category
  - Check references
  - Review (if review mode enabled)

**Quality Review Workflow**:
1. User selects chapter
2. Chooses review type: Structuring / Technical / Reference Validation
3. System launches appropriate review page with chapter data
4. Reviewer marks issues, approves, rejects, or requests changes
5. Status updates reflected in ChapterDetailPage

**Data Flow**:
```
ChapterDetailPage
  ├── useChapterDetailQuery(chapterId) → Chapter metadata
  ├── useChapterFilesQuery(chapterId) → List files
  ├── ChapterToolbar → Select view mode
  ├── If "table" → ChapterFilesTable
  ├── If "upload" → ChapterUploadPanel
  ├── If "editor" → EditorRouter (TipTap/Collabora/OnlyOffice)
  └── Sidebar: ChapterCategorySummary → Category status
```

---

### 5. File Editors

#### Three Editor Types

**A. TipTap WYSIWYG Editor** (FileEditorPage.tsx)
- **Type**: Browser-based rich text editor
- **Files**: .txt, formatted text
- **Features**:
  - Bold, italic, headings, lists, tables
  - Inline math support (MathNodeView)
  - Real-time preview
  - Save on blur

**B. Collabora Online** (TechnicalEditorPage.tsx)
- **Type**: LibreOffice-based online editor
- **Files**: .odt, .docx, spreadsheets
- **Features**:
  - Full Office compatibility
  - Track changes
  - Collaboration (see WOPI)
  - Export to PDF

**C. OnlyOffice** (DocxEditorPage.tsx)
- **Type**: Dedicated Office format editor
- **Files**: .docx, .xlsx, .pptx
- **Features**:
  - Native Office UX
  - Co-editing support
  - Comments & review
  - Version history

#### Editor Selection Logic
```
ChapterDetailPage (viewMode = "editor")
  ├── Detect file type (extension)
  ├── .txt / formatted text → FileEditorPage (TipTap)
  ├── .odt / .docx → TechnicalEditorPage (Collabora)
  └── .docx → DocxEditorPage (OnlyOffice)
```

#### Editor Data Flow
```
Editor Page
  ├── useChapterDetailQuery() → File list
  ├── Fetch file content (if needed)
  ├── EditorComponent (TipTap/Collabora/OnlyOffice) → Display
  ├── User edits
  ├── Auto-save or explicit save
  └── updateFileAPI() → Backend stores changes
```

---

### 6. Quality Control Features

#### Quality Control Dashboard (`/quality-control`)
**Purpose**: Overview of all review tasks and their status

**Components**:
- Stats grid (pending reviews, completed, etc.)
- Filterable list of chapters pending review
- Quick-launch buttons to start review

**Navigation**:
- Click chapter → Navigate to appropriate review page

#### Review Pages (Quality Review Workflows)

**A. Structuring Review Page** (`/ui/projects/:id/structuring-review/:chapterId`)
- **Purpose**: Review document structure, organization, and metadata
- **Panels**:
  - Main document viewer with annotation tools
  - Metadata panel (section titles, categories)
  - Version history / change tracking
  - Status update (approve/reject/request changes)
- **Output**: Structuring comments & approval status

**B. Technical Review Page** (`/ui/projects/:id/technical-review/:chapterId`)
- **Purpose**: Review formatting, references, citations, math correctness
- **Panels**:
  - Document with inline issue highlighting
  - Technical issues form (math errors, broken refs, etc.)
  - Citation linking panel
  - Stylesheet validation panel
- **Output**: List of issues + approval decision

**C. Reference Validation Review** (`/ui/projects/:id/reference-validation-review/:chapterId`)
- **Purpose**: Validate all citations and cross-references
- **Panels**:
  - Reference checker (validates each citation)
  - Missing references tab (highlights unfound refs)
  - Citation linking candidates
  - Status panel
- **Output**: Validated/fixed references + approval

#### Review State Machine
```
File Status Flow:
Draft
  ├── → Structuring Review → Structuring Changes Needed
  │                       → Structuring Approved
  ├── → Technical Review → Technical Issues Found
  │                     → Technical Approved
  ├── → Reference Validation → References Fixed
  │                          → Reference Approved
  └── → Published
```

---

### 7. Workflow & Processing

#### Workflow Page (`/workflow`)
**Purpose**: Track async jobs (processing, validation, publishing)

**Components**:
- Job list with status indicators
- Filtering by job type, status, date
- Job detail panel showing logs

**Job Types**:
- Document processing (OCR, format conversion)
- Reference extraction & linking
- Citation validation
- Publishing pipeline

**Data Flow**:
```
WorkflowPage
  ├── useWorkflowJobsQuery() → Fetch all async jobs
  ├── Poll for status updates (WebSocket or polling)
  └── Display job list with real-time status
```

---

### 8. Files Management

#### Files Page (`/files`)
**Purpose**: Browse all files across all chapters

**Components**:
- Global file table (sortable, filterable)
- Search by filename, project, chapter
- File context menu (download, delete, move)

**Actions**:
- Download file
- Delete file
- Move to different chapter/category
- View in associated chapter

**Data Flow**:
```
FilesPage
  ├── useAllFilesQuery() → Fetch all files (global view)
  ├── DataTable → Sort/filter/paginate
  └── Click file → useNavigate() to chapter
```

---

### 9. Admin Features

#### Admin Dashboard (`/ui/admin/dashboard`)
**Purpose**: System-wide stats and shortcuts

**Components**:
- Total users, projects, files metrics
- Quick links to admin pages
- System health indicators

#### User Management (`/ui/admin/users`)
**Purpose**: Manage system users, roles, permissions

**Components**:
- `AdminUsersTable` - List all users
- `AdminCreateUserForm` - Create new user
- `AdminEditUserForm` - Edit existing user
- `AdminPasswordForm` - Reset user password

**User Roles**:
- **Admin** - Full system access
- **Editor** - Can create/edit projects
- **Viewer** - Read-only access

**Data Flow**:
```
AdminUsersPage
  ├── useUsersQuery() → Fetch all users
  ├── AdminUsersTable → Display users
  ├── Click user → Show edit form
  ├── Edit/Create user
  └── POST/PUT to usersAPI → Update backend
```

---

### 10. Reports & Activities

#### Reports Page (`/reports`)
**Purpose**: Analytics and insights

**Sections**:
- Project completion status
- Files processed vs. pending
- Review turnaround times
- User activity summary

#### Activities Page (`/activities`)
**Purpose**: Audit log of all system actions

**Log Entries**:
- User actions (login, create, edit, delete)
- Review status changes
- File uploads/processing
- Approvals/rejections

**Filtering**:
- By user, project, action type, date range

**Data Flow**:
```
ActivitiesPage
  ├── useActivitiesQuery(filters) → Fetch activity log
  └── Display timeline with action details
```

---

## Core Features

### 1. Real-time Collaboration
- **WebSocket connection** for live document editing
- **Multiple users** can edit same document simultaneously
- **Change tracking** shows who made what changes
- **Lock prevention** - file locked while being edited

### 2. Document Processing
- **Upload** - Drag-drop or file selection
- **Processing pipeline** - Auto-detects format, OCR if needed
- **Category assignment** - Auto or manual categorization
- **Status tracking** - Processing → Ready → Review stages

### 3. Citation & Reference Management
- **Extraction** - Auto-extract citations from document
- **Validation** - Check references exist and are accessible
- **Linking** - Link citations to reference database
- **Missing refs** - Highlight and flag unresolved references

### 4. Multi-Format Support
- **Text files** - .txt (TipTap editor)
- **Documents** - .docx, .odt (Collabora/OnlyOffice)
- **Spreadsheets** - .xlsx (OnlyOffice)
- **Presentations** - .pptx (OnlyOffice)

### 5. Notification System
- **Toast notifications** - Temporary alerts for actions
- **Notification bell** - In-header notification center
- **Notification types**:
  - File processing complete
  - Review assigned
  - Review approved/rejected
  - Approval granted

### 6. Styling & Templates
- **Stylesheet management** - Define document styles
- **Templates** - Pre-defined style templates
- **Application** - Apply styles to chapters/files
- **Validation** - Check style compliance

---

## Design System

### WMS Design System (Updated)

#### Color Tokens
**Semantic Colors** (CSS variables):
```css
--color-sidebar:        #022B3A  (dark navy sidebar)
--color-primary:        #1F7A8C  (teal buttons, links)
--color-primary-hover:  #165f6e  (darker teal on hover)
--color-accent:         #BFDBF7  (light teal highlights)
--color-background:     #F8FAFC  (light gray page background)
--color-card:           #FFFFFF  (white cards)
--color-border:         #E2E8F0  (light gray borders)
--color-text:           #1E293B  (dark text)
--color-muted:          #64748B  (gray muted text)
--color-success:        #22C55E  (green success)
--color-warning:        #F59E0B  (amber warning)
--color-danger:         #EF4444  (red danger/error)
--color-info:           #3B82F6  (blue info)
```

#### Typography
- **Font family**: Inter (sans-serif only)
- **No serif fonts** (Libre Bodoni removed)
- **Sizes**: xs (12px) → xl (20px)
- **Weights**: Regular (400), Medium (500), Semibold (600), Bold (700)

#### Component Styles
```
Button (primary)    → bg-primary text-white hover:bg-primary-hover
Button (secondary)  → bg-white text-text hover:bg-background
Card                → bg-card border-border rounded-xl shadow-sm
Modal               → bg-card rounded-2xl shadow-lg backdrop-blur
Badge (default)     → bg-background text-text border-border
Badge (success)     → bg-success/15 text-success border-success/30
```

#### Runtime Theme Switching
- **Default Theme**: Ocean Blue (teal primary)
- **Alternative Themes**:
  - Slate Dark (indigo primary)
  - Forest Green (green primary)
- **Selector**: Palette icon in sidebar footer
- **Persistence**: Saved in localStorage (`cms-theme`)

#### Sidebar Pattern
- **Collapsible**: Toggles between w-16 (collapsed) and w-60 (expanded)
- **Toggle button**: Chevron icon in sidebar footer
- **Smooth animation**: 300ms transition
- **State management**: `useSidebarStore` (Zustand)

---

## State Management

### Zustand Stores

#### 1. Session Store (`useSessionStore`)
```typescript
interface SessionStore {
  viewer: User | null        // Current logged-in user
  setViewer(user: User)      // Set after login
}
```
**Purpose**: Track authentication state
**Persistence**: Memory (cleared on logout)

#### 2. Theme Store (`useThemeStore`)
```typescript
interface ThemeStore {
  theme: Theme               // Current theme (Ocean Blue/Slate Dark/Forest Green)
  setTheme(name: string)     // Change theme
}
```
**Purpose**: Manage runtime theme
**Persistence**: localStorage (`cms-theme`)

#### 3. Sidebar Store (`useSidebarStore`)
```typescript
interface SidebarStore {
  collapsed: boolean
  toggle()
  setCollapsed(v: boolean)
}
```
**Purpose**: Sidebar collapsed state
**Persistence**: None (UI state, resets on refresh)

#### 4. Toast Store (`useToastStore`)
```typescript
interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
}
```
**Purpose**: Display toast notifications
**Auto-dismiss**: 3-5 seconds

### React Query / TanStack Query

**Queries** (read-only data fetching):
- `useProjectsQuery()` - All projects
- `useProjectDetailQuery(id)` - Single project
- `useChaptersQuery(projectId)` - Chapters in project
- `useChapterDetailQuery(chapterId)` - Chapter metadata
- `useChapterFilesQuery(chapterId)` - Files in chapter
- `useAllFilesQuery()` - All files (global view)
- `useUsersQuery()` - All users (admin)
- `useWorkflowJobsQuery()` - Async jobs
- `useActivitiesQuery()` - Activity log

**Mutations** (data modification):
- `useCreateProjectMutation()`
- `useUpdateProjectMutation()`
- `useDeleteProjectMutation()`
- `useUploadFileMutation()`
- `useUpdateFileMutation()`
- `useDeleteFileMutation()`
- `useStartReviewMutation()`
- `useSubmitReviewMutation()`
- `useCreateUserMutation()`
- `useUpdateUserMutation()`

---

## Data Flow Architecture

### Request Flow
```
React Component
  ↓
Zustand Store / React Query Hook
  ↓
API Client (`api/client.ts`)
  ├── Error handling
  ├── Auth header injection
  └── Response transformation
  ↓
Backend API (Flask)
  ├── Authentication (JWT)
  ├── Authorization (role checking)
  ├── Business logic
  └── Database queries
  ↓
Response
  ├── Data returned to component
  ├── State updated (Query cache)
  └── Re-render triggered
```

### File Upload Flow
```
User selects file(s)
  ↓
ChapterUploadPanel (drag-drop area)
  ↓
useChapterUpload() mutation
  ├── Validates file type
  ├── Splits into chunks if large
  └── POST to /api/files/upload
  ↓
Backend processing
  ├── Stores file
  ├── Detects format
  ├── Triggers processing job
  └── Returns file ID + job ID
  ↓
Frontend updates
  ├── Add file to ChapterFilesTable
  ├── Show processing status
  └── Poll job status via WorkflowPage
```

### Review Submission Flow
```
Reviewer in Review Page (Structuring/Technical/Reference)
  ↓
Fills in review form (issues, comments, approval decision)
  ↓
Clicks "Submit Review" button
  ↓
useSubmitReviewMutation()
  ├── Validates form data
  └── POST to /api/reviews/submit
  ↓
Backend
  ├── Records review
  ├── Updates file status
  ├── Triggers notifications
  └── Logs activity
  ↓
Frontend
  ├── Show success toast
  ├── Invalidate chapter query (refetch)
  └── Navigate back to ProjectDetailPage / QualityControlPage
```

### Real-time Update Flow (WebSocket)
```
Editor opens file
  ↓
Establish WebSocket connection
  ↓
User types/edits
  ↓
TipTap/Editor triggers onChange
  ↓
Send changes to server via WebSocket
  ↓
Server broadcasts to other connected editors
  ↓
Other editors receive update
  ├── Merge changes with local state
  ├── Update document view
  └── Highlight change source
```

---

## Component Hierarchy

### Layout Structure
```
App
  ├── SessionGate (checks authentication)
  │   ├── AuthLayout (for /login, /register)
  │   │   └── AuthCard
  │   │       ├── AuthInput
  │   │       ├── AuthButton
  │   │       └── AuthErrorBlock
  │   │
  │   └── AppLayout (for authenticated routes)
  │       ├── Sidebar
  │       │   ├── Logo area
  │       │   ├── NavLink items
  │       │   ├── AdminGate (admin nav items)
  │       │   ├── ThemeSwitcher
  │       │   └── Collapse toggle
  │       │
  │       ├── TopBar
  │       │   ├── Breadcrumb
  │       │   ├── NotificationBell
  │       │   └── User menu
  │       │
  │       └── Main (Routes)
  │           ├── DashboardPage
  │           ├── ProjectsPage
  │           ├── ProjectDetailPage
  │           ├── ChapterDetailPage
  │           ├── Editor Pages (FileEditorPage, TechnicalEditorPage, DocxEditorPage)
  │           ├── Review Pages (StructuringReviewPage, TechnicalReviewPage, ReferenceValidationReviewPage)
  │           ├── FilesPage
  │           ├── WorkflowPage
  │           ├── QualityControlPage
  │           ├── ReportsPage
  │           ├── ActivitiesPage
  │           ├── StylesheetsPage
  │           └── Admin Pages (AdminDashboardPage, AdminUsersPage)
```

### Common UI Components
```
components/ui/
  ├── Button         (primary, secondary, danger, ghost variants)
  ├── Card           (container, header, footer, hover effects)
  ├── Badge          (default, success, warning, error, info, navy, outline)
  ├── Modal          (dialog with backdrop, focus management)
  ├── PageHeader     (title, subtitle, badges, actions)
  ├── DataTable      (sortable, paginated, filterable)
  ├── Breadcrumb     (navigation path)
  ├── SlideDrawer    (side panel, animated)
  ├── Toast          (notification toast)
  ├── SkeletonLoader (loading placeholders)
  ├── EmptyState     (no-data state)
  ├── ProgressBar    (upload/processing progress)
  ├── SearchInput    (text search with debounce)
  ├── UploadZone     (drag-drop file upload)
  ├── ConfirmDialog  (confirmation modal)
  ├── StatusBadge    (processing, completed, failed status indicators)
  └── ErrorBoundary  (error catching & display)
```

---

## User Roles & Permissions

### Role-Based Access Control (RBAC)

**Admin**
- Access: All pages + admin-only pages
- Permissions: Create/edit/delete users, view reports, access admin dashboard

**Editor**
- Access: All project/chapter/file pages, reviews, quality control
- Permissions: Create/edit projects, upload files, manage chapters

**Viewer**
- Access: View-only (dashboard, projects, files)
- Permissions: Read access, no modifications

**Protected Routes**:
```
/ui/admin/*         → Admin role required (AdminGate wrapper)
/ui/*               → Any authenticated user
/login, /register   → Unauthenticated only
```

---

## Error Handling Strategy

### Client-Side Error Handling
1. **API Errors**: Catch in mutations, display toast with message
2. **Validation Errors**: Form-level validation before submission
3. **Network Errors**: Retry logic, offline indicator
4. **Boundary Errors**: ErrorBoundary catches React errors, shows fallback UI

### Backend Error Codes
```
200 OK                → Success
400 Bad Request       → Validation error
401 Unauthorized      → Not authenticated
403 Forbidden         → Insufficient permissions
404 Not Found         → Resource not found
409 Conflict          → Duplicate/version mismatch
422 Unprocessable     → Semantic error
500 Server Error      → Server-side issue
```

---

## Performance Optimizations

### Frontend Optimizations
- **Code splitting**: Vite lazy-loads routes
- **Query caching**: React Query caches API responses
- **Memoization**: Components memoized with `memo()` / `useMemo`
- **Virtual scrolling**: DataTable virtualized for large datasets
- **Image optimization**: Assets bundled/minified

### Backend Optimizations
- **Connection pooling**: Database connection reuse
- **Pagination**: API endpoints paginate results
- **Caching**: Server-side caching of frequent queries
- **Async jobs**: Long-running tasks (OCR, processing) async

---

## Security Features

### Authentication
- **JWT tokens**: Issued on login, included in auth headers
- **Session validation**: Server validates token on each request
- **Logout**: Clears token from client, invalidates server session

### Authorization
- **Role checking**: Backend validates user role for each endpoint
- **Resource ownership**: Users can only access own projects/files

### Input Validation
- **Client-side**: Form validation before submission
- **Server-side**: All inputs validated on backend

### Data Protection
- **HTTPS**: All API calls over secure connection
- **CORS**: API enforces cross-origin policy

---

## Deployment Architecture

### Frontend (Vite build)
```
npm run build → dist/
  ├── index.html
  ├── assets/
  │   ├── index-{hash}.js (main bundle)
  │   ├── vendor-*.js (split chunks)
  │   └── index-{hash}.css (styles)
  └── Deployed to: Static hosting (CDN/S3/Vercel)
```

### Backend (Flask)
```
python app.py
  ├── Port: 5000 (default) / env-configured
  ├── Database: SQLAlchemy ORM
  ├── API endpoints: /api/v2/*
  └── Deployed to: EC2 / Docker / Cloud Run
```

### Environment Variables
```
VITE_API_URL         → Backend API endpoint (http://localhost:5000/api)
VITE_ENV             → Development / Production
FLASK_ENV            → development / production
DATABASE_URL         → PostgreSQL / SQLite connection
SECRET_KEY           → JWT signing key
```

---

## Future Enhancements

- [ ] Dark mode theme toggle
- [ ] Advanced search with full-text indexing
- [ ] Webhooks for external integrations
- [ ] Bulk operations (multi-file processing)
- [ ] Custom workflows / approval chains
- [ ] API documentation & client SDK
- [ ] Mobile app
- [ ] Version control (git-like diffs)
- [ ] Time-travel review (see document at any point)
- [ ] AI-powered suggestions (auto-fix issues)

---

## Quick Start Links

| Task | Link |
|------|------|
| Browse Projects | `/ui/projects` |
| Create Project | `/ui/projects` → "New Project" |
| Upload Files | `/ui/projects/:id` → "Add Chapter" → Upload |
| Review Chapter | `/quality-control` → Select review type → Review page |
| Manage Users | `/ui/admin/users` (Admin only) |
| Check Activity | `/activities` |
| View Reports | `/reports` |
| Change Theme | Sidebar footer → Palette icon |
| Collapse Sidebar | Sidebar footer → Chevron toggle |

---

**Last Updated**: 2026-06-04
**System Version**: WMS Design System Phase 2-3
**Status**: 44+ files updated with new color tokens, 4 review pages pending full WMS integration
