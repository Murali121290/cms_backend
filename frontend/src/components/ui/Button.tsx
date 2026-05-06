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
    "bg-gold-600 text-white hover:bg-gold-700 active:bg-gold-800 border border-gold-600 hover:border-gold-700 shadow-subtle",
  secondary:
    "bg-white text-navy-900 hover:bg-navy-50 active:bg-navy-100 border border-navy-900 hover:border-navy-800",
  ghost:
    "bg-transparent text-navy-900 hover:bg-surface-100 active:bg-surface-200 border border-transparent",
  danger:
    "bg-error-600 text-white hover:bg-red-700 active:bg-red-800 border border-error-600 hover:border-red-700 shadow-subtle",
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
          "focus-visible:outline-2 focus-visible:outline-gold-600 focus-visible:outline-offset-2",
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
