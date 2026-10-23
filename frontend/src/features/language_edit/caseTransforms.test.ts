import { describe, it, expect } from 'vitest'
import {
  upperCase,
  lowerCase,
  toTitleCase,
  applyCasePreservingStructure,
} from './caseTransforms'

// User-reported bug: `anti-anxiety` -> UPPERCASE was producing `ANTIANXIETY`
// (hyphen stripped). These tests lock in the invariant that the three
// Language Editor case-conversion controls change letter case ONLY and
// preserve every other character of the input, including hyphens.

describe('caseTransforms — anti-anxiety regression', () => {
  it('UPPERCASE preserves the hyphen in anti-anxiety', () => {
    expect(upperCase('anti-anxiety')).toBe('ANTI-ANXIETY')
  })

  it('lowercase preserves the hyphen in ANTI-ANXIETY', () => {
    expect(lowerCase('ANTI-ANXIETY')).toBe('anti-anxiety')
  })

  it('Title Case preserves the hyphen in anti-anxiety -> Anti-Anxiety', () => {
    expect(toTitleCase('anti-anxiety')).toBe('Anti-Anxiety')
  })
})

describe('caseTransforms — hyphenated prefixes', () => {
  const samples: Array<[string, string, string, string]> = [
    // input, UPPER, lower, Title
    ['pre-intervention', 'PRE-INTERVENTION', 'pre-intervention', 'Pre-Intervention'],
    ['post-intervention', 'POST-INTERVENTION', 'post-intervention', 'Post-Intervention'],
    ['anti-anxiety', 'ANTI-ANXIETY', 'anti-anxiety', 'Anti-Anxiety'],
    ['non-invasive', 'NON-INVASIVE', 'non-invasive', 'Non-Invasive'],
    ['co-op', 'CO-OP', 'co-op', 'Co-Op'],
    ['self-anti-anxiety', 'SELF-ANTI-ANXIETY', 'self-anti-anxiety', 'Self-Anti-Anxiety'],
  ]
  for (const [input, upper, lower, title] of samples) {
    it(`${JSON.stringify(input)} transforms without losing any hyphen`, () => {
      expect(upperCase(input)).toBe(upper)
      expect(lowerCase(input)).toBe(lower)
      expect(toTitleCase(input)).toBe(title)
    })
  }
})

describe('caseTransforms — idempotence and round-trips', () => {
  it('UPPERCASE applied twice is a no-op on hyphenated terms', () => {
    expect(upperCase(upperCase('anti-anxiety'))).toBe('ANTI-ANXIETY')
  })

  it('lowercase applied twice is a no-op on hyphenated terms', () => {
    expect(lowerCase(lowerCase('anti-anxiety'))).toBe('anti-anxiety')
  })

  it('Title Case normalises any input casing of a hyphenated term', () => {
    expect(toTitleCase('anti-anxiety')).toBe('Anti-Anxiety')
    expect(toTitleCase('ANTI-ANXIETY')).toBe('Anti-Anxiety')
    expect(toTitleCase('Anti-Anxiety')).toBe('Anti-Anxiety')
    expect(toTitleCase('AnTi-AnXiEtY')).toBe('Anti-Anxiety')
  })
})

describe('caseTransforms — non-letter characters are preserved', () => {
  it('spaces survive each transform', () => {
    expect(upperCase('anti anxiety meds')).toBe('ANTI ANXIETY MEDS')
    expect(lowerCase('ANTI ANXIETY MEDS')).toBe('anti anxiety meds')
    expect(toTitleCase('anti anxiety meds')).toBe('Anti Anxiety Meds')
  })

  it('apostrophes stay inside the word for Title Case', () => {
    // Title Case keeps apostrophes as intra-word so possessives read naturally.
    expect(toTitleCase("o'brien")).toBe("O'brien")
    expect(upperCase("don't")).toBe("DON'T")
    expect(lowerCase("DON'T")).toBe("don't")
  })

  it('non-breaking hyphen (U+2011) is preserved', () => {
    const nbhyphen = 'anti‑anxiety'
    expect(upperCase(nbhyphen)).toBe('ANTI‑ANXIETY')
    expect(lowerCase('ANTI‑ANXIETY')).toBe('anti‑anxiety')
    expect(toTitleCase(nbhyphen)).toBe('Anti‑Anxiety')
  })

  it('en-dash (U+2013) between letter runs is preserved', () => {
    const endash = 'anti–anxiety'
    expect(upperCase(endash)).toBe('ANTI–ANXIETY')
    expect(lowerCase('ANTI–ANXIETY')).toBe('anti–anxiety')
    // En-dash is not part of a letter run, so Title Case treats the two sides
    // as separate words — exact same behaviour as a plain hyphen.
    expect(toTitleCase(endash)).toBe('Anti–Anxiety')
  })

  it('digits and other punctuation inside the input survive untouched', () => {
    expect(upperCase('covid-19')).toBe('COVID-19')
    expect(lowerCase('COVID-19')).toBe('covid-19')
    expect(toTitleCase('covid-19')).toBe('Covid-19')
  })

  it('Unicode letter + combining mark is preserved', () => {
    expect(upperCase('naïve')).toBe('NAÏVE')
    expect(lowerCase('NAÏVE')).toBe('naïve')
    expect(toTitleCase('naïve')).toBe('Naïve')
  })
})

