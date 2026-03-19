import type { ReactNode } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { SkeletonTable } from "./SkeletonLoader";
import { EmptyState } from "./EmptyState";
import { cn } from "@/utils/cn";

/* ─────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────── */
export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T, index: number) => ReactNode;
  sortable?: boolean;
  width?: string;
  align?: "left" | "center" | "right";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  isLoading?: boolean;
  emptyState?: ReactNode;
  onSort?: (key: string, dir: "asc" | "desc") => void;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  className?: string;
}

const alignClasses: Record<"left" | "center" | "right", string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/* ─────────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────────── */
export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  emptyState,
  onSort,
  sortKey,
  sortDir,
  className,
}: DataTableProps<T>) {
  function handleSort(col: Column<T>) {
    if (!col.sortable || !onSort) return;

    const nextDir: "asc" | "desc" =
      sortKey === col.key && sortDir === "asc" ? "desc" : "asc";
    onSort(col.key, nextDir);
  }

  function getAriaSortValue(
    col: Column<T>
  ): "ascending" | "descending" | "none" | undefined {
    if (!col.sortable) return undefined;
    if (sortKey !== col.key) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  }

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      {isLoading ? (
        <SkeletonTable rows={5} cols={columns.length} />
      ) : (
        <table
          role="table"
          className="w-full border-collapse text-sm text-navy-900"
        >
          <thead>
            <tr className="sticky top-0 bg-white z-[10] border-b border-surface-400">
              {columns.map((col) => {
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={getAriaSortValue(col)}
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      "px-4 py-3 font-semibold text-xs text-navy-400 uppercase tracking-wide",
                      "bg-surface-100",
                      col.align ? alignClasses[col.align] : "text-left",
                      col.sortable &&
                        "cursor-pointer select-none hover:text-navy-900 hover:bg-surface-200 transition-colors duration-100"
                    )}
                    onClick={col.sortable ? () => handleSort(col) : undefined}
                    onKeyDown={
                      col.sortable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSort(col);
                            }
                          }
                        : undefined
                    }
                    tabIndex={col.sortable ? 0 : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {col.sortable && (
                        <span className="shrink-0" aria-hidden="true">
                          {isSorted ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="size-3" />
                            ) : (
                              <ArrowDown className="size-3" />
                            )
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-2">
                  {emptyState ?? (
                    <EmptyState
                      title="No results found"
                      description="There are no items to display."
                      size="sm"
                    />
                  )}
                </td>
              </tr>
            ) : (
              data.map((row, rowIndex) => (
                <tr
                  key={keyExtractor(row)}
                  className="border-b border-surface-300 hover:bg-surface-100 transition-colors duration-100"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 text-sm",
                        col.align ? alignClasses[col.align] : "text-left"
                      )}
                    >
                      {col.render
                        ? col.render(row, rowIndex)
                        : String((row as Record<string, unknown>)[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
