import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

type CardPadding = "none" | "sm" | "md" | "lg";

interface CardProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  hover?: boolean;
  padding?: CardPadding;
  className?: string;
  onClick?: () => void;
}

const paddingClasses: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

const headerPaddingClasses: Record<CardPadding, string> = {
  none: "",
  sm: "px-3 py-2",
  md: "px-5 py-3",
  lg: "px-6 py-4",
};

const footerPaddingClasses: Record<CardPadding, string> = {
  none: "",
  sm: "px-3 py-2",
  md: "px-5 py-3",
  lg: "px-6 py-4",
};

export function Card({
  header,
  footer,
  children,
  hover = false,
  padding = "md",
  className,
  onClick,
}: CardProps) {
  const isInteractive = hover || !!onClick;

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "bg-white rounded-md border border-surface-400 shadow-card overflow-hidden",
        "transition-all duration-150",
        isInteractive &&
          "cursor-pointer hover:shadow-hover hover:-translate-y-px",
        className
      )}
    >
      {header && (
        <div
          className={cn(
            "border-b border-surface-400 bg-surface-100",
            headerPaddingClasses[padding]
          )}
        >
          {header}
        </div>
      )}

      <div className={padding !== "none" ? paddingClasses[padding] : ""}>
        {children}
      </div>

      {footer && (
        <div
          className={cn(
            "border-t border-surface-400 bg-surface-100",
            footerPaddingClasses[padding]
          )}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
