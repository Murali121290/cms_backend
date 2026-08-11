import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Edit,
  Filter,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  User as UserIcon,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/store/useToastStore';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSessionStore } from '@/stores/sessionStore';
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  type WebPdfProject,
} from '@/api/webPdfProcessor';
import { usersApi, type User } from '@/api/users';

interface ClientCompany {
  id: number;
  company: string;
  division: string;
}

// ── Validation Badge ──────────────────────────────────────────────────────────

function ValidationBadge({ status }: { status: string | null }) {
  if (!status || status === 'YTS') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted/20 text-muted">
        YTS
      </span>
    );
  }
  if (status === 'pass' || status === 'validated') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
        Passed
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-600 border border-red-500/20">
      Failed
    </span>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: WebPdfProject;
  users: User[];
  onDelete: (id: number) => void;
  onEdit: (project: WebPdfProject) => void;
  onRefresh: () => void;
}

function ProjectCard({ project, users, onDelete, onEdit, onRefresh }: ProjectCardProps) {
  const viewer = useSessionStore((s) => s.viewer);
  const myUsername = (viewer?.username || '').trim().toLowerCase();

  const handleCardClick = () => {
    toast.success(`Project ${project.project_name} details view is under development.`);
  };

  const handleAssigneeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newAssignee = e.target.value;
    try {
      await updateProject(project.id, { assignee: newAssignee });
      onRefresh();
    } catch (err) {
      console.error('Failed to update assignee', err);
      toast.error('Failed to update assignee');
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className="p-4 rounded-xl border bg-card border-border cursor-pointer shadow-sm hover:shadow-md transition-all duration-500 flex flex-col justify-between"
    >
      <div>
        {/* Header row */}
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <h3
              className="font-semibold text-sm text-text truncate m-0"
              title={project.project_name}
            >
              {project.project_name}
            </h3>
            <p className="text-[11px] text-muted mt-0.5">
              {project.client} {project.client_code && `(${project.client_code})`}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(project);
              }}
              className="text-muted hover:text-primary transition-colors p-1 rounded hover:bg-primary/10"
              title="Edit Assignee"
            >
              <Edit size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(project.id);
              }}
              className="text-muted hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30"
              title="Delete Project"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>


        {/* Assignee + Status badge row */}
        <div className="mt-3 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1 text-muted" onClick={(e) => e.stopPropagation()}>
            <UserIcon size={12} className="text-muted/70" />
            <select
              value={project.assignee || ''}
              onChange={handleAssigneeChange}
              className="bg-transparent border-0 text-primary font-medium focus:ring-0 focus:outline-none cursor-pointer p-0 text-[11px] hover:text-primary-hover"
            >
              <option value="" className="text-text bg-card">Unassigned</option>
              {users.filter((u) => u.active_status).map((u) => (
                <option key={u.id} value={u.user_name} className="text-text bg-card">
                  {u.user_name}
                </option>
              ))}
            </select>
          </div>
          <ValidationBadge status={project.validation_status} />
        </div>

        {/* Progress bar visual indicator */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-muted font-bold mb-1">
            <span>PDF Files</span>
            <span>{project.total_files} Files</span>
          </div>
          <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 rounded-full"
              style={{
                width: project.validation_status === 'pass' || project.validation_status === 'validated' ? '100%' : '0%',
              }}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-2.5 border-t border-border/60 flex items-center justify-between text-[10px] text-muted font-medium">
        <span>
          Created: {' '}
          {new Date(
            project.uploaded_at.endsWith('Z') ? project.uploaded_at : project.uploaded_at + 'Z',
          ).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
        <span>
          {project.validation_status === 'pass' || project.validation_status === 'validated' ? '100% Done' : '0% Done'}
        </span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PostProdWebPdfProcessor() {
  useDocumentTitle('Web PDF Processor — S4Carlisle CMS');

  const [projects, setProjects] = useState<WebPdfProject[]>([]);
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<number | null>(null);

  // Form fields
  const [selectedClientId, setSelectedClientId] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [projectName, setProjectName] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Edit Modal State
  const [editingProject, setEditingProject] = useState<WebPdfProject | null>(null);
  const [editAssignee, setEditAssignee] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');

  // ── Data fetching ───────────────────────────────────────────────────────

  const fetchProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch('/api/v2/clients/active');
      if (res.ok) setClients(await res.json());
    } catch {
      /* silent */
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const uList = await usersApi.list();
      setUsers(uList);
    } catch (err) {
      console.error('Failed to fetch users', err);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchClients();
    fetchUsers();
  }, [fetchProjects, fetchClients, fetchUsers]);

  // ── Derived metrics ─────────────────────────────────────────────────────

  const totalCount = projects.length;
  const passedCount = projects.filter((p) => p.validation_status === 'pass' || p.validation_status === 'validated').length;
  const failedCount = projects.filter((p) => p.validation_status === 'fail' || p.validation_status === 'failed').length;

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idStr = e.target.value;
    setSelectedClientId(idStr);
    const found = clients.find((c) => String(c.id) === idStr);
    setClientCode(found ? found.division : '');
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      setErrorMsg('Project Name is required');
      return;
    }
    if (!selectedClientId) {
      setErrorMsg('Please select a client');
      return;
    }
    if (!zipFile) {
      setErrorMsg('Please choose a ZIP file');
      return;
    }

    const clientComp = clients.find((c) => String(c.id) === selectedClientId);
    if (!clientComp) return;

    setUploading(true);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append('client', clientComp.company);
    formData.append('client_code', clientCode);
    formData.append('project_name', projectName.trim());
    formData.append('file', zipFile);

    try {
      await createProject(formData);
      toast.success('Project created and zip file uploaded successfully!');
      setShowAddModal(false);
      // Reset form
      setProjectName('');
      setSelectedClientId('');
      setClientCode('');
      setZipFile(null);
      fetchProjects();
    } catch (err: any) {
      setErrorMsg(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (projectToDelete === null) return;
    try {
      await deleteProject(projectToDelete);
      toast.success('Project deleted successfully');
      setProjectToDelete(null);
      fetchProjects();
    } catch {
      toast.error('Failed to delete project');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;
    setSavingEdit(true);
    try {
      await updateProject(editingProject.id, { assignee: editAssignee });
      toast.success('Project updated successfully');
      setEditingProject(null);
      fetchProjects();
    } catch {
      toast.error('Failed to update project');
    } finally {
      setSavingEdit(false);
    }
  };

  const openEditModal = (p: WebPdfProject) => {
    setEditingProject(p);
    setEditAssignee(p.assignee || '');
  };

  // ── Filtered list ───────────────────────────────────────────────────────

  const filteredProjects = projects.filter((p) => {
    // Search
    const searchMatch =
      p.project_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.client_code || '').toLowerCase().includes(searchQuery.toLowerCase());

    // Status
    let statusMatch = true;
    if (statusFilter === 'passed') {
      statusMatch = p.validation_status === 'pass' || p.validation_status === 'validated';
    } else if (statusFilter === 'failed') {
      statusMatch = p.validation_status === 'fail' || p.validation_status === 'failed';
    } else if (statusFilter === 'unvalidated') {
      statusMatch = !p.validation_status;
    }

    // Assignee
    let assigneeMatch = true;
    if (assigneeFilter !== 'all') {
      if (assigneeFilter === 'unassigned') {
        assigneeMatch = !p.assignee;
      } else {
        assigneeMatch = (p.assignee || '').toLowerCase() === assigneeFilter.toLowerCase();
      }
    }

    return searchMatch && statusMatch && assigneeMatch;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-y-auto">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border/80 flex items-center justify-between bg-card shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => window.history.back()}
            className="p-1.5 h-auto rounded-lg text-muted hover:text-text hover:bg-border/60 shrink-0"
          >
            <ArrowLeft size={16} />
          </Button>
          <div>
            <h1 className="text-base font-semibold m-0 text-text">Web PDF Processor</h1>
            <p className="text-xs text-muted m-0 mt-0.5">
              Upload, extract and audit Web PDF projects and configurations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowAddModal(true)}
            className="text-xs font-semibold h-9 px-3 flex items-center gap-1.5"
            leftIcon={<Plus size={15} />}>
            Create Project
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {/* Metrics Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wider m-0">Total Projects</p>
              <h3 className="text-2xl font-bold text-text m-0 mt-1">{totalCount}</h3>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wider m-0">Passed Validations</p>
              <h3 className="text-2xl font-bold text-text m-0 mt-1">{passedCount}</h3>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-red-500/10 text-red-600 flex items-center justify-center shrink-0">
              <XCircle size={20} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wider m-0">Failed Validations</p>
              <h3 className="text-2xl font-bold text-text m-0 mt-1">{failedCount}</h3>
            </div>
          </div>
        </section>

        {/* Filter bar */}
        <section className="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-80 shrink-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search project, client code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-1.5 w-full text-xs rounded-lg border border-border bg-background text-text focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-end flex-wrap">
            <div className="flex items-center gap-2">
              <Filter size={12} className="text-muted" />
              <span className="text-xs text-muted">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs rounded-lg border border-border bg-background text-text py-1 px-2.5 focus:outline-none"
              >
                <option value="all">All</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="unvalidated">Not Validated</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Assignee:</span>
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="text-xs rounded-lg border border-border bg-background text-text py-1 px-2.5 focus:outline-none"
              >
                <option value="all">All</option>
                <option value="unassigned">Unassigned</option>
                {Array.from(new Set(projects.map((p) => p.assignee).filter(Boolean))).map((username) => (
                  <option key={username} value={username || ''}>
                    {username}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Projects Cards List */}
        {loading ? (
          <div className="h-64 flex items-center justify-center text-xs text-muted">
            <RefreshCw size={20} className="animate-spin mr-2" />
            Loading project packages...
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center border border-dashed border-border rounded-xl bg-card p-6 text-center">
            <FolderOpen size={36} className="text-muted/60 mb-2" />
            <h4 className="text-sm font-semibold text-text m-0">No Projects Found</h4>
            <p className="text-xs text-muted m-0 mt-1 max-w-sm">
              Create a new project by selecting a client and uploading a ZIP package containing PDF files.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((proj) => (
              <ProjectCard
                key={proj.id}
                project={proj}
                users={users}
                onDelete={(id) => setProjectToDelete(id)}
                onEdit={(p) => openEditModal(p)}
                onRefresh={() => fetchProjects()}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── CREATE PROJECT MODAL ──────────────────────────────────────────────── */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Create Web PDF Project">
        <form onSubmit={handleCreateProject} className="space-y-4 pt-1">
          {errorMsg && (
            <div className="p-3 text-xs bg-red-500/10 border border-red-500/20 text-red-600 rounded-lg">
              {errorMsg}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text block">Client Company *</label>
            <select
              value={selectedClientId}
              onChange={handleClientChange}
              required
              className="w-full text-xs p-2 rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">-- Select Client --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company} {c.division && `(${c.division})`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text block">Client Code / Division</label>
            <input
              type="text"
              readOnly
              value={clientCode}
              placeholder="Auto-populated from selection"
              className="w-full text-xs p-2 rounded-lg border border-border bg-muted/40 text-text/80 cursor-not-allowed focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text block">Project Name *</label>
            <input
              type="text"
              required
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. pelagic-guide-book-v2"
              className="w-full text-xs p-2 rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text block">ZIP File Upload *</label>
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-border border-dashed rounded-lg cursor-pointer bg-background hover:bg-card transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 mb-3 text-muted" />
                  <p className="mb-2 text-xs text-text font-semibold">
                    {zipFile ? zipFile.name : 'Click to upload project ZIP'}
                  </p>
                  <p className="text-[10px] text-muted">
                    ZIP file containing the PDF source file(s)
                  </p>
                </div>
                <input
                  type="file"
                  accept=".zip"
                  onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                  className="hidden"
                  required
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowAddModal(false)} className="text-xs font-semibold">
              Cancel
            </Button>
            <Button type="submit" disabled={uploading} className="text-xs font-semibold flex items-center gap-1">
              {uploading ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
              {uploading ? 'Uploading...' : 'Create & Upload'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── EDIT PROJECT MODAL (Assignee only) ────────────────────────────────── */}
      <Modal isOpen={!!editingProject} onClose={() => setEditingProject(null)} title="Edit Project Assignee">
        <form onSubmit={handleSaveEdit} className="space-y-4 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text block">Assignee</label>
            <select
              value={editAssignee}
              onChange={(e) => setEditAssignee(e.target.value)}
              className="w-full text-xs p-2 rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Unassigned</option>
              {users.filter((u) => u.active_status).map((u) => (
                <option key={u.id} value={u.user_name}>
                  {u.user_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditingProject(null)} className="text-xs font-semibold">
              Cancel
            </Button>
            <Button type="submit" disabled={savingEdit} className="text-xs font-semibold">
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── DELETE CONFIRM MODAL ──────────────────────────────────────────────── */}
      <Modal isOpen={projectToDelete !== null} onClose={() => setProjectToDelete(null)} title="Delete Project">
        <div className="space-y-4 pt-1">
          <p className="text-xs text-text">
            Are you sure you want to delete this project? This will soft-delete the database record, but keep project files intact.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setProjectToDelete(null)} className="text-xs font-semibold">
              Cancel
            </Button>
            <Button onClick={handleDeleteConfirm} variant="ghost" className="text-xs font-semibold bg-red-500/10 text-red-600 hover:bg-red-500/20">
              Confirm Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
