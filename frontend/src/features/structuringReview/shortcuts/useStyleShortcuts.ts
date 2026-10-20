import { useEffect, useCallback } from "react";
import { getClientShortcuts } from "./shortcutsStorage";
import type { StyleShortcutItem } from "./types";
import { toast } from "@/store/useToastStore";

interface UseStyleShortcutsOptions {
  editorRef: React.RefObject<any>;
  clientKey: string;
  onOpenPalette?: () => void;
  enabled?: boolean;
}

export function matchShortcutKey(e: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut) return false;
  const norm = shortcut.trim().toLowerCase();
  const isCtrl = e.ctrlKey && !e.metaKey;
  const isAlt = e.altKey;
  const isShift = e.shiftKey;

  // 1. Quick Palette: Alt+S
  if (norm === "alt+s") {
    return isAlt && !isCtrl && !isShift && (e.code === "KeyS" || e.key.toLowerCase() === "s");
  }

  // 2. Alt + Number (Alt+1 to Alt+9)
  for (let n = 1; n <= 9; n++) {
    if (norm === `alt+${n}`) {
      return isAlt && !isCtrl && !isShift && (e.code === `Digit${n}` || e.code === `Numpad${n}` || e.key === String(n));
    }
  }

  // 3. Alt+0 or Alt+10 (TableNote) -> Digit0, Numpad0, or F10
  if (norm === "alt+0" || norm === "alt+10") {
    return isAlt && !isCtrl && !isShift && (e.code === "Digit0" || e.code === "Numpad0" || e.code === "F10" || e.key === "0");
  }

  // 4. Alt+F11 or Alt+11 (FigureLegend) -> F11 or Minus (-)
  if (norm === "alt+f11" || norm === "alt+11") {
    return isAlt && !isCtrl && !isShift && (e.code === "F11" || e.code === "Minus" || e.key === "-");
  }

  // 5. Alt+F12 or Alt+12 (FigureSource) -> F12 or Equal (=)
  if (norm === "alt+f12" || norm === "alt+12") {
    return isAlt && !isCtrl && !isShift && (e.code === "F12" || e.code === "Equal" || e.key === "=");
  }

  // 6. Ctrl + Alt + Digit (Ctrl+Alt+1 to Ctrl+Alt+7, etc.)
  for (let n = 0; n <= 9; n++) {
    if (norm === `ctrl+alt+${n}`) {
      return isCtrl && isAlt && !isShift && (e.code === `Digit${n}` || e.code === `Numpad${n}` || e.key === String(n));
    }
  }

  // 7. Ctrl + Alt + Letter (Ctrl+Alt+T, Ctrl+Alt+E)
  if (norm.startsWith("ctrl+alt+")) {
    const letter = norm.replace("ctrl+alt+", "").toUpperCase();
    return isCtrl && isAlt && !isShift && (e.code === `Key${letter}` || e.key.toUpperCase() === letter);
  }

  // 8. Ctrl + Number (Ctrl+0, Ctrl+1, Ctrl+2, Ctrl+3, Ctrl+7, Ctrl+8, Ctrl+9)
  for (let n = 0; n <= 9; n++) {
    if (norm === `ctrl+${n}`) {
      return isCtrl && !isAlt && !isShift && (e.code === `Digit${n}` || e.code === `Numpad${n}` || e.key === String(n));
    }
  }

  // 9. Ctrl + Period (Ctrl+.)
  if (norm === "ctrl+.") {
    return isCtrl && !isAlt && (e.code === "Period" || e.code === "NumpadDecimal" || e.key === ".");
  }

  // 10. Ctrl + Asterisk (Ctrl+*)
  if (norm === "ctrl+*") {
    return isCtrl && !isAlt && (e.key === "*" || e.code === "NumpadMultiply" || (isShift && e.code === "Digit8"));
  }

  // 11. Ctrl + Plus (Ctrl++)
  if (norm === "ctrl++" || norm === "ctrl+=") {
    return isCtrl && !isAlt && (e.key === "+" || e.code === "NumpadAdd" || (isShift && e.code === "Equal") || e.key === "=");
  }

  // 12. Ctrl + Letter (Ctrl+D for bib_doi)
  if (norm === "ctrl+d") {
    return isCtrl && !isAlt && !isShift && (e.code === "KeyD" || e.key.toLowerCase() === "d");
  }

  // 13. Alt + Shift + Letter or Digit (Alt+Shift+F, Alt+Shift+T, Alt+Shift+B, Alt+Shift+X, Alt+Shift+0)
  if (norm.startsWith("alt+shift+")) {
    const keyPart = norm.replace("alt+shift+", "").toUpperCase();
    if (keyPart >= "0" && keyPart <= "9") {
      return isAlt && isShift && !isCtrl && (e.code === `Digit${keyPart}` || e.code === `Numpad${keyPart}` || e.key === keyPart);
    }
    return isAlt && isShift && !isCtrl && (e.code === `Key${keyPart}` || e.key.toUpperCase() === keyPart);
  }

  return false;
}

