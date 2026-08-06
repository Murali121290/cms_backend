import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Filter,
  FolderOpen,
  Layers,
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
  type EvProject,
} from '@/api/epubValidator';
import { usersApi, type User } from '@/api/users';

interface ClientCompany {
  id: number;
  company: string;
  division?: string;
}

// ── Validation badge ──────────────────────────────────────────────────────────

function ValidationBadge({ status }: { status: string | null }) {
  if (status === 'pass' || status === 'validated' || status === 'Completed') {
    return (
      <span className="capitalize font-bold px-2 py-0.5 rounded-md text-[9px] border bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
        Completed
      </span>
    );
  }
  if (status === 'in_progress' || status === 'in-progress' || status === 'In Progress') {
    return (
      <span className="capitalize font-bold px-2 py-0.5 rounded-md text-[9px] border bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400">
        In Progress
      </span>
    );
  }
  return (
    <span className="capitalize font-bold px-2 py-0.5 rounded-md text-[9px] border bg-primary/10 border-primary/20 text-primary">
      Active
    </span>
  );
}

// ── Project card ──────────────────────────────────────────────────────────────

interface CardProps {
  project: EvProject;
  users: User[];
  onDelete: (id: number) => void;
  onRefresh: () => void;
}

function ProjectCard({ project, users, onDelete, onRefresh }: CardProps) {
  const navigate = useNavigate();
  const viewer = useSessionStore((s) => s.viewer);

  const handleCardClick = () => {
    const assigned = (project.assignee || '').trim().toLowerCase();
    const myUsername = (viewer?.username || '').trim().toLowerCase();

    if (!assigned) {
      toast.error('This project is not assigned to anyone. Assign it to open it.');
      return;
    }

    if (assigned && myUsername && assigned !== myUsername) {
      toast.error(`This project is assigned to ${project.assignee}. You cannot open it.`);
      return;
    }

    navigate(`/post-production/epub-validator/${project.id}`);
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

          <div className="flex items-center gap-2 shrink-0">
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
            <ChevronRight size={16} className="shrink-0 mt-0.5 transition-colors text-muted" />
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
            <span>Files</span>
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

export function PostProdEpubValidator() {
  useDocumentTitle('EPUB Validator — S4Carlisle CMS');
  const navigate = useNavigate();

  const [projects, setProjects] = useState<EvProject[]>([]);
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

  const totalProjects = projects.length;
  const completedProjects = projects.filter(
    (p) => p.validation_status === 'pass' || p.validation_status === 'validated',
  ).length;

  // ── Filters ─────────────────────────────────────────────────────────────

  const statusOptions = Array.from(
    new Set(projects.map((p) => p.validation_status ?? 'Active')),
  ).sort();
  const assigneeOptions = Array.from(
    new Set(projects.map((p) => p.assignee).filter((a): a is string => !!a)),
  ).sort();

  const filteredProjects = projects.filter((p) => {
    const q = searchQuery.trim().toLowerCase();
    const matchSearch =
      !q ||
      p.project_name.toLowerCase().includes(q) ||
      p.client.toLowerCase().includes(q) ||
      (p.client_code ?? '').toLowerCase().includes(q);
    const vs = p.validation_status ?? 'Active';
    const matchStatus = statusFilter === 'all' || vs === statusFilter;
    const matchAssignee =
      assigneeFilter === 'all' ||
      (assigneeFilter === 'unassigned' ? !p.assignee : p.assignee === assigneeFilter);
    return matchSearch && matchStatus && matchAssignee;
  });

  const hasActiveFilters =
    searchQuery.trim() !== '' || statusFilter !== 'all' || assigneeFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setAssigneeFilter('all');
  };

  // ── Create project ───────────────────────────────────────────────────────

  const selectedClient = clients.find((c) => String(c.id) === selectedClientId);

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedClientId(e.target.value);
    const client = clients.find((c) => String(c.id) === e.target.value);
    setClientCode(client?.division ?? '');
  };

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !projectName.trim() || !zipFile) return;

    setUploading(true);
    setErrorMsg(null);

    const form = new FormData();
    form.append('client', selectedClient.company);
    form.append('client_code', clientCode);
    form.append('project_name', projectName.trim());
    form.append('file', zipFile);

    try {
      await createProject(form);
      toast.success('Project created successfully');
      setShowAddModal(false);
      resetForm();
      fetchProjects();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => {
    setSelectedClientId('');
    setClientCode('');
    setProjectName('');
    setZipFile(null);
    setErrorMsg(null);
  };

  // ── Delete project ───────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!projectToDelete) return;
    const targetId = projectToDelete;
    // Optimistically update list so project disappears immediately
    setProjects((prev) => prev.filter((p) => p.id !== targetId));
    setProjectToDelete(null);

    try {
      await deleteProject(targetId);
      toast.success('Project deleted successfully');
      fetchProjects();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete project');
      fetchProjects();
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 text-text">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/post-production')}
            className="p-2 rounded-lg hover:bg-surface text-muted hover:text-text transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-lg">
              <FolderOpen size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-serif text-text m-0">EPUB Validator</h1>
              <p className="text-sm text-muted">
                {totalProjects} project{totalProjects !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        <Button onClick={() => setShowAddModal(true)} leftIcon={<Plus size={15} />}>
          Create Project
        </Button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-primary/10 text-primary rounded-lg">
            <Layers size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">
              Total Projects
            </span>
            <span className="text-lg font-bold text-text">{totalProjects}</span>
          </div>
        </div>

        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">
              Fully Completed
            </span>
            <span className="text-lg font-bold text-text">
              {completedProjects}{' '}
              <span className="text-xs font-normal text-muted">projects</span>
            </span>
          </div>
        </div>

        <div className="bg-card border border-border/70 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
            <RefreshCw size={18} />
          </div>
          <div>
            <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">
              Overall Progress
            </span>
            <span className="text-lg font-bold text-text">
              {totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0}%{' '}
              <span className="text-xs font-normal text-muted">
                ({completedProjects}/{totalProjects} proj)
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      {projects.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by project or customer…"
              className="w-full bg-card border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors placeholder:text-muted/50"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter size={13} className="text-muted shrink-0" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-card border border-border rounded-lg px-2.5 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="bg-card border border-border rounded-lg px-2.5 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors"
            >
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {assigneeOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-primary hover:underline font-semibold whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Grid / empty state */}
      {loading ? (
        <div className="text-center py-16 text-muted text-sm">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-muted border border-dashed border-border rounded-xl bg-card/10">
          <p className="text-xs font-medium">No projects added yet</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-2 text-xs text-primary hover:underline font-bold"
          >
            Create first project
          </button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-16 text-muted border border-dashed border-border rounded-xl bg-card/10">
          <p className="text-xs font-medium">No projects match the current filters</p>
          <button
            onClick={clearFilters}
            className="mt-2 text-xs text-primary hover:underline font-bold"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProjects.map((proj) => (
            <ProjectCard
              key={proj.id}
              project={proj}
              users={users}
              onDelete={(id) => setProjectToDelete(id)}
              onRefresh={fetchProjects}
            />
          ))}
        </div>
      )}

      {/* ── Add Project Modal ─────────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-5 shadow-xl space-y-4">
            {/* Modal header */}
            <div className="flex justify-between items-start border-b border-border/60 pb-2">
              <div>
                <h3 className="text-base font-bold text-text m-0">Add New Project</h3>
                <p className="text-[10px] text-muted mt-0.5">
                  Upload a ZIP package with book files
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="text-muted hover:text-text transition-colors p-1"
              >
                <XCircle size={18} />
              </button>
            </div>

            <form onSubmit={handleAddProject} className="space-y-3.5">
              {/* Client */}
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">
                  Client Name
                </label>
                <select
                  value={selectedClientId}
                  onChange={handleClientChange}
                  required
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="">Select Client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.company}
                    </option>
                  ))}
                </select>
              </div>

              {/* Client code */}
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">
                  Client Code
                </label>
                <input
                  type="text"
                  value={clientCode}
                  onChange={(e) => setClientCode(e.target.value)}
                  placeholder="e.g. ASPEN0503"
                  required
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors placeholder:text-muted/40"
                />
              </div>

              {/* Project name */}
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">
                  Project Name / Code
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Biology Vol 2"
                  required
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-text focus:outline-none focus:border-primary transition-colors placeholder:text-muted/40"
                />
              </div>

              {/* ZIP upload */}
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">
                  Upload Book ZIP Package
                </label>
                <div className="border border-dashed border-border hover:border-primary/60 rounded-lg p-5 text-center cursor-pointer transition-colors bg-background/50">
                  <input
                    type="file"
                    accept=".zip"
                    onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
                    className="hidden"
                    id="zip-upload"
                    required
                  />
                  <label htmlFor="zip-upload" className="cursor-pointer space-y-1.5 block">
                    <Upload className="mx-auto text-muted/80" size={22} />
                    <p className="text-xs font-semibold text-text">Click to choose ZIP Package</p>
                    <p className="text-[9px] text-muted">Supports .zip containing EPUB & PDF files</p>
                  </label>
                </div>
                {zipFile && (
                  <div className="mt-2 bg-background border border-border rounded-lg p-2 text-xs text-muted flex items-center justify-between">
                    <span className="truncate max-w-[280px] font-medium text-text">{zipFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setZipFile(null)}
                      className="text-red-600 hover:text-red-500 font-bold text-[10px]"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {errorMsg && (
                <p className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
                  {errorMsg}
                </p>
              )}

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    resetForm();
                  }}
                  className="px-3.5 py-1.5 bg-background border border-border hover:bg-accent text-text font-bold rounded-lg transition-colors text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !selectedClientId || !projectName.trim() || !zipFile}
                  className="px-3.5 py-1.5 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/95 transition-colors disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5 text-xs"
                >
                  {uploading ? 'Processing ZIP...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ───────────────────────────────────────────── */}
      {projectToDelete && (
        <Modal
          isOpen
          onClose={() => setProjectToDelete(null)}
          title="Delete Project"
          description="Are you sure you want to delete this project? This will remove it from the dashboard."
          confirmLabel="Delete"
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
