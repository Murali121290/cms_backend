import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TrackChanges } from '@/features/editor/TrackChanges'

// End-to-end check of the HTML shape produced by `replaceOccurrence` when
// `asTrackChanges: true`. We mirror the exact transaction the production
// path builds (addMark `del` + insert text with `ins` mark) so the resulting
// HTML is what gets saved and converted to DOCX by xhtml_to_docx. If this
// contract changes, the exported DOCX will stop producing proper `w:ins` /
// `w:del` revision markup — this test fails loudly first.

function makeEditor(html: string): Editor {
  // StarterKit's history conflicts with the dispatched TC transactions in a
  // test environment; disabling it mirrors the TrackChanges.test.ts setup.
  return new Editor({
    extensions: [TrackChanges, StarterKit.configure({ history: false } as any)],
    content: html,
  })
}

function applyTrackedReplace(editor: Editor, from: number, to: number, replacement: string) {
  const schema = editor.schema
  const delMark = schema.marks.del
  const insMark = schema.marks.ins
  const author = 'Reviewer'
  const date = '2026-10-22T00:00:00.000Z'
  const changeId = 'test-change-1'
  const tr = editor.state.tr
  tr.addMark(from, to, delMark.create({ author, date, changeId }))
  tr.insert(to, schema.text(replacement, [insMark.create({ author, date, changeId })]))
  tr.setMeta('preventTrackChanges', true)
  editor.view.dispatch(tr)
}

function applyPlainReplace(editor: Editor, from: number, to: number, replacement: string) {
  const tr = editor.state.tr.insertText(replacement, from, to)
  tr.setMeta('preventTrackChanges', true)
  editor.view.dispatch(tr)
}

describe('tracked replace (TC ON) — anti-anxiety → ANTI-ANXIETY', () => {
  it('leaves the original as <del class="tc-delete"> and inserts <ins class="tc-insert">', () => {
    const editor = makeEditor('<p>The anti-anxiety protocol.</p>')
    ;(editor as any).storage.trackChanges.enabled = true
    // Positions of `anti-anxiety` in the ProseMirror doc: `The ` is 4 chars
    // after the paragraph opener at pos 1, so the word starts at 5.
    const from = 5
    const to = from + 'anti-anxiety'.length
    applyTrackedReplace(editor, from, to, 'ANTI-ANXIETY')

    const html = editor.getHTML()
    expect(html).toContain('<del')
    expect(html).toContain('class="tc-delete"')
    expect(html).toContain('>anti-anxiety<')
    expect(html).toContain('<ins')
    expect(html).toContain('class="tc-insert"')
    expect(html).toContain('>ANTI-ANXIETY<')
    // Hyphen is preserved on BOTH sides of the tracked change.
    expect(html.match(/>anti-anxiety</)).not.toBeNull()
    expect(html.match(/>ANTI-ANXIETY</)).not.toBeNull()
  })

  it('non-nurturing → NON-NURTURING preserves the hyphen in the insertion', () => {
    const editor = makeEditor('<p>a non-nurturing environment.</p>')
    ;(editor as any).storage.trackChanges.enabled = true
    const from = 3
    const to = from + 'non-nurturing'.length
    applyTrackedReplace(editor, from, to, 'NON-NURTURING')
    const html = editor.getHTML()
    expect(html).toContain('>non-nurturing<')
    expect(html).toContain('>NON-NURTURING<')
    expect(html).toContain('tc-delete')
    expect(html).toContain('tc-insert')
  })

  it('tags the ins/del with author, date, and changeId so DOCX export produces w:ins/w:del', () => {
    const editor = makeEditor('<p>pre-intervention cohort.</p>')
    ;(editor as any).storage.trackChanges.enabled = true
    const from = 1
    const to = from + 'pre-intervention'.length
    applyTrackedReplace(editor, from, to, 'PRE-INTERVENTION')
    const html = editor.getHTML()
    expect(html).toContain('data-author="Reviewer"')
    expect(html).toContain('data-date="2026-10-22T00:00:00.000Z"')
    expect(html).toContain('data-change-id="test-change-1"')
  })

  it('repeated tracked replacements do not corrupt earlier changes', () => {
    const editor = makeEditor('<p>anti-anxiety and post-intervention.</p>')
    ;(editor as any).storage.trackChanges.enabled = true
    applyTrackedReplace(editor, 1, 1 + 'anti-anxiety'.length, 'ANTI-ANXIETY')
    // After the first replace the paragraph now contains both the <del>
    // original and the <ins> replacement, so later indices need to account
    // for the inserted text. Find the second word's start by searching.
    const text = editor.state.doc.textContent
    const start = text.indexOf('post-intervention')
    expect(start).toBeGreaterThanOrEqual(0)
    applyTrackedReplace(
      editor,
      start + 1,
      start + 1 + 'post-intervention'.length,
      'POST-INTERVENTION',
    )
    const html = editor.getHTML()
    // Both earlier and later tracked changes survive intact.
    expect(html).toContain('>anti-anxiety<')
    expect(html).toContain('>ANTI-ANXIETY<')
    expect(html).toContain('>post-intervention<')
    expect(html).toContain('>POST-INTERVENTION<')
  })

  it('reopening the saved HTML preserves <ins>/<del> marks', () => {
    const first = makeEditor('<p>anti-anxiety protocol.</p>')
    ;(first as any).storage.trackChanges.enabled = true
    applyTrackedReplace(first, 1, 1 + 'anti-anxiety'.length, 'ANTI-ANXIETY')
    const saved = first.getHTML()

    // A fresh editor started from the saved HTML must round-trip the marks.
    const reopened = makeEditor(saved)
    const rehtml = reopened.getHTML()
    expect(rehtml).toContain('class="tc-delete"')
    expect(rehtml).toContain('class="tc-insert"')
    expect(rehtml).toContain('>anti-anxiety<')
    expect(rehtml).toContain('>ANTI-ANXIETY<')
  })
})

