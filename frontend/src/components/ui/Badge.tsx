import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "navy"
  | "outline";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default:
    "bg-surface-300 text-navy-700 border border-surface-400",
  success:
    "bg-success-100 text-success-600 border border-success-100",
  warning:
    "bg-warning-100 text-warning-600 border border-warning-100",
  error:
    "bg-error-100 text-error-600 border border-error-100",
  info:
    "bg-info-100 text-info-600 border border-info-100",
  navy:
    "bg-navy-900 text-white border border-navy-900",
  outline:
    "bg-transparent text-navy-700 border border-surface-400",
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
