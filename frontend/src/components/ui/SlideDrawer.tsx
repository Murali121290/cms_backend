import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

import { cn } from "@/utils/cn";

interface SlideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: "sm" | "md" | "lg";
}

const widthClasses = {
  sm: "w-80",
  md: "w-96",
  lg: "w-[480px]",
};

export function SlideDrawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  width = "md",
}: SlideDrawerProps) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-text/40"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className={cn(
          "relative ml-auto flex flex-col bg-white shadow-xl h-full",
          widthClasses[width],
          "animate-in slide-in-from-right duration-200"
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-border">
          <div>
            <h2 id="drawer-title" className="text-base font-semibold text-text">
              {title}
            </h2>
            {description ? (
              <p className="text-xs text-muted mt-0.5">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="ml-4 p-1.5 rounded hover:bg-background text-muted hover:text-text transition-colors shrink-0"
            aria-label="Close drawer"
            onClick={onClose}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
