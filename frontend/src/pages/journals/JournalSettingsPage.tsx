import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Download, Plus, X } from 'lucide-react'
import {
  journalsApi, type AssetKind, type IaRule, type IaRulesState, type JournalAsset, type JournalGrammarsheet, type JournalOverview,
  type JournalStylesheet,
} from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { UploadZone } from '@/components/ui/UploadZone'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'

type Tab = 'design' | 'style' | 'ia' | 'grammar'
const TABS: { key: Tab; label: string }[] = [
  { key: 'design', label: 'Design pack' }, { key: 'style', label: 'Style sheet' }, { key: 'ia', label: 'IA rules' },
  { key: 'grammar', label: 'Grammar sheet' },
]
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export function JournalSettingsPage() {
  const { journalId } = useParams()
  const id = Number(journalId)
  const { hash } = useLocation()
  const navigate = useNavigate()
  const tab: Tab = (['design', 'style', 'ia', 'grammar'] as Tab[]).find(t => `#${t}` === hash) ?? 'design'
  const [journal, setJournal] = useState<JournalOverview | null>(null)

  const loadJournal = useCallback(() => journalsApi.getJournal(id).then(setJournal)
    .catch(err => toast.error(getApiErrorMessage(err, 'Could not load the journal'))), [id])
  useEffect(() => { loadJournal() }, [loadJournal])

  if (!journal) return <FullPageSpinner />

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <Breadcrumb items={[
        { label: 'Journal Production', href: '/journal-production' },
        { label: journal.publisher_name ?? 'Client', href: `/journal-production/clients/${journal.client_id}` },
        { label: journal.journal_code, href: `/journal-production/journals/${journal.id}` },
        { label: 'Settings' },
      ]} />
      <div>
        <h1 className="text-xl font-semibold text-text">Journal settings · {journal.journal_code}</h1>
        <p className="text-sm text-muted">
          Articles of this journal use the active version of each item. Every save or upload is a new version; older ones are kept and can be made active again.
        </p>
      </div>
      <div className="flex gap-1 border-b border-border" role="tablist">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
                  onClick={() => navigate({ hash: t.key }, { replace: true })}
                  className={cn('px-4 py-2 text-sm font-semibold border-b-2 -mb-px',
                    tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'design' && <DesignTab journalId={id} onChange={loadJournal} />}
      {tab === 'style' && <StyleTab journalId={id} onChange={loadJournal} />}
      {tab === 'ia' && <IaRulesTab journalId={id} />}
      {tab === 'grammar' && <GrammarTab journalId={id} onChange={loadJournal} />}
    </div>
  )
}

/* ─────────────────────────── Design pack ─────────────────────────── */
const KINDS: { kind: AssetKind; title: string; hint: string; accept: string }[] = [
  { kind: 'template', title: 'InDesign template', hint: 'Sent to the InDesign server at Generate InDesign. One version is active.', accept: '.indt,.indd,.idml' },
  { kind: 'font', title: 'Fonts', hint: 'Sent with the template. The newest version of each font is active.', accept: '.otf,.ttf,.ttc' },
  { kind: 'library', title: 'InDesign library', hint: 'Sent with the template.', accept: '.indl' },
  { kind: 'logo', title: 'Logo', hint: 'Journal logo for the layout.', accept: '.eps,.pdf,.svg,.png,.jpg,.tif,.ai' },
  { kind: 'css', title: 'Preview CSS', hint: 'Styles for the XHTML preview.', accept: '.css' },
]

