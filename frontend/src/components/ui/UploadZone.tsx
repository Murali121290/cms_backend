import {
  useRef,
  useState,
  useCallback,
  type DragEvent,
  type ChangeEvent,
} from "react";
import { Upload, AlertCircle } from "lucide-react";
import { ProgressBar } from "./ProgressBar";
import { cn } from "@/utils/cn";

interface UploadZoneProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  isUploading?: boolean;
  uploadProgress?: number;
  maxSizeMb?: number;
  label?: string;
  className?: string;
}

function parseAcceptedExtensions(accept: string): string[] {
  return accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function validateFiles(
  files: File[],
  accept?: string,
  maxSizeMb?: number
): { valid: File[]; errors: string[] } {
  const valid: File[] = [];
  const errors: string[] = [];
  const extensions = accept ? parseAcceptedExtensions(accept) : null;
  const maxBytes = maxSizeMb ? maxSizeMb * 1024 * 1024 : null;

  for (const file of files) {
    const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;

    if (extensions && !extensions.includes(ext)) {
      errors.push(`"${file.name}" has an unsupported file type.`);
      continue;
    }

    if (maxBytes && file.size > maxBytes) {
      errors.push(`"${file.name}" exceeds the ${maxSizeMb} MB limit.`);
      continue;
    }

    valid.push(file);
  }

  return { valid, errors };
}

export function UploadZone({
  accept,
  multiple = false,
  onFiles,
  isUploading = false,
  uploadProgress,
  maxSizeMb,
  label,
  className,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const processFiles = useCallback(
    (rawFiles: File[]) => {
      setValidationErrors([]);
      const { valid, errors } = validateFiles(rawFiles, accept, maxSizeMb);
      if (errors.length > 0) setValidationErrors(errors);
      if (valid.length > 0) onFiles(valid);
    },
    [accept, maxSizeMb, onFiles]
  );

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      processFiles(multiple ? files : [files[0]]);
    }
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) processFiles(files);
    // Reset so re-selecting the same file fires onChange again
    e.target.value = "";
  }

  function handleClick() {
    if (!isUploading) inputRef.current?.click();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!isUploading && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  const descParts: string[] = [];
  if (accept) descParts.push(accept.replace(/,/g, ", "));
  if (maxSizeMb) descParts.push(`Max ${maxSizeMb} MB`);

  return (
    <div className={cn("w-full space-y-2", className)}>
      <div
        role="button"
        tabIndex={isUploading ? -1 : 0}
        aria-label={label ?? "Upload files"}
        aria-disabled={isUploading}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3",
          "w-full min-h-[9rem] p-6 rounded-md border-2 border-dashed",
          "transition-all duration-150",
          isDragging
            ? "border-navy-500 bg-navy-50 scale-[1.01]"
            : "border-surface-400 bg-surface-100 hover:border-navy-300 hover:bg-white",
          isUploading ? "cursor-default opacity-70" : "cursor-pointer"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleInputChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        <div
          className={cn(
            "flex items-center justify-center size-12 rounded-md",
            isDragging ? "bg-navy-100" : "bg-surface-200"
          )}
        >
          <Upload
            className={cn(
              "size-6",
              isDragging ? "text-navy-600" : "text-navy-400"
            )}
            aria-hidden="true"
          />
        </div>

        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-navy-900">
            {isDragging ? "Drop files here" : label ?? "Drag & drop files here"}
          </p>
          <p className="text-xs text-navy-400">
            or{" "}
            <span className="text-gold-600 font-medium underline underline-offset-2">
              browse to upload
            </span>
          </p>
          {descParts.length > 0 && (
            <p className="text-xs text-navy-300 mt-1">{descParts.join(" · ")}</p>
          )}
        </div>

        {isUploading && (
          <div className="w-full max-w-xs">
            <ProgressBar
              value={uploadProgress}
              size="sm"
              color="gold"
            />
          </div>
        )}
      </div>

      {validationErrors.length > 0 && (
        <ul className="space-y-1" role="alert" aria-label="Upload errors">
          {validationErrors.map((err, i) => (
            <li
              key={i}
              className="flex items-start gap-1.5 text-xs text-error-600"
            >
              <AlertCircle
                className="size-3.5 shrink-0 mt-px"
                aria-hidden="true"
              />
              <span>{err}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
