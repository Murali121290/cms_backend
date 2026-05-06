import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { FileX, Loader2 } from "lucide-react";

import { SlideDrawer } from "@/components/ui/SlideDrawer";
import { UploadZone } from "@/components/ui/UploadZone";
import { useToast } from "@/components/ui/useToast";
import { createChapter, renameChapter } from "@/api/projects";
import { uploadChapterFiles } from "@/api/files";
import { getApiErrorMessage } from "@/api/client";
import type { ChapterSummary } from "@/types/api";

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  number: z.string().min(1, "Chapter number is required"),
  title: z.string().min(2, "Title must be at least 2 characters"),
});

type FormValues = z.infer<typeof schema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextChapterNumber(chapters: ChapterSummary[]): string {
  if (chapters.length === 0) return "1";
  const nums = chapters
    .map((c) => parseInt(c.number, 10))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return String(chapters.length + 1);
  return String(Math.max(...nums) + 1);
}

// ─── Shared field styles ──────────────────────────────────────────────────────

const labelClass =
  "block text-[11px] font-medium uppercase tracking-wide text-[#6B6560] mb-1.5";

const inputClass =
  "w-full border border-surface-400 rounded-md px-3 py-2.5 text-sm text-navy-900 " +
  "placeholder:text-navy-300 focus:outline-none focus:border-gold-600 focus:ring-1 " +
  "focus:ring-gold-600/30 transition-colors duration-100";

const errorClass = "mt-1 text-xs text-error-600";

// ─── Component ────────────────────────────────────────────────────────────────

export interface AddChapterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  projectName: string;
  existingChapters: ChapterSummary[];
  /** If provided the drawer is in edit mode. */
  editingChapter?: ChapterSummary | null;
}

export function AddChapterDrawer({
  isOpen,
  onClose,
  projectId,
  projectName,
  existingChapters,
  editingChapter = null,
}: AddChapterDrawerProps) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const isEditing = editingChapter !== null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { number: "", title: "" },
  });

  // Reset form whenever the drawer opens or editingChapter changes
  useEffect(() => {
    if (isOpen) {
      if (isEditing && editingChapter) {
        reset({ number: editingChapter.number, title: editingChapter.title });
      } else {
        reset({ number: nextChapterNumber(existingChapters), title: "" });
      }
      setSelectedFile(null);
      setSubmitError(null);
    }
  }, [isOpen, isEditing, editingChapter, existingChapters, reset]);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleFiles(files: File[]) {
    setSelectedFile(files[0] ?? null);
  }

  function removeFile() {
    setSelectedFile(null);
  }

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      let chapterId: number;

      if (isEditing && editingChapter) {
        const res = await renameChapter(projectId, editingChapter.id, {
          number: values.number,
          title: values.title,
        });
        chapterId = res.chapter.id;
      } else {
        const res = await createChapter(projectId, {
          number: values.number,
          title: values.title,
        });
        chapterId = res.chapter.id;
      }

      // Optional file upload (only available on create)
      if (!isEditing && selectedFile) {
        await uploadChapterFiles({
          projectId,
          chapterId,
          category: "Manuscript",
          files: [selectedFile],
        });
      }

      // Invalidate the chapters list so it refetches
      await queryClient.invalidateQueries({
        queryKey: ["project-chapters", projectId],
      });

      addToast({
        title: isEditing ? "Chapter updated" : "Chapter added successfully",
        variant: "success",
      });
      onClose();
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, "An unexpected error occurred."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SlideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit Chapter" : "Add Chapter"}
      description={
        isEditing
          ? `Editing chapter ${editingChapter?.number ?? ""}`
          : `Add a new chapter to ${projectName}`
      }
      width="md"
    >
      {/* The form + sticky footer live together in SlideDrawer's scrollable content */}
      <form
        id="add-chapter-form"
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
        className="flex flex-col gap-5"
      >
        {/* Chapter Number */}
        <div>
          <label htmlFor="chapter-number" className={labelClass}>
            Chapter Number
          </label>
          <input
            id="chapter-number"
            type="text"
            className={inputClass}
            placeholder="e.g. 1"
            {...register("number")}
          />
          {errors.number && (
            <p className={errorClass}>{errors.number.message}</p>
          )}
        </div>

        {/* Chapter Title */}
        <div>
          <label htmlFor="chapter-title" className={labelClass}>
            Chapter Title
          </label>
          <input
            id="chapter-title"
            type="text"
            className={inputClass}
            placeholder="e.g. Introduction to Data Science"
            {...register("title")}
          />
          {errors.title && (
            <p className={errorClass}>{errors.title.message}</p>
          )}
        </div>

        {/* File upload — only shown in create mode */}
        {!isEditing && (
          <div>
            <p className={labelClass}>Initial File (Optional)</p>
            {selectedFile ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 border border-surface-400 rounded-md bg-surface-50">
                <span className="text-sm text-navy-800 truncate min-w-0">
                  {selectedFile.name}
                </span>
                <button
                  type="button"
                  onClick={removeFile}
                  className="shrink-0 p-1 rounded hover:bg-surface-200 text-navy-400 hover:text-navy-700 transition-colors"
                  aria-label="Remove file"
                >
                  <FileX className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <UploadZone
                accept=".docx,.pdf,.xml"
                multiple={false}
                onFiles={handleFiles}
                label="Drop a file or click to browse"
                className="min-h-0"
              />
            )}
            <p className="mt-1.5 text-xs text-navy-400">
              DOCX, PDF, XML accepted. Chapter can be created without a file.
            </p>
          </div>
        )}
      </form>

      {/* Sticky footer — negative margins cancel SlideDrawer's px-6 py-5 padding */}
      <div className="sticky bottom-0 -mx-6 -mb-5 mt-6 px-6 py-4 bg-white border-t border-surface-200">
        {submitError && (
          <div className="mb-3 px-3 py-2.5 text-sm text-error-700 bg-error-50 border border-error-200 rounded-md">
            {submitError}
          </div>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 h-9 px-4 text-sm font-medium rounded-md border border-surface-400 text-navy-600 bg-white hover:bg-surface-100 disabled:opacity-50 transition-colors duration-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-chapter-form"
            disabled={isSubmitting}
            className="flex-1 h-9 px-4 text-sm font-medium rounded-md bg-[#C9821A] text-white hover:bg-[#B3711A] disabled:opacity-60 transition-colors duration-100 flex items-center justify-center gap-2"
          >
            {isSubmitting && (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            )}
            {isEditing ? "Save Changes" : "Create Chapter"}
          </button>
        </div>
      </div>
    </SlideDrawer>
  );
}
