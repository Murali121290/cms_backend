import { useState, useMemo, useEffect } from 'react'
import {
  Search, Shield, CheckCircle2, Sliders, Download, Upload, RotateCcw,
  Sparkles, Filter, AlertTriangle, AlertOctagon, Info
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/store/useToastStore'
import { PA_121_RULES, type PaRuleDefinition } from '@/data/paRulesCatalog'

interface Props {
  journalId: number
}

type ModeType = 'Auto Fix' | 'Review and Fix' | 'Review Auto Fix'
type SeverityType = 'Critical' | 'Major' | 'Minor' | 'Informational'

export function PaRulesSettingsTab({ journalId }: Props) {
  const storageKey = `pa_rules_settings_journal_${journalId}`

  // Load from local storage or fallback to catalog defaults
  const [rules, setRules] = useState<PaRuleDefinition[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length === PA_121_RULES.length) {
          return parsed
        }
      }
    } catch {
      // ignore
    }
    return PA_121_RULES
  })

  const [search, setSearch] = useState('')
  const [selectedGate, setSelectedGate] = useState<string>('all')
  const [selectedPart, setSelectedPart] = useState<string>('all')
  const [selectedMode, setSelectedMode] = useState<string>('all')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Sync to localStorage on save
  const handleSave = () => {
    setIsSaving(true)
    setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(rules))
        toast.success(`Successfully saved 121 pre-editing rules configuration for Journal #${journalId}`)
        setHasChanges(false)
      } catch (err) {
        toast.error('Failed to save settings: ' + String(err))
      } finally {
        setIsSaving(false)
      }
    }, 400)
  }

  // Toggle individual rule
  const handleToggleRule = (id: number) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
    setHasChanges(true)
  }

  // Change mode
  const handleChangeMode = (id: number, mode: ModeType) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, defaultMode: mode } : r))
    setHasChanges(true)
  }

  // Change severity
  const handleChangeSeverity = (id: number, severity: SeverityType) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, defaultSeverity: severity } : r))
    setHasChanges(true)
  }

  // Bulk actions
  const handleEnableAll = (enable: boolean) => {
    setRules(prev => prev.map(r => ({ ...r, enabled: enable })))
    setHasChanges(true)
    toast.info(enable ? 'All 121 rules enabled' : 'All 121 rules disabled')
  }

  const handleResetDefaults = () => {
    if (confirm('Reset all 121 rules to PA Editorial Ltd. standard defaults?')) {
      setRules(PA_121_RULES)
      setHasChanges(true)
      localStorage.removeItem(storageKey)
      toast.success('Reset to PA Editorial Ltd. default profile')
    }
  }

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(rules, null, 2))
    const downloadAnchor = document.createElement('a')
    downloadAnchor.setAttribute('href', dataStr)
    downloadAnchor.setAttribute('download', `journal_${journalId}_121_rules_profile.json`)
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
    toast.success('Rules profile exported as JSON')
  }

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target?.result as string)
        if (Array.isArray(imported)) {
          setRules(imported)
          setHasChanges(true)
          toast.success(`Successfully imported ${imported.length} rules profile`)
        } else {
          toast.error('Invalid JSON file format')
        }
      } catch (err) {
        toast.error('Error parsing JSON file: ' + String(err))
      }
    }
    reader.readAsText(file)
  }

  // Filtered rules
  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rules.filter(r => {
      if (selectedGate !== 'all' && r.gateKey !== selectedGate) return false
      if (selectedPart !== 'all' && r.part !== selectedPart) return false
      if (selectedMode !== 'all' && r.defaultMode !== selectedMode) return false
      if (q) {
        const matchName = r.name.toLowerCase().includes(q)
        const matchDesc = r.description.toLowerCase().includes(q)
        const matchDomain = r.domain.toLowerCase().includes(q)
        const matchId = String(r.id) === q || String(r.rule160Id) === q
        if (!matchName && !matchDesc && !matchDomain && !matchId) return false
      }
      return true
    })
  }, [rules, search, selectedGate, selectedPart, selectedMode])

  // Summary counts
  const enabledCount = useMemo(() => rules.filter(r => r.enabled).length, [rules])
  const autofixCount = useMemo(() => rules.filter(r => r.enabled && r.defaultMode === 'Auto Fix').length, [rules])
  const criticalCount = useMemo(() => rules.filter(r => r.enabled && r.defaultSeverity === 'Critical').length, [rules])

  return (
    <div className="space-y-5">
      {/* Overview Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl p-5 border border-slate-700 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="bg-emerald-500/20 text-emerald-300 font-bold px-2.5 py-0.5 rounded-full text-xs uppercase tracking-wider flex items-center gap-1.5 border border-emerald-500/30">
              <Shield className="w-3.5 h-3.5" /> PA Editorial Ltd. Profile
            </span>
            <span className="text-slate-400 text-xs">v2.4 Specification</span>
          </div>
          <h2 className="text-lg font-bold">121 Pre-Editing Checklist & Production Rules</h2>
          <p className="text-slate-300 text-xs mt-1 max-w-2xl leading-relaxed">
            Configure automated detectors, deterministic auto-fixes, and editorial reviewer gates for this journal.
            Includes 1:1 crosswalk mapping with the 160 Extended Quality Points.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJson}
            className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white text-xs"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export JSON
          </Button>
          <label className="cursor-pointer">
            <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
            <span className="inline-flex items-center justify-center px-3 py-1.5 border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white rounded-md text-xs font-semibold">
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Import
            </span>
          </label>
          <Button
            onClick={handleSave}
            isLoading={isSaving}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm"
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Save Configuration
          </Button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[11px] font-semibold text-muted uppercase">Total Rules</div>
          <div className="text-xl font-extrabold text-text mt-0.5">121 <span className="text-xs font-normal text-muted">(160 X-Walk)</span></div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[11px] font-semibold text-muted uppercase">Active / Enabled</div>
          <div className="text-xl font-extrabold text-emerald-600 mt-0.5">{enabledCount} <span className="text-xs font-normal text-muted">/ 121</span></div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[11px] font-semibold text-muted uppercase">Auto-Fix Enabled</div>
          <div className="text-xl font-extrabold text-sky-600 mt-0.5">{autofixCount} rules</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[11px] font-semibold text-muted uppercase">Blocker / Critical</div>
          <div className="text-xl font-extrabold text-rose-600 mt-0.5">{criticalCount} rules</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by rule name, domain, ID (e.g. SI units, #13, En-Dash)..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedGate}
              onChange={e => setSelectedGate(e.target.value)}
              className="text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 text-text"
            >
              <option value="all">All Gated Steps (4)</option>
              <option value="gate1">Gate 1: Structuring (#68–70, #83–84)</option>
              <option value="gate2">Gate 2: References (#48–67)</option>
              <option value="gate3">Gate 3: Mechanical Rules (#1–47, #92–121)</option>
              <option value="gate4">Gate 4: Asset Callouts (#71–91)</option>
            </select>

            <select
              value={selectedPart}
              onChange={e => setSelectedPart(e.target.value)}
              className="text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 text-text"
            >
              <option value="all">All Parts</option>
              <option value="Technical">Part 1: Technical (#1–91)</option>
              <option value="Language">Part 2: Language (#92–121)</option>
            </select>

            <select
              value={selectedMode}
              onChange={e => setSelectedMode(e.target.value)}
              className="text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 text-text"
            >
              <option value="all">All Execution Modes</option>
              <option value="Auto Fix">⚡ Auto Fix</option>
              <option value="Review and Fix">👁️ Review and Fix</option>
              <option value="Review Auto Fix">🔍 Review Auto Fix</option>
            </select>

            <Button
              variant="outline"
              size="sm"
              onClick={handleResetDefaults}
              className="text-xs h-8 text-muted hover:text-text"
            >
              <RotateCcw className="w-3 h-3 mr-1" /> Defaults
            </Button>
          </div>
        </div>

        {/* Quick bulk toggle row */}
        <div className="flex items-center justify-between text-xs text-muted pt-2 border-t border-border">
          <div>
            Showing <strong className="text-text">{filteredRules.length}</strong> of 121 rules
            {hasChanges && <span className="ml-2 text-amber-600 font-semibold">(Unsaved changes)</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleEnableAll(true)}
              className="text-primary hover:underline font-semibold"
            >
              Enable All Filtered
            </button>
            <span>·</span>
            <button
              onClick={() => handleEnableAll(false)}
              className="text-rose-600 hover:underline font-semibold"
            >
              Disable All Filtered
            </button>
          </div>
        </div>
      </div>

      {/* Rules Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-border text-muted font-bold uppercase text-[11px]">
                <th className="py-3 px-4 w-12 text-center">Active</th>
                <th className="py-3 px-3 w-28">Point #</th>
                <th className="py-3 px-3">Rule Name & Domain</th>
                <th className="py-3 px-3 w-40">Gate Stage</th>
                <th className="py-3 px-3 w-40">Resolution Mode</th>
                <th className="py-3 px-3 w-32">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRules.map(rule => (
                <tr
                  key={rule.id}
                  className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                    !rule.enabled ? 'opacity-50 bg-slate-50/30' : ''
                  }`}
                >
                  {/* Enable Switch */}
                  <td className="py-3 px-4 text-center">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => handleToggleRule(rule.id)}
                      className="size-4 rounded text-primary focus:ring-primary cursor-pointer"
                    />
                  </td>

                  {/* Rule ID with Crosswalk */}
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-text bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[11.5px]">
                        #{rule.id}
                      </span>
                      <span className="text-[10px] text-muted font-mono" title={`Extended Crosswalk Point #${rule.rule160Id}`}>
                        (#{rule.rule160Id})
                      </span>
                    </div>
                  </td>

                  {/* Name, Domain, Description */}
                  <td className="py-3 px-3">
                    <div className="font-semibold text-text text-xs flex items-center gap-2">
                      {rule.name}
                      <span className="text-[10.5px] font-normal text-muted bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                        {rule.domain}
                      </span>
                    </div>
                    <div className="text-muted text-[11px] mt-0.5 line-clamp-1">
                      {rule.description}
                    </div>
                  </td>

                  {/* Gate Stage */}
                  <td className="py-3 px-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                      rule.gateKey === 'gate1' ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
                      rule.gateKey === 'gate2' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                      rule.gateKey === 'gate3' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
                      'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    }`}>
                      {rule.gate}
                    </span>
                  </td>

                  {/* Execution Mode */}
                  <td className="py-3 px-3">
                    <select
                      value={rule.defaultMode}
                      disabled={!rule.enabled}
                      onChange={e => handleChangeMode(rule.id, e.target.value as ModeType)}
                      className="w-full text-xs rounded border border-border bg-background py-1 px-2 text-text font-medium disabled:opacity-50"
                    >
                      <option value="Auto Fix">⚡ Auto Fix</option>
                      <option value="Review and Fix">👁️ Review and Fix</option>
                      <option value="Review Auto Fix">🔍 Review Auto Fix</option>
                    </select>
                  </td>

                  {/* Severity */}
                  <td className="py-3 px-3">
                    <select
                      value={rule.defaultSeverity}
                      disabled={!rule.enabled}
                      onChange={e => handleChangeSeverity(rule.id, e.target.value as SeverityType)}
                      className={`w-full text-xs rounded border border-border bg-background py-1 px-2 font-medium disabled:opacity-50 ${
                        rule.defaultSeverity === 'Critical' ? 'text-rose-600 font-bold' :
                        rule.defaultSeverity === 'Major' ? 'text-amber-600 font-bold' :
                        rule.defaultSeverity === 'Minor' ? 'text-slate-700 dark:text-slate-300' :
                        'text-sky-600'
                      }`}
                    >
                      <option value="Critical">Critical</option>
                      <option value="Major">Major</option>
                      <option value="Minor">Minor</option>
                      <option value="Informational">Informational</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
