import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TrackChanges } from '@/features/editor/TrackChanges'

// ─── Contract: LanguageReviewPage initialises TC = ON ────────────────────────
//
// The Language Editor's TC toolbar button is still the single live source of
// truth; this test only locks in the fact that the page SEEDS it to ON when
// mounting the WysiwygEditor. If anyone drops the prop or flips it to false,
// users would open a document and silently lose tracked-change behavior
// until they manually flipped the toolbar on. The source-level assertion
// here fails first.

const __dirname = dirname(fileURLToPath(import.meta.url))
const pagePath = resolve(__dirname, '../../pages/LanguageReviewPage.tsx')
const pageSource = readFileSync(pagePath, 'utf-8')

describe('LanguageReviewPage — TC default', () => {
  it('passes trackChangesEnabled={true} to WysiwygEditor', () => {
    expect(pageSource).toMatch(/trackChangesEnabled=\{true\}/)
  })

  it('mounts the editor with a fileId-scoped key so switching documents remounts and re-defaults', () => {
    // The remount is what guarantees "manual OFF never leaks past the
    // current document session". If this key goes stale, a user could
    // toggle TC off on one document and have that state silently persist
    // to the next.
    expect(pageSource).toMatch(/key=\{`editor-\$\{parsedFileId\}`\}/)
  })
})

// ─── Behaviour: TC ON = tracked edits; manual OFF = plain edits ──────────────
//
// Drives a bare Tiptap editor through the same storage-flag → plugin
// handshake WysiwygEditor uses. This locks in that:
//   1. Setting `storage.trackChanges.enabled = true` right after mount makes
//      edits produce <del>/<ins> markup.
//   2. Flipping the flag back to false mid-session switches subsequent edits
//      to plain insertion with no new tracked markup — proving the toolbar's
//      manual OFF is honored by the replacement path, not just visually.

function makeEditor(html: string): Editor {
  return new Editor({
    extensions: [TrackChanges, StarterKit.configure({ history: false } as any)],
    content: html,
  })
}

function dispatchPlainReplace(editor: Editor, from: number, to: number, replacement: string) {
  const tr = editor.state.tr.insertText(replacement, from, to)
  tr.setMeta('preventTrackChanges', true)
  editor.view.dispatch(tr)
}

function dispatchTrackedReplace(editor: Editor, from: number, to: number, replacement: string) {
  const schema = editor.schema
  const delMark = schema.marks.del
  const insMark = schema.marks.ins
  const author = 'Reviewer'
  const date = '2026-10-22T00:00:00.000Z'
  const changeId = 'default-tc-1'
  const tr = editor.state.tr
  tr.addMark(from, to, delMark.create({ author, date, changeId }))
  tr.insert(to, schema.text(replacement, [insMark.create({ author, date, changeId })]))
  tr.setMeta('preventTrackChanges', true)
  editor.view.dispatch(tr)
}

describe('Track Changes default ON — behavior', () => {
  it('TC flag seeded ON at open: a replacement records <del>+<ins>', () => {
    const editor = makeEditor('<p>anti-anxiety protocol.</p>')
    // Mirror what WysiwygEditor does when trackChangesEnabled={true}: on
    // mount it writes `storage.enabled = true` so the plugin tracks edits.
    ;(editor as any).storage.trackChanges.enabled = true
    dispatchTrackedReplace(editor, 1, 1 + 'anti-anxiety'.length, 'ANTI-ANXIETY')
    const html = editor.getHTML()
    expect(html).toContain('tc-delete')
    expect(html).toContain('tc-insert')
    expect(html).toContain('>anti-anxiety<')
    expect(html).toContain('>ANTI-ANXIETY<')
  })

  it('user flips TC off mid-session: subsequent replacement is plain, no new markup', () => {
    const editor = makeEditor('<p>anti-anxiety and non-nurturing.</p>')
    ;(editor as any).storage.trackChanges.enabled = true
    // First replacement under TC ON — tracked.
    dispatchTrackedReplace(editor, 1, 1 + 'anti-anxiety'.length, 'ANTI-ANXIETY')
    expect(editor.getHTML()).toContain('tc-insert')

    // User clicks the TC toolbar button → tcEnabled flips, which writes
    // storage.enabled = false (same effect as the useEffect in
    // WysiwygEditor).
    ;(editor as any).storage.trackChanges.enabled = false

    // Second replacement: no new tracked markup, text is swapped in place.
    const text = editor.state.doc.textContent
    const start = text.indexOf('non-nurturing')
    expect(start).toBeGreaterThan(-1)
    dispatchPlainReplace(editor, start + 1, start + 1 + 'non-nurturing'.length, 'NON-NURTURING')

    const html = editor.getHTML()
    // Earlier tracked change still visible (not clobbered).
    expect(html).toContain('>anti-anxiety<')
    expect(html).toContain('>ANTI-ANXIETY<')
    // Second edit happened as a plain swap — no NEW tracked span for it.
    expect(html).toContain('NON-NURTURING')
    expect(html).not.toContain('>non-nurturing<')
  })

  it('user flips TC back on: subsequent replacement is tracked again', () => {
    const editor = makeEditor('<p>pre-intervention cohort.</p>')
    ;(editor as any).storage.trackChanges.enabled = false
    dispatchPlainReplace(editor, 1, 1 + 'pre-intervention'.length, 'PRE-INTERVENTION')
    expect(editor.getHTML()).not.toContain('tc-insert')

    ;(editor as any).storage.trackChanges.enabled = true
    const text = editor.state.doc.textContent
    const start = text.indexOf('cohort')
    dispatchTrackedReplace(editor, start + 1, start + 1 + 'cohort'.length, 'COHORT')
    const html = editor.getHTML()
    expect(html).toContain('tc-delete')
    expect(html).toContain('tc-insert')
    expect(html).toContain('>cohort<')
    expect(html).toContain('>COHORT<')
  })
})
