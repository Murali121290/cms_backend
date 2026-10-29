import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The Language Editor's Track Changes visualisation (red strikethrough for
// deletions, green highlight for insertions) is driven by two CSS rules
// inside WysiwygEditor.tsx. Those classes (`tc-insert`, `tc-delete`) are
// also the ones the backend's xhtml_to_docx parser recognises to produce
// `w:ins` / `w:del` revision markup in the exported DOCX. If anyone deletes
// or renames them the visual spec silently breaks AND the exported file
// stops carrying real tracked changes — this test fails first.

const __dirname = dirname(fileURLToPath(import.meta.url))
const wysiwygPath = resolve(__dirname, '../editor/WysiwygEditor.tsx')
const source = readFileSync(wysiwygPath, 'utf-8')

describe('TrackChanges editor styling — red strikethrough / green insertion', () => {
  it('declares a .tc-insert rule with green background', () => {
    const match = source.match(/\.tc-insert[^}]+}/)
    expect(match, 'missing .tc-insert CSS rule').not.toBeNull()
    const block = match![0]
    // Green background (any shade of rgba using the Tailwind green-500 base
    // or the explicit `rgba(34, 197, 94, …)` tuple).
    expect(block).toMatch(/background-color:\s*rgba\(\s*34\s*,\s*197\s*,\s*94/)
    // Green text color.
    expect(block).toMatch(/color:\s*rgb\(\s*21\s*,\s*128\s*,\s*61/)
  })

  it('declares a .tc-delete rule with red color + strikethrough', () => {
    const match = source.match(/\.tc-delete[^}]+}/)
    expect(match, 'missing .tc-delete CSS rule').not.toBeNull()
    const block = match![0]
    // Red background and red text.
    expect(block).toMatch(/background-color:\s*rgba\(\s*239\s*,\s*68\s*,\s*68/)
    expect(block).toMatch(/color:\s*rgba\(\s*127\s*,\s*29\s*,\s*29/)
    // Line-through, not underline — that's what distinguishes a deletion.
    expect(block).toMatch(/text-decoration:\s*line-through/)
  })
})
