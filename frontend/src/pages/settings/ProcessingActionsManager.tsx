import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Search, Save, RotateCcw, Check, ChevronDown, X,
  Layers, ShieldCheck, BookCheck, Languages, Wrench,
  Layout, FileOutput, Sparkles, ScanLine, FileCode,
  Image, Eye, Plus, CheckCircle2, Sliders
} from 'lucide-react'
import type { Stage } from '@/api/stages'
import { useStageActionsStore } from '@/store/useStageActionsStore'
import { toast } from '@/store/useToastStore'
import { Spinner } from '@/components/ui/Spinner'

interface ProcessingActionsManagerProps {
  stages: Stage[]
  onMappingSaved?: () => void
}

// Icon mapper for action definitions
const ICON_MAP: Record<string, React.ElementType> = {
  Layers,
  ShieldCheck,
  BookCheck,
  Languages,
  Wrench,
  Layout,
  FileOutput,
  Sparkles,
  ScanLine,
  FileCode,
  Image,
  Eye,
  Sliders,
}

export function ProcessingActionsManager({ stages, onMappingSaved }: ProcessingActionsManagerProps) {
  const { definitions, mapping: initialMapping, loading: storeLoading, fetchMapping, updateMapping } = useStageActionsStore()

  // Local draft mapping
  const [draftMapping, setDraftMapping] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeDropdownKey, setActiveDropdownKey] = useState<string | null>(null)
  const [stageFilterText, setStageFilterText] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load mapping from store or API
  useEffect(() => {
    void fetchMapping()
  }, [fetchMapping])

  useEffect(() => {
    if (initialMapping && Object.keys(initialMapping).length > 0) {
      setDraftMapping(JSON.parse(JSON.stringify(initialMapping)))
    }
  }, [initialMapping])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveDropdownKey(null)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  // Active stages from DB
  const activeStages = useMemo(() => {
    return stages.filter(s => s.active_status)
  }, [stages])

  // Detect unsaved changes
  const hasChanges = useMemo(() => {
    if (!initialMapping || Object.keys(initialMapping).length === 0) return false
    const keys = Array.from(new Set([...Object.keys(draftMapping), ...Object.keys(initialMapping)]))
    for (const key of keys) {
      const a = (draftMapping[key] || []).slice().sort()
      const b = (initialMapping[key] || []).slice().sort()
      if (a.length !== b.length) return true
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return true
      }
    }
    return false
  }, [draftMapping, initialMapping])

  // Filtered definitions
  const filteredDefinitions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return definitions

    return definitions.filter(item => {
      return (
        item.label.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.key.toLowerCase().includes(query) ||
        (draftMapping[item.key] || []).some(s => s.toLowerCase().includes(query))
      )
    })
  }, [definitions, searchQuery, draftMapping])

  // Toggle stage for an action
  const handleToggleStage = (actionKey: string, stageName: string) => {
    setDraftMapping(prev => {
      const current = prev[actionKey] || []
      const exists = current.some(s => s.toLowerCase() === stageName.toLowerCase())
      const updated = exists
        ? current.filter(s => s.toLowerCase() !== stageName.toLowerCase())
        : [...current, stageName]
      return { ...prev, [actionKey]: updated }
    })
  }

  // Assign all stages to an action
  const handleAssignAllStages = (actionKey: string) => {
    setDraftMapping(prev => ({
      ...prev,
      [actionKey]: activeStages.map(s => s.stage_name),
    }))
  }

  // Clear all stages for an action
  const handleClearStages = (actionKey: string) => {
    setDraftMapping(prev => ({
      ...prev,
      [actionKey]: [],
    }))
  }

  // Reset to initial
  const handleReset = () => {
    if (initialMapping) {
      setDraftMapping(JSON.parse(JSON.stringify(initialMapping)))
      toast.info('Changes reset to last saved state')
    }
  }

  // Save changes to API
  const handleSave = async () => {
    setSaving(true)
    try {
      const success = await updateMapping(draftMapping)
      if (success) {
        toast.success('Processing action mappings updated successfully!')
        onMappingSaved?.()
      } else {
        toast.error('Failed to update action mappings')
      }
    } catch {
      toast.error('An error occurred while saving mappings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Top Action & Filter Toolbar ── */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-text flex items-center gap-2">
              <Sliders size={16} className="text-primary" />
              Action-to-Stage Workflow Configuration
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Select which workflow stages display each automated processing tool and file operation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={!hasChanges || saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted hover:text-text hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <RotateCcw size={13} /> Reset
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg text-white transition-all shadow-sm ${
                hasChanges
                  ? 'bg-primary hover:bg-primary/90 ring-2 ring-primary/30 ring-offset-1'
                  : 'bg-primary/50 opacity-60 cursor-not-allowed'
              }`}
            >
              {saving ? <Spinner /> : <Save size={14} />}
              {saving ? 'Saving Changes…' : hasChanges ? 'Save Changes' : 'All Changes Saved'}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="pt-2 border-t border-border/50">
          <div className="relative max-w-md">
            <Search size={13} className="absolute left-3 top-2.5 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search actions, tools, stages…"
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-text"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-muted hover:text-text"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Action Cards Grid ── */}
      {storeLoading && definitions.length === 0 ? (
        <div className="flex items-center justify-center h-48 bg-card border border-border rounded-xl">
          <Spinner />
          <span className="ml-2 text-xs text-muted">Loading processing actions…</span>
        </div>
      ) : filteredDefinitions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-card border border-border rounded-xl text-center">
          <Sliders size={32} className="text-muted/40 mb-2" />
          <p className="text-sm font-semibold text-text">No processing actions found</p>
          <p className="text-xs text-muted mt-1">Try adjusting your search query</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredDefinitions.map(action => {
            const IconComponent = ICON_MAP[action.icon] || Sliders
            const assignedStages = draftMapping[action.key] || []
            const isDropdownOpen = activeDropdownKey === action.key

            return (
              <div
                key={action.key}
                className="bg-card border border-border rounded-xl p-4 shadow-xs hover:border-primary/40 hover:shadow-sm transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 flex-shrink-0 shadow-xs">
                        <IconComponent size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-text">{action.label}</h4>
                          <span className="text-[10px] font-mono text-muted bg-background px-1.5 py-0.5 rounded border border-border">
                            {action.key}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1 leading-relaxed">
                          {action.description}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Assigned Stages List */}
                  <div className="mt-4 pt-3 border-t border-border/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-text uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle2 size={12} className={assignedStages.length > 0 ? 'text-primary' : 'text-muted'} />
                        Assigned Stages ({assignedStages.length})
                      </span>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleAssignAllStages(action.key)}
                          className="text-[10px] font-medium text-primary hover:underline hover:text-primary/80"
                        >
                          All Stages
                        </button>
                        <span className="text-muted text-[10px]">•</span>
                        <button
                          type="button"
                          onClick={() => handleClearStages(action.key)}
                          className="text-[10px] font-medium text-muted hover:underline hover:text-danger"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {/* Stage Chips */}
                    <div className="flex flex-wrap gap-1.5 min-h-[32px] items-center">
                      {assignedStages.length === 0 ? (
                        <span className="text-xs text-muted italic">
                          No stages assigned — action hidden in file manager
                        </span>
                      ) : (
                        assignedStages.map(stageName => (
                          <span
                            key={stageName}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-background border border-border text-text shadow-xs group"
                          >
                            <span>{stageName}</span>
                            <button
                              type="button"
                              onClick={() => handleToggleStage(action.key, stageName)}
                              className="text-muted hover:text-danger group-hover:text-text transition-colors"
                              title={`Remove ${stageName}`}
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Footer: Add Stage Selector */}
                <div className="mt-3.5 pt-3 border-t border-border/50 relative" ref={isDropdownOpen ? dropdownRef : undefined}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveDropdownKey(isDropdownOpen ? null : action.key)
                      setStageFilterText('')
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium rounded-lg bg-background border border-border hover:bg-accent hover:border-primary/30 text-text transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Plus size={13} className="text-primary" /> Assign / Toggle Stages
                    </span>
                    <ChevronDown size={13} className={`text-muted transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown Menu */}
                  {isDropdownOpen && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 z-30 bg-card border border-border rounded-xl shadow-xl p-2 max-h-56 overflow-hidden flex flex-col">
                      <div className="relative mb-2">
                        <Search size={12} className="absolute left-2.5 top-2 text-muted" />
                        <input
                          type="text"
                          autoFocus
                          value={stageFilterText}
                          onChange={e => setStageFilterText(e.target.value)}
                          placeholder="Filter stages…"
                          className="w-full pl-7 pr-3 py-1 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-text"
                        />
                      </div>

                      <div className="overflow-y-auto flex-1 space-y-1">
                        {activeStages
                          .filter(s => s.stage_name.toLowerCase().includes(stageFilterText.toLowerCase()))
                          .map(stage => {
                            const isSelected = assignedStages.some(
                              s => s.toLowerCase() === stage.stage_name.toLowerCase()
                            )
                            return (
                              <button
                                key={stage.id}
                                type="button"
                                onClick={() => handleToggleStage(action.key, stage.stage_name)}
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                  isSelected
                                    ? 'bg-primary/10 text-primary font-semibold'
                                    : 'text-text hover:bg-background'
                                }`}
                              >
                                <span className="truncate">{stage.stage_name}</span>
                                <span
                                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ml-2 ${
                                    isSelected ? 'bg-primary border-primary text-white' : 'border-border'
                                  }`}
                                >
                                  {isSelected && <Check size={10} />}
                                </span>
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
