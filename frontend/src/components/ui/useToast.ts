import { create } from "zustand";

export type ToastVariant = "success" | "error" | "warning" | "info" | "processing" | "timeout";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  updateToast: (id: string, updates: Partial<Omit<Toast, "id">>) => void;
  removeToast: (id: string) => void;
}

let toastCounter = 0;
// Track auto-dismiss timers so we can clear and restart them on updateToast
const dismissTimers = new Map<string, ReturnType<typeof window.setTimeout>>();

function generateId(): string {
  return `toast-${++toastCounter}-${Date.now()}`;
}

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],

  addToast(toast) {
    const id = generateId();
    const duration = toast.duration ?? 4000;

    const newToast: Toast = { ...toast, id, duration };

    set((state) => ({ toasts: [...state.toasts, newToast] }));

    if (duration > 0) {
      const timer = window.setTimeout(() => {
        dismissTimers.delete(id);
        get().removeToast(id);
      }, duration);
      dismissTimers.set(id, timer);
    }

    return id;
  },

  updateToast(id, updates) {
    // Clear any existing auto-dismiss timer
    const existing = dismissTimers.get(id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
      dismissTimers.delete(id);
    }

    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));

    // Restart auto-dismiss if new duration > 0
    const newDuration = updates.duration;
    if (newDuration !== undefined && newDuration > 0) {
      const timer = window.setTimeout(() => {
        dismissTimers.delete(id);
        get().removeToast(id);
      }, newDuration);
      dismissTimers.set(id, timer);
    }
  },

  removeToast(id) {
    const timer = dismissTimers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      dismissTimers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
