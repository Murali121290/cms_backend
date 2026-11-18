import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The Language Editor's Track Changes visualisation (red strikethrough for
// deletions, green insertion) is driven by two CSS rules inside
// WysiwygEditor.tsx. Those classes (``tc-insert``, ``tc-delete``) are
// also the ones the backend's xhtml_to_docx parser recognises to produce
// ``w:ins`` / ``w:del`` revision markup in the exported DOCX. If anyone
// deletes or renames them the visual spec silently breaks AND the
// exported file stops carrying real tracked changes — this test fails
// first.
//
// Per the current design the diff is font-only — no red / green
// background fills — so the inline tracked change reads cleanly against
// the document. The ``mark`` / ``.tc-highlight`` yellow Highlight is a
// separate action and keeps its background (not asserted here).

const __dirname = dirname(fileURLToPath(import.meta.url))
const wysiwygPath = resolve(__dirname, '../editor/WysiwygEditor.tsx')
const source = readFileSync(wysiwygPath, 'utf-8')

describe('TrackChanges editor styling — red strikethrough / green insertion', () => {
  it('declares a .tc-insert rule with green font color and no background fill', () => {
    const match = source.match(/\.tc-insert[^}]+}/)
    expect(match, 'missing .tc-insert CSS rule').not.toBeNull()
    const block = match![0]
    // Green text color stays — it's how the reviewer spots the insertion.
    expect(block).toMatch(/color:\s*rgb\(\s*21\s*,\s*128\s*,\s*61/)
    // Background fill removed — font-only diff.
    expect(block).toMatch(/background-color:\s*transparent/)
    // Still underlined so the insertion is visually distinct from
    // surrounding prose.
    expect(block).toMatch(/text-decoration:\s*underline/)
  })

  it('declares a .tc-delete rule with red font color, strikethrough, and no background fill', () => {
    const match = source.match(/\.tc-delete[^}]+}/)
    expect(match, 'missing .tc-delete CSS rule').not.toBeNull()
    const block = match![0]
    // Red text color and the strikethrough are preserved.
    expect(block).toMatch(/color:\s*rgba\(\s*127\s*,\s*29\s*,\s*29/)
    expect(block).toMatch(/text-decoration:\s*line-through/)
    // Background fill removed.
    expect(block).toMatch(/background-color:\s*transparent/)
  })

  it('.tc-delete hover state has no red background either', () => {
    // Previously the hover state deepened the red fill. With the
    // font-only treatment, hover must stay transparent so the
    // backgroundless look is consistent in both static and hover
    // states.
    const match = source.match(/\.tc-delete:hover[^}]+}/)
    expect(match, 'missing .tc-delete:hover CSS rule').not.toBeNull()
    expect(match![0]).toMatch(/background-color:\s*transparent/)
  })
})
