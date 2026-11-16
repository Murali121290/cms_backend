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
 * status is pending.
 */
function oneEach(status: string = 'pending', overrides: Partial<Record<UnlockCategory, string>> = {}): WorkflowFinding[] {
  return CATEGORY_UNLOCK_ORDER.map(cat => f(cat, overrides[cat] ?? status))
}

// Post-revert contract: every category chip in CATEGORY_UNLOCK_ORDER
// is visible immediately, Inclusive + Comments gate as "complete" from
// the start, and ``completed`` / ``nextUnlocked`` continue to describe
// resolution progress for any tooling that still cares. The sidebar
// does NOT reveal chips one-at-a-time anymore.

describe('categoryWorkflow / always-visible chips (post-revert)', () => {
  it('visible contains every category in CATEGORY_UNLOCK_ORDER when every category has pending findings', () => {
    const state = computeCategoryWorkflow(oneEach('pending'))
    expect(Array.from(state.visible).sort()).toEqual([...CATEGORY_UNLOCK_ORDER].sort())
    // First pending category is still reported as the next unresolved
    // one for telemetry / tooling callers, even though the UI does
    // not gate chips on it anymore.
    expect(state.nextUnlocked).toBe('abbreviations')
    expect(state.completed.size).toBe(0)
  })

  it('visible contains every category even when the document has zero findings', () => {
    const state = computeCategoryWorkflow([])
    expect(Array.from(state.visible).sort()).toEqual([...CATEGORY_UNLOCK_ORDER].sort())
    expect(state.nextUnlocked).toBeNull()
    expect(state.completed.size).toBe(0)
  })

  it('visible still contains every category after some are fully resolved', () => {
    const findings = [
      f('abbreviations', 'accepted'),
      f('medical_terms', 'edited'),
      f('hyphenation', 'rejected'),
      f('grammar', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    for (const cat of CATEGORY_UNLOCK_ORDER) {
      expect(state.visible.has(cat)).toBe(true)
    }
  })

  it('visible is unaffected by status mix — Accept All a category keeps its chip visible', () => {
    const findings = oneEach('pending', {
      abbreviations: 'accepted',
      medical_terms: 'accepted',
    })
    const state = computeCategoryWorkflow(findings)
    expect(state.visible.has('abbreviations')).toBe(true)
    expect(state.visible.has('medical_terms')).toBe(true)
    expect(state.completed.has('abbreviations')).toBe(true)
    expect(state.completed.has('medical_terms')).toBe(true)
  })
})

describe('categoryWorkflow / allActionableCategoriesComplete (post-revert)', () => {
  it('is always true — Inclusive + Comments chips show from first load regardless of resolution state', () => {
    // Every pending — the chain is NOT literally complete, but the
    // flag is hard-coded true so the UI stops gating Inclusive +
    // Comments on an earlier milestone.
    expect(computeCategoryWorkflow(oneEach('pending')).allActionableCategoriesComplete).toBe(true)
    // Everything resolved — still true.
    expect(computeCategoryWorkflow(oneEach('accepted')).allActionableCategoriesComplete).toBe(true)
    // Nothing at all — still true.
    expect(computeCategoryWorkflow([]).allActionableCategoriesComplete).toBe(true)
    // Mid-progress mix — still true.
    const mix = [
      f('abbreviations', 'accepted'),
      f('medical_terms', 'highlighted'),
      f('grammar', 'pending'),
    ]
    expect(computeCategoryWorkflow(mix).allActionableCategoriesComplete).toBe(true)
  })
})

describe('categoryWorkflow / completed tracking stays accurate', () => {
  it('a category whose every finding is Accept / Edit / Ignore shows up in completed', () => {
    const findings = [
      f('abbreviations', 'accepted'),
      f('abbreviations', 'edited'),
      f('abbreviations', 'rejected'),
      f('medical_terms', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.completed.has('abbreviations')).toBe(true)
    expect(state.completed.has('medical_terms')).toBe(false)
  })

  it('a Highlight decision alone does NOT mark the category completed', () => {
    const findings = [
      f('abbreviations', 'highlighted'),
      f('medical_terms', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.completed.has('abbreviations')).toBe(false)
    expect(state.nextUnlocked).toBe('abbreviations')
  })

  it('a category with zero findings is NOT marked completed (there was nothing to resolve)', () => {
    const findings = [f('medical_terms', 'pending')]
    const state = computeCategoryWorkflow(findings)
    expect(state.completed.has('abbreviations')).toBe(false)
  })

  it('exposes RESOLVED_STATUSES as exactly {accepted, edited, rejected}', () => {
    expect(isResolvedStatus('accepted')).toBe(true)
    expect(isResolvedStatus('edited')).toBe(true)
    expect(isResolvedStatus('rejected')).toBe(true)
    expect(isResolvedStatus('highlighted')).toBe(false)
    expect(isResolvedStatus('pending')).toBe(false)
  })
})

describe('categoryWorkflow / nextUnlocked tracking', () => {
  it('reports the first non-empty, not-fully-resolved category in CATEGORY_UNLOCK_ORDER', () => {
    const findings = [
      f('abbreviations', 'accepted'),
      f('medical_terms', 'pending'),
      f('hyphenation', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    expect(state.nextUnlocked).toBe('medical_terms')
  })

  it('is null when no actionable work remains', () => {
    const state = computeCategoryWorkflow(oneEach('accepted'))
    expect(state.nextUnlocked).toBeNull()
  })

  it('is null for a document with zero findings', () => {
    expect(computeCategoryWorkflow([]).nextUnlocked).toBeNull()
  })

  it('cascades forward correctly through a mixed resolution progression', () => {
    const steps: Array<{ findings: WorkflowFinding[]; expected: UnlockCategory | null }> = [
      { findings: oneEach('pending'), expected: 'abbreviations' },
      { findings: oneEach('pending', { abbreviations: 'accepted' }), expected: 'medical_terms' },
      {
        findings: oneEach('pending', {
          abbreviations: 'accepted',
          medical_terms: 'edited',
        }),
        expected: 'hyphenation',
      },
      {
        findings: oneEach('pending', {
          abbreviations: 'accepted',
          medical_terms: 'edited',
          hyphenation: 'rejected',
          grammar: 'accepted',
          spelling: 'edited',
          sentence: 'rejected',
        }),
        expected: 'typo',
      },
      { findings: oneEach('accepted'), expected: null },
    ]
    for (const { findings, expected } of steps) {
      expect(computeCategoryWorkflow(findings).nextUnlocked).toBe(expected)
    }
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
    // Hyphenation still shows as a chip regardless of how the
    // underlying category string was spelled.
    expect(state.visible.has('hyphenation')).toBe(true)
  })

  it('Inclusive-class findings (bias / article / term) do NOT enter the actionable chain', () => {
    const findings = [
      f('term', 'pending', { source: 'term' }),
      f('bias', 'pending'),
      f('article', 'pending'),
    ]
    const state = computeCategoryWorkflow(findings)
    // Neither 'term', 'bias', nor 'article' is in CATEGORY_UNLOCK_ORDER,
    // so they don't affect nextUnlocked / completed. The actionable
    // chain has nothing to do here.
    expect(state.nextUnlocked).toBeNull()
    // But every actionable chip is still rendered (reverted behaviour).
    for (const cat of CATEGORY_UNLOCK_ORDER) {
      expect(state.visible.has(cat)).toBe(true)
    }
  })
})

describe('categoryWorkflow / purity + refresh preservation', () => {
  it('is pure — the same findings always yield the same state regardless of history', () => {
    const findingsA = oneEach('pending')
    const findingsB = [f('medical_terms', 'pending')]
    const a1 = computeCategoryWorkflow(findingsA)
    const b = computeCategoryWorkflow(findingsB)
    const a2 = computeCategoryWorkflow(findingsA)
    expect(a1.nextUnlocked).toBe(a2.nextUnlocked)
    expect(b.nextUnlocked).toBe('medical_terms')
    expect(a2.nextUnlocked).toBe('abbreviations')
    // Chip visibility is independent of previous calls.
    expect(Array.from(a1.visible).sort()).toEqual(Array.from(a2.visible).sort())
  })

  it('a re-fetched findings list with persisted statuses yields the same workflow state', () => {
    // Simulate persisted statuses across a page reload.
    const findings = [
      f('abbreviations', 'accepted'),
      f('abbreviations', 'edited'),
      f('medical_terms', 'pending'),
    ]
    const state1 = computeCategoryWorkflow(findings)
    const state2 = computeCategoryWorkflow(JSON.parse(JSON.stringify(findings)))
    expect(state1.nextUnlocked).toBe(state2.nextUnlocked)
    expect(Array.from(state1.completed).sort()).toEqual(Array.from(state2.completed).sort())
    expect(Array.from(state1.visible).sort()).toEqual(Array.from(state2.visible).sort())
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
