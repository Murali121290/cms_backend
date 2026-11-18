/**
 * Derivation of the human-readable label shown in the finding card
 * header. Keeps the logic out of LanguageReviewPage.tsx so it can be
 * unit-tested without mounting the whole page.
 *
 * Priority:
 *   1. ``subcategory`` — server-side source-sheet label from the Basic
 *      Grammar workbook ("Basic Grammar", "Article Usage",
 *      "Subject-Verb Agreement", "Common Misuse", "Word/Phrase Choice",
 *      "Sentence Structure", "Punctuation and Capitalization").
 *      Replaces the generic engine category on the card so reviewers
 *      can see which workbook section a finding came from. Sidebar
 *      grouping is unaffected — the chip row still groups by
 *      ``category``.
 *   2. Legacy rename for ``compounds`` / ``compound`` → ``hyphenation``.
 *   3. Rename for ``medical_terms`` → ``medical``.
 *   4. Raw engine ``category`` (fallback).
 *
 * Returns a plain string (never null/undefined) so callers can drop it
 * directly into a span. The downstream CSS uppercases the string.
 */
export interface FindingHeader {
  category: string
  subcategory?: string | null
}

export function displayCategoryFor(f: FindingHeader): string {
  const sub = (f.subcategory ?? '').trim()
  if (sub) return sub
  if (f.category === 'compounds' || f.category === 'compound') return 'hyphenation'
  if (f.category === 'medical_terms') return 'medical'
  return f.category
}
