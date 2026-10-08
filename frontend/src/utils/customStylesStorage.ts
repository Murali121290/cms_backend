const CUSTOM_STYLES_KEY = "cms_custom_styles_store";

/**
 * Retrieves all user-created custom styles from persistent localStorage.
 */
export function getPersistedCustomStyles(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_STYLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Saves a new custom style name to persistent localStorage and returns the updated list.
 */
export function savePersistedCustomStyle(newStyleName: string): string[] {
  if (!newStyleName || typeof newStyleName !== "string") {
    return getPersistedCustomStyles();
  }

  const clean = newStyleName.trim();
  if (!clean) return getPersistedCustomStyles();

  const current = getPersistedCustomStyles();
  if (!current.includes(clean)) {
    const updated = [...current, clean];
    try {
      localStorage.setItem(CUSTOM_STYLES_KEY, JSON.stringify(updated));
    } catch {
      /* Ignore localStorage save error */
    }
    return updated;
  }
  return current;
}
