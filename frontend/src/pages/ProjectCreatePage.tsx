import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, FolderPlus } from "lucide-react";

import { getApiErrorMessage } from "@/api/client";
import { createProject } from "@/api/projects";
import { Button } from "@/components/ui/Button";
import { UploadZone } from "@/components/ui/UploadZone";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";

/* ─── Zod schema ───────────────────────────────────────────────────────────── */

const schema = z.object({
  code: z.string().min(1, "Project code is required").max(64),
  title: z.string().min(1, "Project title is required").max(256),
  client_name: z.string().max(128).optional(),
  xml_standard: z.enum(["NLM / JATS", "BITS", "Custom"] as const, {
    error: "Select a valid XML standard",
  }),
  chapter_count: z.coerce
    .number({ error: "Enter a number" })
    .int()
    .min(1, "At least 1 chapter is required")
    .max(999),
});

type FormValues = z.infer<typeof schema>;

/* ─── Style constants ─────────────────────────────────────────────────────── */

const labelClass =
  "block text-[11px] font-medium uppercase tracking-wide text-navy-500 mb-1.5";

const inputClass =
  "w-full border border-surface-400 rounded-md px-3 py-2.5 text-sm text-navy-900 " +
  "placeholder:text-navy-300 focus:outline-none focus:border-gold-600 focus:ring-1 " +
  "focus:ring-gold-600/20 disabled:opacity-50 disabled:bg-surface-100 transition-colors";

const sectionHeadingClass =
  "text-base font-semibold text-navy-900 border-b border-surface-200 pb-3 mb-5";

const fieldErrorClass = "text-xs text-error-600 mt-1";

const requiredAsterisk = <span className="text-gold-600 ml-0.5">*</span>;

/* ─── Page ─────────────────────────────────────────────────────────────────── */

export function ProjectCreatePage() {
  useDocumentTitle("Create New Project — S4 Carlisle CMS");

  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof schema>, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: "",
      title: "",
      client_name: "",
      xml_standard: "NLM / JATS",
      chapter_count: 1,
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
    if (values.client_name?.trim()) fd.append("client_name", values.client_name.trim());
    fd.append("xml_standard", values.xml_standard);
    fd.append("chapter_count", String(values.chapter_count));
    files.forEach((f) => fd.append("files", f));

    try {
      const result = await createProject(fd);
      navigate(uiPaths.projectDetail(result.project.id));
    } catch (err) {
      setServerError(getApiErrorMessage(err, "Failed to create the project. Please try again."));
    }
  }

  return (
    <main className="page-enter px-6 py-8 max-w-3xl mx-auto w-full">
      {/* Page title row */}
      <div className="mb-6">
        <Link
          to={uiPaths.projects}
          className="inline-flex items-center gap-1.5 text-sm text-navy-500 hover:text-navy-900 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to Projects
        </Link>
        <h1 className="text-2xl font-semibold text-navy-900">Create New Project</h1>
        <p className="text-sm text-navy-500 mt-1">Start a new book or project</p>
      </div>

      {/* Server error */}
      {serverError ? (
        <div
          role="alert"
          className="mb-6 px-4 py-3 bg-error-100 border border-error-200 text-error-700 text-sm rounded-md"
        >
          {serverError}
        </div>
      ) : null}

      <form
        onSubmit={(e) => void handleSubmit(onValid)(e)}
        noValidate
        className="bg-white border border-surface-200 rounded-lg p-8 shadow-sm space-y-8"
      >
        {/* ── Section 1: Project Details ─────────────────────────── */}
        <section aria-labelledby="section-details">
          <h2 id="section-details" className={sectionHeadingClass}>
            Project Details
          </h2>

          <div className="space-y-5">
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
              <p id="code-hint" className="text-xs text-navy-400 mt-1">
                Unique identifier for the project
              </p>
              {errors.code ? (
                <p id="code-error" className={fieldErrorClass} role="alert">
                  {errors.code.message}
                </p>
              ) : null}
            </div>

            {/* Client Name */}
            <div>
              <label htmlFor="client_name" className={labelClass}>
                Client Name
              </label>
              <input
                id="client_name"
                {...register("client_name")}
                type="text"
                className={inputClass}
                placeholder="e.g. Oxford University Press"
                disabled={isSubmitting}
                autoComplete="organization"
              />
              {errors.client_name ? (
                <p className={fieldErrorClass} role="alert">
                  {errors.client_name.message}
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
          </div>
        </section>

        {/* ── Section 2: Configuration ───────────────────────────── */}
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
          </div>
        </section>

        {/* ── Section 3: Initial Files ───────────────────────────── */}
        <section aria-labelledby="section-files">
          <h2 id="section-files" className={sectionHeadingClass}>
            Initial Files
            <span className="ml-2 text-xs font-normal text-navy-400 normal-case tracking-normal">
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
                  className="flex items-center justify-between text-xs text-navy-700 bg-surface-100 rounded px-3 py-1.5"
                >
                  <span className="truncate max-w-[80%]">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    className="text-navy-400 hover:text-error-600 transition-colors ml-2 shrink-0"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* ── Form actions ──────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-200">
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
