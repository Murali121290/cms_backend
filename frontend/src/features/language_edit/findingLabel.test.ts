import { describe, it, expect } from 'vitest'

import { displayCategoryFor } from './findingLabel'

/**
 * Regression tests for the finding-card label derivation.
 *
 * The card header previously showed the engine category ('grammar' /
 * 'sentence') for every Basic Grammar workbook finding. After this
 * change it shows the originating workbook sheet label when the
 * backend serializer supplies ``subcategory``; non-workbook findings
 * keep their existing label via the fallback chain.
 *
 * Sidebar grouping is NOT touched — that still uses ``category``.
 */

describe('displayCategoryFor', () => {
  // ─── subcategory wins when present ────────────────────────────

  it('uses subcategory for Basic Grammar workbook findings', () => {
    expect(displayCategoryFor({
      category: 'grammar',
      subcategory: 'Basic Grammar',
    })).toBe('Basic Grammar')
  })

  it('uses subcategory for Article Usage findings', () => {
    expect(displayCategoryFor({
      category: 'grammar',
      subcategory: 'Article Usage',
    })).toBe('Article Usage')
  })

  it('uses subcategory for Subject-Verb Agreement findings', () => {
    expect(displayCategoryFor({
      category: 'grammar',
      subcategory: 'Subject-Verb Agreement',
    })).toBe('Subject-Verb Agreement')
  })

  it('uses subcategory for Common Misuse findings', () => {
    expect(displayCategoryFor({
      category: 'grammar',
      subcategory: 'Common Misuse',
    })).toBe('Common Misuse')
  })

  it('uses subcategory for Word/Phrase Choice findings', () => {
    expect(displayCategoryFor({
      category: 'grammar',
      subcategory: 'Word/Phrase Choice',
    })).toBe('Word/Phrase Choice')
  })

  it('uses subcategory for Sentence Structure findings', () => {
    expect(displayCategoryFor({
      category: 'grammar',
      subcategory: 'Sentence Structure',
    })).toBe('Sentence Structure')
  })

  it('uses subcategory for Punctuation and Capitalization findings', () => {
    expect(displayCategoryFor({
      category: 'sentence',
      subcategory: 'Punctuation and Capitalization',
    })).toBe('Punctuation and Capitalization')
  })

  // ─── Fallbacks when subcategory is absent ─────────────────────

  it('falls back to engine category when subcategory is null', () => {
    expect(displayCategoryFor({ category: 'grammar', subcategory: null })).toBe('grammar')
    expect(displayCategoryFor({ category: 'spelling', subcategory: null })).toBe('spelling')
    expect(displayCategoryFor({ category: 'abbreviations', subcategory: null })).toBe('abbreviations')
    expect(displayCategoryFor({ category: 'bias', subcategory: null })).toBe('bias')
  })

  it('falls back to engine category when subcategory is undefined', () => {
    expect(displayCategoryFor({ category: 'spelling' })).toBe('spelling')
    expect(displayCategoryFor({ category: 'sentence' })).toBe('sentence')
  })

  it('falls back when subcategory is empty or whitespace-only', () => {
    expect(displayCategoryFor({ category: 'grammar', subcategory: '' })).toBe('grammar')
    expect(displayCategoryFor({ category: 'grammar', subcategory: '   ' })).toBe('grammar')
  })

  // ─── Legacy category rename still applies on the fallback path ─

  it('renames legacy compounds → hyphenation when no subcategory', () => {
    expect(displayCategoryFor({ category: 'compounds' })).toBe('hyphenation')
    expect(displayCategoryFor({ category: 'compound' })).toBe('hyphenation')
  })

  it('renames medical_terms → medical when no subcategory', () => {
    expect(displayCategoryFor({ category: 'medical_terms' })).toBe('medical')
  })

  // ─── Subcategory overrides even the legacy renames ────────────

  it('subcategory wins over the legacy medical_terms rename', () => {
    // Hypothetical future workbook rule tagged with medical_terms +
    // a specific source label — the source label still wins.
    expect(displayCategoryFor({
      category: 'medical_terms',
      subcategory: 'Medical Terminology',
    })).toBe('Medical Terminology')
  })

  // ─── Sidebar grouping is not this helper's job ────────────────

  it('does not mutate the input (pure function)', () => {
    const f = { category: 'grammar', subcategory: 'Article Usage' }
    displayCategoryFor(f)
    expect(f.category).toBe('grammar')
    expect(f.subcategory).toBe('Article Usage')
  })
})
