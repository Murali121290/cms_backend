import apiClient from './client'

export type RuleCategory = 'grammar' | 'spelling' | 'sentence' | 'compounds' | 'inclusive' | 'hyphenation' | 'abbreviations' | 'medical_terms' | string
export type RuleSeverity = 'error' | 'warning' | 'suggestion' | string
// Scope C: canonical per-rule action preference. ``flag`` = produce a
// reviewable finding; ``auto_replace`` = produce a reviewable finding
// pre-filled for one-click acceptance. NEITHER value permits silent text
// mutation — replacement always requires explicit user acceptance in
// the Language Editor.
export type ToolBehaviour = 'flag' | 'auto_replace'

export interface LanguageRule {
  id: string
  category: RuleCategory
  type?: string                            // regex | dictionary | function | builtin | phrase_lookup
  enabled?: boolean
  tool_behaviour?: ToolBehaviour
  severity?: RuleSeverity
  message?: string
  // regex rules
  pattern?: string
  replacement?: string
  flags?: string[]
  // function rules
  function?: string
  params?: Record<string, unknown>
  // phrase_lookup rules (hyphenation workbook)
  source?: string
  suggestions?: string[]
  alt_suggestions?: string[]
  // display-only workbook metadata (optional on any rule)
  group?: string
  problem_type?: string
  style_profile?: string
  context_note?: string
  example_wrong?: string
  example_right?: string
  match_type?: string
  match_case?: boolean
  require_following_word?: boolean
  confidence?: string
  notes?: string
  note?: string
  origin?: string
  // Source attribution badge for workbook rules (Scope-C provenance).
  // Compact label — "ISMP", "Joint Commission", "LWW list", "Workbook".
  source_badge?: string
  source_raw?: string
  // Abbreviation-specific metadata (surfaced by workbook_rules_surface
  // for the Rules Picker; RuleDetails ignores keys it doesn't render).
  abbreviation?: string
  expansion?: string
  plural_abbreviation?: string | null
  plural_expansion_override?: string | null
  subject_area?: string
  abbr_type?: string
  article?: string
  first_use_rule?: string
  ambiguity?: string
  do_not_abbreviate?: boolean
  applies_in?: string
  common_mistake?: string
  // provenance
  source_of?: 'profile' | 'workbook'
  // override provenance (set by backend when a project override is applied)
  is_overridden?: boolean
  override?: { enabled?: boolean; tool_behaviour?: ToolBehaviour }
  // LWW-NE workbook per-row applicability metadata. Surfaced by
  // workbook_rules_surface.list_lww_ne_rules() for the Rules Picker so
  // the ProfileApplicability chip grid can be computed purely client-
  // side without re-asking the backend. ``rule_runs_raw`` is the parsed
  // list of base tag strings ({APA, AMA, NE, Generic, Eponym}) stripped
  // of parenthetical annotations. ``rule_runs_display`` is the comma-
  // joined form for tooltips. ``is_generic`` short-circuits the
  // applicability filter — Generic rows fire in every project.
  rule_runs_raw?: string[]
  rule_runs_display?: string
  is_generic?: boolean
  // Basic Grammar workbook metadata (surfaced by workbook_rules_surface
  // .list_basic_grammar_rules). ``subcategory`` is the human-readable
  // source-sheet label used for the sub-section grouping on the Rules
  // Picker and for the finding-card header in the Language Editor.
  // ``runtime_status`` / ``runtime_status_reason`` / ``reused_by`` let
  // the Rules Picker show which workbook rules are actually executable
  // vs reused by an existing engine detector vs disabled for missing
  // capability. All fields are optional; non-basic_grammar rules omit
  // them entirely.
  subcategory?: string
  rule_name?: string
  rule_description?: string
  explanation?: string
  incorrect_example?: string
  corrected_example?: string
  detection_method?: string
  detection_pattern?: string
  trigger_condition?: string
  exception_conditions?: string
  suggested_correction?: string
  confidence_level?: string
  style_dependency?: string
  validation_status?: string
  recommended_action?: string
  false_positive_risks?: string
  implementation_status?: string
  detector_id?: string
  worksheet?: string
  runtime_status?: 'enabled' | 'reused' | 'disabled' | 'manual_review'
  runtime_status_reason?: string
  reused_by?: string | null
  // Pass-through for any extra engine fields we don't care about in the UI.
  [k: string]: unknown
}

// Per-rule override map: {rule_id: {enabled?, tool_behaviour?}}. Sparse —
// only entries that diverge from the rule's file default are stored.
export type RuleOverrides = Record<string, { enabled?: boolean; tool_behaviour?: ToolBehaviour }>

// Abbreviations workbook settings (Phase B + C). Persisted in the project
// sidecar JSON; no DB column (per the backward-compatibility contract).
// ``audience`` filters rules marked ``expand_for_general_only``.
// ``min_uses`` is the threshold below which the first-use rules stay silent.
// ``scope_reset`` splits document state at chapter boundaries so first-use
// re-fires per chapter.
export type Audience = 'general' | 'professional'

