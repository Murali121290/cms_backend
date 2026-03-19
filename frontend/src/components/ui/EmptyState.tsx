import type { ReactNode, ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/utils/cn";

type EmptyStateSize = "sm" | "md";

interface EmptyStateProps {
  icon?: ComponentType<LucideProps>;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: EmptyStateSize;
  className?: string;
}

const sizeConfig: Record<
  EmptyStateSize,
  { iconSize: string; iconWrapper: string; title: string; desc: string; gap: string }
> = {
  sm: {
    iconSize: "size-8",
    iconWrapper: "size-12 rounded-md",
    title: "text-base",
    desc: "text-xs",
    gap: "gap-3 py-8",
  },
  md: {
    iconSize: "size-10",
    iconWrapper: "size-16 rounded-lg",
    title: "text-lg",
    desc: "text-sm",
    gap: "gap-4 py-14",
  },
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "md",
  className,
}: EmptyStateProps) {
  const config = sizeConfig[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        config.gap,
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex items-center justify-center bg-surface-200",
            config.iconWrapper
          )}
        >
          <Icon
            className={cn(config.iconSize, "text-navy-300")}
            aria-hidden="true"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <h3
          className={cn(
            "font-serif font-semibold text-navy-900",
            config.title
          )}
        >
          {title}
        </h3>
        {description && (
          <p className={cn("text-navy-400 leading-relaxed max-w-xs", config.desc)}>
            {description}
          </p>
        )}
      </div>

      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
