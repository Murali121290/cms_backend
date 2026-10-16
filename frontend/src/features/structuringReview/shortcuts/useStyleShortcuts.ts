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

      // 2. Paragraph Shortcuts: Ctrl + Alt + Key
      if (e.ctrlKey && e.altKey && !e.shiftKey) {
        let keyCombo: string | null = null;
        if (e.code === "Digit0") keyCombo = "Ctrl+Alt+0";
        else if (e.code === "Digit1") keyCombo = "Ctrl+Alt+1";
        else if (e.code === "Digit2") keyCombo = "Ctrl+Alt+2";
        else if (e.code === "Digit3") keyCombo = "Ctrl+Alt+3";
        else if (e.code === "Digit4") keyCombo = "Ctrl+Alt+4";
        else if (e.code === "KeyT") keyCombo = "Ctrl+Alt+T";
        else if (e.code === "KeyE") keyCombo = "Ctrl+Alt+E";

        if (keyCombo) {
          const match = clientData.paragraph_shortcuts.find((s) => s.shortcut === keyCombo);
          if (match) {
            e.preventDefault();
            e.stopPropagation();
            applyShortcut(match);
            return;
          }
        }
      }

      // 3. Character Shortcuts: Alt + Shift + Key
      if (e.altKey && e.shiftKey && !e.ctrlKey) {
        let charCombo: string | null = null;
        if (e.code === "KeyF") charCombo = "Alt+Shift+F";
        else if (e.code === "KeyT") charCombo = "Alt+Shift+T";
        else if (e.code === "KeyB") charCombo = "Alt+Shift+B";
        else if (e.code === "KeyX") charCombo = "Alt+Shift+X";
        else if (e.code === "Digit0") charCombo = "Alt+Shift+0";

        if (charCombo) {
          const match = clientData.character_shortcuts.find((s) => s.shortcut === charCombo);
          if (match) {
            e.preventDefault();
            e.stopPropagation();
            applyShortcut(match);
            return;
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled, clientKey, onOpenPalette, applyShortcut]);

  return { applyShortcut };
}
