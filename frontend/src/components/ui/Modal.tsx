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

type ModalSize = "sm" | "md" | "lg" | "xl";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`).current;

  // Save and restore focus
  useEffect(() => {
    if (isOpen) {
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
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[30] flex items-center justify-center p-4"
      aria-hidden={!isOpen}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-navy-900/50 backdrop-blur-sm animate-[overlay-in_150ms_ease-out]"
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
          "relative z-10 w-full bg-white rounded-lg shadow-modal",
          "animate-[modal-in_150ms_ease-out]",
          "flex flex-col max-h-[90vh]",
          sizeClasses[size]
        )}
      >
        {/* Header */}
        {(title || description) && (
          <div className="px-6 pt-6 pb-4 border-b border-surface-400 shrink-0">
            {title && (
              <div className="flex items-start justify-between gap-4">
                <h2
                  id={titleId}
                  className="font-serif text-lg font-semibold text-navy-900 leading-snug"
                >
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="shrink-0 -mt-0.5 p-1 rounded-sm text-navy-400 hover:text-navy-900 hover:bg-surface-100 transition-colors duration-100"
                  aria-label="Close dialog"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            )}
            {description && (
              <p
                id={`${titleId}-desc`}
                className="mt-1.5 text-sm text-navy-400 leading-relaxed"
              >
                {description}
              </p>
            )}
          </div>
        )}

        {/* If no header, still show close button */}
        {!title && !description && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-sm text-navy-400 hover:text-navy-900 hover:bg-surface-100 transition-colors duration-100"
            aria-label="Close dialog"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-6 py-4 border-t border-surface-400 bg-surface-100 shrink-0 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
