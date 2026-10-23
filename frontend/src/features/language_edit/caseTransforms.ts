// Case-conversion helpers for the Language Editor's inline edit popover.
//
// Invariant: these functions only change letter casing. Hyphens, apostrophes,
// spaces, and other punctuation in the input are preserved byte-for-byte so
// hyphenated compounds like `anti-anxiety`, `pre-intervention`, and
// `post-intervention` keep their structure across all three transforms.
//
// `toUpperCase()` / `toLowerCase()` are native JS and already case-only; they
// are re-exported here as named helpers so the three popover buttons go
// through one audited surface and the Vitest regression tests cover them
// together.

export function upperCase(s: string): string {
  return s.toUpperCase()
}

export function lowerCase(s: string): string {
  return s.toLowerCase()
}

// Title Case: capitalize each contiguous letter run's first letter and
// lowercase the rest. The regex matches letters + combining marks + apostrophe
// only — hyphens, en-dashes, non-breaking hyphens, spaces, and other
// punctuation are NOT part of a "word" and therefore survive unchanged, so
// `anti-anxiety` becomes `Anti-Anxiety` (two separate runs) rather than
// `Antianxiety`.
//
// Doesn't apply English small-word rules (and/of/the) — those vary by house
// style and belong in a separate rule, not in this generic transform.
export function toTitleCase(s: string): string {
  return s.replace(
    /\p{L}[\p{L}\p{M}']*/gu,
    w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  )
}

// Strip to the bare letter sequence (lowercase). Used only for the
// "same word, different structure" check in `applyCasePreservingStructure`.
function letterSignature(s: string): string {
  return (s.match(/\p{L}/gu) || []).join('').toLowerCase()
}

// Apply a case transform while preserving the original word's structural
// characters (hyphens, apostrophes, spaces).
//
// Context: the Language Editor's house-style rules can emit a suggestion that
// drops punctuation — e.g. GP009 maps `non-nurturing` → `nonnurturing`. The
// popover prefills with that suggestion, so clicking UPPERCASE on the
// prefilled text would produce `NONNURTURING` and users perceive this as
// "uppercase removed the hyphen". That mental model is right: when the user
// re-cases a word, they expect its SHAPE to come back.
//
// Rule: if `current` is just a punctuation-stripped variant of `original`
// (same letter sequence, case-insensitive), apply the transform to `original`
// so hyphens/apostrophes/spaces survive. Otherwise the user is editing a
// genuinely different string (e.g. accepted a typo suggestion `received`
// over `recieved`) and we respect their input.
export function applyCasePreservingStructure(
  current: string,
  original: string | undefined | null,
  transform: (s: string) => string,
): string {
  const base =
    original && letterSignature(current) === letterSignature(original)
      ? original
      : current
  return transform(base)
}
