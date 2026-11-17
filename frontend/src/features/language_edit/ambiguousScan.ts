/**
 * Live manuscript scan for an AB07 ambiguous-abbreviation card whose
 * reviewer has picked a canonical meaning.
 *
 * Mirrors ``app/processing/language_editing/ambiguous_scan.py`` so the
 * card can show related occurrences the moment the reviewer clicks a
 * meaning button — before the Accept round-trip commits the choice.
 * Once committed, the backend's identical scan rides on the serialized
 * finding row (``f.ambiguous_scan``); this helper is purely the pre-commit
 * preview, driven off the TipTap editor's live paragraph text.
 *
 * Guarantees — matching the backend contract:
 *   * Never mutates text. Returns substrings quoted verbatim from the
 *     paragraph input so the "Original text" column shows the DOCX's own
 *     surface (case + whitespace preserved).
 *   * Classifies the first ``<expansion> (<abbr>)`` match as
 *     ``first_definition`` and later matches as ``repeated_definition``.
 *   * Matches of ``<other_candidate> (<abbr>)`` are surfaced as
 *     ``inconsistent_definition`` so the reviewer sees the conflict.
 *   * Standalone expansion phrase matches get ``kind='expansion'``;
 *     standalone abbreviation token matches get ``kind='abbreviation'``.
 *   * De-duplicates overlapping spans — an abbreviation sitting inside a
 *     definition's parentheses never appears twice.
 *   * No results when the chosen expansion / abbreviation never appear
 *     outside the originating paragraph — no false findings.
 */

export type AmbiguousScanKind =
  | 'first_definition'
  | 'repeated_definition'
  | 'inconsistent_definition'
  | 'expansion'
  | 'abbreviation'

export interface AmbiguousScanHit {
  kind: AmbiguousScanKind
  para_index: number
  start_offset: number
  end_offset: number
  text: string
  rule_id?: string | null
  conflicting_expansion?: string | null
}

const WS_SPLIT_RE = /\s+/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildPhraseRegex(phrase: string): RegExp | null {
  const tokens = phrase.trim().split(WS_SPLIT_RE).filter(Boolean)
  if (tokens.length === 0) return null
  const body = tokens.map(escapeRegExp).join('\\s+')
  // Non-letter / non-digit boundaries so adjoining punctuation (parens,
  // commas, periods) doesn't block a match but a word character does.
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'gi')
}

function buildAbbrRegex(abbr: string): RegExp | null {
  const token = abbr.trim()
  if (!token) return null
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(token)}(?![A-Za-z0-9])`, 'g')
}

function buildDefinitionRegex(expansion: string, abbr: string): RegExp | null {
  const tokens = expansion.trim().split(WS_SPLIT_RE).filter(Boolean)
  const abbrToken = abbr.trim()
  if (tokens.length === 0 || !abbrToken) return null
  const body = tokens.map(escapeRegExp).join('\\s+')
  return new RegExp(
    `(?<![A-Za-z0-9])${body}\\s*\\(\\s*${escapeRegExp(abbrToken)}\\s*\\)`,
    'gi',
  )
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

export interface AmbiguousScanInput {
  paragraphs: Array<{ paraIndex: number; text: string }>
  abbreviation: string
  chosenExpansion: string
  otherExpansions?: string[]
  skipPara?: (paraIndex: number) => boolean
}

export function scanForChosenExpansion(input: AmbiguousScanInput): AmbiguousScanHit[] {
  const abbr = input.abbreviation.trim()
  const expansion = input.chosenExpansion.trim()
  if (!abbr || !expansion) return []

  const others = (input.otherExpansions ?? [])
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.toLowerCase() !== expansion.toLowerCase())

  const defRegex = buildDefinitionRegex(expansion, abbr)
  const phraseRegex = buildPhraseRegex(expansion)
  const abbrRegex = buildAbbrRegex(abbr)
  const otherDefRegexes = others
    .map(o => ({ label: o, pattern: buildDefinitionRegex(o, abbr) }))
    .filter(e => e.pattern !== null) as Array<{ label: string; pattern: RegExp }>

  const results: AmbiguousScanHit[] = []
  let seenDefinition = false

  for (const { paraIndex, text } of input.paragraphs) {
    if (!text) continue
    if (input.skipPara && input.skipPara(paraIndex)) continue

    const paraHits: AmbiguousScanHit[] = []
    const taken: Array<[number, number]> = []
    const reserve = (start: number, end: number): boolean => {
      for (const [s, e] of taken) {
        if (intervalsOverlap(start, end, s, e)) return false
      }
      taken.push([start, end])
      return true
    }

    const runRegex = (re: RegExp, cb: (start: number, end: number) => void) => {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        cb(m.index, m.index + m[0].length)
        if (m.index === re.lastIndex) re.lastIndex += 1
      }
    }

    if (defRegex) {
      runRegex(defRegex, (s, e) => {
        if (!reserve(s, e)) return
        const kind: AmbiguousScanKind = seenDefinition ? 'repeated_definition' : 'first_definition'
        seenDefinition = true
        paraHits.push({
          kind,
          para_index: paraIndex,
          start_offset: s,
          end_offset: e,
          text: text.slice(s, e),
          rule_id: kind === 'first_definition' ? 'AB01' : 'AB04',
        })
      })
    }

    for (const { label, pattern } of otherDefRegexes) {
      runRegex(pattern, (s, e) => {
        if (!reserve(s, e)) return
        paraHits.push({
          kind: 'inconsistent_definition',
          para_index: paraIndex,
          start_offset: s,
          end_offset: e,
          text: text.slice(s, e),
          rule_id: 'AB06',
          conflicting_expansion: label,
        })
      })
    }

    if (phraseRegex) {
      runRegex(phraseRegex, (s, e) => {
        if (!reserve(s, e)) return
        paraHits.push({
          kind: 'expansion',
          para_index: paraIndex,
          start_offset: s,
          end_offset: e,
          text: text.slice(s, e),
          rule_id: 'AB02',
        })
      })
    }

    if (abbrRegex) {
      runRegex(abbrRegex, (s, e) => {
        if (!reserve(s, e)) return
        paraHits.push({
          kind: 'abbreviation',
          para_index: paraIndex,
          start_offset: s,
          end_offset: e,
          text: text.slice(s, e),
          rule_id: null,
        })
      })
    }

    paraHits.sort((a, b) => a.start_offset - b.start_offset)
    results.push(...paraHits)
  }

  return results
}

/**
 * Pull ``{paraIndex, text}`` from the TipTap editor so the scanner can
 * walk the live document without a backend round-trip. Falls back to
 * sequential block index when a paragraph has no ``paraIdx`` attribute
 * (edge case: freshly-inserted blocks before Save). Headings and other
 * block types are included — the caller's ``skipPara`` is responsible
 * for the same exclusion logic the engine applies.
 */
export function extractParagraphsFromEditor(editor: any): Array<{ paraIndex: number; text: string }> {
  const out: Array<{ paraIndex: number; text: string }> = []
  if (!editor?.state?.doc) return out
  let seq = 0
  editor.state.doc.descendants((node: any) => {
    if (!node.isBlock) return true
    if (node.type?.name !== 'paragraph' && !String(node.type?.name || '').startsWith('heading')) {
      return true
    }
    const rawIdx = node.attrs?.paraIdx
    const parsed = rawIdx != null ? parseInt(String(rawIdx), 10) : NaN
    const paraIndex = Number.isFinite(parsed) ? parsed : seq
    seq += 1
    const text: string = node.textContent || ''
    if (text.trim().length > 0) out.push({ paraIndex, text })
    return false
  })
  return out
}
