import { cn } from "@/utils/cn";

/* ─────────────────────────────────────────────────────────────
   Skeleton — single rectangular block
   ───────────────────────────────────────────────────────────── */
interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export function Skeleton({ width, height, className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton-shimmer rounded-sm", className)}
      style={{
        width: width ?? "100%",
        height: height ?? "1rem",
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────
   SkeletonText — multiple text lines
   ───────────────────────────────────────────────────────────── */
interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="0.875rem"
          width={i === lines - 1 && lines > 1 ? "60%" : "100%"}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SkeletonCard — card-shaped skeleton
   ───────────────────────────────────────────────────────────── */
interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "bg-white rounded-md border border-surface-400 p-5 space-y-4",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton width="2.5rem" height="2.5rem" className="rounded-md shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton height="0.875rem" width="50%" />
          <Skeleton height="0.75rem" width="30%" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SkeletonTable — table row skeletons
   ───────────────────────────────────────────────────────────── */
interface SkeletonTableProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: SkeletonTableProps) {
  return (
    <div aria-hidden="true" className={cn("w-full", className)}>
      {/* Header row */}
      <div
        className="grid gap-4 px-4 py-3 border-b border-surface-400"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} height="0.75rem" width="60%" />
        ))}
      </div>

      {/* Data rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="grid gap-4 px-4 py-3.5 border-b border-surface-300"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              height="0.875rem"
              width={colIdx === 0 ? "80%" : "55%"}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
