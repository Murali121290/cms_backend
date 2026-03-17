import { Link } from "react-router-dom";

import type { FileRecord } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

type FileActionKind = "download" | "checkout" | "cancel_checkout" | "delete";

interface ChapterFilesTableProps {
  projectId: number;
  chapterId: number;
  files: FileRecord[];
  activeTab: string;
  isActionPending: (fileId: number, action: FileActionKind) => boolean;
  isProcessingPending: (fileId: number) => boolean;
  onDownload: (file: FileRecord) => void | Promise<void>;
  onCheckout: (file: FileRecord) => void | Promise<void>;
  onCancelCheckout: (file: FileRecord) => void | Promise<void>;
  onDelete: (file: FileRecord) => void | Promise<void>;
  onRunStructuring: (file: FileRecord) => void | Promise<void>;
}

function lockLabel(file: FileRecord) {
  if (!file.lock.is_checked_out) {
    return "Unlocked";
  }

  if (file.lock.checked_out_by_username) {
    return `Locked by ${file.lock.checked_out_by_username}`;
  }

  return "Locked";
}

export function ChapterFilesTable({
  projectId,
  chapterId,
  files,
  activeTab,
  isActionPending,
  isProcessingPending,
  onDownload,
  onCheckout,
  onCancelCheckout,
  onDelete,
  onRunStructuring,
}: ChapterFilesTableProps) {
  const orderedFiles = [...files].sort((left, right) => {
    if (left.category === activeTab && right.category !== activeTab) {
      return -1;
    }

    if (left.category !== activeTab && right.category === activeTab) {
      return 1;
    }

    const categoryCompare = left.category.localeCompare(right.category);
    if (categoryCompare !== 0) {
      return categoryCompare;
    }

    return left.filename.localeCompare(right.filename);
  });

  return (
    <div className="panel">
      <table className="list-table">
        <thead>
          <tr>
            <th>Filename</th>
            <th>Category</th>
            <th>Type</th>
            <th>Version</th>
            <th>Lock</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {orderedFiles.map((file) => (
            <tr key={file.id}>
              <td>{file.filename}</td>
              <td>
                <span className={`badge${file.category === activeTab ? " badge--active" : ""}`}>
                  {file.category}
                </span>
              </td>
              <td>{file.file_type}</td>
              <td>v{file.version}</td>
              <td>{lockLabel(file)}</td>
              <td>
                <div className="table-actions">
                  <button
                    className="button button--secondary button--small"
                    disabled={isActionPending(file.id, "download")}
                    type="button"
                    onClick={() => void onDownload(file)}
                  >
                    {isActionPending(file.id, "download") ? "Downloading..." : "Download"}
                  </button>
                  {file.available_actions.includes("checkout") ? (
                    <button
                      className="button button--secondary button--small"
                      disabled={isActionPending(file.id, "checkout")}
                      type="button"
                      onClick={() => void onCheckout(file)}
                    >
                      {isActionPending(file.id, "checkout") ? "Checking out..." : "Checkout"}
                    </button>
                  ) : null}
                  {file.available_actions.includes("cancel_checkout") ? (
                    <button
                      className="button button--secondary button--small"
                      disabled={isActionPending(file.id, "cancel_checkout")}
                      type="button"
                      onClick={() => void onCancelCheckout(file)}
                    >
                      {isActionPending(file.id, "cancel_checkout")
                        ? "Cancelling..."
                        : "Cancel checkout"}
                    </button>
                  ) : null}
                  <button
                    className="button button--secondary button--small"
                    disabled={isActionPending(file.id, "delete")}
                    type="button"
                    onClick={() => void onDelete(file)}
                  >
                    {isActionPending(file.id, "delete") ? "Deleting..." : "Delete"}
                  </button>
                  <button
                    className="button button--secondary button--small"
                    disabled={isProcessingPending(file.id)}
                    type="button"
                    onClick={() => void onRunStructuring(file)}
                  >
                    {isProcessingPending(file.id) ? "Structuring..." : "Run structuring"}
                  </button>
                  {file.available_actions.includes("technical_edit") ? (
                    <Link
                      className="button button--secondary button--small"
                      to={uiPaths.technicalReview(projectId, chapterId, file.id)}
                    >
                      Technical review
                    </Link>
                  ) : null}
                  <Link
                    className="button button--secondary button--small"
                    to={uiPaths.structuringReview(projectId, chapterId, file.id)}
                  >
                    Structuring review
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