// Medical Terminology workbook (M-D). ``All`` always fires; the other three
// subprofiles only fire when the project opts in via the Rules Picker.
export type MedicalStyleProfile = 'All' | 'US spelling' | 'UK spelling' | 'Possessive' | 'Nonpossessive'

// UK/US Spelling workbook (S-C). Default derives from the project's
// profile_keys[0] — uk → en-GB, us/ama → en-US. Users explicitly pick
// en-GB-oxendict for UK projects following Oxford (-ize) spelling.
export type DocumentVariant = 'en-US' | 'en-GB' | 'en-GB-oxendict'

export interface ActiveRulesConfig {
  project_id?: number
  project_code?: string
  profile_key?: string
  profile_keys?: string[]
  dash_profile?: string
  name?: string
  description?: string
  rules: LanguageRule[]
  variant_to_canonical?: Record<string, string>
  rule_overrides?: RuleOverrides
  audience?: Audience
  min_uses?: number
  scope_reset?: boolean
  medical_style_profile?: MedicalStyleProfile
  document_variant?: DocumentVariant
}

export interface AvailableProfiles {
  [profileKey: string]: {
    name?: string
    description?: string
    rules?: LanguageRule[]
    variant_to_canonical?: Record<string, string>
    [k: string]: unknown
  }
}

export interface WorkbookRuleSummary {
  total: number
  enabled: number
  flag: number
  auto_replace: number
}

export interface RulesPayload {
  active_rules: ActiveRulesConfig
  available_profiles: AvailableProfiles
  // Scope C: 875 workbook rules normalised + overrides-merged by the backend.
  // Keyed by workbook family ('hyphenation'); future workbooks drop in here.
  workbook_rules?: Record<string, LanguageRule[]>
  workbook_summary?: Record<string, WorkbookRuleSummary>
}

export interface SaveRulesBody {
  profile_key?: string
  profile_keys?: string[]
  rules?: LanguageRule[]
  variant_to_canonical?: Record<string, string>
  profile_name?: string
  note?: string
  dash_profile?: string
  rule_overrides?: RuleOverrides
  audience?: Audience
  min_uses?: number
  scope_reset?: boolean
  medical_style_profile?: MedicalStyleProfile
  document_variant?: DocumentVariant
}

export interface RuleHistoryEntry {
  id: number
  changed_at: string | null
  changed_by_id: number | null
  changed_by_username: string | null
  profile_key: string | null
  enabled_rule_ids: string[]
  disabled_rule_ids: string[]
  enabled_count: number
  disabled_count: number
  note: string | null
}

export const rulesApi = {
  get: (projectId: number | string) =>
    apiClient.get<RulesPayload>(`/projects/${projectId}/language-rules`).then((r) => r.data),

  save: (projectId: number | string, body: SaveRulesBody) =>
    apiClient
      .post<{ ok: boolean; rules: ActiveRulesConfig }>(
        `/projects/${projectId}/language-rules`,
        body,
      )
      .then((r) => r.data),

  history: (projectId: number | string, limit = 50) =>
    apiClient
      .get<{ project_id: number; history: RuleHistoryEntry[] }>(
        `/projects/${projectId}/language-rules/history`,
        { params: { limit } },
      )
      .then((r) => r.data),

  /** Fetch the raw stored config as a formatted JSON string (for the View JSON modal). */
  viewJson: (projectId: number | string) =>
    apiClient
      .get<string>(`/projects/${projectId}/language-rules/export`, {
        responseType: 'text',
        transformResponse: (data) => data,
      })
      .then((r) => r.data as unknown as string),

  /** Trigger a browser download of the project's rules JSON. */
  downloadJson: (projectId: number | string, projectCode?: string) =>
    apiClient
      .get<Blob>(`/projects/${projectId}/language-rules/export`, {
        params: { download: true },
        responseType: 'blob',
      })
      .then((r) => {
        const blob = new Blob([r.data], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectCode || `project-${projectId}`}_language_rules.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }),

  /** Scope D: delete a user-authored custom regex rule. */
  deleteCustomRule: (projectId: number | string, ruleId: string) =>
    apiClient
      .delete<{ ok: boolean; removed: string }>(
        `/projects/${projectId}/language-rules/custom/${encodeURIComponent(ruleId)}`,
      )
      .then((r) => r.data),

  /** Download the project's rules as an Excel workbook (.xlsx). */
  downloadExcel: (projectId: number | string, projectCode?: string) =>
    apiClient
      .get<Blob>(`/projects/${projectId}/language-rules/export.xlsx`, {
        responseType: 'blob',
      })
      .then((r) => {
        const blob = new Blob([r.data], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectCode || `project-${projectId}`}_language_rules.xlsx`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }),
}
