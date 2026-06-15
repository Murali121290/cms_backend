import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, GitBranch, LayoutGrid, ListChecks } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToast } from "@/components/ui/useToast";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useProjectsQuery } from "@/features/projects/useProjectsQuery";
import { useUpdateProjectWorkflow } from "@/features/workflow/useWorkflowMutations";
import {
  WORKFLOW_DEFINITIONS,
  WORKFLOW_ROLES,
  getWorkflowDefinition,
  stageType,
  type StageType,
  type WorkflowDefinition,
  type WorkflowStage,
} from "@/features/workflow/workflowDefinitions";
import { uiPaths } from "@/utils/appPaths";
import type { ProjectSummary } from "@/types/api";

type Tab = "catalog" | "tracking";

const STAGE_TYPE_STYLES: Record<StageType, { chip: string; label: string }> = {
  art: { chip: "bg-amber-50 text-amber-700 border-amber-200", label: "Art" },
  tmpl: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Template" },
  pre: { chip: "bg-violet-50 text-violet-700 border-violet-200", label: "Pre-edit" },
  xml: { chip: "bg-sky-50 text-sky-700 border-sky-200", label: "XML" },
  default: { chip: "bg-background text-text border-border", label: "Standard" },
};

export function WorkflowPage() {
  useDocumentTitle("Workflow â€” S4 Carlisle CMS");
  const [tab, setTab] = useState<Tab>("catalog");

  return (
    <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
      <PageHeader title="Production Workflows" subtitle="S4Carlisle workflow definitions & project tracking" />

      <div className="flex border-b border-border mt-6 mb-6">
        <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")} icon={<LayoutGrid className="w-4 h-4" />}>
          Definitions
        </TabButton>
        <TabButton active={tab === "tracking"} onClick={() => setTab("tracking")} icon={<ListChecks className="w-4 h-4" />}>
          Project Tracking
        </TabButton>
      </div>

      {tab === "catalog" ? <CatalogTab /> : <TrackingTab />}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`py-3 px-4 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
        active ? "border-primary text-primary" : "border-transparent text-muted hover:text-text"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// â”€â”€â”€ Catalog tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CatalogTab() {
  const [selectedId, setSelectedId] = useState<string>(WORKFLOW_DEFINITIONS[0]?.id ?? "");
  const selected = getWorkflowDefinition(selectedId) ?? WORKFLOW_DEFINITIONS[0];

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {WORKFLOW_DEFINITIONS.map((wf) => (
          <button
            key={wf.id}
            type="button"
            onClick={() => setSelectedId(wf.id)}
            className={`text-left bg-white rounded-lg shadow-card p-4 border-l-4 transition-all hover:shadow-hover ${
              wf.id === selected.id ? "border-primary ring-1 ring-gold-200" : "border-border"
            }`}
          >
            <div className="flex items-start justify-between">
              <span className="text-[10px] font-bold tracking-wider text-primary">{wf.id}</span>
              <span className="text-2xl font-bold text-muted">{wf.stages.length}</span>
            </div>
            <h3 className="text-sm font-semibold text-text mt-0.5">{wf.title}</h3>
            <p className="text-xs text-muted mt-0.5 leading-snug">{wf.short}</p>
          </button>
        ))}
      </div>

      {/* Selected workflow detail */}
      {selected && <WorkflowDetail workflow={selected} />}

      {/* Roles table */}
      <section className="bg-white rounded-lg shadow-card p-5 mt-6">
        <h2 className="text-sm font-semibold text-text mb-3">Roles & Responsibilities</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-muted text-xs uppercase tracking-wide">
                <th className="py-2 px-2 text-left font-semibold w-64">Role</th>
                <th className="py-2 px-2 text-left font-semibold">Responsibility</th>
              </tr>
            </thead>
            <tbody>
              {WORKFLOW_ROLES.map(([name, desc]) => (
                <tr key={name} className="border-b border-border align-top">
                  <td className="py-2 px-2 font-medium text-text">{name}</td>
                  <td className="py-2 px-2 text-text">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function WorkflowDetail({ workflow }: { workflow: WorkflowDefinition }) {
  const [stageIdx, setStageIdx] = useState(0);
  const stage = workflow.stages[Math.min(stageIdx, workflow.stages.length - 1)];

  return (
    <section className="bg-white rounded-lg shadow-card p-5">
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold text-text">
            {workflow.id} Â· {workflow.title}
          </h2>
        </div>
        <p className="text-sm text-muted mt-1 max-w-3xl">{workflow.desc}</p>
      </header>

      {/* Stage chain */}
      <div className="flex items-stretch gap-1 overflow-x-auto pb-3 mb-4">
        {workflow.stages.map((s, i) => {
          const st = STAGE_TYPE_STYLES[stageType(s.name)];
          const isSel = i === stageIdx;
          return (
            <div key={s.no} className="flex items-center shrink-0">
              <button
                type="button"
                onClick={() => setStageIdx(i)}
                className={`flex flex-col min-w-[88px] max-w-[120px] p-2 rounded-md border text-left transition-all ${st.chip} ${
                  isSel ? "ring-2 ring-gold-400 -translate-y-0.5 shadow-sm" : "hover:-translate-y-0.5"
                }`}
              >
                <span className="text-[10px] font-bold opacity-70">{s.no}</span>
                <span className="text-[11px] font-medium leading-tight text-text">{s.name}</span>
              </button>
              {i < workflow.stages.length - 1 && (
                <ChevronRight className="w-4 h-4 text-muted mx-0.5 shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Stage detail */}
      {stage && <StageDetail stage={stage} />}
    </section>
  );
}

function StageDetail({ stage }: { stage: WorkflowStage }) {
  const st = STAGE_TYPE_STYLES[stageType(stage.name)];
  return (
    <div className="border border-border rounded-lg p-4 bg-background">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl font-bold text-text">{stage.no}</span>
        <span className="text-sm font-semibold text-text">{stage.name}</span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${st.chip}`}>{st.label}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide mb-1.5">Activities</h4>
          <ul className="list-disc pl-4 space-y-1">
            {stage.acts.map((a) => (
              <li key={a} className="text-sm text-text leading-snug">{a}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide mb-1.5">Owner</h4>
          <span className="inline-block text-sm px-3 py-1.5 rounded-md bg-white border border-border text-text">
            {stage.owner}
          </span>
        </div>
        <div>
          <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide mb-1.5">Deliverable</h4>
          <span className="inline-block text-sm px-3 py-1.5 rounded-md bg-primary border border-primary text-primary">
            {stage.out}
          </span>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ Tracking tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TrackingTab() {
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data?.projects ?? [];

  const { assigned, unassigned } = useMemo(() => {
    const assigned: ProjectSummary[] = [];
    const unassigned: ProjectSummary[] = [];
    for (const p of projects) {
      (p.workflow_name ? assigned : unassigned).push(p);
    }
    return { assigned, unassigned };
  }, [projects]);

  if (projectsQuery.isPending) {
    return <p className="text-sm text-muted">Loading projectsâ€¦</p>;
  }
  if (projectsQuery.isError) {
    return (
      <div className="bg-white rounded-lg shadow-card p-8 text-center text-sm text-muted">
        Failed to load projects.{" "}
        <button className="text-primary underline" onClick={() => void projectsQuery.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {assigned.length === 0 && (
        <p className="text-sm text-muted">No projects have a workflow assigned yet.</p>
      )}
      {assigned.map((p) => (
        <ProjectTrackingCard key={p.id} project={p} />
      ))}

      {unassigned.length > 0 && (
        <section className="bg-white rounded-lg shadow-card p-5">
          <h2 className="text-sm font-semibold text-text mb-3">Unassigned projects</h2>
          <div className="space-y-2">
            {unassigned.map((p) => (
              <UnassignedRow key={p.id} project={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ProjectTrackingCard({ project }: { project: ProjectSummary }) {
  const definition = getWorkflowDefinition(project.workflow_name);

  if (!definition) {
    return (
      <div className="bg-white rounded-lg shadow-card p-4 text-sm text-muted">
        <span className="font-medium text-text">{project.code}</span> — unknown workflow{" "}
        <Badge variant="warning">{project.workflow_name}</Badge>
      </div>
    );
  }

  return (
    <section className="bg-white rounded-lg shadow-card p-5">
      <header className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div className="min-w-0">
          <Link to={uiPaths.projectDetail(project.id)} className="text-sm font-semibold text-text hover:text-primary">
            {project.code} · {project.title}
          </Link>
          <p className="text-xs text-muted mt-0.5">
            <Badge variant="default">{definition.id} — {definition.title}</Badge>
          </p>
        </div>
      </header>

      <div className="mt-3">
        <h4 className="text-[10px] font-bold text-muted uppercase tracking-wide mb-1.5">Workflow Stages</h4>
        <div className="flex flex-wrap gap-2">
          {definition.stages.map((s) => (
            <span key={s.no} className="text-xs px-2.5 py-1 bg-background border border-border rounded-md text-text">
              {s.no} · {s.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function UnassignedRow({ project }: { project: ProjectSummary }) {
  const mutation = useUpdateProjectWorkflow();
  const { addToast } = useToast();
  const [value, setValue] = useState("");

  function assign() {
    if (!value) return;
    mutation.mutate(
      { projectId: project.id, workflowName: value },
      {
        onSuccess: () => addToast({ title: `${project.code} assigned ${value}`, variant: "success" }),
        onError: () => addToast({ title: "Failed to assign workflow", variant: "error" }),
      },
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
      <span className="text-sm text-text truncate">
        {project.code} Â· {project.title}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 px-2 text-sm bg-white border border-border rounded-md text-text focus:outline-none focus:border-text"
        >
          <option value="">Select workflowâ€¦</option>
          {WORKFLOW_DEFINITIONS.map((wf) => (
            <option key={wf.id} value={wf.id}>
              {wf.id} Â· {wf.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={assign}
          disabled={!value || mutation.isPending}
          className="h-8 px-3 text-sm font-medium rounded-md bg-text/40 text-white hover:bg-text/15 disabled:opacity-40 transition-colors"
        >
          Assign
        </button>
      </div>
    </div>
  );
}
