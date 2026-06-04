import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, Pencil } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/SearchInput";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/useToast";
import { downloadFile } from "@/api/files";
import { getApiErrorMessage } from "@/api/client";
import { useFilesQuery } from "@/features/files/useFilesQuery";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { uiPaths } from "@/utils/appPaths";
import type { FileListItem } from "@/types/api";

const CATEGORIES = ["Manuscript", "Art", "InDesign", "Proof", "XML", "Miscellaneous"];
const PAGE_SIZE = 50;

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function FilesPage() {
  useDocumentTitle("Files — S4 Carlisle CMS");
  const { addToast } = useToast();

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [offset, setOffset] = useState(0);

  const query = useFilesQuery({ q: q || undefined, category: category || undefined, offset, limit: PAGE_SIZE });
  const files = query.data?.files ?? [];
  const total = query.data?.pagination.total ?? 0;

  function resetAndSet<T>(setter: (v: T) => void) {
    return (value: T) => {
      setOffset(0);
      setter(value);
    };
  }

  async function handleDownload(file: FileListItem) {
    try {
      const { blob, filename } = await downloadFile(file.id, file.filename);
      triggerBrowserDownload(blob, filename);
    } catch (error) {
      addToast({ title: getApiErrorMessage(error, "Failed to download file"), variant: "error" });
    }
  }

  const columns: Column<FileListItem>[] = [
    {
      key: "filename",
      header: "File",
      render: (f) => <span className="font-medium text-navy-900">{f.filename}</span>,
    },
    {
      key: "category",
      header: "Category",
      render: (f) => <Badge variant="outline">{f.category}</Badge>,
    },
    {
      key: "project",
      header: "Project",
      render: (f) => (
        <span className="text-navy-600">
          {f.project_code ? `${f.project_code}` : "—"}
          {f.project_title ? <span className="text-navy-400"> · {f.project_title}</span> : null}
        </span>
      ),
    },
    {
      key: "chapter",
      header: "Chapter",
      render: (f) =>
        f.chapter_number ? (
          <span className="text-navy-600">
            Ch {f.chapter_number}
            {f.chapter_title ? <span className="text-navy-400"> · {f.chapter_title}</span> : null}
          </span>
        ) : (
          <span className="text-navy-400">—</span>
        ),
    },
    {
      key: "version",
      header: "Ver",
      align: "right",
      render: (f) => <span className="tabular-nums text-navy-600">v{f.version}</span>,
    },
    {
      key: "uploaded_at",
      header: "Uploaded",
      render: (f) => (
        <span className="text-navy-500 text-xs">
          {new Date(f.uploaded_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
        </span>
      ),
    },
    {
      key: "lock",
      header: "Status",
      render: (f) =>
        f.lock.is_checked_out ? (
          <Badge variant="warning">Locked{f.lock.checked_out_by_username ? ` · ${f.lock.checked_out_by_username}` : ""}</Badge>
        ) : (
          <Badge variant="success">Available</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (f) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => void handleDownload(f)}
            title="Download"
            className="p-1.5 text-navy-500 hover:text-navy-900 hover:bg-surface-200 rounded-md transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          {f.chapter_id !== null && (
            <Link
              to={uiPaths.docxEditor(f.project_id, f.chapter_id, f.id)}
              title="Edit (formatting-preserving)"
              className="p-1.5 text-navy-500 hover:text-navy-900 hover:bg-surface-200 rounded-md transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </Link>
          )}
        </div>
      ),
    },
  ];

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="page-enter page px-6 py-6 max-w-7xl mx-auto">
      <PageHeader title="Files" subtitle={`${total} files across all projects`} />

      <div className="flex flex-wrap items-center gap-3 mt-6 mb-4">
        <SearchInput
          value={q}
          onChange={resetAndSet(setQ)}
          placeholder="Search filenames…"
          className="w-72"
        />
        <select
          value={category}
          onChange={(e) => resetAndSet(setCategory)(e.target.value)}
          className="h-9 px-3 text-sm bg-white border border-surface-400 rounded-md text-navy-900 focus:outline-none focus:border-navy-900"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg shadow-card overflow-hidden">
        {query.isError ? (
          <div className="p-8 text-center text-sm text-navy-500">
            Failed to load files.{" "}
            <button className="text-gold-700 underline" onClick={() => void query.refetch()}>
              Retry
            </button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={files}
            keyExtractor={(f) => f.id}
            isLoading={query.isPending}
          />
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-navy-500">
          <span>
            Page {page} of {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="h-9 px-3 rounded-md border border-surface-400 bg-white text-navy-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-100 transition-colors"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="h-9 px-3 rounded-md border border-surface-400 bg-white text-navy-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-100 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
