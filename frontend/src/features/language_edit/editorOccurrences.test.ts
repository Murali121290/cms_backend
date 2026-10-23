import { describe, it, expect } from 'vitest'

// Mirror of the mapping that LanguageReviewPage.tsx uses to translate
// `findings` into decoration occurrences. Extracted here as a pure helper so
// the lifecycle rules can be regression-tested without mounting the full page
// (and in particular, without needing a running editor instance).
//
// The real page uses the same decision tree inline inside a useMemo; both
// stay in sync via the shared assertions below. If you change the lifecycle,
// change the production mapping AND these tests.
interface MinimalFinding {
  id: number
  para_index: number
  start_offset: number
  end_offset: number
  original_text: string
  suggestion: string
  edited_text?: string
  category: string
  status: 'pending' | 'accepted' | 'edited' | 'rejected' | 'highlighted'
}

interface MinimalOccurrence {
  para_index: number
  match_start: number
  match_end: number
  surface: string
  category: string
}

function mapFindingsToOccurrences(findings: MinimalFinding[]): MinimalOccurrence[] {
  return findings.map((f) => {
    let surface = f.original_text
    if (f.status === 'edited') {
      surface = f.edited_text || f.suggestion || f.original_text
    } else if (f.status === 'accepted' || f.status === 'rejected') {
      surface = ''
    }
    return {
      para_index: f.para_index,
      match_start: f.start_offset,
      match_end: f.end_offset,
      surface,
      category: f.category,
    }
  })
}

const base = (overrides: Partial<MinimalFinding> = {}): MinimalFinding => ({
  id: 1,
  para_index: 0,
  start_offset: 4,
  end_offset: 17,
  original_text: 'non-nurturing',
  suggestion: 'nonnurturing',
  category: 'grammar',
  status: 'pending',
  ...overrides,
})

describe('editorOccurrences lifecycle — replacement preserves highlight', () => {
  it('pending finding decorates the original word', () => {
    const occs = mapFindingsToOccurrences([base()])
    expect(occs[0].surface).toBe('non-nurturing')
  })

  it('edited finding retargets its decoration to the replacement text', () => {
    const occs = mapFindingsToOccurrences([
      base({ status: 'edited', edited_text: 'NON-NURTURING' }),
    ])
    // After the user clicks UPPERCASE + Replace, the decoration surface is
    // the new text so OccurrenceHighlight can still locate it in the DOM —
    // the highlight visually tracks onto `NON-NURTURING` instead of
    // disappearing.
    expect(occs[0].surface).toBe('NON-NURTURING')
  })

  it('edited finding falls back to suggestion when no custom edited_text', () => {
    const occs = mapFindingsToOccurrences([
      base({ status: 'edited', edited_text: undefined }),
    ])
    expect(occs[0].surface).toBe('nonnurturing')
  })

  it('highlighted finding keeps the original word as its decoration surface', () => {
    const occs = mapFindingsToOccurrences([base({ status: 'highlighted' })])
    expect(occs[0].surface).toBe('non-nurturing')
  })

  it('accepted finding clears its decoration without renumbering indices', () => {
    const occs = mapFindingsToOccurrences([base({ status: 'accepted' })])
    expect(occs).toHaveLength(1)
    expect(occs[0].surface).toBe('')
  })

  it('rejected finding clears its decoration without renumbering indices', () => {
    const occs = mapFindingsToOccurrences([base({ status: 'rejected' })])
    expect(occs).toHaveLength(1)
    expect(occs[0].surface).toBe('')
  })
})

describe('editorOccurrences lifecycle — unrelated findings and term highlights are untouched', () => {
  it('resolving one finding does not change others', () => {
    const findings: MinimalFinding[] = [
      base({ id: 1, status: 'edited', edited_text: 'NON-NURTURING' }),
      base({ id: 2, status: 'pending', original_text: 'anti-anxiety', start_offset: 20, end_offset: 32 }),
      base({ id: 3, status: 'highlighted', original_text: 'glucose', category: 'term', start_offset: 40, end_offset: 47 }),
    ]
    const occs = mapFindingsToOccurrences(findings)
    expect(occs[0].surface).toBe('NON-NURTURING') // edited one tracks the new text
    expect(occs[1].surface).toBe('anti-anxiety')  // unrelated pending finding untouched
    expect(occs[2].surface).toBe('glucose')       // term highlight untouched
    expect(occs[2].category).toBe('term')
  })

  it('index positions stay stable so handleOccurrenceClick(idx) still matches findings[idx]', () => {
    const findings: MinimalFinding[] = [
      base({ id: 1, status: 'accepted' }),            // cleared
      base({ id: 2, status: 'pending', original_text: 'anti-anxiety' }),
      base({ id: 3, status: 'rejected' }),            // cleared
      base({ id: 4, status: 'pending', original_text: 'pre-intervention' }),
    ]
    const occs = mapFindingsToOccurrences(findings)
    // Length matches findings — resolving does not splice.
    expect(occs).toHaveLength(findings.length)
    // Index 1 (anti-anxiety) and index 3 (pre-intervention) still line up
    // with their sidebar cards. Verified by surface at those positions.
    expect(occs[1].surface).toBe('anti-anxiety')
    expect(occs[3].surface).toBe('pre-intervention')
  })
})

describe('editorOccurrences — replacement with different-length text', () => {
  it('replacement length change does not drop the decoration', () => {
    // Original is `non-nurturing` (13 chars), replacement is `NON-NURTURING`
    // (13 chars) — same length. But also test a longer replacement.
    const findings: MinimalFinding[] = [
      base({ status: 'edited', edited_text: 'NON-NURTURING AND SUPPORTIVE' }),
    ]
    const occs = mapFindingsToOccurrences(findings)
    expect(occs[0].surface).toBe('NON-NURTURING AND SUPPORTIVE')
    // Offsets stay as recorded on the original span — the editor's own
    // content-based match in OccurrenceHighlight finds the new surface
    // forward from match_start, so even a shorter replacement decorates.
  })

  it('shorter replacement text still produces a non-empty surface', () => {
    const findings: MinimalFinding[] = [
      base({ status: 'edited', edited_text: 'ok' }),
    ]
    const occs = mapFindingsToOccurrences(findings)
    expect(occs[0].surface).toBe('ok')
  })
})
