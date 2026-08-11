import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  ChevronUp,
  ChevronDown,
  Play,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/store/useToastStore';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  listProjectFiles,
  mergeProjectFiles,
  type WebPdfProject,
  type ProjectFile,
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
  onSelect: (project: WebPdfProject) => void;
}

function ProjectCard({ project, users, onDelete, onEdit, onRefresh, onSelect }: ProjectCardProps) {
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
      onClick={() => onSelect(project)}
      className="p-4 rounded-xl border bg-card border-border cursor-pointer shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-300 flex flex-col justify-between group"
    >
      <div>
        {/* Header row */}
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <h3
              className="font-semibold text-sm text-text truncate m-0 group-hover:text-primary transition-colors"
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
              onClick={(e) => { e.stopPropagation(); onEdit(project); }}
              className="text-muted hover:text-primary transition-colors p-1 rounded hover:bg-primary/10"
              title="Edit Assignee"
            >
              <Edit size={14} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
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
              style={{ width: project.status === 'Merged' ? '100%' : '0%' }}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-2.5 border-t border-border/60 flex items-center justify-between text-[10px] text-muted font-medium">
        <span>
          Created:{' '}
          {new Date(
            project.uploaded_at.endsWith('Z') ? project.uploaded_at : project.uploaded_at + 'Z',
          ).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
        <span className={project.status === 'Merged' ? 'text-emerald-600' : ''}>
          {project.status === 'Merged' ? '✓ Merged' : 'Ready'}
        </span>
      </div>
    </div>
  );
}

