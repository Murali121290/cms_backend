import { AlertTriangle, AlertCircle } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { cn } from "@/utils/cn";

type ConfirmVariant = "danger" | "warning";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  isLoading?: boolean;
}

const variantConfig: Record<
  ConfirmVariant,
  { icon: typeof AlertTriangle; iconClass: string; bgClass: string }
> = {
  danger: {
    icon: AlertCircle,
    iconClass: "text-error-600",
    bgClass: "bg-error-100",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-warning-600",
    bgClass: "bg-warning-100",
  },
};

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  isLoading = false,
}: ConfirmDialogProps) {
  const { icon: Icon, iconClass, bgClass } = variantConfig[variant];

  const footer = (
    <div className="flex items-center justify-end gap-3">
      <Button variant="ghost" size="md" onClick={onClose} disabled={isLoading}>
        {cancelLabel}
      </Button>
      <Button
        variant={variant === "danger" ? "danger" : "primary"}
        size="md"
        onClick={onConfirm}
        isLoading={isLoading}
      >
        {confirmLabel}
      </Button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" footer={footer}>
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "shrink-0 flex items-center justify-center size-10 rounded-md",
            bgClass
          )}
        >
          <Icon className={cn("size-5", iconClass)} aria-hidden="true" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-base font-semibold text-navy-900 leading-snug">
            {title}
          </h3>
          <p className="mt-1.5 text-sm text-navy-400 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </Modal>
  );
}
