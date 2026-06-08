import { useState, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, FolderPlus } from "lucide-react";

import { getApiErrorMessage } from "@/api/client";
import { createProject } from "@/api/projects";
import { clientsApi, type Client } from "@/api/clients";
import { workflowsApi } from "@/api/workflows";
import { Button } from "@/components/ui/Button";
import { UploadZone } from "@/components/ui/UploadZone";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

/* ─── Zod schema ─────────────────────────────────────────────────────────── */

const schema = z.object({
  code: z.string().min(1, "Project code is required").max(64),
  title: z.string().min(1, "Project title is required").max(256),
  client_id: z.coerce.number().optional(),
  xml_standard: z.enum(["NLM / JATS", "BITS", "Custom"] as const, {
    error: "Select a valid XML standard",
  }),
  chapter_count: z.coerce
    .number({ error: "Enter a number" })
    .int()
    .min(1, "At least 1 chapter is required")
    .max(999),
  workflow_name: z.string().optional(),
  project_manager: z.string().max(128).optional(),
  priority: z.string().optional(),
  category: z.string().max(128).optional(),
  composition: z.string().max(128).optional(),
  edition: z.string().max(64).optional(),
  color: z.string().max(64).optional(),
  trim_size: z.string().max(64).optional(),
  copyright_year: z.coerce.number().int().min(1900).max(2099).optional().or(z.literal("")),
  manuscript_pages: z.coerce.number().int().min(0).optional().or(z.literal("")),
  estimated_pages: z.coerce.number().int().min(0).optional().or(z.literal("")),
  isbn_no: z.string().max(64).optional(),
  billing_location: z.string().max(128).optional(),
  due_date: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

/* ─── Style constants ─────────────────────────────────────────────────────── */

const labelClass =
  "block text-[11px] font-medium uppercase tracking-wide text-muted mb-1.5";

const inputClass =
  "w-full border border-border rounded-md px-3 py-2.5 text-sm text-text " +
  "placeholder:text-muted focus:outline-none focus:border-primary focus:ring-1 " +
  "focus:ring-gold-600/20 disabled:opacity-50 disabled:bg-background transition-colors";

const sectionHeadingClass =
  "text-base font-semibold text-text border-b border-border pb-3 mb-5";

const fieldErrorClass = "text-xs text-danger mt-1";

const requiredAsterisk = <span className="text-primary ml-0.5">*</span>;

/* ─── Page ─────────────────────────────────────────────────────────────────── */

export function ProjectCreatePage() {
  useDocumentTitle("Create New Project – S4 Carlisle CMS");

  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [workflowNames, setWorkflowNames] = useState<string[]>([]);

  useEffect(() => {
    clientsApi.list().then(setClients).catch(() => undefined);
    workflowsApi.listNames().then(setWorkflowNames).catch(() => undefined);
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof schema>, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: "",
      title: "",
      client_id: undefined,
      xml_standard: "NLM / JATS",
      chapter_count: 1,
      workflow_name: "",
      project_manager: "",
      priority: "",
      category: "",
      composition: "",
      edition: "",
      color: "",
      trim_size: "",
      copyright_year: "",
      manuscript_pages: "",
      estimated_pages: "",
      isbn_no: "",
      billing_location: "",
      due_date: "",
    },
  });

  const handleFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !names.has(f.name))];
    });
  }, []);

  async function onValid(values: FormValues) {
    setServerError(null);
    const fd = new FormData();
    fd.append("code", values.code.trim());
    fd.append("title", values.title.trim());
    fd.append("xml_standard", values.xml_standard);
    fd.append("chapter_count", String(values.chapter_count));
    if (values.client_id) fd.append("client_id", String(values.client_id));
    if (values.workflow_name) fd.append("workflow_name", values.workflow_name);
    if (values.project_manager?.trim()) fd.append("project_manager", values.project_manager.trim());
    if (values.priority) fd.append("priority", values.priority);
    if (values.category?.trim()) fd.append("category", values.category.trim());
    if (values.composition?.trim()) fd.append("composition", values.composition.trim());
    if (values.edition?.trim()) fd.append("edition", values.edition.trim());
    if (values.color?.trim()) fd.append("color", values.color.trim());
    if (values.trim_size?.trim()) fd.append("trim_size", values.trim_size.trim());
    if (values.copyright_year) fd.append("copyright_year", String(values.copyright_year));
    if (values.manuscript_pages) fd.append("manuscript_pages", String(values.manuscript_pages));
    if (values.estimated_pages) fd.append("estimated_pages", String(values.estimated_pages));
    if (values.isbn_no?.trim()) fd.append("isbn_no", values.isbn_no.trim());
    if (values.billing_location?.trim()) fd.append("billing_location", values.billing_location.trim());
    if (values.due_date) fd.append("due_date", values.due_date);
    files.forEach((f) => fd.append("files", f));

    try {
      const result = await createProject(fd);
      navigate(uiPaths.projectDetail(result.project.id));
    } catch (err) {
      setServerError(getApiErrorMessage(err, "Failed to create the project. Please try again."));
    }
  }

  return (
    <main className="page-enter px-6 py-8 max-w-4xl mx-auto w-full">
      {/* Page title row */}
      <div className="mb-6">
        <Link
          to={uiPaths.projects}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to Projects
        </Link>
        <h1 className="text-2xl font-semibold text-text">Create New Project</h1>
        <p className="text-sm text-muted mt-1">Start a new book or project</p>
      </div>

      {/* Server error */}
      {serverError ? (
        <div
          role="alert"
          className="mb-6 px-4 py-3 bg-danger/10 border border-danger/30 text-danger text-sm rounded-md"
        >
          {serverError}
        </div>
      ) : null}

      <form
        onSubmit={(e) => void handleSubmit(onValid)(e)}
        noValidate
        className="bg-white border border-border rounded-lg p-8 shadow-sm space-y-8"
      >
        {/* ── Section 1: Project Details ──────────────────────────────── */}
        <section aria-labelledby="section-details">
          <h2 id="section-details" className={sectionHeadingClass}>
            Project Details
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Project Code */}
            <div>
              <label htmlFor="code" className={labelClass}>
                Project Code {requiredAsterisk}
              </label>
              <input
                id="code"
                {...register("code")}
                type="text"
                className={inputClass}
                placeholder="e.g. PUB-2024-001"
                disabled={isSubmitting}
                autoComplete="off"
                aria-describedby={errors.code ? "code-error" : "code-hint"}
              />
              <p id="code-hint" className="text-xs text-muted mt-1">
                Unique identifier for the project
              </p>
              {errors.code ? (
                <p id="code-error" className={fieldErrorClass} role="alert">
                  {errors.code.message}
                </p>
              ) : null}
            </div>

            {/* Project Title */}
            <div>
              <label htmlFor="title" className={labelClass}>
                Project Title {requiredAsterisk}
              </label>
              <input
                id="title"
                {...register("title")}
                type="text"
                className={inputClass}
                placeholder="e.g. Advanced Data Science"
                disabled={isSubmitting}
                autoComplete="off"
              />
              {errors.title ? (
                <p className={fieldErrorClass} role="alert">
                  {errors.title.message}
                </p>
              ) : null}
            </div>

            {/* Client */}
            <div>
              <label htmlFor="client_id" className={labelClass}>
                Client
              </label>
              <select
                id="client_id"
                {...register("client_id")}
                className={inputClass}
                disabled={isSubmitting}
              >
                <option value="">— Select client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company || `${c.first_name ?? ""} ${c.surname ?? ""}`.trim()}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label htmlFor="priority" className={labelClass}>
                Priority
              </label>
              <select
                id="priority"
                {...register("priority")}
                className={inputClass}
                disabled={isSubmitting}
              >
                <option value="">— Select —</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>

            {/* Category */}
            <div>
              <label htmlFor="category" className={labelClass}>
                Category
              </label>
              <input
                id="category"
                {...register("category")}
                type="text"
                className={inputClass}
                placeholder="e.g. Textbook"
                disabled={isSubmitting}
              />
            </div>

            {/* Composition */}
            <div>
              <label htmlFor="composition" className={labelClass}>
                Composition
              </label>
              <input
                id="composition"
                {...register("composition")}
                type="text"
                className={inputClass}
                placeholder="e.g. Author"
                disabled={isSubmitting}
              />
            </div>

            {/* Project Manager */}
            <div>
              <label htmlFor="project_manager" className={labelClass}>
                Project Manager
              </label>
              <input
                id="project_manager"
                {...register("project_manager")}
                type="text"
                className={inputClass}
                placeholder="Username"
                disabled={isSubmitting}
              />
            </div>

            {/* Due Date */}
            <div>
              <label htmlFor="due_date" className={labelClass}>
                Due Date
              </label>
              <input
                id="due_date"
                {...register("due_date")}
                type="date"
                className={inputClass}
                disabled={isSubmitting}
              />
            </div>
          </div>
        </section>

        {/* ── Section 2: Publishing Details ──────────────────────────── */}
        <section aria-labelledby="section-publishing">
          <h2 id="section-publishing" className={sectionHeadingClass}>
            Publishing Details
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div>
              <label htmlFor="edition" className={labelClass}>Edition</label>
              <input id="edition" {...register("edition")} type="text" className={inputClass} placeholder="e.g. 3rd" disabled={isSubmitting} />
            </div>

            <div>
              <label htmlFor="color" className={labelClass}>Color</label>
              <input id="color" {...register("color")} type="text" className={inputClass} placeholder="e.g. 4C" disabled={isSubmitting} />
            </div>

            <div>
              <label htmlFor="trim_size" className={labelClass}>Trim Size</label>
              <input id="trim_size" {...register("trim_size")} type="text" className={inputClass} placeholder='e.g. 8.5"×11"' disabled={isSubmitting} />
            </div>

            <div>
              <label htmlFor="copyright_year" className={labelClass}>Copyright Year</label>
              <input id="copyright_year" {...register("copyright_year")} type="number" min={1900} max={2099} className={inputClass} placeholder="2024" disabled={isSubmitting} />
            </div>

            <div>
              <label htmlFor="manuscript_pages" className={labelClass}>Manuscript Pages</label>
              <input id="manuscript_pages" {...register("manuscript_pages")} type="number" min={0} className={inputClass} disabled={isSubmitting} />
            </div>

            <div>
              <label htmlFor="estimated_pages" className={labelClass}>Estimated Pages</label>
              <input id="estimated_pages" {...register("estimated_pages")} type="number" min={0} className={inputClass} disabled={isSubmitting} />
            </div>

            <div>
              <label htmlFor="isbn_no" className={labelClass}>ISBN</label>
              <input id="isbn_no" {...register("isbn_no")} type="text" className={inputClass} placeholder="978-0-000-00000-0" disabled={isSubmitting} />
            </div>

            <div>
              <label htmlFor="billing_location" className={labelClass}>Billing Location</label>
              <input id="billing_location" {...register("billing_location")} type="text" className={inputClass} disabled={isSubmitting} />
            </div>
          </div>
        </section>

        {/* ── Section 3: Configuration ──────────────────────────────── */}
        <section aria-labelledby="section-config">
          <h2 id="section-config" className={sectionHeadingClass}>
            Configuration
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* XML Standard */}
            <div>
              <label htmlFor="xml_standard" className={labelClass}>
                XML Standard {requiredAsterisk}
              </label>
              <select
                id="xml_standard"
                {...register("xml_standard")}
                className={inputClass}
                disabled={isSubmitting}
              >
                <option value="NLM / JATS">NLM / JATS</option>
                <option value="BITS">BITS</option>
                <option value="Custom">Custom</option>
              </select>
              {errors.xml_standard ? (
                <p className={fieldErrorClass} role="alert">
                  {errors.xml_standard.message}
                </p>
              ) : null}
            </div>

            {/* Number of Chapters */}
            <div>
              <label htmlFor="chapter_count" className={labelClass}>
                Number of Chapters {requiredAsterisk}
              </label>
              <input
                id="chapter_count"
                {...register("chapter_count")}
                type="number"
                min={1}
                className={inputClass}
                disabled={isSubmitting}
              />
              {errors.chapter_count ? (
                <p className={fieldErrorClass} role="alert">
                  {errors.chapter_count.message}
                </p>
              ) : null}
            </div>

            {/* Production Workflow */}
            <div className="sm:col-span-2">
              <label htmlFor="workflow_name" className={labelClass}>
                Production Workflow
              </label>
              <select
                id="workflow_name"
                {...register("workflow_name")}
                className={inputClass}
                disabled={isSubmitting}
              >
                <option value="">None (assign later)</option>
                {workflowNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted mt-1">
                Determines the production stage track for this project.
              </p>
            </div>
          </div>
        </section>

        {/* ── Section 4: Initial Files ──────────────────────────────── */}
        <section aria-labelledby="section-files">
          <h2 id="section-files" className={sectionHeadingClass}>
            Initial Files
            <span className="ml-2 text-xs font-normal text-muted normal-case tracking-normal">
              Optional
            </span>
          </h2>

          <UploadZone
            accept=".pdf,.docx,.doc,.xml,.png,.jpg,.jpeg,.tiff,.tif"
            multiple
            maxSizeMb={50}
            label="Click to upload files"
            onFiles={handleFiles}
            isUploading={isSubmitting}
          />

          {/* Staged file list */}
          {files.length > 0 ? (
            <ul className="mt-3 space-y-1.5" aria-label="Files to upload">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between text-xs text-text bg-background rounded px-3 py-1.5"
                >
                  <span className="truncate max-w-[80%]">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    className="text-muted hover:text-danger transition-colors ml-2 shrink-0"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* ── Form actions ────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
          <Button
            variant="ghost"
            type="button"
            disabled={isSubmitting}
            onClick={() => navigate(uiPaths.projects)}
          >
            Back to Projects
          </Button>
          <Button
            variant="primary"
            type="submit"
            isLoading={isSubmitting}
            disabled={isSubmitting}
            leftIcon={<FolderPlus />}
          >
            Create Project
          </Button>
        </div>
      </form>
    </main>
  );
}
