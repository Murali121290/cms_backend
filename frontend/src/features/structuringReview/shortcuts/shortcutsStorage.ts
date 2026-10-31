import { DEFAULT_CLIENT_SHORTCUTS } from "./defaultShortcuts";
import type { AllClientsShortcutsConfig, ClientShortcutsMap, StyleShortcutItem } from "./types";

const STORAGE_KEY = "cms_client_shortcuts_config_v2";

export function resolveClientKey(
  clientName?: string | null,
  tagSet?: string | null,
  detectedStyles?: string[]
): string {
  if (tagSet) {
    const t = tagSet.toLowerCase();
    if (t.includes("springer") || t === "spr") return "springer";
    if (t.includes("publisher") || t === "lww" || t === "default") return "publisher";
  }
  if (clientName) {
    const c = clientName.toLowerCase();
    if (c.includes("springer") || c === "spr") return "springer";
  }
  if (detectedStyles && detectedStyles.length > 0) {
    const isSpringer = detectedStyles.some(
      (s) => s === "Head1" || s === "Head2" || s === "Para-FL" || s === "ChapterTitle" || s === "eXtractTxt"
    );
    if (isSpringer) return "springer";
  }
  return "publisher";
}

export function getAllClientShortcuts(): AllClientsShortcutsConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        return {
          publisher: { ...DEFAULT_CLIENT_SHORTCUTS.publisher, ...(parsed.publisher || {}) },
          springer: { ...DEFAULT_CLIENT_SHORTCUTS.springer, ...(parsed.springer || {}) },
        };
      }
    }
  } catch (e) {
    console.warn("Failed to load client shortcuts from localStorage:", e);
  }
  return DEFAULT_CLIENT_SHORTCUTS;
}

export function getClientShortcuts(clientKey: string): ClientShortcutsMap {
  const all = getAllClientShortcuts();
  return all[clientKey] || all.publisher || DEFAULT_CLIENT_SHORTCUTS.publisher;
}

export function saveClientShortcuts(config: AllClientsShortcutsConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Failed to save client shortcuts:", e);
  }
}

export function resetClientShortcuts(): AllClientsShortcutsConfig {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("Failed to reset client shortcuts:", e);
  }
  return DEFAULT_CLIENT_SHORTCUTS;
}

export function getShortcutBadgeForStyle(styleName: string, clientKey: string): string | null {
  const clientData = getClientShortcuts(clientKey);
  const paraMatch = clientData.paragraph_shortcuts.find(
    (s) => (s.style || "").toLowerCase() === styleName.toLowerCase()
  );
  if (paraMatch) return paraMatch.shortcut;

  const charMatch = clientData.character_shortcuts.find(
    (s) => (s.style || "").toLowerCase() === styleName.toLowerCase()
  );
  if (charMatch) return charMatch.shortcut;

  return null;
}
