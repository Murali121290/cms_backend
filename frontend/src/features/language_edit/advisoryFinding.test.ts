import { describe, it, expect } from 'vitest'

import { isAdvisoryIdentity } from './advisoryFinding'

/**
 * Regression tests for the two-mode finding card UI predicate.
 *
 * Case 1 (replacement diff): isAdvisoryIdentity → false. Card renders
 *   original → suggestion in red-strikethrough + green, with Accept /
 *   Edit / Highlight / Ignore actions.
 *
 * Case 2 (advisory identity): isAdvisoryIdentity → true. Card hides the
 *   diff arrow, hides Accept + Edit, shows the phrase once as muted
 *   italic text, keeps Highlight + Ignore.
 */

describe('isAdvisoryIdentity — the Case-2 trigger', () => {
  // ─── Case 2: advisory flag + identical texts ───────────────────

  it('treats passive_voice "was considered" as Case 2', () => {
    expect(isAdvisoryIdentity({
      advisory: true,
      original_text: 'was considered',
      suggestion: 'was considered',
    })).toBe(true)
  })

  it('treats passive_voice "were admitted" as Case 2', () => {
    expect(isAdvisoryIdentity({
      advisory: true,
      original_text: 'were admitted',
      suggestion: 'were admitted',
    })).toBe(true)
  })

  it('treats max_sentence_length (long sentence advisory) as Case 2', () => {
    const long = 'The patient was admitted with complex symptoms and later recovered fully'
    expect(isAdvisoryIdentity({
      advisory: true,
      original_text: long,
      suggestion: long,
    })).toBe(true)
  })

  it('tolerates whitespace-only differences when advisory=true', () => {
    expect(isAdvisoryIdentity({
      advisory: true,
      original_text: '  was considered  ',
      suggestion: 'was considered',
    })).toBe(true)
  })

  // ─── Case 1: real replacement findings ─────────────────────────

  it('treats a US→UK spelling replacement as Case 1', () => {
    expect(isAdvisoryIdentity({
      advisory: false,
      original_text: 'color',
      suggestion: 'colour',
    })).toBe(false)
  })

  it('treats hyphenation replacements as Case 1', () => {
    expect(isAdvisoryIdentity({
      advisory: false,
      original_text: 'acid base balance',
      suggestion: 'acid-base balance',
    })).toBe(false)
  })

  it('treats AB02 compression (treatment → Tx) as Case 1', () => {
    expect(isAdvisoryIdentity({
      advisory: false,
      original_text: 'treatment',
      suggestion: 'Tx',
    })).toBe(false)
  })

  // ─── Edge: advisory flag missing or undefined ──────────────────

  it('never treats a finding without the advisory flag as Case 2 even if texts match', () => {
    // The backend's _drop_identity_findings normally prevents this
    // combination, but the UI guard must not depend on identity alone.
    expect(isAdvisoryIdentity({
      original_text: 'word',
      suggestion: 'word',
    })).toBe(false)
    expect(isAdvisoryIdentity({
      advisory: false,
      original_text: 'word',
      suggestion: 'word',
    })).toBe(false)
  })

  // ─── Edge: advisory + differing texts ──────────────────────────

  it('falls through to Case 1 when advisory=true but texts actually differ', () => {
    // An advisory rule that ships a real suggestion should render as
    // Case 1 (diff + Accept available) — the backend flag alone is
    // not sufficient to suppress the diff.
    expect(isAdvisoryIdentity({
      advisory: true,
      original_text: 'walked briskly',
      suggestion: 'strode',
    })).toBe(false)
  })

  // ─── edited_text precedence ────────────────────────────────────

  it('uses edited_text when present for the identity check (Case 2 preserved after no-op edit)', () => {
    expect(isAdvisoryIdentity({
      advisory: true,
      original_text: 'was considered',
      suggestion: 'was considered',
      edited_text: 'was considered',
    })).toBe(true)
  })

  it('switches an advisory finding to Case 1 when the user edited it to real text', () => {
    // A reviewer who typed a real replacement into an advisory
    // finding's edit box turns it into a genuine diff — the predicate
    // follows edited_text precedence just like the diff renderer.
    expect(isAdvisoryIdentity({
      advisory: true,
      original_text: 'was considered',
      suggestion: 'was considered',
      edited_text: 'proved',
    })).toBe(false)
  })

  // ─── Robustness on missing / undefined fields ──────────────────

  it('handles empty strings without crashing', () => {
    expect(isAdvisoryIdentity({
      advisory: true,
      original_text: '',
      suggestion: '',
    })).toBe(true)
  })
})