describe('caseTransforms — empty and whitespace input', () => {
  it('empty string stays empty for all three', () => {
    expect(upperCase('')).toBe('')
    expect(lowerCase('')).toBe('')
    expect(toTitleCase('')).toBe('')
  })

  it('whitespace-only input is preserved', () => {
    expect(upperCase('   ')).toBe('   ')
    expect(lowerCase('   ')).toBe('   ')
    expect(toTitleCase('   ')).toBe('   ')
  })
})

describe('applyCasePreservingStructure — restores hyphens stripped by backend suggestions', () => {
  // Backend rule GP009 can emit a suggestion that drops the hyphen
  // (`non-nurturing` → `nonnurturing`). When the user clicks UPPERCASE on
  // the prefilled suggestion they expect the hyphen back.

  it('non-nurturing: UPPERCASE on `nonnurturing` yields `NON-NURTURING`', () => {
    expect(applyCasePreservingStructure('nonnurturing', 'non-nurturing', upperCase))
      .toBe('NON-NURTURING')
  })

  it('anti-anxiety: UPPERCASE on `antianxiety` yields `ANTI-ANXIETY`', () => {
    expect(applyCasePreservingStructure('antianxiety', 'anti-anxiety', upperCase))
      .toBe('ANTI-ANXIETY')
  })

  it('pre-intervention: UPPERCASE on `preintervention` yields `PRE-INTERVENTION`', () => {
    expect(applyCasePreservingStructure('preintervention', 'pre-intervention', upperCase))
      .toBe('PRE-INTERVENTION')
  })

  it('post-intervention: UPPERCASE on `postintervention` yields `POST-INTERVENTION`', () => {
    expect(applyCasePreservingStructure('postintervention', 'post-intervention', upperCase))
      .toBe('POST-INTERVENTION')
  })

  it('lowercase route: already-lower input stays with hyphen from original', () => {
    expect(applyCasePreservingStructure('NONNURTURING', 'non-nurturing', lowerCase))
      .toBe('non-nurturing')
  })

  it('Title Case restores hyphens', () => {
    expect(applyCasePreservingStructure('nonnurturing', 'non-nurturing', toTitleCase))
      .toBe('Non-Nurturing')
  })

  it('when input is a letter-identical variant with no original, falls back to input', () => {
    expect(applyCasePreservingStructure('nonnurturing', '', upperCase)).toBe('NONNURTURING')
    expect(applyCasePreservingStructure('nonnurturing', undefined, upperCase)).toBe('NONNURTURING')
    expect(applyCasePreservingStructure('nonnurturing', null, upperCase)).toBe('NONNURTURING')
  })

  it('when input and original are letter-different, respect the input', () => {
    // Typo correction: original `recieved` → suggestion `received`. User
    // clicks UPPERCASE on `received`; the result must NOT reach into the
    // original (which would say `RECIEVED` — reintroducing the typo).
    expect(applyCasePreservingStructure('received', 'recieved', upperCase))
      .toBe('RECEIVED')
  })

  it('restores the hyphen even if the user hand-edits the suggestion', () => {
    // User cleared the input and retyped the stripped form by hand.
    // Still the same letter sequence as original → UPPERCASE should re-add
    // the hyphen.
    expect(applyCasePreservingStructure('NonNurturing', 'non-nurturing', upperCase))
      .toBe('NON-NURTURING')
  })

  it('idempotence: UPPERCASE twice yields the same hyphenated form', () => {
    const once = applyCasePreservingStructure('nonnurturing', 'non-nurturing', upperCase)
    const twice = applyCasePreservingStructure(once, 'non-nurturing', upperCase)
    expect(twice).toBe('NON-NURTURING')
  })

  it('does not inject hyphens the original did not have', () => {
    // Original was plain, suggestion is a fresh typing. UPPERCASE should
    // not fabricate structure.
    expect(applyCasePreservingStructure('hello', 'hello', upperCase)).toBe('HELLO')
  })

  it('replacement length differs from original: letter signature still drives the lookup', () => {
    // Suggestion added characters the original didn't have (e.g. an edit
    // that changes letters). The signatures differ → apply transform to
    // the input only, don't try to overlay original.
    expect(applyCasePreservingStructure('nonnurtured', 'non-nurturing', upperCase))
      .toBe('NONNURTURED')
  })
})

describe('caseTransforms — hyphen character count invariant', () => {
  // Every character other than letters is preserved exactly, so the number of
  // hyphens in the output must equal the number in the input across all three
  // transforms. This catches any future regression that word-tokenises the
  // input and drops separators.
  const inputs = [
    'anti-anxiety',
    'pre-intervention',
    'post-intervention',
    'self-anti-anxiety-pre',
    'covid-19',
    '-leading-and-trailing-',
  ]
  for (const input of inputs) {
    it(`hyphen count is preserved for ${JSON.stringify(input)}`, () => {
      const expected = (input.match(/-/g) || []).length
      expect((upperCase(input).match(/-/g) || []).length).toBe(expected)
      expect((lowerCase(input).match(/-/g) || []).length).toBe(expected)
      expect((toTitleCase(input).match(/-/g) || []).length).toBe(expected)
    })
  }
})
