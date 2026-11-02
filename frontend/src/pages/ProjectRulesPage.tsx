import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Save,
  Search,
  History as HistoryIcon,
  Loader2,
  AlertCircle,
  Lock,
  Code2,
  Download,
  FileSpreadsheet,
  Sparkles,
  SpellCheck,
  AlignLeft,
  Link2,
  Users,
  Hash,
  Check,
  X,
  Copy as CopyIcon,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Keyboard,
  Zap,
  ShieldCheck,
  Minimize2,
  BookOpenCheck,
  CircleAlert,
  CircleHelp,
  CircleX,
  Stethoscope,
} from 'lucide-react'
import { rulesApi, type LanguageRule, type RuleHistoryEntry, type RuleOverrides, type ToolBehaviour, type Audience, type MedicalStyleProfile } from '@/api/rulesApi'
import { RuleDetails } from '@/features/language_edit/RuleDetails'
import { useRBAC } from '@/hooks/useRBAC'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { formatDateTime } from '@/utils/dateUtils'
import { useUsersStore } from '@/stores/usersStore'

type CategoryKey = 'grammar' | 'spelling' | 'sentence' | 'compounds' | 'inclusive' | 'hyphenation' | 'abbreviations' | 'medical_terms' | 'custom' | 'other'

interface CategoryMeta {
  label: string
  Icon: typeof Hash
  grad: string         // gradient for the tile
  dot: string          // bg-*-500 for solid dots
  accent: string       // left border on section (border-*-500)
  ring: string         // text-*-500 for the progress ring stroke
  chipActive: string
  chipInactive: string
  softBg: string
  tileBg: string       // soft gradient card bg
}

const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
  grammar: {
    label: 'Grammar', Icon: Sparkles,
    grad: 'from-amber-500 to-orange-500',
    dot: 'bg-amber-500', accent: 'border-l-amber-500', ring: 'text-amber-500',
    chipActive: 'bg-amber-500 text-white border-amber-500',
    chipInactive: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
    softBg: 'bg-gradient-to-r from-amber-50/60 to-transparent',
    tileBg: 'from-amber-50 to-orange-50/40',
  },
  spelling: {
    label: 'Spelling', Icon: SpellCheck,
    grad: 'from-sky-500 to-blue-500',
    dot: 'bg-sky-500', accent: 'border-l-sky-500', ring: 'text-sky-500',
    chipActive: 'bg-sky-500 text-white border-sky-500',
    chipInactive: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
    softBg: 'bg-gradient-to-r from-sky-50/60 to-transparent',
    tileBg: 'from-sky-50 to-blue-50/40',
  },
  sentence: {
    label: 'Sentence', Icon: AlignLeft,
    grad: 'from-violet-500 to-purple-500',
    dot: 'bg-violet-500', accent: 'border-l-violet-500', ring: 'text-violet-500',
    chipActive: 'bg-violet-500 text-white border-violet-500',
    chipInactive: 'bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100',
    softBg: 'bg-gradient-to-r from-violet-50/60 to-transparent',
    tileBg: 'from-violet-50 to-purple-50/40',
  },
  compounds: {
    label: 'Compounds', Icon: Link2,
    grad: 'from-emerald-500 to-teal-500',
    dot: 'bg-emerald-500', accent: 'border-l-emerald-500', ring: 'text-emerald-500',
    chipActive: 'bg-emerald-500 text-white border-emerald-500',
    chipInactive: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
    softBg: 'bg-gradient-to-r from-emerald-50/60 to-transparent',
    tileBg: 'from-emerald-50 to-teal-50/40',
  },
  inclusive: {
    label: 'Inclusive', Icon: Users,
    grad: 'from-rose-500 to-pink-500',
    dot: 'bg-rose-500', accent: 'border-l-rose-500', ring: 'text-rose-500',
    chipActive: 'bg-rose-500 text-white border-rose-500',
    chipInactive: 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100',
    softBg: 'bg-gradient-to-r from-rose-50/60 to-transparent',
    tileBg: 'from-rose-50 to-pink-50/40',
  },
  hyphenation: {
    label: 'Hyphenation', Icon: Link2,
    grad: 'from-teal-500 to-cyan-500',
    dot: 'bg-teal-500', accent: 'border-l-teal-500', ring: 'text-teal-500',
    chipActive: 'bg-teal-500 text-white border-teal-500',
    chipInactive: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100',
    softBg: 'bg-gradient-to-r from-teal-50/60 to-transparent',
    tileBg: 'from-teal-50 to-cyan-50/40',
  },
  abbreviations: {
    label: 'Abbreviations', Icon: Hash,
    grad: 'from-indigo-500 to-blue-500',
    dot: 'bg-indigo-500', accent: 'border-l-indigo-500', ring: 'text-indigo-500',
    chipActive: 'bg-indigo-500 text-white border-indigo-500',
    chipInactive: 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100',
    softBg: 'bg-gradient-to-r from-indigo-50/60 to-transparent',
    tileBg: 'from-indigo-50 to-blue-50/40',
  },
  medical_terms: {
    label: 'Medical Terms', Icon: Stethoscope,
    grad: 'from-green-500 to-teal-500',
    dot: 'bg-green-500', accent: 'border-l-green-500', ring: 'text-green-500',
    chipActive: 'bg-green-500 text-white border-green-500',
    chipInactive: 'bg-green-50 text-green-800 border-green-200 hover:bg-green-100',
    softBg: 'bg-gradient-to-r from-green-50/60 to-transparent',
    tileBg: 'from-green-50 to-teal-50/40',
  },
  custom: {
    label: 'Custom', Icon: Code2,
    grad: 'from-fuchsia-500 to-purple-500',
    dot: 'bg-fuchsia-500', accent: 'border-l-fuchsia-500', ring: 'text-fuchsia-500',
    chipActive: 'bg-fuchsia-500 text-white border-fuchsia-500',
    chipInactive: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200 hover:bg-fuchsia-100',
    softBg: 'bg-gradient-to-r from-fuchsia-50/60 to-transparent',
    tileBg: 'from-fuchsia-50 to-purple-50/40',
  },
  other: {
    label: 'Other', Icon: Hash,
    grad: 'from-slate-500 to-slate-600',
    dot: 'bg-slate-400', accent: 'border-l-slate-400', ring: 'text-slate-400',
    chipActive: 'bg-slate-700 text-white border-slate-700',
    chipInactive: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200',
    softBg: 'bg-slate-50',
    tileBg: 'from-slate-50 to-slate-100/40',
  },
}