describe('plain replace (TC OFF)', () => {
  it('does NOT emit <del>/<ins> markup', () => {
    const editor = makeEditor('<p>anti-anxiety protocol.</p>')
    ;(editor as any).storage.trackChanges.enabled = false
    const from = 1
    const to = from + 'anti-anxiety'.length
    applyPlainReplace(editor, from, to, 'ANTI-ANXIETY')
    const html = editor.getHTML()
    expect(html).not.toContain('<del')
    expect(html).not.toContain('<ins')
    expect(html).not.toContain('tc-delete')
    expect(html).not.toContain('tc-insert')
    // The text swap did happen.
    expect(html).toContain('ANTI-ANXIETY')
    expect(html).not.toContain('anti-anxiety')
  })

  it('preserves hyphen in the replacement even without tracked changes', () => {
    const editor = makeEditor('<p>non-nurturing environment.</p>')
    const from = 1
    const to = from + 'non-nurturing'.length
    applyPlainReplace(editor, from, to, 'NON-NURTURING')
    expect(editor.getHTML()).toContain('NON-NURTURING')
  })
})

describe('tracked replace preserves surrounding formatting', () => {
  it('bold text around a tracked replacement remains bold', () => {
    const editor = makeEditor('<p>before <strong>bold anti-anxiety text</strong> after</p>')
    ;(editor as any).storage.trackChanges.enabled = true
    const text = editor.state.doc.textContent
    const start = text.indexOf('anti-anxiety')
    applyTrackedReplace(editor, start + 1, start + 1 + 'anti-anxiety'.length, 'ANTI-ANXIETY')
    const html = editor.getHTML()
    // The surrounding <strong> stays, and both the original and the
    // replacement inherit it (bold-and-tracked, like Word's revision view).
    expect(html).toContain('<strong>')
    expect(html).toContain('tc-delete')
    expect(html).toContain('tc-insert')
    expect(html).toContain('>bold ')
    expect(html).toContain(' text<')
  })
})