function DesignTab({ journalId, onChange }: { journalId: number; onChange: () => void }) {
  const [assets, setAssets] = useState<JournalAsset[]>([])
  const [busy, setBusy] = useState<AssetKind | null>(null)
  const [note, setNote] = useState('')
  const load = useCallback(() => journalsApi.getAssets(journalId).then(setAssets)
    .catch(err => toast.error(getApiErrorMessage(err, 'Could not load the design pack'))), [journalId])
  useEffect(() => { load() }, [load])

  const upload = async (kind: AssetKind, files: File[]) => {
    setBusy(kind)
    try {
      const saved = await journalsApi.uploadAssets(journalId, kind, files, note || undefined)
      toast.success(saved.map(a => `${a.filename} v${a.version}${a.is_active ? ' (active)' : ''}`).join(', '))
      setNote('')
      await load()
      onChange()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Upload failed'))
    } finally {
      setBusy(null)
    }
  }
  const activate = async (a: JournalAsset) => {
    try {
      await journalsApi.activateAsset(journalId, a.id)
      toast.success(`${a.filename} v${a.version} is now active`)
      await load()
      onChange()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not activate'))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {KINDS.map(k => {
        const rows = assets.filter(a => a.kind === k.kind)
        return (
          <section key={k.kind} className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-text">{k.title}</h2>
              <p className="text-xs text-muted">{k.hint}</p>
            </div>
            {rows.length === 0 ? <p className="text-xs text-muted">Nothing uploaded yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead className="text-muted uppercase tracking-wide text-[10px]"><tr>
                  <th className="text-left py-1.5">File</th><th className="text-left">Version</th><th className="text-left">Uploaded</th><th />
                </tr></thead>
                <tbody>{rows.map(a => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-1.5 font-mono pr-2">{a.filename}{a.note && <div className="font-sans text-muted">{a.note}</div>}</td>
                    <td>v{a.version}</td>
                    <td className="whitespace-nowrap">{fmtDate(a.uploaded_at)}</td>
                    <td className="text-right whitespace-nowrap space-x-2">
                      {a.is_active ? <Badge variant="success" size="sm">Active</Badge>
                        : <Button size="sm" variant="secondary" onClick={() => activate(a)}>Make active</Button>}
                      <a href={journalsApi.assetUrl(journalId, a.id)} className="inline-flex text-primary align-middle" aria-label={`Download ${a.filename}`}>
                        <Download className="size-3.5" />
                      </a>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {k.kind === 'template' && (
              <Input label="Note for the next upload (optional)" placeholder="e.g. new running heads" value={note} onChange={e => setNote(e.target.value)} />
            )}
            <UploadZone accept={k.accept} multiple={k.kind === 'font'} isUploading={busy === k.kind}
                        label={`Upload ${k.title.toLowerCase()} (${k.accept})`} onFiles={files => upload(k.kind, files)} />
          </section>
        )
      })}
    </div>
  )
}

/* ─────────────────────────── Style sheet ─────────────────────────── */
type Rules = Record<string, unknown>
const JATS_TARGETS = ['italic', 'bold', 'sc', 'monospace', 'sup', 'sub', 'underline']
const ALL_FORMATS = ['TIFF', 'EPS', 'PDF', 'PNG', 'JPG', 'SVG']

function useVersions<T extends { id: number; is_active: boolean; created_at: string }>(fetcher: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([])
  const load = useCallback(() => fetcher().then(r => setRows([...r].sort((a, b) => a.id - b.id)))
    .catch(err => toast.error(getApiErrorMessage(err, 'Could not load versions'))), [fetcher])
  useEffect(() => { load() }, [load])
  const active = rows.find(r => r.is_active) ?? rows[rows.length - 1]
  return { rows, active, load }
}

function VersionList<T extends { id: number; is_active: boolean; created_at: string; name: string }>(
  { rows, onActivate }: { rows: T[]; onActivate: (r: T) => void },
) {
  if (!rows.length) return <p className="text-xs text-muted">No versions saved yet.</p>
  return (
    <table className="w-full text-xs"><tbody>
      {[...rows].reverse().map(r => (
        <tr key={r.id} className="border-t border-border first:border-0">
          <td className="py-1.5">v{rows.indexOf(r) + 1}</td>
          <td>{r.name}</td>
          <td className="whitespace-nowrap">{fmtDate(r.created_at)}</td>
          <td className="text-right">{r.is_active ? <Badge variant="success" size="sm">Active</Badge>
            : <Button size="sm" variant="secondary" onClick={() => onActivate(r)}>Make active</Button>}</td>
        </tr>
      ))}
    </tbody></table>
  )
}

function StyleTab({ journalId, onChange }: { journalId: number; onChange: () => void }) {
  const fetcher = useCallback(() => journalsApi.getStylesheets(journalId), [journalId])
  const { rows, active, load } = useVersions<JournalStylesheet>(fetcher)
  const [name, setName] = useState('')
  const [rules, setRules] = useState<Rules>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(active?.name ?? 'Style sheet')
    setRules(active?.style_rules ?? {})
  }, [active])

  const get = <V,>(path: string, fallback: V): V => {
    const v = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Rules)[k] : undefined), rules)
    return (v === undefined ? fallback : v) as V
  }
  const set = (path: string, value: unknown) => setRules(prev => {
    const next: Rules = JSON.parse(JSON.stringify(prev))
    const keys = path.split('.')
    let o = next
    keys.slice(0, -1).forEach(k => { o[k] = (o[k] && typeof o[k] === 'object') ? o[k] : {}; o = o[k] as Rules })
    o[keys[keys.length - 1]] = value
    return next
  })
  const charStyles = Object.entries(get<Record<string, string>>('character_styles', {}))
  const formats = get<string[]>('art.formats', ['TIFF', 'EPS', 'PDF', 'PNG', 'JPG'])

  const save = async () => {
    setSaving(true)
    try {
      await journalsApi.createStylesheet(journalId, { name: name.trim() || 'Style sheet', style_rules: rules, is_active: true })
      toast.success('Saved as a new version. New check runs use it.')
      await load()
      onChange()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }
  const activate = async (r: JournalStylesheet) => {
    await journalsApi.activateStylesheet(journalId, r.id).catch(err => toast.error(getApiErrorMessage(err, 'Could not activate')))
    await load()
    onChange()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
      <section className="bg-card border border-border rounded-xl p-4 space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]"><Input label="Style sheet name" value={name} onChange={e => setName(e.target.value)} /></div>
          <Button onClick={save} isLoading={saving}>Save as v{rows.length + 1}</Button>
        </div>

        <Group title="Structuring">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Tag set (structuring_lib)" value={get('tag_set', '') as string}
                    onChange={e => set('tag_set', e.target.value || null)}
                    options={[{ value: '', label: 'Canonical tags (H1, TXT, REF-N…)' }, { value: 'springer', label: 'springer' }]} />
            <Input label="Abstract word limit" type="number" value={String(get('abstract_word_limit', 250))}
                   onChange={e => set('abstract_word_limit', Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-text">Word character styles → JATS</p>
            {charStyles.map(([w, j], i) => (
              <div key={i} className="flex gap-2 items-center">
                <input aria-label="Word character style" value={w} className="h-8 flex-1 rounded border border-border bg-background px-2 text-sm"
                       onChange={e => { const m = Object.fromEntries(charStyles.map(([a, b], k) => (k === i ? [e.target.value, b] : [a, b]))); set('character_styles', m) }} />
                <select aria-label="JATS element" value={j} className="h-8 rounded border border-border bg-background px-2 text-sm"
                        onChange={e => set('character_styles', { ...Object.fromEntries(charStyles), [w]: e.target.value })}>
                  {JATS_TARGETS.map(t => <option key={t}>{t}</option>)}
                </select>
                <button type="button" aria-label="Remove mapping" className="text-muted hover:text-danger"
                        onClick={() => set('character_styles', Object.fromEntries(charStyles.filter((_, k) => k !== i)))}><X className="size-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="secondary" leftIcon={<Plus />}
                    onClick={() => set('character_styles', { ...Object.fromEntries(charStyles), [`Style ${charStyles.length + 1}`]: 'italic' })}>Add mapping</Button>
          </div>
        </Group>

        <Group title="Citations and references">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Citation form" value={get('references.citation_form', 'auto') as string} onChange={e => set('references.citation_form', e.target.value)}
                    options={[{ value: 'auto', label: 'Detect from the text' }, { value: 'brackets', label: '[1]' }, { value: 'parens', label: '(1)' }]} />
            <Select label="Reference style" value={get('references.style', 'Vancouver') as string} onChange={e => set('references.style', e.target.value)}
                    options={['Vancouver', 'AMA', 'APA'].map(v => ({ value: v, label: v }))} />
          </div>
          <Toggle label="Check DOIs with Crossref" checked={get('references.crossref_lookup', true)} onChange={v => set('references.crossref_lookup', v)} />
        </Group>

        <Group title="Art">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Minimum resolution (ppi)" type="number" value={String(get('art.min_ppi', 300))} onChange={e => set('art.min_ppi', Number(e.target.value))} />
            <Input label="Placed width (mm)" type="number" value={String(get('art.placed_width_mm', 84))} onChange={e => set('art.placed_width_mm', Number(e.target.value))} />
            <Input label="File naming ({n} = figure)" value={get('art.naming', 'fig{n}.tif') as string} onChange={e => set('art.naming', e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-3">
            {ALL_FORMATS.map(f => (
              <label key={f} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={formats.includes(f)} className="size-4"
                       onChange={e => set('art.formats', e.target.checked ? [...formats, f] : formats.filter(x => x !== f))} /> {f}
              </label>
            ))}
          </div>
        </Group>
      </section>

      <div className="space-y-4">
        <section className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-semibold text-text">Versions</h2>
          <VersionList rows={rows} onActivate={activate} />
        </section>
        <section className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-semibold text-text">style_rules</h2>
          <pre className="text-[11px] leading-relaxed bg-surface rounded-md p-3 overflow-auto max-h-96">{JSON.stringify(rules, null, 2)}</pre>
        </section>
      </div>
    </div>
  )
}

/* ─────────────────────────── IA rules ─────────────────────────── */
const iaKey = (r: IaRule) => `${r.element}${r.subtype}${r.pattern}`

function IaRulesTab({ journalId }: { journalId: number }) {
  const [state, setState] = useState<IaRulesState | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await journalsApi.getIaRules(journalId)
      setState(s)
      setSelected(new Set(s.selected.map(iaKey)))
      setDirty(false)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load the IA rules'))
    }
  }, [journalId])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const out = new Map<string, IaRule[]>()
    const needle = q.trim().toLowerCase()
    for (const r of state?.catalog ?? []) {
      if (needle && !`${r.element} ${r.subtype} ${r.pattern} ${r.example ?? ''}`.toLowerCase().includes(needle)) continue
      out.set(r.element, [...(out.get(r.element) ?? []), r])
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [state, q])

  if (!state) return <div className="p-6 text-sm text-muted">Loading IA rules…</div>

  const toggle = (keys: string[], on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      keys.forEach(k => (on ? next.add(k) : next.delete(k)))
      return next
    })
    setDirty(true)
  }
  const save = async () => {
    setSaving(true)
    try {
      const rows = state.catalog.filter(r => selected.has(iaKey(r)))
      const res = await journalsApi.saveIaRules(journalId, rows)
      toast.success(`${res.selected.length} IA rules saved as the active editorial stylesheet`)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save the IA rules'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search rules, e.g. Figure, Ranges, Units" aria-label="Search IA rules"
                 className="h-9 flex-1 min-w-[220px] rounded-md border border-border bg-background px-3 text-sm" />
          <span className="text-sm text-muted tabular-nums">{selected.size} of {state.catalog.length} selected</span>
          <Button onClick={save} isLoading={saving} disabled={!dirty}>Save IA rules</Button>
        </div>
        <div className="divide-y divide-border border border-border rounded-lg">
          {groups.map(([element, rows]) => {
            const keys = rows.map(iaKey)
            const n = keys.filter(k => selected.has(k)).length
            const expanded = open.has(element) || !!q
            return (
              <div key={element}>
                <div className="flex items-center gap-3 px-3 py-2">
                  <input type="checkbox" className="size-4" aria-label={`Select all ${element} rules`}
                         checked={n === keys.length} ref={el => { if (el) el.indeterminate = n > 0 && n < keys.length }}
                         onChange={e => toggle(keys, e.target.checked)} />
                  <button type="button" className="flex-1 text-left text-sm font-semibold text-text"
                          onClick={() => setOpen(prev => { const s = new Set(prev); s.has(element) ? s.delete(element) : s.add(element); return s })}
                          aria-expanded={expanded}>
                    {element}
                  </button>
                  <span className="text-xs text-muted tabular-nums">{n}/{keys.length}</span>
                </div>
                {expanded && (
                  <ul className="pb-2 pl-10 pr-3 space-y-1">
                    {rows.map(r => (
                      <li key={iaKey(r)}>
                        <label className="flex items-baseline gap-2 text-sm cursor-pointer">
                          <input type="checkbox" className="size-4 translate-y-0.5" checked={selected.has(iaKey(r))}
                                 onChange={e => toggle([iaKey(r)], e.target.checked)} />
                          <span className="text-muted w-28 shrink-0">{r.subtype}</span>
                          <span className="font-mono text-text">{r.pattern}</span>
                          {r.example && <span className="text-xs text-muted">e.g. {r.example}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </section>
      <div className="space-y-3">
        <section className="bg-card border border-border rounded-xl p-4 space-y-2 text-sm">
          <h2 className="font-semibold text-text">Editorial stylesheet</h2>
          {state.stylesheet ? (
            <p className="text-muted">Active: <span className="text-text">{state.stylesheet.name}</span>, {state.selected.length} rules.</p>
          ) : <p className="text-muted">None yet. Select rules and save to create it.</p>}
        </section>
        <p className="text-xs text-muted bg-surface rounded-lg p-3">
          The book <strong>Technical review</strong> page runs every rule and marks the findings covered by these selected rules
          as <em>in stylesheet</em>. The Ranges and Thousand separator choices also set the fix it suggests. Saving here updates the
          journal's hidden book project, so the Technical review page no longer asks for a project stylesheet.
        </p>
      </div>
    </div>
  )
}

/* ─────────────────────────── Grammar sheet ─────────────────────────── */
type Term = { find: string; replace: string; note?: string }

function GrammarTab({ journalId, onChange }: { journalId: number; onChange: () => void }) {
  const fetcher = useCallback(() => journalsApi.getGrammarsheets(journalId), [journalId])
  const { rows, active, load } = useVersions<JournalGrammarsheet>(fetcher)
  const [name, setName] = useState('')
  const [variant, setVariant] = useState('US_English')
  const [rules, setRules] = useState<Rules>({})
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(active?.name ?? 'Grammar sheet')
    setVariant(active?.language_variant ?? 'US_English')
    setRules(active?.grammar_rules ?? {})
  }, [active])

  const terms = (rules.terms as Term[] | undefined) ?? []
  const setTerms = (t: Term[]) => setRules(r => ({ ...r, terms: t }))
  const shown = useMemo(() => terms.map((t, i) => [t, i] as const)
    .filter(([t]) => !q || `${t.find} ${t.replace} ${t.note ?? ''}`.toLowerCase().includes(q.toLowerCase())), [terms, q])
  const flag = (k: string, label: string, hint: string) => (
    <Toggle label={label} hint={hint} checked={(rules[k] as boolean | undefined) ?? true} onChange={v => setRules(r => ({ ...r, [k]: v }))} />
  )

  const importCsv = async (files: File[]) => {
    const text = await files[0].text()
    const added = text.split(/\r?\n/).map(l => l.split(',').map(s => s.trim()))
      .filter(([f, r]) => f && r && f.toLowerCase() !== 'find').map(([find, replace, note]) => ({ find, replace, note }))
    const known = new Set(terms.map(t => t.find.toLowerCase()))
    const fresh = added.filter(t => !known.has(t.find.toLowerCase()))
    setTerms([...terms, ...fresh])
    toast.success(`${fresh.length} terms added${added.length - fresh.length ? `, ${added.length - fresh.length} duplicates skipped` : ''}. Save to keep them.`)
  }
  const save = async () => {
    setSaving(true)
    try {
      await journalsApi.createGrammarsheet(journalId, { name: name.trim() || 'Grammar sheet', language_variant: variant, grammar_rules: rules, is_active: true })
      toast.success('Saved as a new version')
      await load()
      onChange()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }
  const activate = async (r: JournalGrammarsheet) => {
    await journalsApi.activateGrammarsheet(journalId, r.id).catch(err => toast.error(getApiErrorMessage(err, 'Could not activate')))
    await load()
    onChange()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
      <section className="bg-card border border-border rounded-xl p-4 space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]"><Input label="Grammar sheet name" value={name} onChange={e => setName(e.target.value)} /></div>
          <Select label="Language variant" value={variant} onChange={e => setVariant(e.target.value)}
                  options={[{ value: 'US_English', label: 'US English' }, { value: 'UK_English', label: 'UK English' }]} />
          <Button onClick={save} isLoading={saving}>Save as v{rows.length + 1}</Button>
        </div>
        <Group title="Rules">
          <div className="grid gap-3 sm:grid-cols-2">
            {flag('serial_comma', 'Serial (Oxford) comma', 'a, b, and c')}
            {flag('data_plural', '“data” is plural', 'data is → data are')}
            {flag('concise', 'Concise phrasing', 'in order to → to')}
            {flag('spell_out_numbers', 'Spell out one to nine', 'except with units')}
          </div>
        </Group>
        <Group title={`Preferred terms (${terms.length})`}>
          <div className="flex flex-wrap gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search terms" aria-label="Search terms"
                   className="h-8 w-56 rounded border border-border bg-background px-2 text-sm" />
            <Button size="sm" variant="secondary" leftIcon={<Plus />} onClick={() => { setQ(''); setTerms([{ find: '', replace: '' }, ...terms]) }}>Add term</Button>
          </div>
          <div className="space-y-1.5">
            {shown.map(([t, i]) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                {(['find', 'replace', 'note'] as const).map(k => (
                  <input key={k} aria-label={k} placeholder={k} value={t[k] ?? ''} className="h-8 rounded border border-border bg-background px-2 text-sm"
                         onChange={e => setTerms(terms.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                ))}
                <button type="button" aria-label="Remove term" className="text-muted hover:text-danger"
                        onClick={() => setTerms(terms.filter((_, j) => j !== i))}><X className="size-4" /></button>
              </div>
            ))}
          </div>
          <UploadZone accept=".csv" label="Import a word list (.csv with find,replace,note columns)" onFiles={importCsv} />
        </Group>
      </section>
      <div className="space-y-4">
        <section className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-semibold text-text">Versions</h2>
          <VersionList rows={rows} onActivate={activate} />
        </section>
        <p className="text-xs text-muted bg-surface rounded-lg p-3">
          The Language Editing check will read these rules. It is not built yet, so saving a grammar sheet does not create findings.
        </p>
      </div>
    </div>
  )
}

/* ─────────────────────────── shared bits ─────────────────────────── */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</p>
      {children}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 size-4" />
      <span><span className="block text-sm font-medium text-text">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  )
}
