/**
 * DocxViewer
 * Fetches a DOCX file, converts it to HTML with mammoth, and displays it
 * read-only in a TipTap editor with the full extension set so tables,
 * alignment, underline, colour, highlight etc. all render correctly.
 */
import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit       from '@tiptap/starter-kit'
import { Table }        from '@tiptap/extension-table'
import { TableRow }     from '@tiptap/extension-table-row'
import { TableCell }    from '@tiptap/extension-table-cell'
import { TableHeader }  from '@tiptap/extension-table-header'
import { TextAlign }    from '@tiptap/extension-text-align'
import { Underline }    from '@tiptap/extension-underline'
import { Color }        from '@tiptap/extension-color'
import { TextStyle }    from '@tiptap/extension-text-style'
import { Highlight }    from '@tiptap/extension-highlight'
import { FontFamily }   from '@tiptap/extension-font-family'
import mammoth          from 'mammoth'

interface DocxViewerProps {
  /** URL to fetch the DOCX file (e.g. the /download endpoint) */
  src:        string
  /** Editable when the chapter has an assignee; read-only otherwise */
  editable?:  boolean
  className?: string
}

const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Underline,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  FontFamily,
]

export function DocxViewer({ src, editable = false, className = '' }: DocxViewerProps) {
  const [html,    setHtml]    = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const editor = useEditor({
    extensions:  EXTENSIONS,
    content:     '',
    editable,
    editorProps: {
      attributes: {
        class: [
          'prose prose-sm max-w-none focus:outline-none',
          'px-10 py-8',
          // table styles
          '[&_table]:border-collapse [&_table]:w-full',
          '[&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm',
          '[&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:text-sm [&_th]:bg-gray-50 [&_th]:font-semibold',
        ].join(' '),
      },
    },
  })

  // Fetch and convert DOCX → HTML when src changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setHtml(null)

    fetch(src, { cache: 'no-store' })   // bypass browser cache on every load
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.arrayBuffer()
      })
      .then(buf =>
        mammoth.convertToHtml({ arrayBuffer: buf }, {
          styleMap: [
            "p[style-name='Heading 1'] => h1",
            "p[style-name='Heading 2'] => h2",
            "p[style-name='Heading 3'] => h3",
            "p[style-name='Heading 4'] => h4",
            "p[style-name='Heading 5'] => h5",
            "p[style-name='Heading 6'] => h6",
            "u              => u",
            "strike         => s",
            "br             => br",
          ],
        })
      )
      .then(result => {
        if (!cancelled) setHtml(result.value)
      })
      .catch(err => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load document')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [src])

  // Push converted HTML into editor once available
  useEffect(() => {
    if (editor && html !== null) {
      editor.commands.setContent(html, false)
    }
  }, [editor, html])

  // Sync editable prop → editor when assignee changes
  useEffect(() => {
    if (editor) editor.setEditable(editable)
  }, [editor, editable])

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-full bg-white ${className}`}>
        <div className="flex flex-col items-center gap-2 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs">Loading document…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full bg-white ${className}`}>
        <p className="text-xs text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className={`h-full overflow-y-auto bg-white ${className}`}>
      <EditorContent editor={editor} />
    </div>
  )
}
