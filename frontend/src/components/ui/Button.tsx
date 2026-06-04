import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover active:bg-primary/80 border border-primary hover:border-primary-hover shadow-subtle",
  secondary:
    "bg-white text-text hover:bg-background active:bg-background/80 border border-border hover:border-border",
  ghost:
    "bg-transparent text-text hover:bg-background active:bg-background/50 border border-transparent",
  danger:
    "bg-danger text-white hover:bg-danger/90 active:bg-danger/80 border border-danger hover:border-danger shadow-subtle",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2.5",
};

const iconSizeClasses: Record<ButtonSize, string> = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      className,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={isLoading}
        className={cn(
          "inline-flex items-center justify-center font-medium rounded-md",
          "transition-all duration-150",
          "focus:ring-2 focus:ring-primary/30 focus:ring-offset-0",
          variantClasses[variant],
          sizeClasses[size],
          isDisabled && "opacity-50 cursor-not-allowed pointer-events-none",
          className
        )}
        {...props}
      >
        {isLoading ? (
          <Loader2
            className={cn(iconSizeClasses[size], "animate-spin shrink-0")}
            aria-hidden="true"
          />
        ) : (
          leftIcon && (
            <span className={cn(iconSizeClasses[size], "shrink-0")} aria-hidden="true">
              {leftIcon}
            </span>
          )
        )}
        {children && <span>{children}</span>}
        {!isLoading && rightIcon && (
          <span className={cn(iconSizeClasses[size], "shrink-0")} aria-hidden="true">
            {rightIcon}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
