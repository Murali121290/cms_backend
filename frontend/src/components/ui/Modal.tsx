import {
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import ReactDOM from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";

type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl";

interface ModalProps {
  isOpen?: boolean;
  open?: boolean; // WMS compatibility
  onClose: () => void;
  onConfirm?: () => void; // WMS compatibility - some modals use this instead of just onClose
  title?: string;
  description?: string;
  message?: string; // WMS compatibility - alias for description
  children?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  confirmLabel?: string;
  loading?: boolean;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-4xl",
};

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  isOpen,
  open,
  onClose,
  onConfirm,
  title,
  description,
  message,
  children,
  footer,
  size = "md",
  confirmLabel = "Confirm",
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`).current;

  // Support both isOpen and open props (WMS compatibility)
  const isModalOpen = isOpen ?? open ?? false;
  const desc = description ?? message;

  // Save and restore focus
  useEffect(() => {
    if (isModalOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Focus the dialog after paint
      requestAnimationFrame(() => {
        if (dialogRef.current) {
          const firstFocusable = dialogRef.current.querySelector<HTMLElement>(
            FOCUSABLE_SELECTORS
          );
          firstFocusable?.focus();
        }
      });
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // Lock body scroll
  useEffect(() => {
    if (isModalOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isModalOpen]);

  // ESC key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
        ).filter((el) => !el.closest("[aria-hidden]"));

        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  if (!isModalOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[30] flex items-center justify-center p-4"
      aria-hidden={!isModalOpen}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[overlay-in_150ms_ease-out]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? `${titleId}-desc` : undefined}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative z-10 w-full bg-card rounded-2xl shadow-lg",
          "animate-[modal-in_150ms_ease-out]",
          "flex flex-col max-h-[90vh] overflow-hidden",
          sizeClasses[size]
        )}
      >
        {/* Header */}
        {(title || desc) && (
          <div className="px-6 pt-6 pb-4 border-b border-border shrink-0">
            {title && (
              <div className="flex items-start justify-between gap-4">
                <h2
                  id={titleId}
                  className="text-lg font-semibold text-text leading-snug"
                >
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="shrink-0 -mt-0.5 p-1 rounded-sm text-muted hover:text-text hover:bg-background transition-colors duration-100"
                  aria-label="Close dialog"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            )}
            {desc && (
              <p
                id={`${titleId}-desc`}
                className="mt-1.5 text-sm text-muted leading-relaxed"
              >
                {desc}
              </p>
            )}
          </div>
        )}

        {/* If no header, still show close button */}
        {!title && !description && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-sm text-muted hover:text-text hover:bg-background transition-colors duration-100"
            aria-label="Close dialog"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-5 min-h-0">{children}</div>

        {/* Footer */}
        {(footer || onConfirm) && (
          <div className="px-6 py-4 border-t border-border bg-background shrink-0 rounded-b-2xl">
            {footer}
            {onConfirm && !footer && (
              <div className="flex gap-3 justify-end">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-text bg-background border border-border rounded-lg hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirm}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
                >
                  {confirmLabel}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// WMS compatibility exports
export const ConfirmDialog = Modal  // WMS ConfirmDialog is just Modal
export function WMSModal(props: ModalProps & { open?: boolean }) {
  const { open, isOpen, ...rest } = props
  return <Modal isOpen={open ?? isOpen ?? false} {...rest} />
}