// ── Category Label ────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  FC: { label: 'Cover', color: 'bg-violet-500/10 text-violet-600 border-violet-500/20' },
  FM: { label: 'Front Matter', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  TEXT: { label: 'Chapter', color: 'bg-primary/10 text-primary border-primary/20' },
  BM: { label: 'Back Matter', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  BC: { label: 'Back Cover', color: 'bg-pink-500/10 text-pink-600 border-pink-500/20' },
};

// ── Main page ─────────────────────────────────────────────────────────────────

export function PostProdWebPdfProcessor() {
  useDocumentTitle('Web PDF Processor — S4Carlisle CMS');
  const navigate = useNavigate();

  const [projects, setProjects] = useState<WebPdfProject[]>([]);
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Workspace state
  const [selectedProject, setSelectedProject] = useState<WebPdfProject | null>(null);
  const [projectFiles, setProjectFiles] = useState<(ProjectFile & { selected: boolean })[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [merging, setMerging] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<number | null>(null);
  const [editingProject, setEditingProject] = useState<WebPdfProject | null>(null);
  const [editAssignee, setEditAssignee] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Form
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

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [projectsData, clientsRes, usersList] = await Promise.all([
          listProjects(),
          fetch('/api/v2/clients/active').then(r => r.ok ? r.json() : null),
          usersApi.list(),
        ]);

        if (mounted) {
          setProjects(projectsData);
          if (clientsRes) setClients(clientsRes);
          setUsers(usersList);
        }
      } catch (err) {
        console.error('Failed to load data', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, []);

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

  // ── Derived metrics ─────────────────────────────────────────────────────

  const totalCount = projects.length;
  const passedCount = projects.filter(
    (p) => p.validation_status === 'pass' || p.validation_status === 'validated',
  ).length;
  const failedCount = projects.filter(
    (p) => p.validation_status === 'fail' || p.validation_status === 'failed',
  ).length;

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idStr = e.target.value;
    setSelectedClientId(idStr);
    const found = clients.find((c) => String(c.id) === idStr);
    setClientCode(found ? found.division : '');
  };

  const handleSelectProject = async (p: WebPdfProject) => {
    setSelectedProject(p);
    setProjectFiles([]);
    setLoadingFiles(true);
    try {
      const files = await listProjectFiles(p.id);
      setProjectFiles(
        files.map((f) => ({
          ...f,
          selected: true, // all auto-detected files pre-selected
        })),
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to load project files');
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) { setErrorMsg('Project Name is required'); return; }
    if (!selectedClientId) { setErrorMsg('Please select a client'); return; }
    if (!zipFile) { setErrorMsg('Please choose a ZIP file'); return; }

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
      toast.success('Project created and ZIP uploaded successfully!');
      setShowAddModal(false);
      setProjectName(''); setSelectedClientId(''); setClientCode(''); setZipFile(null);
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
      if (selectedProject?.id === projectToDelete) setSelectedProject(null);
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
      toast.success('Project updated');
      setEditingProject(null);
      fetchProjects();
    } catch {
      toast.error('Failed to update project');
    } finally {
      setSavingEdit(false);
    }
  };

  const moveFile = (index: number, dir: 'up' | 'down') => {
    const next = dir === 'up' ? index - 1 : index + 1;
    if (next < 0 || next >= projectFiles.length) return;
    const list = [...projectFiles];
    [list[index], list[next]] = [list[next], list[index]];
    setProjectFiles(list);
  };

  const toggleFile = (index: number) => {
    const list = [...projectFiles];
    list[index].selected = !list[index].selected;
    setProjectFiles(list);
  };

  const changeCategory = (index: number, cat: ProjectFile['category']) => {
    const list = [...projectFiles];
    list[index].category = cat;
    setProjectFiles(list);
  };

  const handleMerge = async () => {
    if (!selectedProject) return;
    const selectedFiles = projectFiles
      .filter((f) => f.selected)
      .map((f) => ({
        filename: f.filename,
        absolute_path: f.absolute_path,
        category: f.category,
      }));
    if (selectedFiles.length === 0) {
      toast.error('Select at least one PDF file to merge.');
      return;
    }
    setMerging(true);
    try {
      await mergeProjectFiles(selectedProject.id, selectedFiles);
      toast.success('PDF files merged successfully!');
      fetchProjects();
    } catch (err: any) {
      toast.error(err.message || 'Failed to merge PDF files.');
    } finally {
      setMerging(false);
    }
  };

  // ── Filtered list ───────────────────────────────────────────────────────

  const filteredProjects = projects.filter((p) => {
    const searchMatch =
      p.project_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.client_code || '').toLowerCase().includes(searchQuery.toLowerCase());

    let statusMatch = true;
    if (statusFilter === 'passed') statusMatch = p.validation_status === 'pass' || p.validation_status === 'validated';
    else if (statusFilter === 'failed') statusMatch = p.validation_status === 'fail' || p.validation_status === 'failed';
    else if (statusFilter === 'unvalidated') statusMatch = !p.validation_status;

    let assigneeMatch = true;
    if (assigneeFilter !== 'all') {
      if (assigneeFilter === 'unassigned') assigneeMatch = !p.assignee;
      else assigneeMatch = (p.assignee || '').toLowerCase() === assigneeFilter.toLowerCase();
    }

    return searchMatch && statusMatch && assigneeMatch;
  });

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border/80 flex items-center justify-between bg-card shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => {
              if (selectedProject) setSelectedProject(null);
              else navigate('/post-production');
            }}
            className="p-1.5 h-auto rounded-lg text-muted hover:text-text hover:bg-border/60 shrink-0"
          >
            <ArrowLeft size={16} />
          </Button>
          <div>
            <h1 className="text-base font-semibold m-0 text-text">
              {selectedProject ? selectedProject.project_name : 'Web PDF Processor'}
            </h1>
            <p className="text-xs text-muted m-0 mt-0.5">
              {selectedProject
                ? `${selectedProject.client}${selectedProject.client_code ? ` (${selectedProject.client_code})` : ''} • Step 1: Merge PDFs`
                : 'Upload, extract and audit Web PDF projects and configurations'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!selectedProject && (
            <>
              <Button
                onClick={() => fetchProjects()}
                variant="outline"
                className="text-xs font-semibold h-9 px-3 flex items-center gap-1.5"
                disabled={loading}
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Refresh
              </Button>
              <Button
                onClick={() => setShowAddModal(true)}
                className="text-xs font-semibold h-9 px-3 flex items-center gap-1.5"
                leftIcon={<Plus size={15} />}
              >
                Create Project
              </Button>
            </>
          )}
        </div>
      </header>

      {/* ── WORKSPACE (split-screen) ───────────────────────────────────────── */}
      {selectedProject ? (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-x divide-border overflow-hidden">

          {/* LEFT — PDF Preview */}
          <div className="flex flex-col p-6 overflow-hidden bg-background">
            <h2 className="text-sm font-bold text-text mb-3 flex items-center gap-2 shrink-0">
              <FileText size={16} className="text-primary" />
              Merged PDF Preview
              {selectedProject.status === 'Merged' && (
                <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  ✓ Merged
                </span>
              )}
            </h2>

            <div className="flex-1 rounded-xl overflow-hidden bg-card border border-border relative">
              {selectedProject.status === 'Merged' ? (
                <iframe
                  src={`/api/v2/post-prod/web-pdf-processor/projects/${selectedProject.id}/merged-pdf`}
                  className="w-full h-full border-0"
                  title="Merged PDF Preview"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                  <FolderOpen size={48} className="text-muted/30 mb-4" />
                  <h3 className="text-sm font-semibold text-text m-0">No Merged PDF Yet</h3>
                  <p className="text-xs text-muted max-w-xs mt-2">
                    Categorize and order the files on the right panel, then click <strong>Merge &amp; Convert</strong> to generate the combined book PDF.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — File Categorisation & Controls */}
          <div className="flex flex-col p-6 overflow-hidden bg-card">
            <div className="flex items-start justify-between mb-4 shrink-0 gap-3">
              <div>
                <h2 className="text-sm font-bold text-text m-0">Step 1 — Merge PDF</h2>
                <p className="text-[11px] text-muted m-0 mt-0.5">
                  Auto-detected below. Check/uncheck, reorder, or re-categorize files, then merge.
                </p>
              </div>
              <Button
                onClick={handleMerge}
                disabled={merging || loadingFiles}
                className="text-xs font-semibold h-9 px-4 flex items-center gap-1.5 shrink-0"
              >
                {merging ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                {merging ? 'Merging...' : 'Merge & Convert'}
              </Button>
            </div>

            {/* Category legend */}
            <div className="flex flex-wrap gap-1.5 mb-3 shrink-0">
              {Object.entries(CATEGORY_LABELS).map(([cat, { label, color }]) => (
                <span key={cat} className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${color}`}>
                  {cat} — {label}
                </span>
              ))}
            </div>

            {/* File list */}
            {loadingFiles ? (
              <div className="flex-1 flex items-center justify-center text-xs text-muted">
                <RefreshCw size={18} className="animate-spin mr-2" />
                Scanning package files...
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto rounded-xl border border-border divide-y divide-border/50">
                {projectFiles.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted">
                    No PDF files found in this package's extract folder.
                  </div>
                ) : (
                  projectFiles.map((file, idx) => {
                    const catStyle = CATEGORY_LABELS[file.category] || CATEGORY_LABELS.TEXT;
                    return (
                      <div
                        key={file.relative_path}
                        className={`p-3 flex items-center gap-3 text-xs transition-colors ${
                          file.selected ? 'bg-card' : 'bg-muted/10'
                        }`}
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={file.selected}
                          onChange={() => toggleFile(idx)}
                          className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer shrink-0"
                        />

                        {/* File info */}
                        <div className={`min-w-0 flex-1 ${!file.selected ? 'opacity-50' : ''}`}>
                          <p className="font-semibold text-text truncate m-0" title={file.filename}>
                            {file.filename}
                          </p>
                          <p className="text-[10px] text-muted m-0 mt-0.5">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>

                        {/* Category selector */}
                        <select
                          value={file.category}
                          onChange={(e) => changeCategory(idx, e.target.value as ProjectFile['category'])}
                          className={`text-[11px] font-semibold rounded-lg border py-1 px-2 focus:outline-none bg-background ${catStyle.color}`}
                          disabled={!file.selected}
                        >
                          <option value="FC">Cover (FC)</option>
                          <option value="FM">Front Matter (FM)</option>
                          <option value="TEXT">Chapter (TEXT)</option>
                          <option value="BM">Back Matter (BM)</option>
                          <option value="BC">Back Cover (BC)</option>
                        </select>

                        {/* Order controls */}
                        <div className="flex flex-col shrink-0">
                          <button
                            onClick={() => moveFile(idx, 'up')}
                            disabled={idx === 0}
                            className="p-0.5 hover:bg-border/60 rounded text-muted hover:text-text disabled:opacity-25 transition-colors"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={() => moveFile(idx, 'down')}
                            disabled={idx === projectFiles.length - 1}
                            className="p-0.5 hover:bg-border/60 rounded text-muted hover:text-text disabled:opacity-25 transition-colors"
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── PROJECTS LISTING ───────────────────────────────────────────── */
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6 overflow-y-auto">
          {/* Metrics */}
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
                  {Array.from(new Set(projects.map((p) => p.assignee).filter(Boolean))).map((u) => (
                    <option key={u} value={u || ''}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Cards */}
          {loading ? (
            <div className="h-64 flex items-center justify-center text-xs text-muted">
              <RefreshCw size={20} className="animate-spin mr-2" /> Loading projects...
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center border border-dashed border-border rounded-xl bg-card p-6 text-center">
              <FolderOpen size={36} className="text-muted/60 mb-2" />
              <h4 className="text-sm font-semibold text-text m-0">No Projects Found</h4>
              <p className="text-xs text-muted m-0 mt-1 max-w-sm">
                Create a project and upload a ZIP package containing the PDF source files.
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
                  onEdit={(p) => { setEditingProject(p); setEditAssignee(p.assignee || ''); }}
                  onRefresh={fetchProjects}
                  onSelect={handleSelectProject}
                />
              ))}
            </div>
          )}
        </main>
      )}

      {/* ── CREATE PROJECT MODAL ──────────────────────────────────────────── */}
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
              <option value="">— Select Client —</option>
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
              placeholder="Auto-populated from client selection"
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
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-border border-dashed rounded-lg cursor-pointer bg-background hover:bg-card transition-colors">
              <Upload className="w-7 h-7 mb-2 text-muted" />
              <p className="text-xs text-text font-semibold">
                {zipFile ? zipFile.name : 'Click to upload ZIP package'}
              </p>
              <p className="text-[10px] text-muted mt-0.5">Must be a .zip file containing PDF files</p>
              <input
                type="file"
                accept=".zip"
                onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => setShowAddModal(false)} className="text-xs font-semibold">
              Cancel
            </Button>
            <Button type="submit" disabled={uploading} className="text-xs font-semibold flex items-center gap-1">
              {uploading ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
              {uploading ? 'Uploading...' : 'Create & Upload'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── EDIT MODAL ────────────────────────────────────────────────────── */}
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
                <option key={u.id} value={u.user_name}>{u.user_name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => setEditingProject(null)} className="text-xs font-semibold">
              Cancel
            </Button>
            <Button type="submit" disabled={savingEdit} className="text-xs font-semibold">
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── DELETE CONFIRM ────────────────────────────────────────────────── */}
      <Modal isOpen={projectToDelete !== null} onClose={() => setProjectToDelete(null)} title="Delete Project">
        <div className="space-y-4 pt-1">
          <p className="text-xs text-text">
            Are you sure? The database record will be soft-deleted. Project files on disk will remain intact.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setProjectToDelete(null)} className="text-xs font-semibold">
              Cancel
            </Button>
            <Button
              onClick={handleDeleteConfirm}
              variant="ghost"
              className="text-xs font-semibold bg-red-500/10 text-red-600 hover:bg-red-500/20"
            >
              Confirm Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
