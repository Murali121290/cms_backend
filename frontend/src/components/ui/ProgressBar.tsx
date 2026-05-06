import { cn } from "@/utils/cn";

type ProgressColor = "navy" | "gold" | "success" | "error";
type ProgressSize = "sm" | "md";

interface ProgressBarProps {
  value?: number;
  size?: ProgressSize;
  color?: ProgressColor;
  label?: string;
  showValue?: boolean;
  className?: string;
}

const trackHeightClasses: Record<ProgressSize, string> = {
  sm: "h-1",
  md: "h-2",
};

const fillColorClasses: Record<ProgressColor, string> = {
  navy: "bg-navy-900",
  gold: "bg-gold-600",
  success: "bg-success-600",
  error: "bg-error-600",
};

export function ProgressBar({
  value,
  size = "md",
  color = "navy",
  label,
  showValue = false,
  className,
}: ProgressBarProps) {
  const isIndeterminate = value === undefined;
  const clampedValue = isIndeterminate ? 0 : Math.min(100, Math.max(0, value));

  return (
    <div className={cn("w-full", className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-1.5">
          {label && (
            <span className="text-sm text-navy-700 font-medium">{label}</span>
          )}
          {showValue && !isIndeterminate && (
            <span className="text-xs text-navy-400 tabular-nums">
              {clampedValue}%
            </span>
          )}
        </div>
      )}

      <div
        role="progressbar"
        aria-valuenow={isIndeterminate ? undefined : clampedValue}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className={cn(
          "w-full bg-surface-300 rounded-full overflow-hidden",
          trackHeightClasses[size]
        )}
      >
        {isIndeterminate ? (
          <div
            className={cn(
              "h-full w-1/3 rounded-full",
              fillColorClasses[color],
              "animate-[indeterminate_1.5s_ease-in-out_infinite]"
            )}
            style={{
              animation: "indeterminate 1.5s ease-in-out infinite",
            }}
          />
        ) : (
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300 ease-out",
              fillColorClasses[color]
            )}
            style={{ width: `${clampedValue}%` }}
          />
        )}
      </div>

      <style>{`
        @keyframes indeterminate {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
