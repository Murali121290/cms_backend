import { cn } from "@/utils/cn";
import { Badge } from "./Badge";
import type { ComponentProps } from "react";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

type StatusSize = "sm" | "md";

interface StatusBadgeProps {
  status: string;
  size?: StatusSize;
  className?: string;
}

interface StatusConfig {
  variant: BadgeVariant;
  label: string;
  pulse: boolean;
}

function getStatusConfig(status: string): StatusConfig {
  const normalized = status.toLowerCase().trim();

  switch (normalized) {
    case "processing":
    case "queued":
      return { variant: "info", label: capitalize(normalized), pulse: true };

    case "completed":
    case "active":
    case "published":
    case "ready":
      return { variant: "success", label: capitalize(normalized), pulse: false };

    case "failed":
    case "error":
      return { variant: "error", label: capitalize(normalized), pulse: false };

    case "draft":
      return { variant: "warning", label: "Draft", pulse: false };

    case "archived":
      return { variant: "outline", label: "Archived", pulse: false };

    default:
      return { variant: "default", label: capitalize(normalized), pulse: false };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const pulseDotVariantClasses: Record<NonNullable<BadgeVariant>, string> = {
  default: "bg-navy-400",
  success: "bg-success-600",
  warning: "bg-warning-600",
  error: "bg-error-600",
  info: "bg-info-600",
  navy: "bg-white",
  outline: "bg-navy-400",
};

export function StatusBadge({ status, size = "md", className }: StatusBadgeProps) {
  const config = getStatusConfig(status);

  return (
    <Badge variant={config.variant} size={size} className={cn("gap-1.5", className)}>
      {config.pulse ? (
        <span className="relative flex size-1.5 shrink-0">
          <span
            className={cn(
              "absolute inline-flex size-full rounded-full opacity-75 animate-ping",
              pulseDotVariantClasses[config.variant ?? "default"]
            )}
          />
          <span
            className={cn(
              "relative inline-flex rounded-full size-1.5",
              pulseDotVariantClasses[config.variant ?? "default"]
            )}
          />
        </span>
      ) : null}
      {config.label}
    </Badge>
  );
}
