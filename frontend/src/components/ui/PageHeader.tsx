import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode[];
  breadcrumb?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  badge,
  primaryAction,
  secondaryActions,
  breadcrumb,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex items-start justify-between gap-4", className)}>
      {/* Left side: breadcrumb + title + subtitle */}
      <div className="min-w-0 flex-1">
        {breadcrumb && (
          <div className="mb-1.5 text-sm text-navy-400">{breadcrumb}</div>
        )}

        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="font-serif text-2xl font-semibold text-navy-900 leading-tight truncate">
            {title}
          </h1>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>

        {subtitle && (
          <p className="mt-1 text-sm text-navy-400 leading-snug">{subtitle}</p>
        )}
      </div>

      {/* Right side: actions */}
      {(primaryAction || (secondaryActions && secondaryActions.length > 0)) && (
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          {secondaryActions?.map((action, i) => (
            <div key={i}>{action}</div>
          ))}
          {primaryAction && <div>{primaryAction}</div>}
        </div>
      )}
    </header>
  );
}
