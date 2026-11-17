import React, { useState, useEffect, useMemo } from 'react'
import { X, Save, Edit3, Move, RefreshCw, AlertCircle, Plus, Trash2 } from 'lucide-react'
import { projectsApi, type Project } from '@/api/projects'
import { chaptersApi, type Chapter } from '@/api/chapters'
import { toast } from '@/store/useToastStore'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { useRBAC } from '@/hooks/useRBAC'

export interface BookMapItem {
  id?: string | number
  s_no?: number
  component: string
  mss_page_count: number | ''
  art_count: number | ''
  keystroke_count: number | ''
  cast_off_pages: number | ''
  start_page_act: string | number
  end_page_act: string | number
  blanks_act: number | ''
  total_pages: number | ''
  cast_off_diff: number | ''
  remarks: string
}

interface ProjectBookMapModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
  onSuccess?: () => void
}

function isManuscriptChapter(chName: string | null | undefined): boolean {
  if (!chName) return false
  const name = chName.trim().toLowerCase()
  if (name === 'design' || name === 'ce support') return false
  if (name.includes('art')) return false
  return true
}

function formatComponentName(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (trimmed === '00' || trimmed.toLowerCase() === 'book 00') return 'Book'
  if (trimmed.toUpperCase() === 'FM' || trimmed.toLowerCase() === 'front matter') return 'FM'
  if (trimmed.toUpperCase() === 'BM' || trimmed.toLowerCase() === 'back matter') return 'BM'
  // Single letter appendix, e.g. "A" -> "Appendix A", "B" -> "Appendix B"
  if (/^[A-Za-z]$/.test(trimmed)) {
    return `Appendix ${trimmed.toUpperCase()}`
  }
  // Chapter digits, e.g. "1" or "01" -> "Chapter 01"
  if (/^\d+$/.test(trimmed)) {
    return `Chapter ${trimmed.padStart(2, '0')}`
  }
  // If already formatted like "Chapter 1" -> "Chapter 01"
  const chMatch = trimmed.match(/^Chapter\s*(\d+)$/i)
  if (chMatch) {
    return `Chapter ${chMatch[1].padStart(2, '0')}`
  }
  // If already formatted like "Appendix A"
  const appMatch = trimmed.match(/^Appendix\s*([A-Za-z])$/i)
  if (appMatch) {
    return `Appendix ${appMatch[1].toUpperCase()}`
  }
  return trimmed
}

// Order: Front matter -> Body (Book, Chapters in numeric order) -> Back matter (Appendix, References, Index, BM, etc.)
function getComponentOrderScore(comp: string): { type: number; val: number; str: string } {
  const c = (comp || '').trim().toLowerCase()

  // 1. Front Matter
  if (c === 'fm' || c.startsWith('front') || c.startsWith('preface') || c.startsWith('intro')) {
    return { type: 1, val: 0, str: c }
  }

  // 2. Book 00 or Book
  if (c === 'book' || c === 'book 00' || c === '00') {
    return { type: 2, val: 0, str: c }
  }

  // 2b. Body / Chapters (e.g. "Chapter 01", "01", "Chapter 1", "Ch 01")
  const numMatch = c.match(/(?:chapter|ch)?\s*(\d+)/i)
  if (numMatch && !c.includes('art')) {
    return { type: 2, val: parseInt(numMatch[1], 10), str: c }
  }
  if (/^\d+$/.test(c)) {
    return { type: 2, val: parseInt(c, 10), str: c }
  }

  // 3. Back Matter
  // 3a. Appendix (e.g. "Appendix A", "Appendix B", "A", "B")
  const appMatch = c.match(/(?:appendix)?\s*([a-z])$/i)
  if (c.startsWith('appendix') || /^[a-z]$/i.test(c)) {
    const charCode = (appMatch ? appMatch[1] : c).toLowerCase().charCodeAt(0)
    return { type: 3, val: charCode, str: c }
  }
  // 3b. Back matter (BM)
  if (c === 'bm' || c.startsWith('back')) {
    return { type: 4, val: 1, str: c }
  }
  // 3c. References / Bibliography
  if (c.includes('reference') || c.includes('biblio')) {
    return { type: 4, val: 2, str: c }
  }
  // 3d. Index / Glossary
  if (c.includes('glossary')) {
    return { type: 4, val: 3, str: c }
  }
  if (c.includes('index')) {
    return { type: 4, val: 4, str: c }
  }

  // Any other back or extra component
  return { type: 5, val: 0, str: c }
}

