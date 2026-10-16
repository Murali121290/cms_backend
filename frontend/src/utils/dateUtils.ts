/**
 * Date utility helpers for standardizing timezone parsing and display.
 */

/**
 * Safely parse an ISO date string into a Date object.
 * If the string lacks a timezone offset or 'Z' suffix (a common issue
 * when naive UTC timestamps are serialized by python backends), this normalizes
 * it by treating it as UTC so browsers accurately convert it to the local timezone.
 */
export function parseUtcDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  let normalized = dateStr.trim();
  if (!normalized) return null;
  if (!normalized.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(normalized)) {
    normalized += 'Z';
  }
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format an ISO date string into a localized date & time string.
 */
export function formatDateTime(
  dateStr: string | null | undefined,
  locale: string = 'en-GB',
  options?: Intl.DateTimeFormatOptions
): string {
  const d = parseUtcDate(dateStr);
  if (!d) return '—';
  return d.toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    ...options,
  });
}

/**
 * Format an ISO date string into a localized date only string.
 */
export function formatDate(
  dateStr: string | null | undefined,
  locale: string = 'en-GB',
  options?: Intl.DateTimeFormatOptions
): string {
  const d = parseUtcDate(dateStr);
  if (!d) return '—';
  return d.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}