export function useStyleShortcuts({
  editorRef,
  clientKey,
  onOpenPalette,
  enabled = true,
}: UseStyleShortcutsOptions) {
  const applyShortcut = useCallback(
    (item: StyleShortcutItem) => {
      const editor = editorRef.current?.editor;
      if (!editor) return;

      if (item.type === "paragraph") {
        const styleName = item.style || "Normal";
        const headingMap: Record<string, number> = {
          H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6,
          Head1: 1, Head2: 2, Head3: 3, Head4: 4, Head5: 5, Head6: 6,
        };
        const level =
          headingMap[styleName] ??
          (styleName.toLowerCase().startsWith("head") || styleName.toLowerCase().startsWith("h")
            ? parseInt(styleName.replace(/\D/g, ""), 10) || undefined
            : undefined);

        let chain = editor.chain().focus();
        if (level && level >= 1 && level <= 6) {
          chain = chain
            .setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
            .updateAttributes("heading", { styleLabel: styleName });
        } else {
          if (editor.isActive("heading")) {
            chain = chain.setParagraph();
          }
          chain = chain.updateAttributes("paragraph", { styleLabel: styleName });
        }
        chain.run();
        toast.success(`Applied [${styleName}] (${item.label}) via ${item.shortcut}`);
      } else {
        // Character style
        if (item.style) {
          editor.chain().focus().toggleMark("charStyle", { class: item.style }).run();
          toast.success(`Applied [${item.style}] (${item.label}) via ${item.shortcut}`);
        } else {
          editor.chain().focus().unsetMark("charStyle").run();
          toast.success(`Cleared Character Style via ${item.shortcut}`);
        }
      }
    },
    [editorRef]
  );

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Quick Palette Trigger: Alt + S
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.code === "KeyS" || e.key.toLowerCase() === "s")) {
        e.preventDefault();
        e.stopPropagation();
        onOpenPalette?.();
        return;
      }

      const clientData = getClientShortcuts(clientKey);

      // 2. Check character shortcuts (e.g. Ctrl+0, Ctrl+., Ctrl+Alt+5, Ctrl+*, Ctrl+D, Ctrl++, Alt+Shift+F, etc.)
      for (const item of clientData.character_shortcuts) {
        if (item.shortcut && matchShortcutKey(e, item.shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          applyShortcut(item);
          return;
        }
      }

      // 3. Check paragraph shortcuts (e.g. Alt+1..9, Alt+0, Alt+F11, Alt+F12, Ctrl+Alt+T, Ctrl+Alt+E)
      for (const item of clientData.paragraph_shortcuts) {
        if (item.shortcut && matchShortcutKey(e, item.shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          applyShortcut(item);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled, clientKey, onOpenPalette, applyShortcut]);

  return { applyShortcut };
}
