import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Mail,
  Search,
  Globe,
  Building2,
  Sparkles,
  Save,
  RotateCcw,
  Send,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Info,
  X,
  Eye,
  ChevronRight,
  HelpCircle,
  Bell,
  BellOff,
  Pencil,
  SlidersHorizontal,
  Sliders,
  Check,
  ExternalLink,
  Database
} from 'lucide-react'
import {
  transitionNotificationsApi,
  type CustomerSummary,
  type CustomerConfigResponse,
  type StageEmailConfig,
  type TemplateVariable,
  type StageInfo
} from '@/api/transitionNotifications'
import { toast } from '@/store/useToastStore'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Dropdown } from '@/components/ui/Dropdown'

export function StageTransitionNotifications() {
  const navigate = useNavigate()

  // ── Global State ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [variables, setVariables] = useState<TemplateVariable[]>([])

  // Selected customer
  const [selectedClientCode, setSelectedClientCode] = useState<string>('default')
  const [clientConfig, setClientConfig] = useState<CustomerConfigResponse | null>(null)
  const [configLoading, setConfigLoading] = useState(false)

  // Working copy of stages configuration
  const [workingStages, setWorkingStages] = useState<Record<string, StageEmailConfig>>({})
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Table filtering & search
  const [stageSearchQuery, setStageSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all')

  // Searchable Customer Dropdown options (Default template first, then customers alphabetically)
  const customerDropdownOptions = useMemo(() => {
    const list = [
      {
        value: 'default',
        label: 'Default Template (Global Fallback)',
      },
    ]

    const sorted = [...customers]
      .filter(c => c.client_code !== 'default')
      .sort((a, b) => a.client_name.localeCompare(b.client_name))

    for (const c of sorted) {
      list.push({
        value: c.client_code,
        label: `${c.client_name} (${c.client_code})`,
      })
    }

    return list
  }, [customers])

  // Slide-Out Drawer State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [selectedStage, setSelectedStage] = useState<string>('')
  const [drawerTab, setDrawerTab] = useState<'editor' | 'preview'>('editor')

  // Add Stage Modal state
  const [isAddStageModalOpen, setIsAddStageModalOpen] = useState(false)
  const [newStageNameInput, setNewStageNameInput] = useState('')
  const [selectedSystemStageToAdd, setSelectedSystemStageToAdd] = useState('')
  const [alsoAddToSystemMaster, setAlsoAddToSystemMaster] = useState(false)
  const [addingStage, setAddingStage] = useState(false)

  // Delete / Disable Stage state
  const [isDeleteStageModalOpen, setIsDeleteStageModalOpen] = useState(false)
  const [stageToDelete, setStageToDelete] = useState<string>('')

  // Revert confirmation state
  const [isRevertConfirmOpen, setIsRevertConfirmOpen] = useState(false)
  const [reverting, setReverting] = useState(false)

  // Sync All JSON to DB state
  const [syncingAll, setSyncingAll] = useState(false)

  // Test Email state
  const [isTestEmailOpen, setIsTestEmailOpen] = useState(false)
  const [testEmailAddress, setTestEmailAddress] = useState('')
  const [sendingTestEmail, setSendingTestEmail] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // Tag inputs inside drawer
  const [newToEmail, setNewToEmail] = useState('')
  const [newCcEmail, setNewCcEmail] = useState('')

  // Input refs for cursor insertion
  const subjectInputRef = useRef<HTMLInputElement>(null)
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [lastFocusedInput, setLastFocusedInput] = useState<'subject' | 'body'>('body')

  // ── Initial Data Load ────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadInitial() {
      setLoading(true)
      try {
        const [custList, vars] = await Promise.all([
          transitionNotificationsApi.listCustomers(),
          transitionNotificationsApi.getVariables(),
        ])
        setCustomers(custList)
        setVariables(vars)
        if (custList.length > 0) {
          setSelectedClientCode('default')
        }
      } catch (err: any) {
        toast.error('Failed to load transition notification settings.')
      } finally {
        setLoading(false)
      }
    }
    loadInitial()
  }, [])

  // ── Load Client Config on selection ──────────────────────────────────────────
  useEffect(() => {
    if (!selectedClientCode) return
    let active = true

    async function loadConfig() {
      setConfigLoading(true)
      try {
        const res = await transitionNotificationsApi.getCustomerConfig(selectedClientCode)
        if (!active) return
        setClientConfig(res)
        setWorkingStages(JSON.parse(JSON.stringify(res.stages || {})))

        const stageKeys = Object.keys(res.stages || {})
        if (stageKeys.length > 0) {
          setSelectedStage(stageKeys[0])
        } else if (res.all_system_stages.length > 0) {
          setSelectedStage(res.all_system_stages[0].stage_name)
        } else {
          setSelectedStage('')
        }
        setHasUnsavedChanges(false)
      } catch (err: any) {
        toast.error(`Failed to load config for ${selectedClientCode}`)
      } finally {
        if (active) setConfigLoading(false)
      }
    }

    loadConfig()
    return () => {
      active = false
    }
  }, [selectedClientCode])

  // Current stage config for drawer
  const currentStageConfig: StageEmailConfig = useMemo(() => {
    if (!selectedStage || !workingStages[selectedStage]) {
      return {
        enabled: true,
        custom_message: '',
        to: [],
        cc: [],
        subject: '',
        body: '',
      }
    }
    return workingStages[selectedStage]
  }, [selectedStage, workingStages])

  // System stages not yet added
  const unconfiguredStages = useMemo(() => {
    if (!clientConfig) return []
    const existing = new Set(Object.keys(workingStages))
    return clientConfig.all_system_stages.filter(s => !existing.has(s.stage_name))
  }, [clientConfig, workingStages])

  // Description map for system stages
  const stageDescriptions = useMemo(() => {
    const map: Record<string, string> = {}
    if (clientConfig?.all_system_stages) {
      for (const s of clientConfig.all_system_stages) {
        if (s.description) map[s.stage_name] = s.description
      }
    }
    return map
  }, [clientConfig])

  // Filtered stages for the table
  const filteredStageList = useMemo(() => {
    return Object.keys(workingStages).filter(stName => {
      const cfg = workingStages[stName]
      const isEnabled = cfg?.enabled !== false

      // Status filter
      if (statusFilter === 'active' && !isEnabled) return false
      if (statusFilter === 'disabled' && isEnabled) return false

      // Search query filter
      if (stageSearchQuery.trim()) {
        const q = stageSearchQuery.toLowerCase()
        const matchesName = stName.toLowerCase().includes(q)
        const matchesSubject = (cfg?.subject || '').toLowerCase().includes(q)
        const matchesTo = (cfg?.to || []).some(t => t.toLowerCase().includes(q))
        const matchesDesc = (stageDescriptions[stName] || '').toLowerCase().includes(q)
        return matchesName || matchesSubject || matchesTo || matchesDesc
      }

      return true
    })
  }, [workingStages, statusFilter, stageSearchQuery, stageDescriptions])

  // Stage statistics
  const stageStats = useMemo(() => {
    const all = Object.keys(workingStages)
    const active = all.filter(k => workingStages[k]?.enabled !== false).length
    const disabled = all.length - active
    return { total: all.length, active, disabled }
  }, [workingStages])

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const updateCurrentStage = (field: keyof StageEmailConfig, value: any) => {
    if (!selectedStage) return
    setWorkingStages(prev => ({
      ...prev,
      [selectedStage]: {
        ...(prev[selectedStage] || {
          enabled: true,
          custom_message: '',
          to: [],
          cc: [],
          subject: '',
          body: '',
        }),
        [field]: value,
      },
    }))
    setHasUnsavedChanges(true)
  }

  // Instant toggle from table row
  const handleToggleStageEnabled = (stageName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setWorkingStages(prev => {
      const cur = prev[stageName]
      if (!cur) return prev
      const newEnabled = cur.enabled === false ? true : false
      return {
        ...prev,
        [stageName]: {
          ...cur,
          enabled: newEnabled,
        },
      }
    })
    setHasUnsavedChanges(true)
  }

  // Open drawer for a specific stage
  const handleOpenDrawer = (stageName: string) => {
    setSelectedStage(stageName)
    setDrawerTab('editor')
    setIsDrawerOpen(true)
  }

  // Tag recipient management
  const handleAddToEmail = (emailOrToken: string) => {
    const trimmed = emailOrToken.trim()
    if (!trimmed) return
    const current = currentStageConfig.to || []
    if (!current.includes(trimmed)) {
      updateCurrentStage('to', [...current, trimmed])
    }
    setNewToEmail('')
  }

  const handleRemoveToEmail = (index: number) => {
    const current = [...(currentStageConfig.to || [])]
    current.splice(index, 1)
    updateCurrentStage('to', current)
  }

  const handleAddCcEmail = (emailOrToken: string) => {
    const trimmed = emailOrToken.trim()
    if (!trimmed) return
    const current = currentStageConfig.cc || []
    if (!current.includes(trimmed)) {
      updateCurrentStage('cc', [...current, trimmed])
    }
    setNewCcEmail('')
  }

  const handleRemoveCcEmail = (index: number) => {
    const current = [...(currentStageConfig.cc || [])]
    current.splice(index, 1)
    updateCurrentStage('cc', current)
  }

  // Insert placeholder variable at cursor position
  const insertPlaceholder = (key: string) => {
    if (lastFocusedInput === 'subject' && subjectInputRef.current) {
      const el = subjectInputRef.current
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const val = el.value
      const newVal = val.substring(0, start) + key + val.substring(end)
      updateCurrentStage('subject', newVal)
      setTimeout(() => {
        el.focus()
        el.setSelectionRange(start + key.length, start + key.length)
      }, 0)
    } else if (bodyTextareaRef.current) {
      const el = bodyTextareaRef.current
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const val = el.value
      const newVal = val.substring(0, start) + key + val.substring(end)
      updateCurrentStage('body', newVal)
      setTimeout(() => {
        el.focus()
        el.setSelectionRange(start + key.length, start + key.length)
      }, 0)
    }
  }

  // Save all settings
  const handleSave = async () => {
    if (!selectedClientCode) return
    setSaving(true)
    try {
      const res = await transitionNotificationsApi.saveCustomerConfig(
        selectedClientCode,
        workingStages
      )
      toast.success(res.message || 'Settings saved successfully.')
      setHasUnsavedChanges(false)

      const [updatedConfig, updatedCustList] = await Promise.all([
        transitionNotificationsApi.getCustomerConfig(selectedClientCode),
        transitionNotificationsApi.listCustomers(),
      ])
      setClientConfig(updatedConfig)
      setCustomers(updatedCustList)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to save configuration.')
    } finally {
      setSaving(false)
    }
  }

  // ── Sync All JSON files to PostgreSQL Database ─────────────────────────────
  const handleSyncAllToDb = async () => {
    setSyncingAll(true)
    try {
      const res = await transitionNotificationsApi.syncAllToDb()
      toast.success(res.message || 'All JSON templates successfully saved to PostgreSQL database!')
      const [updatedConfig, updatedCustList] = await Promise.all([
        transitionNotificationsApi.getCustomerConfig(selectedClientCode),
        transitionNotificationsApi.listCustomers(),
      ])
      setClientConfig(updatedConfig)
      setCustomers(updatedCustList)
      setHasUnsavedChanges(false)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to sync configurations to database.')
    } finally {
      setSyncingAll(false)
    }
  }

  // Create custom override from default
  const handleCreateCustomOverride = async () => {
    if (selectedClientCode === 'default') return
    setSaving(true)
    try {
      await transitionNotificationsApi.initializeCustomerConfig(selectedClientCode)
      toast.success(`Custom template initialized for ${selectedClientCode}.`)
      const [updatedConfig, updatedCustList] = await Promise.all([
        transitionNotificationsApi.getCustomerConfig(selectedClientCode),
        transitionNotificationsApi.listCustomers(),
      ])
      setClientConfig(updatedConfig)
      setWorkingStages(JSON.parse(JSON.stringify(updatedConfig.stages || {})))
      setCustomers(updatedCustList)
      setHasUnsavedChanges(false)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to initialize custom config.')
    } finally {
      setSaving(false)
    }
  }

  // Revert back to default
  const handleRevertToDefault = async () => {
    if (selectedClientCode === 'default') return
    setReverting(true)
    try {
      await transitionNotificationsApi.deleteCustomerConfig(selectedClientCode)
      toast.success(`Reverted ${selectedClientCode} to default template.`)
      setIsRevertConfirmOpen(false)

      const [updatedConfig, updatedCustList] = await Promise.all([
        transitionNotificationsApi.getCustomerConfig(selectedClientCode),
        transitionNotificationsApi.listCustomers(),
      ])
      setClientConfig(updatedConfig)
      setWorkingStages(JSON.parse(JSON.stringify(updatedConfig.stages || {})))
      setCustomers(updatedCustList)
      setHasUnsavedChanges(false)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to revert config.')
    } finally {
      setReverting(false)
    }
  }

  // Add new stage
  const handleConfirmAddStage = async () => {
    const stageName = (selectedSystemStageToAdd || newStageNameInput).trim()
    if (!stageName) {
      toast.error('Please enter or select a stage name.')
      return
    }

    if (workingStages[stageName]) {
      toast.error(`Stage "${stageName}" is already in this configuration.`)
      setSelectedStage(stageName)
      setIsAddStageModalOpen(false)
      setIsDrawerOpen(true)
      return
    }

    setAddingStage(true)
    const defaultTemplate: StageEmailConfig = {
      enabled: true,
      custom_message: 'The {current_stage} stage has been completed. The chapter has been moved to the {next_stage} stage.',
      to: ['{next_stage_team_email}'],
      cc: [],
      subject: '[{client_name}] {project_code} - Chapter {chapter_name} | {current_stage} → {next_stage} | Stage Transition Notification',
      body: `Hi Team,\n\nThe {current_stage} stage has been completed for Chapter {chapter_name}.\n\nThe chapter has been moved to the {next_stage} stage and is now ready for processing.\n\nRegards,\n{current_stage} Team\n\nNote : This is an automated mail and please do not reply.`,
    }

    try {
      if (alsoAddToSystemMaster && newStageNameInput.trim()) {
        await transitionNotificationsApi.addStage(selectedClientCode, {
          stage_name: stageName,
          add_to_system_master: true,
          ...defaultTemplate,
        })
      }
    } catch (e) {
      console.warn('Backend addStage call:', e)
    } finally {
      setAddingStage(false)
    }

    setWorkingStages(prev => ({
      ...prev,
      [stageName]: defaultTemplate,
    }))
    setSelectedStage(stageName)
    setHasUnsavedChanges(true)
    setIsAddStageModalOpen(false)
    setNewStageNameInput('')
    setSelectedSystemStageToAdd('')
    setAlsoAddToSystemMaster(false)
    setIsDrawerOpen(true)
    toast.success(`Stage "${stageName}" added. Remember to Save Changes.`)
  }

  // Disable stage notifications
  const handleConfirmDisableStage = (stageName: string) => {
    setWorkingStages(prev => {
      const cur = prev[stageName]
      if (!cur) return prev
      return {
        ...prev,
        [stageName]: {
          ...cur,
          enabled: false,
        },
      }
    })
    setHasUnsavedChanges(true)
    setIsDeleteStageModalOpen(false)
    toast.success(`Disabled notifications for "${stageName}". Click "Save Changes" to apply.`)
  }

  // Permanently delete stage
  const handleConfirmPermanentDeleteStage = (stageName: string) => {
    setWorkingStages(prev => {
      const next = { ...prev }
      delete next[stageName]
      return next
    })
    const remaining = Object.keys(workingStages).filter(k => k !== stageName)
    if (selectedStage === stageName) {
      if (remaining.length > 0) {
        setSelectedStage(remaining[0])
      } else {
        setSelectedStage('')
        setIsDrawerOpen(false)
      }
    }
    setHasUnsavedChanges(true)
    setIsDeleteStageModalOpen(false)
    toast.success(`Removed "${stageName}" from configuration. Click "Save Changes" to apply.`)
  }

  // Live rendered preview
  const renderedPreview = useMemo(() => {
    const sampleMap: Record<string, string> = {
      '{chapter_name}': '01',
      '{chapter_title}': 'Foundations of Modern Publishing & Digital Workflows',
      '{current_stage}': selectedStage || 'Manuscript Analysis',
      '{next_stage}': 'Pre-editing',
      '{project_code}': clientConfig?.client_code === 'default' ? 'PRJ-DEMO-2026' : `PRJ-${clientConfig?.client_code}-01`,
      '{client_name}': clientConfig?.client_name || 'Publisher Media Group',
      '{author_email}': 'lead_author@university.edu',
      '{client_email}': 'editorial_desk@publisher.org',
      '{languageediting_team_email}': 'languageediting_team@example.com',
      '{pre_editing_team_email}': 'pre_editing_team@example.com',
      '{next_stage_team_email}': 'pre_editing_team@example.com',
    }

    let subj = currentStageConfig.subject || ''
    let body = currentStageConfig.body || ''

    for (const [k, v] of Object.entries(sampleMap)) {
      subj = subj.split(k).join(v)
      body = body.split(k).join(v)
    }

    const renderedTo = (currentStageConfig.to || []).map(t => {
      let r = t
      for (const [k, v] of Object.entries(sampleMap)) {
        r = r.split(k).join(v)
      }
      return r
    })

    const renderedCc = (currentStageConfig.cc || []).map(c => {
      let r = c
      for (const [k, v] of Object.entries(sampleMap)) {
        r = r.split(k).join(v)
      }
      return r
    })

    return {
      subject: subj,
      body: body,
      to: renderedTo,
      cc: renderedCc,
    }
  }, [currentStageConfig, selectedStage, clientConfig])

  // Test email dispatch
  const handleSendTestEmail = async () => {
    if (!testEmailAddress || !testEmailAddress.includes('@')) {
      toast.error('Please enter a valid email address.')
      return
    }

    setSendingTestEmail(true)
    setTestResult(null)
    try {
      const res = await transitionNotificationsApi.sendTestNotification({
        to_email: testEmailAddress.trim(),
        subject: currentStageConfig.subject,
        body: currentStageConfig.body,
        client_code: selectedClientCode,
        stage_name: selectedStage,
      })
      setTestResult({ success: true, message: res.message })
      toast.success(res.message)
    } catch (err: any) {
      const errMsg = err.response?.data?.detail || 'Failed to dispatch test email.'
      setTestResult({ success: false, message: errMsg })
      toast.error(errMsg)
    } finally {
      setSendingTestEmail(false)
    }
  }

  if (loading) {
    return <FullPageSpinner />
  }

  const isDefaultSelected = selectedClientCode === 'default'
  const isCustomConfig = clientConfig?.is_custom ?? false

  return (
    <div className="max-w-[1500px] mx-auto space-y-5 pb-20">
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings')}
            className="h-9 w-9 p-0 rounded-lg hover:bg-muted/10 text-muted hover:text-text"
          >
            <ArrowLeft size={18} />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                <Mail size={18} />
              </div>
              <h1 className="text-xl font-bold text-text">Stage Transition Notifications</h1>
            </div>
            <p className="text-xs text-muted mt-0.5">
              Automated email notifications, recipient routing, and messages triggered upon stage completion.
            </p>
          </div>
        </div>

        {/* Global Save and Status Actions */}
        <div className="flex items-center gap-3">
          {hasUnsavedChanges && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg border border-amber-200 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Unsaved Changes
            </div>
          )}

          <Button
            size="sm"
            onClick={() => {
              setNewStageNameInput('')
              setSelectedSystemStageToAdd('')
              setAlsoAddToSystemMaster(false)
              setIsAddStageModalOpen(true)
            }}
            leftIcon={<Plus size={14} />}
            className="text-xs h-9 px-3.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-semibold"
          >
            Add Stage
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAllToDb}
            disabled={syncingAll}
            isLoading={syncingAll}
            leftIcon={<Database size={14} className="text-indigo-600" />}
            className="text-xs h-9 px-3.5 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold shadow-xs"
            title="Import and save all JSON templates from disk directly into PostgreSQL database"
          >
            Sync All JSON to DB
          </Button>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            isLoading={saving}
            leftIcon={<Save size={14} />}
            className="text-xs h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
            title="Save this customer configuration directly into PostgreSQL database"
          >
            Save
          </Button>
        </div>
      </div>

      {/* ── Customer Selector Bar ───────────────────────────────────────────── */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-3.5 sm:p-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 sm:gap-4">
          {/* Customer Dropdown + Indicator */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <span className="text-xs font-bold text-muted uppercase tracking-wider whitespace-nowrap">
              Select Customer:
            </span>

            <div className="w-64 sm:w-80">
              <Dropdown
                value={selectedClientCode}
                onChange={setSelectedClientCode}
                options={customerDropdownOptions}
                searchable={true}
                placeholder="Select a customer..."
                icon={isDefaultSelected ? <Globe size={15} className="text-indigo-600 shrink-0" /> : <Building2 size={15} className="text-primary shrink-0" />}
                className="h-9 text-xs font-semibold bg-surface border-border shadow-xs"
                dropdownClassName="w-80 max-h-72 shadow-xl border-border bg-card"
              />
            </div>

            {/* Custom / Inherited Status Badge & Actions */}
            <div className="flex items-center gap-2 flex-wrap">

              {isDefaultSelected ? (
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200/60 inline-flex items-center gap-1 whitespace-nowrap shadow-2xs">
                  <Globe size={12} /> Global Fallback
                </span>
              ) : isCustomConfig ? (
                <div className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-purple-50 text-purple-700 border border-purple-200/60 inline-flex items-center gap-1 whitespace-nowrap shadow-2xs">
                    <CheckCircle2 size={12} /> Custom Configuration
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsRevertConfirmOpen(true)}
                    className="text-xs h-7 text-rose-600 hover:text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1 px-2 whitespace-nowrap rounded-lg"
                  >
                    <RotateCcw size={12} />
                    Revert to Default
                  </Button>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 inline-flex items-center gap-1 whitespace-nowrap shadow-2xs">
                    <Info size={12} /> Inherited from Default
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCreateCustomOverride}
                    className="text-xs h-7 text-primary hover:bg-primary/5 inline-flex items-center gap-1 px-2.5 whitespace-nowrap rounded-lg"
                  >
                    <Sparkles size={12} />
                    Customize for {selectedClientCode}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Search & Filter Toolbar - Side by side on one line */}
          <div className="flex items-center gap-2.5 shrink-0 self-start xl:self-auto">
            {/* Search filter */}
            <div className="relative w-48 sm:w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search stages or recipients..."
                value={stageSearchQuery}
                onChange={e => setStageSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-surface border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
              />
              {stageSearchQuery && (
                <button
                  onClick={() => setStageSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Filter pills: All, Active, Disabled */}
            <div className="flex items-center p-0.5 bg-surface rounded-lg border border-border text-xs shrink-0 shadow-2xs">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${statusFilter === 'all' ? 'bg-card text-text shadow-xs font-semibold' : 'text-muted hover:text-text'
                  }`}
              >
                All ({stageStats.total})
              </button>
              <button
                onClick={() => setStatusFilter('active')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${statusFilter === 'active' ? 'bg-card text-emerald-700 shadow-xs font-semibold' : 'text-muted hover:text-text'
                  }`}
              >
                Active ({stageStats.active})
              </button>
              <button
                onClick={() => setStatusFilter('disabled')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${statusFilter === 'disabled' ? 'bg-card text-amber-700 shadow-xs font-semibold' : 'text-muted hover:text-text'
                  }`}
              >
                Disabled ({stageStats.disabled})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stages Table ────────────────────────────────────────────────────── */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {configLoading ? (
          <div className="p-16 flex flex-col items-center justify-center min-h-[360px]">
            <Spinner size="lg" />
            <p className="text-xs text-muted mt-3">Loading stages for {selectedClientCode}...</p>
          </div>
        ) : filteredStageList.length === 0 ? (
          <div className="p-16 text-center">
            <div className="inline-flex p-3 rounded-full bg-muted/10 text-muted mb-3">
              <Mail size={24} />
            </div>
            <h3 className="text-sm font-bold text-text">No stages found</h3>
            <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
              {stageSearchQuery || statusFilter !== 'all'
                ? 'No workflow stages match the search or status filter.'
                : 'No stages are configured for this customer yet.'}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {(stageSearchQuery || statusFilter !== 'all') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setStageSearchQuery('')
                    setStatusFilter('all')
                  }}
                  className="text-xs"
                >
                  Clear Filters
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setIsAddStageModalOpen(true)}
                className="text-xs bg-primary text-white"
              >
                <Plus size={14} className="mr-1" /> Add Stage
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface/50 text-[11px] font-bold text-muted uppercase tracking-wider">
                  <th className="py-3 px-4 w-32">Email Status</th>
                  <th className="py-3 px-4 min-w-[200px]">Workflow Stage</th>
                  <th className="py-3 px-4 min-w-[220px]">TO Recipients</th>
                  <th className="py-3 px-4 min-w-[160px]">CC Recipients</th>
                  <th className="py-3 px-4 min-w-[260px]">Subject Template</th>
                  <th className="py-3 px-4 w-36 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {filteredStageList.map(stName => {
                  const stageCfg = workingStages[stName]
                  const isEnabled = stageCfg?.enabled !== false
                  const toRecipients = stageCfg?.to || []
                  const ccRecipients = stageCfg?.cc || []
                  const desc = stageDescriptions[stName]

                  return (
                    <tr
                      key={stName}
                      onClick={() => handleOpenDrawer(stName)}
                      className={`hover:bg-muted/5 transition-colors cursor-pointer group ${!isEnabled ? 'bg-slate-50/40' : ''
                        }`}
                    >
                      {/* 1. Status Toggle Switch */}
                      <td className="py-3.5 px-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={e => handleToggleStageEnabled(stName, e)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                              }`}
                            title={isEnabled ? 'Click to disable email notifications' : 'Click to enable email notifications'}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${isEnabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                            />
                          </button>
                          <span
                            className={`text-[11px] font-semibold ${isEnabled ? 'text-emerald-700' : 'text-slate-400'
                              }`}
                          >
                            {isEnabled ? 'Active' : 'Disabled'}
                          </span>
                        </div>
                      </td>

                      {/* 2. Stage Name & Description */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-text flex items-center gap-2">
                          <span className={!isEnabled ? 'line-through text-muted' : ''}>{stName}</span>
                          {!isEnabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold flex items-center gap-0.5">
                              <BellOff size={10} /> Off
                            </span>
                          )}
                        </div>
                        {desc && (
                          <p className="text-[11px] text-muted line-clamp-1 mt-0.5 max-w-sm">
                            {desc}
                          </p>
                        )}
                      </td>

                      {/* 3. TO Recipients */}
                      <td className="py-3.5 px-4">
                        {toRecipients.length > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {toRecipients.slice(0, 2).map(r => (
                              <span
                                key={r}
                                className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-indigo-50/80 text-indigo-700 border border-indigo-100/60 max-w-[200px] truncate"
                                title={r}
                              >
                                {r}
                              </span>
                            ))}
                            {toRecipients.length > 2 && (
                              <span className="text-[11px] font-medium text-muted bg-surface px-1.5 py-0.5 rounded border border-border">
                                +{toRecipients.length - 2} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-rose-500 text-[11px] font-medium flex items-center gap-1">
                            <AlertCircle size={12} /> No recipients configured
                          </span>
                        )}
                      </td>

                      {/* 4. CC Recipients */}
                      <td className="py-3.5 px-4">
                        {ccRecipients.length > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {ccRecipients.slice(0, 1).map(c => (
                              <span
                                key={c}
                                className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-100 text-slate-700 border border-slate-200 max-w-[160px] truncate"
                                title={c}
                              >
                                {c}
                              </span>
                            ))}
                            {ccRecipients.length > 1 && (
                              <span className="text-[11px] font-medium text-muted bg-surface px-1.5 py-0.5 rounded border border-border">
                                +{ccRecipients.length - 1} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted/60 text-[11px]">—</span>
                        )}
                      </td>

                      {/* 5. Subject Line Preview */}
                      <td className="py-3.5 px-4">
                        <p
                          className="text-[11px] text-text font-mono line-clamp-1 max-w-[340px]"
                          title={stageCfg?.subject || 'No subject'}
                        >
                          {stageCfg?.subject || <span className="text-muted italic">No subject</span>}
                        </p>
                      </td>

                      {/* 6. Actions */}
                      <td className="py-3.5 px-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDrawer(stName)}
                            leftIcon={<Pencil size={12} />}
                            className="h-8 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10 font-semibold rounded-lg"
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setStageToDelete(stName)
                              setIsDeleteStageModalOpen(true)
                            }}
                            className="h-8 w-8 p-0 text-muted hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                            title="Delete or disable this stage"
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Slide-Out Drawer (Stage Template Editor) ────────────────────────── */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setIsDrawerOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="relative w-full max-w-2xl bg-card border-l border-border shadow-2xl h-full flex flex-col z-10 animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 sm:p-5 border-b border-border bg-surface/50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                  <Mail size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-text">{selectedStage}</h2>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted/20 text-muted font-medium">
                      {selectedClientCode}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    Email notification sent when chapter moves beyond "{selectedStage}".
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Active / Disabled Switch */}
                <div className="flex items-center gap-2 px-2.5 py-1 bg-card rounded-lg border border-border">
                  <span className="text-xs font-semibold text-text">Email:</span>
                  <button
                    type="button"
                    onClick={() => updateCurrentStage('enabled', currentStageConfig.enabled === false)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${currentStageConfig.enabled !== false ? 'bg-emerald-600' : 'bg-slate-300'
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${currentStageConfig.enabled !== false ? 'translate-x-4' : 'translate-x-0'
                        }`}
                    />
                  </button>
                  <span
                    className={`text-[11px] font-bold ${currentStageConfig.enabled !== false ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                  >
                    {currentStageConfig.enabled !== false ? 'Active' : 'Disabled'}
                  </span>
                </div>

                {/* Close Button */}
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-muted/10 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Drawer Tabs */}
            <div className="px-5 border-b border-border flex items-center gap-4 bg-surface/30">
              <button
                onClick={() => setDrawerTab('editor')}
                className={`py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${drawerTab === 'editor'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:text-text'
                  }`}
              >
                <Sliders size={14} />
                <span>Email Template & Routing</span>
              </button>
              <button
                onClick={() => setDrawerTab('preview')}
                className={`py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${drawerTab === 'preview'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:text-text'
                  }`}
              >
                <Eye size={14} />
                <span>Live Preview & Test Send</span>
              </button>
            </div>

            {/* Drawer Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Banner if stage is disabled */}
              {currentStageConfig.enabled === false && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2.5 text-xs text-amber-800">
                  <BellOff size={16} className="text-amber-600 shrink-0" />
                  <div>
                    <span className="font-semibold">Email notifications are disabled for this stage.</span>
                    <p className="text-[11px] text-amber-700 mt-0.5 leading-normal">
                      No email will be triggered on transition. Switch toggle to "Active" above to re-enable.
                    </p>
                  </div>
                </div>
              )}

              {drawerTab === 'editor' ? (
                <div className="space-y-4">
                  {/* Transition Alert Message */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-text flex items-center gap-1.5">
                      Transition Alert Message
                      <span className="text-[11px] font-normal text-muted">(Displayed on screen during transition)</span>
                    </label>
                    <input
                      type="text"
                      value={currentStageConfig.custom_message || ''}
                      onChange={e => updateCurrentStage('custom_message', e.target.value)}
                      placeholder="The {current_stage} stage has been completed..."
                      className="w-full px-3 py-2 text-xs bg-surface border border-border rounded-lg text-text focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* TO Recipients Chip Input */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-text">
                        TO Recipients <span className="text-rose-500">*</span>
                      </label>
                      {/* Quick tokens */}
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-muted">Quick add:</span>
                        <button
                          type="button"
                          onClick={() => handleAddToEmail('{next_stage_team_email}')}
                          className="text-primary hover:underline font-mono"
                        >
                          +NextStageTeam
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddToEmail('{author_email}')}
                          className="text-primary hover:underline font-mono"
                        >
                          +Author
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddToEmail('{client_email}')}
                          className="text-primary hover:underline font-mono"
                        >
                          +ClientContact
                        </button>
                      </div>
                    </div>

                    <div className="min-h-[42px] p-2 bg-surface border border-border rounded-lg flex flex-wrap items-center gap-1.5 focus-within:ring-1 focus-within:ring-primary focus-within:border-primary">
                      {(currentStageConfig.to || []).map((t, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200"
                        >
                          {t}
                          <button
                            type="button"
                            onClick={() => handleRemoveToEmail(idx)}
                            className="hover:text-rose-600 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        placeholder={
                          (currentStageConfig.to || []).length === 0
                            ? 'Type email address or token and press Enter...'
                            : 'Add another email...'
                        }
                        value={newToEmail}
                        onChange={e => setNewToEmail(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault()
                            handleAddToEmail(newToEmail)
                          }
                        }}
                        onBlur={() => {
                          if (newToEmail.trim()) handleAddToEmail(newToEmail)
                        }}
                        className="flex-1 min-w-[180px] bg-transparent text-xs text-text placeholder:text-muted focus:outline-none py-1"
                      />
                    </div>
                  </div>

                  {/* CC Recipients Chip Input */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-text">
                        CC Recipients <span className="text-[11px] font-normal text-muted">(Optional)</span>
                      </label>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-muted">Quick add:</span>
                        <button
                          type="button"
                          onClick={() => handleAddCcEmail('{pre_editing_team_email}')}
                          className="text-primary hover:underline font-mono"
                        >
                          +Pre-editing
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddCcEmail('{languageediting_team_email}')}
                          className="text-primary hover:underline font-mono"
                        >
                          +LanguageEditing
                        </button>
                      </div>
                    </div>

                    <div className="min-h-[40px] p-2 bg-surface border border-border rounded-lg flex flex-wrap items-center gap-1.5 focus-within:ring-1 focus-within:ring-primary">
                      {(currentStageConfig.cc || []).map((c, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono bg-slate-100 text-slate-700 border border-slate-200"
                        >
                          {c}
                          <button
                            type="button"
                            onClick={() => handleRemoveCcEmail(idx)}
                            className="hover:text-rose-600 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        placeholder="Type CC email address and press Enter..."
                        value={newCcEmail}
                        onChange={e => setNewCcEmail(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault()
                            handleAddCcEmail(newCcEmail)
                          }
                        }}
                        onBlur={() => {
                          if (newCcEmail.trim()) handleAddCcEmail(newCcEmail)
                        }}
                        className="flex-1 min-w-[180px] bg-transparent text-xs text-text placeholder:text-muted focus:outline-none py-1"
                      />
                    </div>
                  </div>

                  {/* Subject Line */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-text">Subject Line</label>
                      <span className="text-[11px] text-muted">Supports placeholders</span>
                    </div>
                    <input
                      ref={subjectInputRef}
                      type="text"
                      onFocus={() => setLastFocusedInput('subject')}
                      value={currentStageConfig.subject || ''}
                      onChange={e => updateCurrentStage('subject', e.target.value)}
                      placeholder="[{client_name}] {project_code} - Chapter {chapter_name} | {current_stage} → {next_stage}..."
                      className="w-full px-3 py-2 text-xs font-mono bg-surface border border-border rounded-lg text-text focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Body Textarea */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-text">Email Message Body</label>
                      <span className="text-[11px] text-muted">Plain text / multiline</span>
                    </div>
                    <textarea
                      ref={bodyTextareaRef}
                      rows={9}
                      onFocus={() => setLastFocusedInput('body')}
                      value={currentStageConfig.body || ''}
                      onChange={e => updateCurrentStage('body', e.target.value)}
                      placeholder="Hi Team,\n\nThe {current_stage} stage has been completed..."
                      className="w-full px-3 py-2 text-xs font-mono leading-relaxed bg-surface border border-border rounded-lg text-text focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                    />
                  </div>

                  {/* Available Variables Quick Pills */}
                  <div className="p-3 bg-surface rounded-xl border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text flex items-center gap-1.5">
                        <Sparkles size={13} className="text-primary" />
                        Click Variable to Insert into {lastFocusedInput === 'subject' ? 'Subject' : 'Body'}:
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {variables.map(v => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => insertPlaceholder(v.key)}
                          className="px-2 py-1 text-[11px] font-mono bg-card hover:bg-primary/10 hover:text-primary text-text rounded-md border border-border hover:border-primary/40 transition-colors"
                          title={v.description}
                        >
                          {v.key}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Live Preview & Direct Test Send Tab */
                <div className="space-y-4">
                  <div className="p-3 bg-indigo-50/60 border border-indigo-200/60 rounded-xl text-xs text-indigo-900 flex items-center gap-2">
                    <Info size={16} className="text-indigo-600 shrink-0" />
                    <span>
                      This simulates how the notification will look to recipients when chapter transition events fire.
                    </span>
                  </div>

                  {/* Preview Container */}
                  <div className="border border-border rounded-xl bg-surface p-4 space-y-3 font-mono text-xs">
                    <div className="space-y-1 pb-3 border-b border-border">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-muted text-[11px] w-16 uppercase">TO:</span>
                        <div className="flex flex-wrap gap-1 text-text">
                          {renderedPreview.to.length > 0 ? (
                            renderedPreview.to.map((r, i) => (
                              <span key={i} className="px-2 py-0.5 rounded bg-card border border-border text-[11px]">
                                {r}
                              </span>
                            ))
                          ) : (
                            <span className="text-rose-500 italic">No TO recipients</span>
                          )}
                        </div>
                      </div>

                      {renderedPreview.cc.length > 0 && (
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-muted text-[11px] w-16 uppercase">CC:</span>
                          <div className="flex flex-wrap gap-1 text-text">
                            {renderedPreview.cc.map((c, i) => (
                              <span key={i} className="px-2 py-0.5 rounded bg-card border border-border text-[11px]">
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-baseline gap-2 pt-1">
                        <span className="font-semibold text-muted text-[11px] w-16 uppercase">Subject:</span>
                        <span className="text-text font-bold">{renderedPreview.subject || '(Empty subject)'}</span>
                      </div>
                    </div>

                    <div className="pt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-text bg-card p-3 rounded-lg border border-border/60">
                      {renderedPreview.body || '(Empty body)'}
                    </div>
                  </div>

                  {/* Send Test Email Card */}
                  <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Send size={15} className="text-primary" />
                      <h4 className="text-xs font-bold text-text">Send Live Test Email</h4>
                    </div>
                    <p className="text-[11px] text-muted">
                      Dispatch a sample test message containing this template directly to your inbox via the configured SMTP server.
                    </p>

                    <div className="flex gap-2">
                      <input
                        type="email"
                        placeholder="your.email@company.com"
                        value={testEmailAddress}
                        onChange={e => setTestEmailAddress(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs bg-card border border-border rounded-lg text-text focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <Button
                        size="sm"
                        onClick={handleSendTestEmail}
                        disabled={sendingTestEmail || !testEmailAddress}
                        isLoading={sendingTestEmail}
                        leftIcon={<Send size={13} />}
                        className="h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-white shadow-xs shrink-0"
                      >
                        Send Test
                      </Button>
                    </div>

                    {testResult && (
                      <div
                        className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${testResult.success
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-rose-50 text-rose-800 border border-rose-200'
                          }`}
                      >
                        {testResult.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                        <span>{testResult.message}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-border bg-surface/50 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDrawerOpen(false)}
                className="h-9 px-4 text-xs font-medium"
              >
                Done
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  isLoading={saving}
                  leftIcon={<Save size={14} />}
                  className="h-9 px-4 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                  title="Save configuration directly into PostgreSQL database"
                >
                  Save to DB
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Stage Modal ──────────────────────────────────────────────────── */}
      <Modal
        isOpen={isAddStageModalOpen}
        onClose={() => {
          setIsAddStageModalOpen(false)
          setNewStageNameInput('')
          setSelectedSystemStageToAdd('')
          setAlsoAddToSystemMaster(false)
        }}
        title="Add Stage to Transition Notifications"
      >
        <div className="space-y-4 text-xs">
          <p className="text-muted leading-relaxed">
            Configure automated transition email notifications for an existing workflow stage or create a new custom stage.
          </p>

          {/* Option 1: Select from System Stages */}
          {unconfiguredStages.length > 0 && (
            <div className="space-y-1">
              <label className="font-semibold text-text">Choose from Available System Stages</label>
              <select
                value={selectedSystemStageToAdd}
                onChange={e => {
                  setSelectedSystemStageToAdd(e.target.value)
                  if (e.target.value) setNewStageNameInput('')
                }}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text focus:outline-none focus:ring-1 focus:ring-primary text-xs cursor-pointer"
              >
                <option value="">-- Select a system stage --</option>
                {unconfiguredStages.map(s => (
                  <option key={s.stage_name} value={s.stage_name}>
                    {s.stage_name} {s.description ? `(${s.description})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {unconfiguredStages.length > 0 && (
            <div className="flex items-center gap-2 my-1 text-muted text-[11px]">
              <div className="flex-1 h-px bg-border" />
              <span>OR</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {/* Option 2: Custom Stage Name */}
          <div className="space-y-1">
            <label className="font-semibold text-text">Create New Custom Stage Name</label>
            <input
              type="text"
              placeholder="e.g. Author Proofing, Typesetting QC, Final Indexing..."
              value={newStageNameInput}
              onChange={e => {
                setNewStageNameInput(e.target.value)
                if (e.target.value) setSelectedSystemStageToAdd('')
              }}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text focus:outline-none focus:ring-1 focus:ring-primary text-xs"
            />
            <p className="text-[11px] text-muted">
              You can type any stage name to set up email recipient rules for it.
            </p>
          </div>

          {newStageNameInput.trim() && (
            <label className="flex items-start gap-2.5 p-2.5 bg-surface rounded-lg border border-border cursor-pointer hover:bg-muted/10 transition-colors">
              <input
                type="checkbox"
                checked={alsoAddToSystemMaster}
                onChange={e => setAlsoAddToSystemMaster(e.target.checked)}
                className="mt-0.5 rounded border-border text-primary focus:ring-primary"
              />
              <div className="text-xs">
                <span className="font-semibold text-text">Also register in System Stage Management</span>
                <p className="text-[11px] text-muted mt-0.5 leading-normal">
                  Creates a master entry in `stage_master` table so this stage is recognized throughout all workflows.
                </p>
              </div>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsAddStageModalOpen(false)
                setNewStageNameInput('')
                setSelectedSystemStageToAdd('')
                setAlsoAddToSystemMaster(false)
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={addingStage || (!selectedSystemStageToAdd && !newStageNameInput.trim())}
              onClick={handleConfirmAddStage}
              className="bg-primary text-white flex items-center gap-1.5"
            >
              {addingStage ? <Spinner size="sm" /> : <Plus size={14} />}
              Add Stage
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete / Disable Stage Modal ────────────────────────────────────── */}
      <Modal
        isOpen={isDeleteStageModalOpen}
        onClose={() => setIsDeleteStageModalOpen(false)}
        title={`Delete Stage Email: ${stageToDelete}`}
      >
        <div className="space-y-4 text-xs">
          <p className="text-text leading-relaxed">
            Choose what you want to do with the transition email for <strong className="font-semibold text-text">{stageToDelete}</strong>:
          </p>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => handleConfirmDisableStage(stageToDelete)}
              className="w-full text-left p-3 rounded-lg border border-border hover:border-amber-400 bg-surface hover:bg-amber-50/40 transition-all group"
            >
              <div className="flex items-center gap-2">
                <BellOff size={16} className="text-amber-600 group-hover:scale-105 transition-transform" />
                <span className="font-semibold text-text">Disable Notifications</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-medium ml-auto">Recommended</span>
              </div>
              <p className="text-[11px] text-muted mt-1 leading-normal pl-6">
                Suppresses all transition emails for this stage so no emails are sent, while keeping the recipient configuration saved for later re-activation.
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleConfirmPermanentDeleteStage(stageToDelete)}
              className="w-full text-left p-3 rounded-lg border border-border hover:border-rose-400 bg-surface hover:bg-rose-50/40 transition-all group"
            >
              <div className="flex items-center gap-2">
                <Trash2 size={16} className="text-rose-600 group-hover:scale-105 transition-transform" />
                <span className="font-semibold text-rose-700">Permanently Delete Stage</span>
              </div>
              <p className="text-[11px] text-muted mt-1 leading-normal pl-6">
                Completely removes this stage's email configuration from this customer template.
              </p>
            </button>
          </div>

          <div className="flex justify-end pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteStageModalOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Revert to Default Confirmation Dialog ────────────────────────────── */}
      <ConfirmDialog
        isOpen={isRevertConfirmOpen}
        onClose={() => setIsRevertConfirmOpen(false)}
        onConfirm={handleRevertToDefault}
        title="Revert Customer Settings to Default"
        message={`Are you sure you want to revert transition notification settings for '${selectedClientCode}' back to the Global Default template? This will delete custom recipient rules and templates for this publisher.`}
        confirmLabel={reverting ? 'Reverting...' : 'Revert to Default'}
      />
    </div>
  )
}
