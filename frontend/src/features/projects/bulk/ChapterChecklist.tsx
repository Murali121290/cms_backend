import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'

export interface ChecklistChapter {
  id: number
  chapters: string
  chapter_title?: string | null
}

interface ChapterChecklistProps {
  chapters: ChecklistChapter[]
  selectedIds: Set<number>
  onChange: (selected: Set<number>) => void
  summaryCounts?: Record<number, Record<string, number>>
  initialTrack?: 'manuscript' | 'art' | 'all'
  showTrackFilter?: boolean
}

export function ChapterChecklist({
  chapters,
  selectedIds,
  onChange,
  summaryCounts,
  initialTrack = 'all',
  showTrackFilter = true,
}: ChapterChecklistProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [trackFilter, setTrackFilter] = useState<'all' | 'manuscript' | 'art'>(initialTrack)

  // Exclude "Final files" pseudo-chapter
  const validChapters = useMemo(() => {
    return chapters.filter(c => !c.chapters?.toLowerCase().includes('final files'))
  }, [chapters])

  // Filter by track and search keyword
  const filteredChapters = useMemo(() => {
    return validChapters.filter(c => {
      const isArt = c.chapters?.toLowerCase().includes('art')
      if (trackFilter === 'art' && !isArt) return false
      if (trackFilter === 'manuscript' && isArt) return false

      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase()
        const matchNum = c.chapters?.toLowerCase().includes(term)
        const matchTitle = c.chapter_title?.toLowerCase().includes(term)
        return matchNum || matchTitle
      }
      return true
    })
  }, [validChapters, trackFilter, searchTerm])

  const visibleIds = useMemo(() => {
    return new Set(filteredChapters.map(c => c.id))
  }, [filteredChapters])

  const selectedCountInView = useMemo(() => {
    let count = 0
    for (const id of visibleIds) {
      if (selectedIds.has(id)) count++
    }
    return count
  }, [visibleIds, selectedIds])

  const handleSelectAll = () => {
    const next = new Set(selectedIds)
    filteredChapters.forEach(c => next.add(c.id))
    onChange(next)
  }

  const handleDeselectAll = () => {
    const next = new Set(selectedIds)
    filteredChapters.forEach(c => next.delete(c.id))
    onChange(next)
  }

  const handleToggle = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onChange(next)
  }

  return (
    <div className="space-y-2.5">
      {/* Track filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {showTrackFilter && (
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTrackFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${trackFilter === 'all'
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted hover:text-text'
                }`}
            >
              All ({validChapters.length})
            </button>
            <button
              type="button"
              onClick={() => setTrackFilter('manuscript')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${trackFilter === 'manuscript'
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted hover:text-text'
                }`}
            >
              Manuscripts ({validChapters.filter(c => !c.chapters?.toLowerCase().includes('art')).length})
            </button>
            <button
              type="button"
              onClick={() => setTrackFilter('art')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${trackFilter === 'art'
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted hover:text-text'
                }`}
            >
              Art Tracks ({validChapters.filter(c => c.chapters?.toLowerCase().includes('art')).length})
            </button>
          </div>
        )}

        <div className="relative flex-1 sm:max-w-xs ml-auto">
          <Search size={13} className="absolute left-2.5 top-2.5 text-muted pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search chapter..."
            className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background focus:ring-1 focus:ring-primary focus:border-primary outline-none"
          />
        </div>
      </div>

      {/* Checklist Header */}
      <div className="flex items-center justify-between pt-1">
        <label className="text-xs font-medium text-muted">
          Chapters ({selectedCountInView}/{filteredChapters.length} selected)
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDeselectAll}
            className="text-[11px] text-primary hover:underline font-medium transition-colors"
          >
            Deselect all
          </button>
          <span className="text-border">|</span>
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-[11px] text-primary hover:underline font-medium transition-colors"
          >
            Select all
          </button>
        </div>
      </div>

      {/* Chapters Scroll Box */}
      <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border bg-background">
        {filteredChapters.length === 0 ? (
          <p className="text-center text-xs text-muted py-6">No chapters match your filter.</p>
        ) : (
          filteredChapters.map(ch => {
            const isSelected = selectedIds.has(ch.id)
            const isArt = ch.chapters?.toLowerCase().includes('art')
            const counts = summaryCounts?.[ch.id]
            const totalFiles = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null

            return (
              <label
                key={ch.id}
                className={`flex items-start gap-3 px-3 py-2.5 hover:bg-surface transition-colors cursor-pointer select-none ${isSelected ? 'bg-primary/5' : ''
                  }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggle(ch.id)}
                  className="mt-0.5 rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
                />
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0 ${isArt
                          ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300'
                          : 'bg-primary/10 text-primary'
                          }`}
                      >
                        {isArt ? ch.chapters : `Ch ${ch.chapters}`}
                      </span>
                      <span className="truncate text-xs text-text font-medium">
                        {ch.chapter_title || `Chapter ${ch.chapters}`}
                      </span>
                    </div>
                    {totalFiles !== null && (
                      <span className="text-[11px] font-mono text-muted flex-shrink-0">
                        {totalFiles} file{totalFiles !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}