function sortComponents<T extends { component: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const oA = getComponentOrderScore(a.component)
    const oB = getComponentOrderScore(b.component)
    if (oA.type !== oB.type) return oA.type - oB.type
    if (oA.val !== oB.val) return oA.val - oB.val
    return oA.str.localeCompare(oB.str)
  })
}

function computeCastOffDiff(total: number | '', castOff: number | ''): number | '' {
  if (total !== '' && castOff !== '' && !isNaN(Number(total)) && !isNaN(Number(castOff))) {
    return Number(total) - Number(castOff)
  }
  return ''
}

export function ProjectBookMapModal({ isOpen, onClose, project, onSuccess }: ProjectBookMapModalProps) {
  const { canAccess, viewer } = useRBAC()
  // Accessible to managers & admins
  const canEdit = canAccess(['admin', 'manager', 'lead']) || project.project_manager === viewer?.username

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [items, setItems] = useState<BookMapItem[]>([])
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  // Load existing book map from project or initialize from chapters/breakdown
  useEffect(() => {
    if (!isOpen || !project?.id) return

    let isMounted = true
    setLoading(true)
    setIsEditing(false)

    async function loadData() {
      try {
        const res = await projectsApi.getBookmap(project.id).catch(() => null)
        const savedBookmap = res?.bookmap

        if (savedBookmap && Array.isArray(savedBookmap.items) && savedBookmap.items.length > 0) {
          if (isMounted) {
            // Keep only manuscript chapters in case art/design/ce support was previously saved
            // Format component names (e.g. A -> Appendix A, 00 -> Book)
            const filteredItems = savedBookmap.items
              .filter((it: BookMapItem) => isManuscriptChapter(it.component))
              .map((it: BookMapItem) => ({ ...it, component: formatComponentName(it.component) }))
            // Sort in Front -> Body -> Back order
            const orderedItems = sortComponents(filteredItems.length > 0 ? filteredItems : savedBookmap.items)
              .map((it: BookMapItem, idx: number) => ({ ...it, s_no: idx + 1 }))
            setItems(orderedItems)
            setLoading(false)
          }
          return
        }

        // Initialize from chapters
        let projectChapters: Chapter[] = []
        try {
          projectChapters = await chaptersApi.getByProject(project.project_code || '')
        } catch {
          projectChapters = []
        }

        // Filter only manuscript chapters — exclude Art, Design, and CE support
        const validChapters = (projectChapters || []).filter(c => isManuscriptChapter(c.chapters))

        // Also check if file_details has chapter_breakdown from PO extraction
        const fileDetails = (project.file_details as any) || {}
        const breakdown = Array.isArray(fileDetails.chapter_breakdown) ? fileDetails.chapter_breakdown : []

        let initialList: BookMapItem[] = []

        if (validChapters.length > 0) {
          const mapped = validChapters.map((c) => {
            const compName = formatComponentName(c.chapters)

            // MSS Page Count from the DB (either chapter manuscript_pages or breakdown)
            const b = breakdown.find((item: any) => String(item.chapter) === String(c.chapters) || String(item.chapter).padStart(2, '0') === c.chapters)
            const mssCount = c.manuscript_pages != null ? c.manuscript_pages : (b?.pages ?? '')

            return {
              id: c.id,
              s_no: 1,
              component: compName,
              mss_page_count: mssCount !== '' ? Number(mssCount) : '',
              art_count: '',
              keystroke_count: '',
              cast_off_pages: '',
              start_page_act: '',
              end_page_act: '',
              blanks_act: '',
              total_pages: '',
              cast_off_diff: '',
              remarks: ''
            }
          })
          initialList = sortComponents(mapped).map((item, idx) => ({ ...item, s_no: idx + 1 }))
        } else if (breakdown.length > 0) {
          const mapped = breakdown.map((b: any, idx: number) => ({
            id: `breakdown-${idx}`,
            s_no: idx + 1,
            component: formatComponentName(String(b.chapter)),
            mss_page_count: b.pages != null ? Number(b.pages) : '',
            art_count: '',
            keystroke_count: '',
            cast_off_pages: '',
            start_page_act: '',
            end_page_act: '',
            blanks_act: '',
            total_pages: '',
            cast_off_diff: '',
            remarks: ''
          }))
          initialList = sortComponents(mapped).map((item, idx) => ({ ...item, s_no: idx + 1 }))
        } else {
          // Default template
          initialList = [
            { s_no: 1, component: 'FM', mss_page_count: '', art_count: '', keystroke_count: '', cast_off_pages: '', start_page_act: '', end_page_act: '', blanks_act: '', total_pages: '', cast_off_diff: '', remarks: '' },
            { s_no: 2, component: 'Chapter 01', mss_page_count: '', art_count: '', keystroke_count: '', cast_off_pages: '', start_page_act: '', end_page_act: '', blanks_act: '', total_pages: '', cast_off_diff: '', remarks: '' }
          ]
        }

        if (isMounted) {
          setItems(initialList)
          setLoading(false)
        }
      } catch (e) {
        console.error('Failed to load book map:', e)
        if (isMounted) setLoading(false)
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [isOpen, project])

  // Handle cell change
  const handleCellChange = (index: number, field: keyof BookMapItem, value: any) => {
    setItems(prev => {
      const updated = [...prev]
      const current = { ...updated[index], [field]: value }

      if (field === 'cast_off_pages') {
        current.cast_off_diff = computeCastOffDiff(current.total_pages, value)
      } else if (field === 'total_pages') {
        current.cast_off_diff = computeCastOffDiff(value, current.cast_off_pages)
      }

      updated[index] = current
      return updated
    })
  }

  // Add row
  const handleAddRow = () => {
    setItems(prev => [
      ...prev,
      {
        s_no: prev.length + 1,
        component: `Chapter ${String(prev.length + 1).padStart(2, '0')}`,
        mss_page_count: '',
        art_count: '',
        keystroke_count: '',
        cast_off_pages: '',
        start_page_act: '',
        end_page_act: '',
        blanks_act: '',
        total_pages: '',
        cast_off_diff: '',
        remarks: ''
      }
    ])
  }

  // Remove row
  const handleRemoveRow = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index).map((item, idx) => ({ ...item, s_no: idx + 1 })))
  }

  // Drag and Drop
  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
  }

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) return
    setItems(prev => {
      const updated = [...prev]
      const [moved] = updated.splice(draggedIndex, 1)
      updated.splice(targetIndex, 0, moved)
      return updated.map((item, idx) => ({ ...item, s_no: idx + 1 }))
    })
    setDraggedIndex(null)
  }

  // Save Book Map to database JSON
  const handleSave = async () => {
    if (!project?.id) return
    setSaving(true)
    try {
      await projectsApi.updateBookmap(project.id, {
        items,
        updated_at: new Date().toISOString()
      })
      toast.success('Book map saved successfully.')
      setIsEditing(false)
      onSuccess?.()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to save book map.')
    } finally {
      setSaving(false)
    }
  }

  // Summary Totals
  const totals = useMemo(() => {
    let mss = 0
    let art = 0
    let castOff = 0
    let blanks = 0
    let totalAct = 0
    let diff = 0

    items.forEach(it => {
      if (it.mss_page_count !== '' && !isNaN(Number(it.mss_page_count))) mss += Number(it.mss_page_count)
      if (it.art_count !== '' && !isNaN(Number(it.art_count))) art += Number(it.art_count)
      if (it.cast_off_pages !== '' && !isNaN(Number(it.cast_off_pages))) castOff += Number(it.cast_off_pages)
      if (it.blanks_act !== '' && !isNaN(Number(it.blanks_act))) blanks += Number(it.blanks_act)
      if (it.total_pages !== '' && !isNaN(Number(it.total_pages))) totalAct += Number(it.total_pages)
      if (it.cast_off_diff !== '' && !isNaN(Number(it.cast_off_diff))) diff += Number(it.cast_off_diff)
    })

    return { mss, art, castOff, blanks, totalAct, diff }
  }, [items])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div
        className="bg-card w-full max-w-6xl max-h-[92vh] rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden text-text"
        onClick={e => e.stopPropagation()}
      >
        {/* Header matching Pathfinder style */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface/50">
          <div>
            <h2 className="text-lg font-bold text-red-600 dark:text-red-400 tracking-tight flex items-center gap-2">
              ADD PROJECT BOOK MAP
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
              <span>Project Name:</span>
              <span className="font-semibold text-text font-mono bg-surface px-2 py-0.5 rounded border border-border">
                {project.project_code || (project as any).code || project.project_title || `PRJ-${project.id}`}
              </span>
              {(project.project_title || (project as any).title) && (
                <span className="text-muted truncate max-w-md">({project.project_title || (project as any).title})</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-muted/20 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Action bar & Subheader */}
        <div className="px-6 py-3 bg-muted/10 border-b border-border flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-muted">
            <Move size={14} className="text-primary flex-shrink-0" />
            <span className="font-medium">Drag and drop chapters to order them</span>
          </div>

          <div className="flex items-center gap-2">
            {!isEditing ? (
              canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                  leftIcon={<Edit3 size={13} />}
                >
                  Edit Book Map
                </Button>
              )
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddRow}
                  leftIcon={<Plus size={13} />}
                >
                  Add Component
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  leftIcon={saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                >
                  {saving ? 'Saving...' : 'Save Book Map'}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Content Table */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted gap-3">
              <Spinner size={32} />
              <p className="text-xs">Loading project book map...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-muted border border-dashed border-border rounded-xl">
              <p className="text-sm font-medium mb-2">No chapters or components found.</p>
              {canEdit && (
                <Button size="sm" onClick={handleAddRow} leftIcon={<Plus size={14} />}>
                  Add Component
                </Button>
              )}
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden shadow-sm bg-card bookmap-no-spin">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-surface/80 border-b border-border font-semibold text-muted tracking-wider uppercase text-[11px]">
                    <th className="py-2.5 px-3 w-12 text-center">S.No</th>
                    <th className="py-2.5 px-3 min-w-[150px]">Component</th>
                    <th className="py-2.5 px-3 w-24 text-right">MSS Page Count</th>
                    <th className="py-2.5 px-3 w-20 text-right">Art Count</th>
                    <th className="py-2.5 px-3 w-24 text-right">Keystroke Count</th>
                    <th className="py-2.5 px-3 w-24 text-right">Cast-Off Pages</th>
                    <th className="py-2.5 px-3 w-24 text-right">Start Page (Act.)</th>
                    <th className="py-2.5 px-3 w-24 text-right">End Page (Act.)</th>
                    <th className="py-2.5 px-3 w-20 text-right">Blanks (Act.)</th>
                    <th className="py-2.5 px-3 w-24 text-right">Total Pages</th>
                    <th className="py-2.5 px-3 w-24 text-right">Cast-Off Diff</th>
                    <th className="py-2.5 px-3 min-w-[140px]">Remarks</th>
                    {isEditing && <th className="py-2.5 px-2 w-10 text-center"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((row, idx) => (
                    <tr
                      key={row.id || idx}
                      draggable={isEditing}
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={() => handleDrop(idx)}
                      className={`hover:bg-muted/10 transition-colors ${draggedIndex === idx ? 'opacity-40 bg-primary/10' : ''}`}
                    >
                      <td className="py-2 px-3 text-center text-muted font-medium">
                        {isEditing && (
                          <Move size={11} className="inline mr-1 text-muted/60 cursor-grab" />
                        )}
                        {idx + 1}
                      </td>

                      {/* Component */}
                      <td className="py-2 px-3 font-medium text-text">
                        {isEditing ? (
                          <input
                            type="text"
                            value={row.component}
                            onChange={e => handleCellChange(idx, 'component', e.target.value)}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.component
                        )}
                      </td>

                      {/* MSS Page Count */}
                      <td className="py-2 px-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={row.mss_page_count}
                            onChange={e => handleCellChange(idx, 'mss_page_count', e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.mss_page_count !== '' ? row.mss_page_count : '—'
                        )}
                      </td>

                      {/* Art Count */}
                      <td className="py-2 px-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={row.art_count}
                            onChange={e => handleCellChange(idx, 'art_count', e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.art_count !== '' ? row.art_count : '—'
                        )}
                      </td>

                      {/* Keystroke Count */}
                      <td className="py-2 px-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={row.keystroke_count}
                            onChange={e => handleCellChange(idx, 'keystroke_count', e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.keystroke_count !== '' ? row.keystroke_count : '—'
                        )}
                      </td>

                      {/* Cast-Off Pages */}
                      <td className="py-2 px-3 text-right font-medium">
                        {isEditing ? (
                          <input
                            type="number"
                            value={row.cast_off_pages}
                            onChange={e => handleCellChange(idx, 'cast_off_pages', e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-right font-medium focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.cast_off_pages !== '' ? row.cast_off_pages : '—'
                        )}
                      </td>

                      {/* Start Page (Act.) */}
                      <td className="py-2 px-3 text-right">
                        {isEditing ? (
                          <input
                            type="text"
                            value={row.start_page_act}
                            onChange={e => handleCellChange(idx, 'start_page_act', e.target.value)}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.start_page_act !== '' ? row.start_page_act : '—'
                        )}
                      </td>

                      {/* End Page (Act.) */}
                      <td className="py-2 px-3 text-right">
                        {isEditing ? (
                          <input
                            type="text"
                            value={row.end_page_act}
                            onChange={e => handleCellChange(idx, 'end_page_act', e.target.value)}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.end_page_act !== '' ? row.end_page_act : '—'
                        )}
                      </td>

                      {/* Blanks (Act.) */}
                      <td className="py-2 px-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={row.blanks_act}
                            onChange={e => handleCellChange(idx, 'blanks_act', e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.blanks_act !== '' ? row.blanks_act : '—'
                        )}
                      </td>

                      {/* Total Pages */}
                      <td className="py-2 px-3 text-right font-semibold text-text">
                        {isEditing ? (
                          <input
                            type="number"
                            value={row.total_pages}
                            onChange={e => handleCellChange(idx, 'total_pages', e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-right font-semibold focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.total_pages !== '' ? row.total_pages : '—'
                        )}
                      </td>

                      {/* Cast-Off Diff */}
                      <td className={`py-2 px-3 text-right font-medium ${row.cast_off_diff !== '' && Number(row.cast_off_diff) < 0
                        ? 'text-red-500 font-bold'
                        : row.cast_off_diff !== '' && Number(row.cast_off_diff) > 0
                          ? 'text-emerald-500 font-bold'
                          : 'text-muted'
                        }`}>
                        {isEditing ? (
                          <input
                            type="number"
                            value={row.cast_off_diff}
                            onChange={e => handleCellChange(idx, 'cast_off_diff', e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.cast_off_diff !== '' ? (Number(row.cast_off_diff) > 0 ? `+${row.cast_off_diff}` : row.cast_off_diff) : '—'
                        )}
                      </td>

                      {/* Remarks */}
                      <td className="py-2 px-3 text-muted">
                        {isEditing ? (
                          <input
                            type="text"
                            value={row.remarks}
                            onChange={e => handleCellChange(idx, 'remarks', e.target.value)}
                            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          row.remarks || '—'
                        )}
                      </td>

                      {/* Remove action in edit mode */}
                      {isEditing && (
                        <td className="py-2 px-2 text-center">
                          <button
                            onClick={() => handleRemoveRow(idx)}
                            className="text-muted hover:text-red-500 transition-colors p-1"
                            title="Remove row"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>

                {/* Footer Totals */}
                <tfoot>
                  <tr className="bg-surface/80 border-t-2 border-border font-bold text-text">
                    <td className="py-2.5 px-3 text-center">Total</td>
                    <td className="py-2.5 px-3"></td>
                    <td className="py-2.5 px-3 text-right font-mono">{totals.mss || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{totals.art || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-mono">—</td>
                    <td className="py-2.5 px-3 text-right font-mono">{totals.castOff || '—'}</td>
                    <td className="py-2.5 px-3 text-right"></td>
                    <td className="py-2.5 px-3 text-right"></td>
                    <td className="py-2.5 px-3 text-right font-mono">{totals.blanks || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-primary">{totals.totalAct || '—'}</td>
                    <td className={`py-2.5 px-3 text-right font-mono ${totals.diff < 0 ? 'text-red-500' : totals.diff > 0 ? 'text-emerald-500' : ''
                      }`}>
                      {totals.diff !== 0 ? (totals.diff > 0 ? `+${totals.diff}` : totals.diff) : '—'}
                    </td>
                    <td className="py-2.5 px-3"></td>
                    {isEditing && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-3 border-t border-border bg-surface/50 flex items-center justify-between">
          <div className="text-[11px] text-muted">
            Values are stored in project details without modifying core schema. Only managers and admins can edit.
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving} leftIcon={saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}>
                  {saving ? 'Saving...' : 'Save Book Map'}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

