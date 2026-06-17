import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "navy"
  | "outline"
  | "planning"
  | "hold"
  | "in-progress";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default:
    "bg-background text-text border border-border",
  success:
    "bg-success/15 text-success border border-success/30",
  warning:
    "bg-warning/15 text-warning border border-warning/30",
  error:
    "bg-danger/15 text-danger border border-danger/30",
  info:
    "bg-info/15 text-info border border-info/30",
  navy:
    "bg-sidebar text-white border border-sidebar",
  outline:
    "bg-transparent text-text border border-border",
  planning:
    "bg-info/15 text-info border border-info/30",
  hold:
    "bg-warning/15 text-warning border border-warning/30",
  "in-progress":
    "bg-info/15 text-info border border-info/30",
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-xs leading-none",
  md: "px-2 py-1 text-xs leading-none",
};

export function Badge({
  variant = "default",
  size = "md",
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium rounded-sm whitespace-nowrap",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {children}
    </span>
  );
}

// WMS compatibility: map status strings to badge variants
export const statusToBadge = (status: string): BadgeVariant => {
  const lower = status.toLowerCase()
  if (lower.includes('success') || lower.includes('active')) return 'success'
  if (lower.includes('error') || lower.includes('failed')) return 'error'
  if (lower.includes('warning') || lower.includes('pending')) return 'warning'
  if (lower.includes('info')) return 'info'
  return 'default'
}
