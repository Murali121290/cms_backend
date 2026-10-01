import { useCallback, useEffect, useState } from 'react'
import { Download, ImageIcon } from 'lucide-react'
import { journalsApi, type ArticleArt } from '@/api/journals'
import { getApiErrorMessage } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { UploadZone } from '@/components/ui/UploadZone'
import { Spinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { cn } from '@/utils/cn'

const STATUS = {
  ok: { badge: 'success', label: 'Ready', border: 'border-l-green-500' },
  warning: { badge: 'warning', label: 'Needs attention', border: 'border-l-amber-500' },
  error: { badge: 'error', label: 'Blocking', border: 'border-l-red-500' },
  missing: { badge: 'error', label: 'No file', border: 'border-l-red-500' },
} as const

/** Article art: figures cited, their linked files, and the journal's format / resolution / naming checks. */
export function ArticleFilesPanel({ articleId, settingsHref }: { articleId: number; settingsHref?: string }) {
  const [art, setArt] = useState<ArticleArt | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setArt(await journalsApi.getArt(articleId))
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load the art files'))
    }
  }, [articleId])
  useEffect(() => { load() }, [load])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
      await load()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'That did not work'))
    } finally {
      setBusy(false)
    }
  }

  if (!art) return <div className="p-6 flex justify-center"><Spinner /></div>

  const figNumbers = [...new Set([...art.figures.map(f => f.number), 1, 2, 3, 4, 5, 6].filter(Boolean))].sort((a, b) => a - b)
  const ready = art.figures.filter(f => f.status === 'ok').length
  const blocking = art.figures.filter(f => f.status === 'error' || f.status === 'missing').length

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold uppercase tracking-wider text-text">Art files</p>
        <Badge variant={blocking ? 'error' : ready === art.figures.length ? 'success' : 'warning'} size="sm">
          {ready} of {art.figures.length} figures ready{blocking ? ` · ${blocking} blocking` : ''}
        </Badge>
      </div>
      <p className="text-muted">
        Checks from the style sheet: {art.rules.formats.join(', ')} · {art.rules.min_ppi} ppi at {art.rules.placed_width_mm} mm ·
        named <span className="font-mono">{art.rules.naming}</span>
        {settingsHref && <> · <a href={settingsHref} className="text-primary hover:underline">Change</a></>}
      </p>

      {art.figures.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {art.figures.map(f => (
            <div key={f.number} className={cn('rounded-md border border-border border-l-4 px-2 py-1.5', STATUS[f.status].border)}>
              <div className="font-semibold text-text">Figure {f.number}</div>
              <div className="text-muted font-mono truncate" title={f.filename ?? ''}>{f.filename ?? '—'}</div>
              <Badge variant={STATUS[f.status].badge} size="sm">{STATUS[f.status].label}</Badge>
            </div>
          ))}
        </div>
      )}

      <UploadZone accept=".tif,.tiff,.eps,.pdf,.png,.jpg,.jpeg,.svg,.ai" multiple isUploading={busy}
                  label="Upload or replace art (fig2.tif replaces Figure 2 as a new version)"
                  onFiles={files => act(() => journalsApi.uploadArt(articleId, files), `${files.length} file${files.length > 1 ? 's' : ''} uploaded`)} />

      <div className="flex flex-col gap-2">
        {art.files.length === 0 && <p className="text-muted text-center py-4">No art files yet.</p>}
        {art.files.map(f => (
          <article key={f.id} className={cn('rounded-lg border border-border border-l-4 bg-card p-2.5 space-y-1.5', STATUS[f.status].border)}>
            <div className="flex items-center gap-2">
              <ImageIcon className="size-4 text-muted shrink-0" />
              <span className="font-mono text-text truncate" title={f.filename}>{f.filename}</span>
              <span className="ml-auto text-muted whitespace-nowrap">v{f.version}{f.versions > 1 ? ` of ${f.versions}` : ''}</span>
            </div>
            <div className="text-muted">
              {f.format} · {f.vector ? 'vector' : f.width ? `${f.width} × ${f.height} px${f.ppi ? ` · ${f.ppi} ppi` : ''}` : 'size unknown'}
            </div>
            <div className="flex flex-wrap gap-1">
              {f.checks.map((c, i) => (
                <Badge key={i} variant={c.status === 'ok' ? 'success' : c.status === 'warning' ? 'warning' : 'error'} size="sm">{c.text}</Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="sr-only" htmlFor={`link-${f.id}`}>Linked figure</label>
              <select id={`link-${f.id}`} value={f.figure_number ?? ''} disabled={busy}
                      onChange={e => act(() => journalsApi.linkArt(articleId, f.id, e.target.value ? Number(e.target.value) : null),
                        e.target.value ? `Linked to Figure ${e.target.value}` : 'Unlinked')}
                      className="h-7 rounded border border-border bg-background px-1.5">
                <option value="">Not linked</option>
                {figNumbers.map(n => <option key={n} value={n}>Figure {n}</option>)}
              </select>
              {f.figure_number !== null && f.checks.some(c => c.text.startsWith('Rename')) && (
                <Button size="sm" variant="secondary" disabled={busy}
                        onClick={() => act(() => journalsApi.renameArt(articleId, f.id), 'Renamed as a new version')}>Rename</Button>
              )}
              <a href={journalsApi.artUrl(articleId, f.id)} className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
                <Download className="size-3.5" /> Download
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