interface SeverityStyle { label: string; chip: string; border: string; Icon: typeof CircleAlert; iconCls: string }
const SEVERITY_STYLE: Record<string, SeverityStyle> = {
  error:      { label: 'Error',      chip: 'bg-rose-100 text-rose-700 border-rose-200',    border: 'border-l-rose-400',   Icon: CircleX,     iconCls: 'text-rose-500' },
  warning:    { label: 'Warning',    chip: 'bg-amber-100 text-amber-800 border-amber-200',  border: 'border-l-amber-400',  Icon: CircleAlert, iconCls: 'text-amber-500' },
  suggestion: { label: 'Suggestion', chip: 'bg-sky-100 text-sky-700 border-sky-200',        border: 'border-l-sky-300',    Icon: CircleHelp,  iconCls: 'text-sky-500' },
}

function catOf(rule: LanguageRule): CategoryKey {
  const c = (rule.category || '').toLowerCase()
  if (c in CATEGORY_META) return c as CategoryKey
  return 'other'
}

type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string }

export function ProjectRulesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { roles } = useRBAC()
  useDocumentTitle('Rules — S4 Carlisle CMS')

  const normalizedRoles = useMemo(
    () => new Set(roles.map((r) => r.toLowerCase().replace(/\s+/g, ''))),
    [roles],
  )
  const canEdit = normalizedRoles.has('admin') || normalizedRoles.has('projectmanager')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rules, setRules] = useState<LanguageRule[]>([])
  const [initialRules, setInitialRules] = useState<LanguageRule[]>([])  // for diff count
  // Scope C: 875 Hyphenation workbook rules surfaced read-mostly. Enabled
  // state + tool_behaviour overrides live in ruleOverrides, not in the
  // rule object itself (keeps the save payload sparse — we never serialize
  // 875 rules back to the server).
  const [workbookRules, setWorkbookRules] = useState<LanguageRule[]>([])
  const [ruleOverrides, setRuleOverrides] = useState<RuleOverrides>({})
  const [initialOverrides, setInitialOverrides] = useState<RuleOverrides>({})
  // Phase B+C Abbreviations settings — persisted in the project sidecar
  // JSON. ``initial*`` snapshots support discard + dirty tracking.
  const [audience, setAudience] = useState<Audience>('general')
  const [minUses, setMinUses] = useState<number>(2)
  const [scopeReset, setScopeReset] = useState<boolean>(false)
  const [initialAudience, setInitialAudience] = useState<Audience>('general')
  const [initialMinUses, setInitialMinUses] = useState<number>(2)
  const [initialScopeReset, setInitialScopeReset] = useState<boolean>(false)
  // Medical Terminology workbook (M-D): style profile for the subprofile
  // rules (US spelling, Possessive, Nonpossessive). ``All``-tagged rules
  // always fire; the subprofiles stay silent until the project opts in.
  const [medicalStyleProfile, setMedicalStyleProfile] = useState<MedicalStyleProfile>('All')
  const [initialMedicalStyleProfile, setInitialMedicalStyleProfile] = useState<MedicalStyleProfile>('All')
  const [profileKeys, setProfileKeys] = useState<string[]>(['uk'])
  const [profileChoices, setProfileChoices] = useState<string[]>([])
  const [availableProfiles, setAvailableProfiles] = useState<Record<string, any>>({})
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<CategoryKey | 'all'>('all')
  const [collapsed, setCollapsed] = useState<Set<CategoryKey>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<RuleHistoryEntry[] | null>(null)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonText, setJsonText] = useState<string | null>(null)
  const [projectCode, setProjectCode] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastSeq = useRef(0)
  const searchRef = useRef<HTMLInputElement | null>(null)

  function pushToast(kind: Toast['kind'], text: string) {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev, { id, kind, text }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200)
  }

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setLoading(true)
    rulesApi.get(projectId)
      .then((data) => {
        if (cancelled) return
        const activeRules = (data.active_rules?.rules ?? []).map((r) => ({
          ...r, enabled: r.enabled !== false,
        }))
        setRules(activeRules)
        setInitialRules(activeRules.map((r) => ({ ...r })))
        // Scope C: workbook rules + overrides. Concat every workbook family
        // the backend returns into a single flat state — the category chip
        // on each rule carries the routing so the Rules Picker renders
        // them under the right card without further plumbing.
        const wbBuckets = data.workbook_rules ?? {}
        const wb = ([] as LanguageRule[])
          .concat((wbBuckets.hyphenation ?? []) as LanguageRule[])
          .concat((wbBuckets.abbreviations ?? []) as LanguageRule[])
          .concat((wbBuckets.medical_terms ?? []) as LanguageRule[])
          .concat((wbBuckets.custom ?? []) as LanguageRule[])
        setWorkbookRules(wb)
        const overrides = (data.active_rules?.rule_overrides ?? {}) as RuleOverrides
        setRuleOverrides(overrides)
        setInitialOverrides(JSON.parse(JSON.stringify(overrides)))
        // Phase B+C settings — defaults match the backend validators.
        const aud: Audience = (data.active_rules?.audience as Audience) ?? 'general'
        const mu = typeof data.active_rules?.min_uses === 'number' ? data.active_rules.min_uses : 2
        const sr = Boolean(data.active_rules?.scope_reset)
        setAudience(aud); setInitialAudience(aud)
        setMinUses(mu); setInitialMinUses(mu)
        setScopeReset(sr); setInitialScopeReset(sr)
        const msp: MedicalStyleProfile = (data.active_rules?.medical_style_profile as MedicalStyleProfile) ?? 'All'
        setMedicalStyleProfile(msp); setInitialMedicalStyleProfile(msp)
        const keys = (data.active_rules?.profile_keys && data.active_rules.profile_keys.length)
          ? data.active_rules.profile_keys
          : [data.active_rules?.profile_key ?? 'uk']
        setProfileKeys(keys)
        setProfileChoices(Object.keys(data.available_profiles ?? {}))
        setAvailableProfiles(data.available_profiles ?? {})
        setProjectCode(data.active_rules?.project_code)
        setDirty(false)
      })
      .catch((err) => pushToast('error', err?.response?.data?.detail || err?.message || 'Failed to load rules'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [projectId])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if ((e.key === 's' || e.key === 'S') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (dirty && canEdit && !saving) handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, canEdit, saving]) // eslint-disable-line

  /** Merged list of all rules (profile + workbook) with the current override
   *  map applied. This is the source of truth for grouping, counts, and
   *  rendering — the UI never shows the raw per-store state directly.
   *
   *  Overrides apply uniformly: for each rule, look up ``ruleOverrides[id]``
   *  and swap in the overridden ``enabled`` / ``tool_behaviour``. A rule
   *  without an override entry displays its file default. */
  const allRules = useMemo<LanguageRule[]>(() => {
    const apply = (r: LanguageRule): LanguageRule => {
      const ov = ruleOverrides[r.id]
      if (!ov) return r
      const next: LanguageRule = { ...r, is_overridden: true, override: ov }
      if ('enabled' in ov) next.enabled = !!ov.enabled
      if (ov.tool_behaviour) next.tool_behaviour = ov.tool_behaviour
      return next
    }
    return [...rules.map(apply), ...workbookRules.map(apply)]
  }, [rules, workbookRules, ruleOverrides])

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const g: Record<CategoryKey, LanguageRule[]> = {
      grammar: [], spelling: [], sentence: [], compounds: [], inclusive: [], hyphenation: [], abbreviations: [], medical_terms: [], custom: [], other: [],
    }
    for (const r of allRules) {
      if (activeCategory !== 'all' && catOf(r) !== activeCategory) continue
      if (q) {
        const hay = `${r.id} ${r.message ?? ''} ${r.pattern ?? ''} ${r.source ?? ''}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      g[catOf(r)].push(r)
    }
    return g
  }, [allRules, search, activeCategory])

  const counts = useMemo(() => {
    const total = allRules.length
    const enabled = allRules.filter((r) => r.enabled !== false).length
    const byCat: Record<CategoryKey, { total: number; enabled: number }> = {
      grammar: { total: 0, enabled: 0 }, spelling: { total: 0, enabled: 0 },
      sentence: { total: 0, enabled: 0 }, compounds: { total: 0, enabled: 0 },
      inclusive: { total: 0, enabled: 0 }, hyphenation: { total: 0, enabled: 0 },
      abbreviations: { total: 0, enabled: 0 }, medical_terms: { total: 0, enabled: 0 },
      custom: { total: 0, enabled: 0 }, other: { total: 0, enabled: 0 },
    }
    const bySeverity = { error: 0, warning: 0, suggestion: 0 }
    for (const r of allRules) {
      const c = catOf(r); byCat[c].total += 1
      if (r.enabled !== false) {
        byCat[c].enabled += 1
        const s = (r.severity || '').toLowerCase()
        if (s in bySeverity) (bySeverity as any)[s]++
      }
    }
    return { total, enabled, byCat, bySeverity, pct: total ? Math.round((enabled / total) * 100) : 0 }
  }, [allRules])

  /** Per-rule membership: does this rule live in the profile store or the
   *  workbook store? Toggle / behaviour-change writes land in different
   *  state buckets depending on the answer. */
  const workbookIdSet = useMemo(() => new Set(workbookRules.map((r) => r.id)), [workbookRules])

  const diff = useMemo(() => {
    // Changes across both profile rules and the overrides map.
    let added = 0, removed = 0, changedBehaviour = 0
    const initRuleMap = new Map(initialRules.map((r) => [r.id, {
      enabled: r.enabled !== false,
      tb: r.tool_behaviour,
    }]))
    for (const r of rules) {
      const prev = initRuleMap.get(r.id); if (!prev) continue
      const nowEnabled = r.enabled !== false
      if (nowEnabled && !prev.enabled) added++
      if (!nowEnabled && prev.enabled) removed++
      if (prev.tb !== r.tool_behaviour) changedBehaviour++
    }
    const allIds = new Set([...Object.keys(initialOverrides), ...Object.keys(ruleOverrides)])
    for (const id of allIds) {
      const prev = initialOverrides[id] || {}
      const now = ruleOverrides[id] || {}
      // Only count enabled transitions when the override's ``enabled`` field
      // actually diverged between prev and now.
      const prevEn = 'enabled' in prev ? !!prev.enabled : null
      const nowEn  = 'enabled' in now  ? !!now.enabled  : null
      if (prevEn !== nowEn) {
        if (nowEn === false) removed++
        else if (nowEn === true) added++
      }
      if (prev.tool_behaviour !== now.tool_behaviour) changedBehaviour++
    }
    // Abbreviations settings also count as changes so the Save bar
    // surfaces when the user tweaks only a setting.
    let settingsChanged = 0
    if (audience !== initialAudience) settingsChanged++
    if (minUses !== initialMinUses) settingsChanged++
    if (scopeReset !== initialScopeReset) settingsChanged++
    if (medicalStyleProfile !== initialMedicalStyleProfile) settingsChanged++
    return {
      added, removed, changedBehaviour,
      total: added + removed + changedBehaviour + settingsChanged,
    }
  }, [rules, initialRules, ruleOverrides, initialOverrides,
      audience, initialAudience, minUses, initialMinUses, scopeReset, initialScopeReset,
      medicalStyleProfile, initialMedicalStyleProfile])

  /** Rebuild the rule union when the selected styles change.
   *  - Preserves existing enabled/disabled flags for rule IDs that stay in the union.
   *  - Adds new rules (from newly-selected styles) with each style's default enabled flag.
   *  - Drops rules that are no longer in any selected style's profile. */
  function toggleStyle(key: string) {
    if (!canEdit) return
    const nextKeys = profileKeys.includes(key)
      ? profileKeys.filter((k) => k !== key)
      : [...profileKeys, key]
    if (nextKeys.length === 0) {
      pushToast('error', 'At least one style must be selected')
      return
    }
    setProfileKeys(nextKeys)

    const existingById = new Map(rules.map((r) => [r.id, r]))
    const seen = new Set<string>()
    const next: LanguageRule[] = []
    for (const pk of nextKeys) {
      const profile = availableProfiles[pk]
      if (!profile || !Array.isArray(profile.rules)) continue
      for (const r of profile.rules as LanguageRule[]) {
        if (!r.id || seen.has(r.id)) continue
        seen.add(r.id)
        const prev = existingById.get(r.id)
        next.push(prev ? { ...r, enabled: prev.enabled !== false } : { ...r })
      }
    }
    setRules(next)
    setDirty(true)
  }

  function toggleRule(ruleId: string) {
    if (!canEdit) return
    const current = allRules.find((r) => r.id === ruleId)
    if (!current) return
    const nextEnabled = !(current.enabled !== false)
    if (workbookIdSet.has(ruleId)) {
      // Workbook rule — update the sparse overrides map so the save
      // payload stays small (no 875-rule round-trip to the server).
      setRuleOverrides((prev) => ({
        ...prev,
        [ruleId]: { ...(prev[ruleId] || {}), enabled: nextEnabled },
      }))
    } else {
      // Profile rule — edit the project's canonical rule list directly.
      setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, enabled: nextEnabled } : r)))
    }
    setDirty(true)
  }

  /** Scope-C per-rule FLAG | AUTO_REPLACE preference. Writes to the same
   *  bucket as toggleRule (profile → rule.tool_behaviour; workbook →
   *  overrides map). Never silently mutates manuscript text. */
  function changeBehaviour(ruleId: string, next: ToolBehaviour) {
    if (!canEdit) return
    if (workbookIdSet.has(ruleId)) {
      setRuleOverrides((prev) => ({
        ...prev,
        [ruleId]: { ...(prev[ruleId] || {}), tool_behaviour: next },
      }))
    } else {
      setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, tool_behaviour: next } : r)))
    }
    setDirty(true)
  }

  function setAll(enabled: boolean, category?: CategoryKey) {
    if (!canEdit) return
    // Workbook rules get a batch override; profile rules get an in-place
    // ``enabled`` update. ``category`` undefined means "all categories".
    const touchesWorkbook = !category || category === 'hyphenation'
    const touchesProfile = !category || category !== 'hyphenation'
    if (touchesWorkbook && workbookRules.length) {
      setRuleOverrides((prev) => {
        const next = { ...prev }
        for (const r of workbookRules) {
          if (category && catOf(r) !== category) continue
          next[r.id] = { ...(next[r.id] || {}), enabled }
        }
        return next
      })
    }
    if (touchesProfile) {
      setRules((prev) => prev.map((r) => (category ? (catOf(r) === category ? { ...r, enabled } : r) : { ...r, enabled })))
    }
    setDirty(true)
  }
  function applyPreset(preset: 'strict' | 'standard' | 'minimal') {
    if (!canEdit) return
    setRules((prev) => prev.map((r) => {
      const sev = (r.severity || '').toLowerCase()
      let enable = true
      if (preset === 'minimal') enable = sev === 'error'
      else if (preset === 'standard') enable = sev === 'error' || sev === 'warning'
      else if (preset === 'strict') enable = true
      return { ...r, enabled: enable }
    }))
    setDirty(true)
    pushToast('info', `Applied preset: ${preset[0].toUpperCase()}${preset.slice(1)}`)
  }
  async function deleteCustomRule(ruleId: string) {
    if (!projectId || !canEdit) return
    const target = workbookRules.find((r) => r.id === ruleId)
    const label = target?.message || ruleId
    if (!window.confirm(`Delete custom rule "${label}"?\n\nThis is permanent — the rule will stop firing on future analyze passes.`)) {
      return
    }
    try {
      await rulesApi.deleteCustomRule(projectId, ruleId)
      setWorkbookRules((prev) => prev.filter((r) => r.id !== ruleId))
      // Also drop any override entry that referenced the deleted rule
      // so the sparse map stays clean.
      setRuleOverrides((prev) => {
        if (!(ruleId in prev)) return prev
        const next = { ...prev }
        delete next[ruleId]
        return next
      })
      setInitialOverrides((prev) => {
        if (!(ruleId in prev)) return prev
        const next = { ...prev }
        delete next[ruleId]
        return next
      })
      pushToast('success', `Deleted "${label}"`)
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || err?.message || 'Delete failed')
    }
  }

  function discardChanges() {
    setRules(initialRules.map((r) => ({ ...r })))
    setRuleOverrides(JSON.parse(JSON.stringify(initialOverrides)))
    setAudience(initialAudience)
    setMinUses(initialMinUses)
    setScopeReset(initialScopeReset)
    setMedicalStyleProfile(initialMedicalStyleProfile)
    setDirty(false)
  }

  function changeMedicalStyleProfile(next: MedicalStyleProfile) {
    if (!canEdit) return
    setMedicalStyleProfile(next); setDirty(true)
  }

  // Phase E settings handlers — all mark the page dirty so the floating
  // Save bar surfaces and the Save button writes them with the next POST.
  function changeAudience(next: Audience) {
    if (!canEdit) return
    setAudience(next); setDirty(true)
  }
  function changeMinUses(next: number) {
    if (!canEdit) return
    // Backend validator rejects < 1; clamp here for immediate feedback.
    const clamped = Math.max(1, Math.min(10, Math.floor(next || 1)))
    setMinUses(clamped); setDirty(true)
  }
  function toggleScopeReset() {
    if (!canEdit) return
    setScopeReset(prev => !prev); setDirty(true)
  }
  function toggleCollapse(cat: CategoryKey) {
    setCollapsed((prev) => {
      const n = new Set(prev)
      if (n.has(cat)) n.delete(cat); else n.add(cat)
      return n
    })
  }
  async function handleSave() {
    if (!projectId || !canEdit) return
    setSaving(true)
    try {
      // Scope C: profile rules ride in ``rules``; workbook rules ride in
      // the sparse ``rule_overrides`` map. Backend merges on the engine
      // side at analyze time.
      await rulesApi.save(projectId, {
        profile_keys: profileKeys,
        rules,
        rule_overrides: ruleOverrides,
        audience,
        min_uses: minUses,
        scope_reset: scopeReset,
        medical_style_profile: medicalStyleProfile,
      })
      setInitialRules(rules.map((r) => ({ ...r })))
      setInitialOverrides(JSON.parse(JSON.stringify(ruleOverrides)))
      setInitialAudience(audience)
      setInitialMinUses(minUses)
      setInitialScopeReset(scopeReset)
      setInitialMedicalStyleProfile(medicalStyleProfile)
      setDirty(false)
      pushToast('success', `Saved · ${counts.enabled}/${counts.total} rules enabled`)
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || err?.message || 'Save failed')
    } finally { setSaving(false) }
  }
  async function openHistory() {
    if (!projectId) return
    setHistoryOpen(true)
    if (history !== null) return
    try {
      const data = await rulesApi.history(projectId)
      setHistory(data.history)
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || err?.message || 'Failed to load history')
    }
  }
  async function openJsonView() {
    if (!projectId) return
    setJsonOpen(true); setJsonText(null)
    try {
      const text = await rulesApi.viewJson(projectId)
      setJsonText(text)
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || err?.message || 'Failed to load JSON')
    }
  }
  async function downloadJson() {
    if (!projectId) return
    try {
      await rulesApi.downloadJson(projectId, projectCode)
      pushToast('success', 'JSON downloaded')
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || err?.message || 'Download failed')
    }
  }
  async function downloadExcel() {
    if (!projectId) return
    try {
      await rulesApi.downloadExcel(projectId, projectCode)
      pushToast('success', 'Excel downloaded')
    } catch (err: any) {
      pushToast('error', err?.response?.data?.detail || err?.message || 'Download failed')
    }
  }
  function copyJson() {
    if (!jsonText) return
    navigator.clipboard?.writeText(jsonText)
    setCopied(true); setTimeout(() => setCopied(false), 1200)
  }

  if (loading) return <SkeletonPage />

  const activeMeta = activeCategory !== 'all' && activeCategory in CATEGORY_META
    ? CATEGORY_META[activeCategory as CategoryKey] : null
  const visibleCats = (Object.keys(CATEGORY_META) as CategoryKey[]).filter((c) => counts.byCat[c].total > 0)

  return (
    <div className="h-screen bg-slate-50 relative overflow-hidden flex flex-col">
      {/* Decorative background blob */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-br from-violet-200/40 via-indigo-200/30 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-20 -left-40 w-[500px] h-[500px] bg-gradient-to-br from-sky-200/30 via-blue-200/20 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* ═══ Hero header ═════════════════════════════════════════════════ */}
      <header className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white">
        <div className="absolute inset-0 opacity-20 pointer-events-none"
             style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        <div className="relative max-w-7xl mx-auto px-6 pt-6 pb-10">
          <div className="flex items-start gap-4">
            <button
              onClick={() => navigate(-1)}
              className="mt-1 w-10 h-10 rounded-xl bg-white/10 backdrop-blur hover:bg-white/20 flex items-center justify-center text-white transition-colors"
              title="Back"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-indigo-200/70 mb-2">
                <button onClick={() => navigate('/projects')} className="hover:text-white">Projects</button>
                <ChevronRight size={11} />
                <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-white font-medium">
                  {projectCode || `Project #${projectId}`}
                </button>
                <ChevronRight size={11} />
                <span className="text-white font-medium">Rules</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
                  <Sparkles size={22} />
                </div>
                <div>
                  <h1 className="text-2xl font-bold leading-tight">Language Editing Rules</h1>
                  <p className="text-sm text-indigo-200/80">
                    <span className="text-white font-medium">{projectCode || `project #${projectId}`}</span>
                    {' · '}
                    styles: {profileKeys.map((k) => (
                      <span key={k} className="inline-block ml-1 text-[11px] font-semibold uppercase bg-white/10 border border-white/20 rounded px-1.5 py-0.5">
                        {k.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </p>
                </div>
              </div>
            </div>

            {/* Big progress ring + save */}
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-3 bg-white/5 border border-white/10 backdrop-blur rounded-2xl px-4 py-3">
                <ProgressRing percent={counts.pct} size={56} stroke={5} track="rgba(255,255,255,0.14)" bar="url(#heroGrad)" />
                <svg width="0" height="0"><defs><linearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#a78bfa" /><stop offset="100%" stopColor="#60a5fa" /></linearGradient></defs></svg>
                <div className="text-xs">
                  <div className="font-semibold text-white text-sm">
                    {counts.enabled}<span className="text-indigo-200/60"> / {counts.total}</span>
                  </div>
                  <div className="text-indigo-200/70">rules enabled</div>
                </div>
              </div>
              <button
                onClick={handleSave}
                disabled={!canEdit || !dirty || saving}
                className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  !canEdit || !dirty
                    ? 'bg-white/10 text-indigo-300/50 cursor-not-allowed border border-white/5'
                    : 'bg-gradient-to-br from-violet-500 to-indigo-500 text-white hover:shadow-lg hover:shadow-violet-500/40 hover:-translate-y-0.5'
                }`}
                title={!canEdit ? 'Only Admin / Project Manager can save' : dirty ? '⌘S' : 'No unsaved changes'}
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                Save
                {dirty && !saving && canEdit && (
                  <span className="text-xs bg-white/20 rounded px-1.5 py-0.5">{diff.total}</span>
                )}
              </button>
            </div>
          </div>

          {/* Compact stat tiles */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <SummaryTile
              label="Total enabled" value={counts.enabled} total={counts.total} pct={counts.pct}
              icon={<BookOpenCheck size={14} />} grad="from-indigo-500 to-violet-500"
            />
            {(['error', 'warning', 'suggestion'] as const).map((sev) => {
              const style = SEVERITY_STYLE[sev]
              return (
                <SummaryTile
                  key={sev}
                  label={style.label}
                  value={counts.bySeverity[sev]}
                  icon={<style.Icon size={14} />}
                  grad={sev === 'error' ? 'from-rose-500 to-pink-500' : sev === 'warning' ? 'from-amber-500 to-orange-500' : 'from-sky-500 to-blue-500'}
                />
              )
            })}
            {visibleCats.slice(0, 2).map((cat) => {
              const meta = CATEGORY_META[cat]; const c = counts.byCat[cat]
              return (
                <SummaryTile
                  key={cat}
                  label={meta.label}
                  value={c.enabled} total={c.total}
                  pct={c.total ? Math.round((c.enabled / c.total) * 100) : 0}
                  icon={<meta.Icon size={14} />} grad={meta.grad}
                />
              )
            })}
          </div>
        </div>
      </header>

      {!canEdit && (
        <div className="bg-amber-50 border-y border-amber-200 px-6 py-2.5 flex items-center gap-2 text-sm text-amber-900">
          <Lock size={14} /> View-only mode — only <b>Admin</b> or <b>Project Manager</b> can save changes.
        </div>
      )}

      {/* ═══ Toolbar ═════════════════════════════════════════════════════ */}
      <div className="shrink-0 z-20 bg-white/80 backdrop-blur-xl border-b border-slate-200/80 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search rules…  (press / )"
              className="w-full border border-slate-200 rounded-xl pl-9 pr-10 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Preset menu */}
            <PresetMenu disabled={!canEdit} onPick={applyPreset} />
            <div className="h-6 w-px bg-slate-200" />
            <ToolbarButton onClick={openJsonView} icon={<Code2 size={13} />} label="View JSON" />
            <DownloadMenu onJson={downloadJson} onExcel={downloadExcel} />
            <ToolbarButton onClick={openHistory} icon={<HistoryIcon size={13} />} label="History" />
            <div className="h-6 w-px bg-slate-200" />
            <StylePickerMenu
              available={profileChoices}
              selected={profileKeys}
              onToggle={toggleStyle}
              disabled={!canEdit || profileChoices.length === 0}
            />
          </div>
        </div>

      </div>

      {/* ═══ Sidebar nav + focused content pane ════════════════════════
         Both columns scroll independently so the hero + toolbar stay put
         at the top and the long rules list doesn't push the Save bar off
         the bottom of the viewport. ``min-h-0`` lets flex children shrink
         below their content height so overflow-y-auto actually takes effect. */}
      <main className="flex-1 min-h-0 w-full max-w-7xl mx-auto px-6 py-6 flex gap-6 items-stretch overflow-hidden">

        {/* ─── LEFT: category nav + settings ───────────────────────── */}
        <aside className="w-60 shrink-0 self-stretch overflow-y-auto space-y-6 pr-1 pb-6">
          {/* Categories list */}
          <div>
            <h3 className="text-[10px] uppercase tracking-widest font-semibold text-slate-400 px-3 mb-2">
              Categories
            </h3>
            <nav className="space-y-0.5">
              <button
                onClick={() => setActiveCategory('all')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeCategory === 'all'
                    ? 'bg-violet-50 text-violet-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                  All rules
                </span>
                <span className="text-xs text-slate-400 font-medium tabular-nums">
                  {counts.enabled}/{counts.total}
                </span>
              </button>
              {visibleCats.map((cat) => {
                const meta = CATEGORY_META[cat]
                const c = counts.byCat[cat]
                const pct = c.total ? Math.round((c.enabled / c.total) * 100) : 0
                const isActive = activeCategory === cat
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-slate-100 text-slate-900 font-semibold'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                      <span className="truncate">{meta.label}</span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-slate-400 font-medium tabular-nums">
                        {c.enabled}/{c.total}
                      </span>
                      {pct > 0 && pct < 100 && (
                        <span className="text-[10px] text-slate-400 tabular-nums w-7 text-right">
                          {pct}%
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Abbreviations settings — only when the workbook is loaded */}
          {counts.byCat.abbreviations.total > 0 && (
            <div>
              <h3 className="text-[10px] uppercase tracking-widest font-semibold text-slate-400 px-3 mb-2">
                Abbreviations
              </h3>
              <div className="space-y-3 px-3">
                {/* Audience */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1" title="General expands common terms (BP → blood pressure); Professional leaves them untouched.">
                    Audience
                  </label>
                  <div className="inline-flex rounded-md border border-slate-200 overflow-hidden bg-white w-full">
                    {(['general', 'professional'] as Audience[]).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => changeAudience(opt)}
                        disabled={!canEdit}
                        className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                          audience === opt
                            ? 'bg-indigo-500 text-white'
                            : 'text-slate-600 hover:bg-slate-50'
                        } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {opt[0].toUpperCase() + opt.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Min uses */}
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-slate-500" title="Minimum occurrences before first-use rules fire.">
                    Min uses
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={minUses}
                    onChange={(e) => changeMinUses(Number(e.target.value))}
                    disabled={!canEdit}
                    className="w-14 border border-slate-200 rounded-md px-1.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 disabled:opacity-50 tabular-nums"
                  />
                </div>

                {/* Scope reset */}
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-slate-500 cursor-pointer" title="Reset first-use tracking at each chapter boundary." onClick={toggleScopeReset}>
                    Scope reset
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={scopeReset}
                    onClick={toggleScopeReset}
                    disabled={!canEdit}
                    className={`relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border transition-colors ${
                      scopeReset ? 'bg-indigo-500 border-indigo-500' : 'bg-slate-200 border-slate-300'
                    } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform mt-[1px] ${
                      scopeReset ? 'translate-x-[16px]' : 'translate-x-[2px]'
                    }`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Medical Terms settings — only when the workbook is loaded */}
          {counts.byCat.medical_terms.total > 0 && (
            <div>
              <h3 className="text-[10px] uppercase tracking-widest font-semibold text-slate-400 px-3 mb-2 mt-4">
                Medical Terms
              </h3>
              <div className="space-y-3 px-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1" title="Rules tagged 'All' always fire. The other profiles only fire when selected: US spelling patterns, Possessive / Nonpossessive eponyms.">
                    Style profile
                  </label>
                  <select
                    value={medicalStyleProfile}
                    onChange={(e) => changeMedicalStyleProfile(e.target.value as MedicalStyleProfile)}
                    disabled={!canEdit}
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-green-200 focus:border-green-300 disabled:opacity-50"
                  >
                    <option value="All">All (default — subprofiles silent)</option>
                    <option value="US spelling">US spelling (haem→hem, oedema→edema, …)</option>
                    <option value="UK spelling">UK spelling</option>
                    <option value="Possessive">Possessive eponyms (Alzheimer's)</option>
                    <option value="Nonpossessive">Nonpossessive eponyms (Alzheimer)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* ─── RIGHT: content pane ───────────────────────────────────
           Fixed-height container with internal scroll — the rules list
           grows up to 1047 rows (Medical Terms) and must not push the
           page past viewport height. Bottom padding leaves breathing
           room above the floating Save bar when it's visible. */}
        <section className="flex-1 min-w-0 self-stretch overflow-y-auto pr-1 pb-28">
          {activeCategory === 'all' ? (
            /* ─── Overview grid — compact category tiles, click to drill ─── */
            <>
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-900">All rules</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {counts.enabled} of {counts.total} enabled across {visibleCats.length} categories.
                  Pick a category on the left to configure its rules.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {visibleCats.map((cat) => {
                  const meta = CATEGORY_META[cat]
                  const c = counts.byCat[cat]
                  const pct = c.total ? Math.round((c.enabled / c.total) * 100) : 0
                  return (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className="group text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${meta.grad} text-white flex items-center justify-center shrink-0`}>
                          <meta.Icon size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold text-slate-900">{meta.label}</h3>
                            <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {c.enabled} of {c.total} enabled · {pct}%
                          </div>
                          <div className="mt-2 h-1 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full ${meta.dot} rounded-full`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            /* ─── Focused category view — big header + dense rules list ─── */
            (() => {
              const cat = activeCategory as CategoryKey
              const meta = CATEGORY_META[cat]
              const list = grouped[cat]
              const total = counts.byCat[cat].total
              const enabled = counts.byCat[cat].enabled
              const pct = total ? Math.round((enabled / total) * 100) : 0
              const fullyOn = enabled === total
              const fullyOff = enabled === 0
              return (
                <>
                  {/* Category header */}
                  <div className="flex items-center gap-4 mb-5">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${meta.grad} text-white flex items-center justify-center shrink-0 shadow-sm`}>
                      <meta.Icon size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-semibold text-slate-900">{meta.label}</h2>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-sm text-slate-500">
                          {enabled} of {total} enabled · {pct}%
                        </span>
                        <div className="w-32 h-1 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full ${meta.dot} rounded-full transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setAll(true, cat)}
                        disabled={!canEdit || fullyOn}
                        className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:text-slate-400 disabled:bg-slate-50 disabled:border-slate-200 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Enable all
                      </button>
                      <button
                        onClick={() => setAll(false, cat)}
                        disabled={!canEdit || fullyOff}
                        className="text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Disable all
                      </button>
                    </div>
                  </div>

                  {/* Rules list */}
                  {list.length > 0 ? (
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                      <ul className="divide-y divide-slate-100">
                        {list.map((rule) => (
                          <RuleDetails
                            key={rule.id}
                            rule={rule}
                            canEdit={canEdit}
                            onToggle={() => toggleRule(rule.id)}
                            onBehaviourChange={(next) => changeBehaviour(rule.id, next)}
                            onDelete={catOf(rule) === 'custom' ? () => deleteCustomRule(rule.id) : undefined}
                          />
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <EmptyState
                      icon={<Search size={28} />}
                      title={search
                        ? `No rules match "${search}" in ${meta.label}`
                        : `No rules in ${meta.label}`}
                      action={search ? (
                        <button onClick={() => setSearch('')} className="mt-3 text-sm text-violet-700 hover:underline">
                          Clear search
                        </button>
                      ) : undefined}
                    />
                  )}
                </>
              )
            })()
          )}

          {counts.total === 0 && activeCategory === 'all' && (
            <div className="mt-5">
              <EmptyState
                icon={<Hash size={28} />}
                title="No rules in this profile"
                hint="Pick another profile from the dropdown in the toolbar."
              />
            </div>
          )}
        </section>
      </main>

      {/* ═══ Floating save bar (sticky bottom when dirty) ═══════════════ */}
      {dirty && canEdit && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 animate-in fade-in slide-in-from-bottom-4">
          <div className="bg-slate-900 text-white rounded-2xl shadow-2xl shadow-slate-900/30 flex items-center gap-4 pl-5 pr-2 py-2">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="font-medium">{diff.total} unsaved change{diff.total === 1 ? '' : 's'}</span>
              <span className="text-slate-400 text-xs">
                {diff.added > 0 && <span className="text-emerald-400">+{diff.added}</span>}
                {diff.added > 0 && diff.removed > 0 && ' · '}
                {diff.removed > 0 && <span className="text-rose-400">−{diff.removed}</span>}
              </span>
            </div>
            <button
              onClick={discardChanges}
              className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 text-white text-sm font-semibold hover:shadow-lg hover:shadow-violet-500/40"
            >
              {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              Save changes
            </button>
          </div>
        </div>
      )}

      {/* ═══ Keyboard hints ═════════════════════════════════════════════ */}
      <div className="fixed bottom-4 right-4 z-10 hidden lg:flex items-center gap-2 text-[11px] text-slate-500 bg-white/80 backdrop-blur border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm">
        <Keyboard size={12} />
        <span><kbd className="font-mono text-[10px] bg-slate-100 px-1 rounded">/</kbd> search</span>
        <span className="text-slate-300">·</span>
        <span><kbd className="font-mono text-[10px] bg-slate-100 px-1 rounded">⌘S</kbd> save</span>
      </div>

      {/* ═══ Toasts ═════════════════════════════════════════════════════ */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-in slide-in-from-right fade-in ${
              t.kind === 'success' ? 'bg-emerald-600 text-white' :
              t.kind === 'error'   ? 'bg-rose-600 text-white' :
                                     'bg-slate-900 text-white'
            }`}
          >
            {t.kind === 'success' && <Check size={14} />}
            {t.kind === 'error' && <AlertCircle size={14} />}
            {t.kind === 'info' && <Zap size={14} />}
            {t.text}
          </div>
        ))}
      </div>

      {/* ═══ JSON view modal ═════════════════════════════════════════════ */}
      {jsonOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setJsonOpen(false)}>
          <div
            className="w-full max-w-3xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-5 py-3.5 border-b flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 text-white flex items-center justify-center">
                  <Code2 size={15} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Rules configuration JSON</h3>
                  <p className="text-xs text-slate-500">{projectCode || `Project ${projectId}`} · source of truth</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={copyJson} disabled={!jsonText}
                  className="text-xs px-2.5 py-1.5 rounded-md border bg-white hover:bg-slate-50 inline-flex items-center gap-1 disabled:opacity-50">
                  {copied ? <><Check size={12} className="text-emerald-600" /> Copied</> : <><CopyIcon size={12} /> Copy</>}
                </button>
                <button onClick={downloadJson}
                  className="text-xs px-2.5 py-1.5 rounded-md border bg-white hover:bg-slate-50 inline-flex items-center gap-1">
                  <Download size={12} /> JSON
                </button>
                <button onClick={downloadExcel}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center gap-1">
                  <FileSpreadsheet size={12} /> Excel
                </button>
                <button onClick={() => setJsonOpen(false)}
                  className="w-7 h-7 rounded-md hover:bg-slate-100 text-slate-500 inline-flex items-center justify-center">
                  <X size={14} />
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-auto bg-slate-950 text-slate-100 font-mono text-xs leading-6 p-4">
              {jsonText === null ? (
                <div className="text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading JSON…</div>
              ) : (
                <pre className="whitespace-pre-wrap break-words">{jsonText}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ History drawer ══════════════════════════════════════════════ */}
      {historyOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex justify-end" onClick={() => setHistoryOpen(false)}>
          <aside className="w-[480px] max-w-full h-full bg-white shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-right"
                 onClick={(e) => e.stopPropagation()}>
            <header className="px-5 py-3.5 border-b flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 text-white flex items-center justify-center">
                  <HistoryIcon size={15} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Rule selection history</h3>
                  <p className="text-xs text-slate-500">Audit log · newest first</p>
                </div>
              </div>
              <button onClick={() => setHistoryOpen(false)}
                className="w-7 h-7 rounded-md hover:bg-slate-100 text-slate-500 inline-flex items-center justify-center">
                <X size={14} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 text-sm space-y-2.5">
              {history === null && <div className="text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
              {history !== null && history.length === 0 && (
                <EmptyState icon={<HistoryIcon size={24} />} title="No changes recorded yet" />
              )}
              {history?.map((h) => (
                <div key={h.id} className="border border-slate-200 rounded-xl p-3.5 hover:shadow-md hover:border-violet-200 transition-all">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-white text-xs font-bold flex items-center justify-center shadow-sm">
                        {((h.changed_by_username ? useUsersStore.getState().getUserDisplayNameByUsername(h.changed_by_username) : null) || h.changed_by_username || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="font-medium text-sm">
                        {(h.changed_by_username ? useUsersStore.getState().getUserDisplayNameByUsername(h.changed_by_username) : null) || h.changed_by_username || 'System'}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {formatDateTime(h.changed_at)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-slate-700">{(h.profile_key ?? '-').toUpperCase()}</span>
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium"><Check size={10} /> {h.enabled_count}</span>
                    <span className="text-slate-300">·</span>
                    <span className="inline-flex items-center gap-1 text-slate-500"><X size={10} /> {h.disabled_count}</span>
                  </div>
                  {h.note && <div className="text-xs text-slate-500 mt-2 italic bg-slate-50 px-2.5 py-1.5 rounded-lg">"{h.note}"</div>}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

// ─── Small building blocks ─────────────────────────────────────────────────

function SkeletonPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 h-48" />
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-3">
        <div className="h-10 bg-slate-200 rounded-xl animate-pulse" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 bg-slate-200/80 rounded-2xl animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function ProgressRing({ percent, size, stroke, track, bar, className = '' }: {
  percent: number; size: number; stroke: number; track: string; bar: string; className?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (percent / 100) * c
  return (
    <svg width={size} height={size} className={className}>
      <circle cx={size/2} cy={size/2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <circle
        cx={size/2} cy={size/2} r={r} stroke={bar} strokeWidth={stroke} fill="none"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dashoffset 0.4s ease' }}
      />
      <text x={size/2} y={size/2 + 3} textAnchor="middle" fontSize={size/3.5} fontWeight="600" fill="currentColor" className="opacity-80">
        {percent}
      </text>
    </svg>
  )
}

function SummaryTile({ label, value, total, pct, icon, grad }: {
  label: string; value: number; total?: number; pct?: number; icon: React.ReactNode; grad: string
}) {
  return (
    <div className="bg-white/10 backdrop-blur border border-white/10 rounded-xl p-3 hover:bg-white/15 transition-colors">
      <div className="flex items-center justify-between">
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${grad} text-white flex items-center justify-center`}>
          {icon}
        </div>
        {pct !== undefined && (
          <span className="text-[10px] font-semibold text-indigo-200/70 tabular-nums">{pct}%</span>
        )}
      </div>
      <div className="mt-2">
        <div className="text-xl font-bold text-white tabular-nums leading-none">
          {value}{total !== undefined && <span className="text-sm text-indigo-200/60 font-normal"> / {total}</span>}
        </div>
        <div className="text-[11px] text-indigo-200/70 mt-0.5">{label}</div>
      </div>
    </div>
  )
}

function StylePickerMenu({
  available, selected, onToggle, disabled,
}: {
  available: string[]; selected: string[]; onToggle: (k: string) => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const PROFILE_META: Record<string, { label: string; description: string }> = {
    uk:                      { label: 'UK',       description: 'British English' },
    us:                      { label: 'US',       description: 'US English' },
    ama:                     { label: 'AMA',      description: 'American Medical Association' },
    apa:                     { label: 'APA',      description: 'American Psychological Association' },
    chicago:                 { label: 'Chicago',  description: 'Chicago Manual of Style' },
    canadian:                { label: 'Canadian', description: 'Canadian English' },
    medical_pharmaceutical:  { label: 'Medical',  description: 'Medical / Pharmaceutical' },
  }
  const summary = selected.length === 1
    ? (PROFILE_META[selected[0]]?.label || selected[0].toUpperCase())
    : `${selected.length} styles`

  return (
    <div className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs text-slate-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        title="Pick one or more style standards. Rules Picker shows the union."
      >
        <Hash size={13} className="text-violet-500" /> Styles: <span className="font-semibold">{summary}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-2 min-w-[260px] z-20 animate-in fade-in zoom-in-95">
          <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400 font-semibold border-b">
            Style standards
          </div>
          {available.map((key) => {
            const meta = PROFILE_META[key] || { label: key.toUpperCase(), description: '' }
            const on = selected.includes(key)
            return (
              <button
                key={key}
                onMouseDown={(e) => { e.preventDefault(); onToggle(key) }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2.5"
              >
                <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                  on ? 'bg-violet-600 border-violet-600' : 'bg-white border-slate-300'
                }`}>
                  {on && <Check size={10} className="text-white" strokeWidth={3} />}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-800">{meta.label}</div>
                  <div className="text-[11px] text-slate-500">{meta.description}</div>
                </div>
              </button>
            )
          })}
          <div className="border-t px-3 pt-2 pb-1 text-[11px] text-slate-500">
            {selected.length} selected · rules shown = union of all
          </div>
        </div>
      )}
    </div>
  )
}

function DownloadMenu({ onJson, onExcel }: { onJson: () => void; onExcel: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs text-slate-700 transition-colors"
      >
        <Download size={13} /> Download <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 min-w-[180px] z-20 animate-in fade-in zoom-in-95">
          <button
            onMouseDown={(e) => { e.preventDefault(); onJson(); setOpen(false) }}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2.5"
          >
            <Code2 size={14} className="text-slate-500 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-slate-800">JSON (.json)</div>
              <div className="text-[11px] text-slate-500">Raw config, same as CE Support file</div>
            </div>
          </button>
          <button
            onMouseDown={(e) => { e.preventDefault(); onExcel(); setOpen(false) }}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2.5"
          >
            <FileSpreadsheet size={14} className="text-emerald-600 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-slate-800">Excel (.xlsx)</div>
              <div className="text-[11px] text-slate-500">Review-friendly spreadsheet</div>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

function ToolbarButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs text-slate-700 transition-colors">
      {icon} {label}
    </button>
  )
}

function FilterPill({ active, onClick, label, icon,
  activeCls = 'bg-slate-900 text-white border-slate-900',
  inactiveCls = 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
}: {
  active: boolean; onClick: () => void; label: string; icon?: React.ReactNode; activeCls?: string; inactiveCls?: string
}) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border inline-flex items-center gap-1.5 transition-all ${active ? activeCls + ' shadow-sm' : inactiveCls}`}>
      {icon}
      {label}
    </button>
  )
}

function PresetMenu({ disabled, onPick }: { disabled: boolean; onPick: (p: 'strict' | 'standard' | 'minimal') => void }) {
  const [open, setOpen] = useState(false)
  const PRESETS = [
    { key: 'strict' as const,   icon: ShieldCheck,  label: 'Strict',   hint: 'Enable every rule' },
    { key: 'standard' as const, icon: BookOpenCheck, label: 'Standard', hint: 'Errors + Warnings' },
    { key: 'minimal' as const,  icon: Minimize2,    label: 'Minimal',  hint: 'Errors only' },
  ]
  return (
    <div className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Zap size={13} className="text-amber-500" /> Presets <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 min-w-[200px] z-20 animate-in fade-in zoom-in-95">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onMouseDown={(e) => { e.preventDefault(); onPick(p.key); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2.5"
            >
              <p.icon size={14} className="text-slate-500 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-slate-800">{p.label}</div>
                <div className="text-[11px] text-slate-500">{p.hint}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ text, cls }: { text: string; cls: string }) {
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide ${cls}`}>{text}</span>
}

function EmptyState({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl">
      <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">{icon}</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
      {action}
    </div>
  )
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange() }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${
        checked ? 'bg-gradient-to-r from-violet-500 to-indigo-500' : 'bg-slate-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export default ProjectRulesPage
