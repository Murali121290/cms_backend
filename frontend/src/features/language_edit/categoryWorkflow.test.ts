import { describe, it, expect } from 'vitest'
import {
  CATEGORY_UNLOCK_ORDER,
  computeCategoryWorkflow,
  isResolvedStatus,
  type WorkflowFinding,
  type UnlockCategory,
} from './categoryWorkflow'

function f(category: string, status: string, extras: Partial<WorkflowFinding> = {}): WorkflowFinding {
  return { category, status, ...extras }
}

/**
 * Convenience: one finding per category in the unlock order. Default
 * status is pending. Used to exercise the "chain of eight" cases.
 */
function oneEach(status: string = 'pending', overrides: Partial<Record<UnlockCategory, string>> = {}): WorkflowFinding[] {
  return CATEGORY_UNLOCK_ORDER.map(cat => f(cat, overrides[cat] ?? status))
}

describe('categoryWorkflow / initial visibility', () => {
  it('shows only abbreviations when every category has pending findings', () => {
    const state = computeCategoryWorkflow(oneEach('pending'))
    expect(Array.from(state.visible)).toEqual(['abbreviations'])
    expect(state.nextUnlocked).toBe('abbreviations')
    expect(state.completed.size).toBe(0)
  })

  it('shows nothing (no next, no completed) when the document has zero findings', () => {
    const state = computeCategoryWorkflow([])
    expect(state.visible.size).toBe(0)
    expect(state.nextUnlocked).toBeNull()
  })
})

