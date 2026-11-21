import { useEffect, useRef } from "react";

export type ShortcutMap = Partial<Record<string, (e: KeyboardEvent) => void>>;

const isTyping = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button"].includes(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
};

/** Page-level keyboard shortcuts; ignored while typing, with modifiers, or while a dialog is open. */
export function useShortcuts(map: ShortcutMap, enabled: boolean) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "Escape" && isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const fn = ref.current[e.key] ?? ref.current[e.key.toLowerCase()];
      if (fn) fn(e);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
