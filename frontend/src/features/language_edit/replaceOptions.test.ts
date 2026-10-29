import { describe, it, expect } from 'vitest'
import { replaceOptionsFor } from './replaceOptions'

// Locks in the decision tree every Language Editor text-mutation path uses
// to call `WysiwygEditor.replaceOccurrence`. Centralising the choice here
// means the sidebar Accept/Edit button, the popover Replace button, and the
// popover's UPPERCASE/lowercase/Title Case buttons all branch the same way,
// so Track Changes behavior is consistent across the UI.

describe('replaceOptionsFor — Accept with TC toggle', () => {
  it('TC ON ⇒ asTrackChanges: true (produces <del>+<ins> pair)', () => {
    const opts = replaceOptionsFor('accepted', true)
    expect(opts).toEqual({ asTrackChanges: true })
  })

  it('TC OFF ⇒ asTrackChanges: false (plain in-place replace)', () => {
    const opts = replaceOptionsFor('accepted', false)
    expect(opts).toEqual({ asTrackChanges: false })
  })

  it('TC flag flips the option field byte-for-byte', () => {
    expect(replaceOptionsFor('accepted', true).asTrackChanges).toBe(true)
    expect(replaceOptionsFor('accepted', false).asTrackChanges).toBe(false)
  })
})

describe('replaceOptionsFor — Edit (sidebar + popover Replace + case buttons)', () => {
  it('TC ON ⇒ asTrackChanges: true', () => {
    expect(replaceOptionsFor('edited', true)).toEqual({ asTrackChanges: true })
  })

  it('TC OFF ⇒ asTrackChanges: false', () => {
    expect(replaceOptionsFor('edited', false)).toEqual({ asTrackChanges: false })
  })

  it('shares the Accept branch so UPPERCASE/lowercase/Title Case replace behave the same', () => {
    expect(replaceOptionsFor('edited', true)).toEqual(replaceOptionsFor('accepted', true))
    expect(replaceOptionsFor('edited', false)).toEqual(replaceOptionsFor('accepted', false))
  })
})

describe('replaceOptionsFor — Highlight is a separate affordance', () => {
  it('Highlight returns highlightOnly: true regardless of TC toggle', () => {
    expect(replaceOptionsFor('highlighted', false)).toEqual({ highlightOnly: true })
    expect(replaceOptionsFor('highlighted', true)).toEqual({ highlightOnly: true })
  })

  it('Highlight never carries asTrackChanges — it must not consume the TC flag path', () => {
    const opts = replaceOptionsFor('highlighted', true)
    expect(opts.asTrackChanges).toBeUndefined()
  })
})
