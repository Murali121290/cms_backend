import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Keyboard, RotateCcw, Check, Sparkles } from "lucide-react";
import {
  getAllClientShortcuts,
  saveClientShortcuts,
  resetClientShortcuts,
} from "../shortcuts/shortcutsStorage";
import type { AllClientsShortcutsConfig } from "../shortcuts/types";
import { Button } from "@/components/ui/Button";
import { toast } from "@/store/useToastStore";

interface StyleShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeClientKey: string;
  onConfigChange?: () => void;
}

export function StyleShortcutsDialog({
  isOpen,
  onClose,
  activeClientKey,
  onConfigChange,
}: StyleShortcutsDialogProps) {
  const [config, setConfig] = useState<AllClientsShortcutsConfig>(getAllClientShortcuts());
  const [selectedClient, setSelectedClient] = useState<string>(activeClientKey);

  useEffect(() => {
    if (isOpen) {
      setConfig(getAllClientShortcuts());
      setSelectedClient(activeClientKey);
    }
  }, [isOpen, activeClientKey]);

  if (!isOpen) return null;

  const currentClientData = config[selectedClient] || config.publisher;

  const handleUpdateShortcut = (
    type: "paragraph" | "character",
    action: string,
    newShortcut: string
  ) => {
    const updated = { ...config };
    const clientData = { ...updated[selectedClient] };

    if (type === "paragraph") {
      clientData.paragraph_shortcuts = clientData.paragraph_shortcuts.map((item) =>
        item.action === action ? { ...item, shortcut: newShortcut } : item
      );
    } else {
      clientData.character_shortcuts = clientData.character_shortcuts.map((item) =>
        item.action === action ? { ...item, shortcut: newShortcut } : item
      );
    }

    updated[selectedClient] = clientData;
    setConfig(updated);
  };

  const handleSave = () => {
    saveClientShortcuts(config);
    toast.success("Shortcut configuration saved!");
    onConfigChange?.();
    onClose();
  };

  const handleReset = () => {
    if (confirm("Reset all shortcuts to default mappings?")) {
      const reset = resetClientShortcuts();
      setConfig(reset);
      toast.info("Shortcuts reset to factory defaults.");
      onConfigChange?.();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-100"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="h-14 px-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 leading-tight">
                Keyboard Shortcuts Configuration
              </h2>
              <p className="text-[11px] text-slate-500">
                Mapped based on client tag sets (<code className="font-mono text-[10px]">client_shortcuts_mapping.json</code>)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 cursor-pointer border-none bg-transparent"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Client Tag Set Tab Switcher */}
        <div className="px-5 py-3 bg-slate-100/70 border-b border-slate-200 flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
            Client Tag Set:
          </span>
          <div className="flex gap-1.5 bg-white p-1 rounded-lg border border-slate-200">
            {Object.keys(config).map((key) => {
              const isSelected = selectedClient === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedClient(key)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer border-none transition-colors ${
                    isSelected
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  {config[key].client_label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Shortcuts Table */}
        <div className="max-h-96 overflow-y-auto p-5 space-y-5">
          {/* Paragraph Shortcuts */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-purple-900 mb-2.5 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-600" />
              Paragraph Styles ({currentClientData.paragraph_shortcuts.length})
            </h3>
            <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
              {currentClientData.paragraph_shortcuts.map((item) => (
                <div
                  key={item.action}
                  className="px-3.5 py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-mono text-slate-900">
                        {item.style}
                      </span>
                      <span className="text-[11px] text-slate-500 truncate">
                        {item.label}
                      </span>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={item.shortcut}
                    onChange={(e) =>
                      handleUpdateShortcut("paragraph", item.action, e.target.value)
                    }
                    className="w-28 text-center text-xs font-mono font-semibold py-1 px-2 rounded-md bg-slate-50 border border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Character Shortcuts */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-900 mb-2.5 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              Character Styles ({currentClientData.character_shortcuts.length})
            </h3>
            <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
              {currentClientData.character_shortcuts.map((item) => (
                <div
                  key={item.action}
                  className="px-3.5 py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-mono text-slate-900">
                        {item.style || "Clear Character Style"}
                      </span>
                      <span className="text-[11px] text-slate-500 truncate">
                        {item.label}
                      </span>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={item.shortcut}
                    onChange={(e) =>
                      handleUpdateShortcut("character", item.action, e.target.value)
                    }
                    className="w-28 text-center text-xs font-mono font-semibold py-1 px-2 rounded-md bg-slate-50 border border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-14 px-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer border-none bg-transparent"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Check className="w-3.5 h-3.5" />}
              onClick={handleSave}
            >
              Save Configuration
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