describe('categoryWorkflow / sequential unlock', () => {
  it('keeps Medical Terms hidden while Abbreviations has even one pending finding', () => {
    const findings = [
      f('abbreviations', 'accepted'),
      f('abbreviations', 'pending'), // one straggler locks the chain
      f('medical_terms', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.visible.has('medical_terms')).toBe(false)
    expect(state.nextUnlocked).toBe('abbreviations')
  })

  it('reveals Medical Terms once every Abbreviations finding is resolved', () => {
    const findings = [
      f('abbreviations', 'accepted'),
      f('abbreviations', 'edited'),
      f('abbreviations', 'rejected'),
      f('medical_terms', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.completed.has('abbreviations')).toBe(true)
    expect(state.visible.has('abbreviations')).toBe(true) // stays visible for review
    expect(state.visible.has('medical_terms')).toBe(true)
    expect(state.nextUnlocked).toBe('medical_terms')
  })

  it('counts a mix of Accept / Edit / Ignore as fully resolved', () => {
    const findings = [
      f('abbreviations', 'accepted'),
      f('abbreviations', 'edited'),
      f('abbreviations', 'rejected'),
      f('medical_terms', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.completed.has('abbreviations')).toBe(true)
    expect(state.nextUnlocked).toBe('medical_terms')
  })

  it('does NOT reveal the next category until the current one is fully resolved (even one pending blocks)', () => {
    const findings = [
      f('abbreviations', 'accepted'),
      f('abbreviations', 'accepted'),
      f('abbreviations', 'pending'),
      f('medical_terms', 'accepted'),
      f('hyphenation', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    // medical_terms + hyphenation findings exist but are locked
    // behind the still-pending abbreviations finding.
    expect(state.visible.has('medical_terms')).toBe(false)
    expect(state.visible.has('hyphenation')).toBe(false)
    expect(state.nextUnlocked).toBe('abbreviations')
  })
})

describe('categoryWorkflow / highlight does not resolve', () => {
  it('a Highlight decision alone leaves the category incomplete', () => {
    const findings = [
      f('abbreviations', 'highlighted'),
      f('medical_terms', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.completed.has('abbreviations')).toBe(false)
    expect(state.nextUnlocked).toBe('abbreviations')
    expect(state.visible.has('medical_terms')).toBe(false)
  })

  it('pending alone keeps the category incomplete', () => {
    expect(isResolvedStatus('pending')).toBe(false)
  })

  it('exposes RESOLVED_STATUSES as exactly {accepted, edited, rejected}', () => {
    expect(isResolvedStatus('accepted')).toBe(true)
    expect(isResolvedStatus('edited')).toBe(true)
    expect(isResolvedStatus('rejected')).toBe(true)
    expect(isResolvedStatus('highlighted')).toBe(false)
    expect(isResolvedStatus('pending')).toBe(false)
  })
})

describe('categoryWorkflow / empty-category auto-skip', () => {
  it('a category with zero findings is skipped (not visible, not blocking)', () => {
    const findings = [
      // No abbreviations findings at all.
      f('medical_terms', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.visible.has('abbreviations')).toBe(false)
    expect(state.completed.has('abbreviations')).toBe(false)
    expect(state.nextUnlocked).toBe('medical_terms')
    expect(state.visible.has('medical_terms')).toBe(true)
  })

  it('skips multiple empty categories in sequence and lands on the first with findings', () => {
    const findings = [
      // Abbreviations, Medical Terms, Hyphenation all empty.
      f('grammar', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.visible.size).toBe(1)
    expect(state.nextUnlocked).toBe('grammar')
  })

  it('every category empty → nothing visible, no next', () => {
    const state = computeCategoryWorkflow([])
    expect(state.visible.size).toBe(0)
    expect(state.completed.size).toBe(0)
    expect(state.nextUnlocked).toBeNull()
  })
})

describe('categoryWorkflow / only one next category unlocks at a time', () => {
  it('after Abbreviations completes with multiple downstream categories pending, ONLY Medical Terms unlocks', () => {
    const findings = [
      f('abbreviations', 'accepted'),
      f('medical_terms', 'pending'),
      f('hyphenation', 'pending'),
      f('grammar', 'pending'),
      f('spelling', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.visible.has('abbreviations')).toBe(true)
    expect(state.visible.has('medical_terms')).toBe(true)
    // None of the downstream chips unlock yet.
    expect(state.visible.has('hyphenation')).toBe(false)
    expect(state.visible.has('grammar')).toBe(false)
    expect(state.visible.has('spelling')).toBe(false)
    expect(state.nextUnlocked).toBe('medical_terms')
  })

  it('cascades one step at a time as each category completes', () => {
    // Full cascade: abbreviations+medical_terms resolved → hyphenation unlocks.
    const findings = [
      f('abbreviations', 'accepted'),
      f('medical_terms', 'edited'),
      f('hyphenation', 'pending'),
      f('grammar', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.visible.has('abbreviations')).toBe(true)
    expect(state.visible.has('medical_terms')).toBe(true)
    expect(state.visible.has('hyphenation')).toBe(true)
    expect(state.visible.has('grammar')).toBe(false)
    expect(state.nextUnlocked).toBe('hyphenation')
  })

  it('reveals every category when every finding is resolved', () => {
    const findings = oneEach('accepted')
    const state = computeCategoryWorkflow(findings)
    for (const cat of CATEGORY_UNLOCK_ORDER) {
      expect(state.visible.has(cat)).toBe(true)
      expect(state.completed.has(cat)).toBe(true)
    }
    expect(state.nextUnlocked).toBeNull()
  })
})

describe('categoryWorkflow / refresh and re-analysis', () => {
  it('a re-fetched findings list with persisted statuses yields the same workflow (refresh preservation)', () => {
    // Simulate the first session: reviewer resolved every AB.
    const session1 = [
      f('abbreviations', 'accepted'),
      f('abbreviations', 'edited'),
      f('medical_terms', 'pending'),
    ]
    const state1 = computeCategoryWorkflow(session1)
    expect(state1.nextUnlocked).toBe('medical_terms')

    // Reopen the document — GET /findings returns the same rows
    // (statuses persisted in DB). Workflow must come back at
    // Medical Terms, NOT reset to Abbreviations.
    const session2 = JSON.parse(JSON.stringify(session1))
    const state2 = computeCategoryWorkflow(session2)
    expect(state2.nextUnlocked).toBe('medical_terms')
    expect(state2.completed.has('abbreviations')).toBe(true)
  })

  it('re-analysis that resurrects a pending AB finding locks subsequent categories', () => {
    // Pre-reanalysis: AB fully resolved, MT in progress.
    const pre = [
      f('abbreviations', 'accepted'),
      f('medical_terms', 'pending'),
    ]
    expect(computeCategoryWorkflow(pre).visible.has('medical_terms')).toBe(true)

    // Post-reanalysis: a new AB pending finding appeared (e.g. an
    // Accept on one AB uncovered a downstream AB02).
    const post = [
      f('abbreviations', 'accepted'),
      f('abbreviations', 'pending'), // the new one
      f('medical_terms', 'pending'),
    ]
    const state = computeCategoryWorkflow(post)
    expect(state.nextUnlocked).toBe('abbreviations')
    // Medical Terms LOCKS BACK UP even though it was previously visible.
    expect(state.visible.has('medical_terms')).toBe(false)
  })

  it('completion survives a re-analysis that only re-asserts existing resolved rows', () => {
    // No new pending — just re-asserted resolved rows. State should
    // remain at Medical Terms.
    const findings = [
      f('abbreviations', 'accepted'),
      f('abbreviations', 'edited'),
      f('medical_terms', 'pending'),
    ]
    expect(computeCategoryWorkflow(findings).nextUnlocked).toBe('medical_terms')
  })
})

describe('categoryWorkflow / per-document independence', () => {
  it('each call is pure — the same findings always yield the same state regardless of history', () => {
    const findingsA = oneEach('pending')
    const findingsB = [f('medical_terms', 'pending')]
    const a1 = computeCategoryWorkflow(findingsA)
    const b = computeCategoryWorkflow(findingsB)
    const a2 = computeCategoryWorkflow(findingsA)
    // B's workflow doesn't bleed into subsequent A computations.
    expect(a1.nextUnlocked).toBe(a2.nextUnlocked)
    expect(b.nextUnlocked).toBe('medical_terms')
    expect(a2.nextUnlocked).toBe('abbreviations')
  })

  it('loading a new document (fresh findings list) initialises workflow from scratch', () => {
    // Document 1: partially worked through.
    const doc1 = [
      f('abbreviations', 'accepted'),
      f('medical_terms', 'pending'),
    ]
    const w1 = computeCategoryWorkflow(doc1)
    expect(w1.nextUnlocked).toBe('medical_terms')

    // Document 2: brand new, nothing done.
    const doc2 = oneEach('pending')
    const w2 = computeCategoryWorkflow(doc2)
    expect(w2.nextUnlocked).toBe('abbreviations')
    expect(w2.completed.size).toBe(0)
  })
})

describe('categoryWorkflow / category matching mirrors page filters', () => {
  it('"compounds" category counts toward the Hyphenation slot', () => {
    const findings = [
      f('abbreviations', 'accepted'),
      f('medical_terms', 'accepted'),
      f('compounds', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.nextUnlocked).toBe('hyphenation')
  })

  it('Inclusive-class findings (bias / article / term) are NOT in the actionable chain', () => {
    // Inclusive is view-only and outside the unlock chain. A doc
    // whose only findings are term-source or bias must leave the
    // chain fully "complete" (nothing to action) and surface the
    // Inclusive chip via ``allActionableCategoriesComplete``.
    const findings = [
      f('term', 'pending', { source: 'term' }),
      f('bias', 'pending'),
      f('article', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.nextUnlocked).toBeNull()
    expect(state.allActionableCategoriesComplete).toBe(true)
  })
})

// ─── Inclusive + Comments gate (view-only chips) ──────────────────

describe('categoryWorkflow / allActionableCategoriesComplete', () => {
  it('is false while any actionable category still has pending findings', () => {
    const state = computeCategoryWorkflow(oneEach('pending'))
    expect(state.allActionableCategoriesComplete).toBe(false)
  })

  it('is true when every actionable category is fully resolved', () => {
    const state = computeCategoryWorkflow(oneEach('accepted'))
    expect(state.allActionableCategoriesComplete).toBe(true)
  })

  it('is true for a document with no findings at all (every chain slot auto-skipped)', () => {
    const state = computeCategoryWorkflow([])
    expect(state.allActionableCategoriesComplete).toBe(true)
  })

  it('counts a mix of Accept / Edit / Ignore as resolved; Highlight blocks', () => {
    // Six actionable categories resolved, the seventh still highlighted.
    const findings = [
      f('abbreviations', 'accepted'),
      f('medical_terms', 'edited'),
      f('hyphenation', 'rejected'),
      f('grammar', 'accepted'),
      f('spelling', 'edited'),
      f('sentence', 'rejected'),
      f('typo', 'highlighted'), // Highlight alone is NOT resolved.
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.allActionableCategoriesComplete).toBe(false)
    expect(state.nextUnlocked).toBe('typo')
  })

  it('re-analysis that reopens an earlier chain slot closes the gate again', () => {
    const before = oneEach('accepted')
    const beforeState = computeCategoryWorkflow(before)
    expect(beforeState.allActionableCategoriesComplete).toBe(true)
    const after: WorkflowFinding[] = [
      ...before,
      f('abbreviations', 'pending'),  // re-analysis added this
    ]
    const afterState = computeCategoryWorkflow(after)
    expect(afterState.allActionableCategoriesComplete).toBe(false)
    expect(afterState.nextUnlocked).toBe('abbreviations')
  })
})

describe('categoryWorkflow / isInclusiveFinding', () => {
  it('matches every rule category that belongs in the view-only Inclusive tab', async () => {
    const { isInclusiveFinding } = await import('./categoryWorkflow')
    expect(isInclusiveFinding(f('bias', 'pending'))).toBe(true)
    expect(isInclusiveFinding(f('article', 'pending'))).toBe(true)
    expect(isInclusiveFinding(f('term', 'pending'))).toBe(true)
    expect(isInclusiveFinding(f('grammar', 'pending', { source: 'term' }))).toBe(true)
    // Non-inclusive categories:
    expect(isInclusiveFinding(f('grammar', 'pending'))).toBe(false)
    expect(isInclusiveFinding(f('abbreviations', 'pending'))).toBe(false)
  })
})
