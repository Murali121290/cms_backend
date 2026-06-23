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
    textClass: string;
  }
> = {
  success: {
    icon: CheckCircle2,
    iconClass: "text-green-800",
    borderClass: "border-green-200",
    bgClass: "bg-green-50",
    textClass: "text-green-800",
  },
  error: {
    icon: AlertCircle,
    iconClass: "text-red-800",
    borderClass: "border-red-200",
    bgClass: "bg-red-50",
    textClass: "text-red-800",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-yellow-800",
    borderClass: "border-yellow-200",
    bgClass: "bg-yellow-50",
    textClass: "text-yellow-800",
  },
  info: {
    icon: Info,
    iconClass: "text-blue-800",
    borderClass: "border-blue-200",
    bgClass: "bg-blue-50",
    textClass: "text-blue-800",
  },
  processing: {
    icon: Loader2,
    iconClass: "text-amber-800 animate-spin",
    borderClass: "border-amber-200",
    bgClass: "bg-amber-50",
    textClass: "text-amber-800",
  },
  timeout: {
    icon: AlertTriangle,
    iconClass: "text-orange-800",
    borderClass: "border-orange-200",
    bgClass: "bg-orange-50",
    textClass: "text-orange-800",
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
        <p className={cn("text-sm font-medium leading-snug", config.textClass)}>
          {toast.title}
        </p>
        {toast.description && (
          <p className={cn("mt-0.5 text-xs leading-relaxed opacity-85", config.textClass)}>
            {toast.description}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        aria-label="Dismiss notification"
        className={cn(
          "shrink-0 -mt-0.5 -mr-0.5 p-1 rounded-sm transition-colors duration-100 opacity-60 hover:opacity-100",
          config.textClass
        )}
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
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
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
