import ReactDOM from "react-dom";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { useToast, type Toast, type ToastVariant } from "./useToast";
import { cn } from "@/utils/cn";

/* ─────────────────────────────────────────────────────────────
   Per-variant styling
   ───────────────────────────────────────────────────────────── */
const variantConfig: Record<
  ToastVariant,
  {
    icon: typeof CheckCircle2;
    iconClass: string;
    borderClass: string;
    bgClass: string;
  }
> = {
  success: {
    icon: CheckCircle2,
    iconClass: "text-success-600",
    borderClass: "border-success-100",
    bgClass: "bg-white",
  },
  error: {
    icon: AlertCircle,
    iconClass: "text-error-600",
    borderClass: "border-error-100",
    bgClass: "bg-white",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-warning-600",
    borderClass: "border-warning-100",
    bgClass: "bg-white",
  },
  info: {
    icon: Info,
    iconClass: "text-info-600",
    borderClass: "border-info-100",
    bgClass: "bg-white",
  },
  processing: {
    icon: Loader2,
    iconClass: "text-[#C9821A] animate-spin",
    borderClass: "border-surface-200 border-l-4 border-l-[#C9821A]",
    bgClass: "bg-white",
  },
  timeout: {
    icon: AlertTriangle,
    iconClass: "text-[#92400E]",
    borderClass: "border-surface-200 border-l-4 border-l-[#92400E]",
    bgClass: "bg-white",
  },
};

/* ─────────────────────────────────────────────────────────────
   Single Toast item
   ───────────────────────────────────────────────────────────── */
interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const config = variantConfig[toast.variant];
  const Icon = config.icon;
  const isTimeout = toast.variant === "timeout";

  return (
    <div
      role="alert"
      aria-atomic="true"
      className={cn(
        "relative flex items-start gap-3 w-80 p-4 rounded-md border shadow-card",
        "animate-[toast-in_150ms_ease-out]",
        config.bgClass,
        config.borderClass
      )}
    >
      <Icon
        className={cn("size-4 shrink-0 mt-0.5", config.iconClass)}
        aria-hidden="true"
      />

      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium leading-snug",
            isTimeout ? "text-[#92400E]" : "text-navy-900"
          )}
        >
          {toast.title}
        </p>
        {toast.description && (
          <p className="mt-0.5 text-xs text-navy-400 leading-relaxed">
            {toast.description}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 -mt-0.5 -mr-0.5 p-1 rounded-sm text-navy-300 hover:text-navy-900 hover:bg-surface-100 transition-colors duration-100"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ToastContainer — portal to document.body
   ───────────────────────────────────────────────────────────── */
export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return ReactDOM.createPortal(
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={removeToast} />
        </div>
      ))}
    </div>,
    document.body
  );
}
