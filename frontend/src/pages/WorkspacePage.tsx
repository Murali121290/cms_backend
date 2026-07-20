import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Clock,
  CheckCircle,
  Calendar,
  AlertCircle,
  TrendingUp,
  Search,
  ChevronDown,
  ChevronUp,
  Briefcase,
  Users,
  Layers,
  Loader,
  Check,
  Filter,
  X,
  Download,
} from 'lucide-react'
import api from '@/api/client'
import { getApiErrorMessage } from '@/api/client'
import * as XLSX from 'xlsx'

interface WorkspaceItem {
  id: number
  client: string
  project: string
  chapters: string
  stage_name: string
  planned_start_date: string | null
  planned_end_date: string | null
  actual_start_date: string | null
  actual_end_date: string | null
  stage_status: string
  delayed: boolean
  delay_days: number | null
  remarks: string | null
  manuscript_pages?: number
  ce_pages?: number
  project_manager_name?: string
}

interface WorkspaceStats {
  today_assigned: number
  yesterday_assigned: number
  delayed_count: number
  completed_count: number
  kra_meet_rate: number
}

interface TeamMemberWorkspaceData {
  username: string
  role: string
  email: string | null
  stats: WorkspaceStats
  assignments: WorkspaceItem[]
}

interface TeamLeadWorkspaceData {
  stats: WorkspaceStats
  members: TeamMemberWorkspaceData[]
}

interface StageMetric {
  stage_name: string
  active_count: number
  delayed_count: number
  today_assigned: number
  yesterday_assigned: number
  kra_meet_rate: number
}

interface ManagerWorkspaceData {
  stats: WorkspaceStats
  stages: StageMetric[]
  members: TeamMemberWorkspaceData[]
}

interface WorkspaceDashboardResponse {
  role: string
  viewer: {
    id: number
    username: string
    email: string
  }
  user_workspace: {
    stats: WorkspaceStats
    assignments: WorkspaceItem[]
  } | null
  teamlead_workspace: TeamLeadWorkspaceData | null
  manager_workspace: ManagerWorkspaceData | null
}

interface AssignmentTarget {
  project: string
  chapters: string
  stage_name: string
}

export function WorkspacePage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStage, setFilterStage] = useState('All')
  const [expandedMember, setExpandedMember] = useState<string | null>(null)
  
  const [tlActiveTab, setTlActiveTab] = useState<'members' | 'chapters'>('members')
  const [mgrActiveTab, setMgrActiveTab] = useState<'members' | 'chapters'>('members')
  const [selectedAssignments, setSelectedAssignments] = useState<AssignmentTarget[]>([])
  
  const [isAssigning, setIsAssigning] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  // Excel-like Column Filters State
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const [selectedPMs, setSelectedPMs] = useState<string[]>([])
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([])
  
  const [activeFilterDropdown, setActiveFilterDropdown] = useState<'client' | 'pm' | 'project' | 'stage' | 'status' | 'assignee' | null>(null)
  const [filterSearchQuery, setFilterSearchQuery] = useState('')

  const isAnyExcelFilterActive = selectedClients.length > 0 ||
                                 selectedPMs.length > 0 ||
                                 selectedProjects.length > 0 || 
                                 selectedStages.length > 0 || 
                                 selectedStatuses.length > 0 || 
                                 selectedAssignees.length > 0

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.excel-filter-container')) {
        setActiveFilterDropdown(null)
      }
    }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [])

  const applyExcelFilters = (assignments: any[]) => {
    return assignments.filter(item => {
      // 1. Text Search Term
      const matchesSearch = item.chapters.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            item.project.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (item.client && item.client.toLowerCase().includes(searchTerm.toLowerCase())) ||
                            (item.project_manager_name && item.project_manager_name.toLowerCase().includes(searchTerm.toLowerCase()))
      if (!matchesSearch) return false

      // 2. Client filter
      if (selectedClients.length > 0 && !selectedClients.includes(item.client)) {
        return false
      }

      // 3. PM filter
      if (selectedPMs.length > 0 && !selectedPMs.includes(item.project_manager_name)) {
        return false
      }

      // 4. Project filter
      if (selectedProjects.length > 0 && !selectedProjects.includes(item.project)) {
        return false
      }

      // 5. Stage filter
      if (selectedStages.length > 0 && !selectedStages.includes(item.stage_name)) {
        return false
      }

      // 6. Status filter
      if (selectedStatuses.length > 0) {
        const itemStatus = item.delayed ? 'Delayed' : 'On Schedule'
        if (!selectedStatuses.includes(itemStatus)) {
          return false
        }
      }

      // 7. Assignee filter
      if (selectedAssignees.length > 0) {
        const itemAssignee = item.current_assignee || 'Unassigned'
        if (!selectedAssignees.includes(itemAssignee)) {
          return false
        }
      }

      return true
    })
  }

  const handleExportExcel = (assignments: any[]) => {
    const dataToExport = assignments.map(item => ({
      'Client': item.client || '',
      'PM': item.project_manager_name || '-',
      'Project Code': item.project || '',
      'Chapter Name': item.chapters || '',
      'MSS Pages': item.manuscript_pages || 0,
      'CE Pages': item.ce_pages || 0,
      'Stage Name': item.stage_name || '',
      'Start Date': item.planned_start_date ? new Date(item.planned_start_date).toLocaleDateString('en-GB') : '-',
      'End Date': item.planned_end_date ? new Date(item.planned_end_date).toLocaleDateString('en-GB') : '-',
      'SLA Status': item.delayed ? `Delayed (${item.delay_days}d)` : 'On Schedule',
      'Current Assignee': item.current_assignee || 'Unassigned'
    }))

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Queue')

    const maxProps = [
      { wch: 15 }, // Client
      { wch: 18 }, // PM
      { wch: 15 }, // Project Code
      { wch: 25 }, // Chapter Name
      { wch: 12 }, // MSS Pages
      { wch: 12 }, // CE Pages
      { wch: 20 }, // Stage Name
      { wch: 18 }, // Start Date
      { wch: 18 }, // End Date
      { wch: 18 }, // SLA Status
      { wch: 20 }  // Assignee
    ]
    worksheet['!cols'] = maxProps

    const dateStr = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(workbook, `workspace_queue_${dateStr}.xlsx`)
  }

  const renderColumnFilter = (
    columnType: 'client' | 'pm' | 'project' | 'stage' | 'status' | 'assignee',
    columnLabel: string,
    assignments: any[]
  ) => {
    let uniqueValues: string[] = []
    if (columnType === 'client') {
      uniqueValues = Array.from(new Set(assignments.map(a => a.client))).filter(Boolean)
    } else if (columnType === 'pm') {
      uniqueValues = Array.from(new Set(assignments.map(a => a.project_manager_name || '-'))).filter(Boolean)
    } else if (columnType === 'project') {
      uniqueValues = Array.from(new Set(assignments.map(a => a.project))).filter(Boolean)
    } else if (columnType === 'stage') {
      uniqueValues = Array.from(new Set(assignments.map(a => a.stage_name))).filter(Boolean)
    } else if (columnType === 'status') {
      uniqueValues = ['Delayed', 'On Schedule']
    } else if (columnType === 'assignee') {
      uniqueValues = Array.from(new Set(assignments.map(a => a.current_assignee || 'Unassigned'))).filter(Boolean)
    }

    const selectedList = 
      columnType === 'client' ? selectedClients :
      columnType === 'pm' ? selectedPMs :
      columnType === 'project' ? selectedProjects :
      columnType === 'stage' ? selectedStages :
      columnType === 'status' ? selectedStatuses :
      selectedAssignees

    const setSelectedList = 
      columnType === 'client' ? setSelectedClients :
      columnType === 'pm' ? setSelectedPMs :
      columnType === 'project' ? setSelectedProjects :
      columnType === 'stage' ? setSelectedStages :
      columnType === 'status' ? setSelectedStatuses :
      setSelectedAssignees

    const isDropdownOpen = activeFilterDropdown === columnType
    const filteredValues = uniqueValues.filter(val => 
      val.toLowerCase().includes(filterSearchQuery.toLowerCase())
    )

    const handleToggle = (val: string, checked: boolean) => {
      if (checked) {
        setSelectedList(prev => [...prev, val])
      } else {
        setSelectedList(prev => prev.filter(v => v !== val))
      }
    }

    const isFiltered = selectedList.length > 0

    return (
      <div className="relative inline-flex items-center gap-1.5 excel-filter-container normal-case font-bold">
        <span>{columnLabel}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setFilterSearchQuery('')
            setActiveFilterDropdown(activeFilterDropdown === columnType ? null : columnType)
          }}
          className={`p-0.5 rounded hover:bg-muted transition-colors ${
            isFiltered ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
          title={`Filter by ${columnLabel}`}
        >
          <Filter size={11} fill={isFiltered ? 'currentColor' : 'none'} />
        </button>

        {isDropdownOpen && (
          <div className="absolute top-full left-0 mt-2 z-50 bg-card border border-border shadow-xl rounded-xl p-3 w-52 font-normal text-xs text-foreground text-left flex flex-col gap-2">
            <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
              <span className="font-bold text-[10px] text-muted-foreground uppercase tracking-wide">Filter {columnLabel}</span>
              <button 
                type="button" 
                onClick={() => setActiveFilterDropdown(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            </div>

            {uniqueValues.length > 5 && (
              <input
                type="text"
                placeholder="Search..."
                value={filterSearchQuery}
                onChange={e => setFilterSearchQuery(e.target.value)}
                className="w-full border border-border/80 rounded px-2 py-1 bg-background text-[11px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            )}

            <div className="max-h-36 overflow-y-auto space-y-1">
              {filteredValues.map(val => (
                <label key={val} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 p-1.5 rounded transition-all">
                  <input
                    type="checkbox"
                    checked={selectedList.includes(val)}
                    onChange={(e) => handleToggle(val, e.target.checked)}
                    className="w-3.5 h-3.5 border-border rounded focus:ring-primary accent-primary"
                  />
                  <span className="truncate max-w-[150px]">{val}</span>
                </label>
              ))}
              {filteredValues.length === 0 && (
                <p className="text-center py-2 text-muted-foreground text-[10px]">No matches</p>
              )}
            </div>

            <div className="flex justify-between border-t border-border/40 pt-2 text-[10px] font-bold">
              <button type="button" className="text-primary hover:underline" onClick={() => setSelectedList(uniqueValues)}>Select All</button>
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setSelectedList([])}>Clear</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const { data, isLoading, error, refetch } = useQuery<WorkspaceDashboardResponse>({
    queryKey: ['workspace-dashboard'],
    queryFn: async () => {
      const res = await api.get('/dashboard/workspaces')
      return res.data
    },
    refetchInterval: 30000, // Poll every 30 seconds
  })

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader className="w-8 h-8 text-primary animate-spin" />
        <p className="text-muted-foreground text-sm font-medium">Loading workspace dashboard...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] border border-border/50 rounded-2xl bg-card p-8 text-center max-w-md mx-auto my-12">
        <AlertCircle className="w-12 h-12 text-destructive mb-4" />
        <h3 className="text-lg font-bold mb-2">Failed to load workspace</h3>
        <p className="text-muted-foreground text-sm mb-6">
          {getApiErrorMessage(error, 'Could not fetch your role-specific dashboard metrics.')}
        </p>
      </div>
    )
  }

  const { role, viewer, user_workspace, teamlead_workspace, manager_workspace } = data

  // Helper date formatter
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  // 1. Stats Display Logic
  const getStats = () => {
    if (role === 'user' && user_workspace) return user_workspace.stats
    if (role === 'teamlead' && teamlead_workspace) return teamlead_workspace.stats
    if (role === 'manager' && manager_workspace) return manager_workspace.stats
    return { today_assigned: 0, yesterday_assigned: 0, delayed_count: 0, completed_count: 0, kra_meet_rate: 100 }
  }
  const stats = getStats()

  // 2. Render KRA Circular Progress
  const renderKraProgress = (rate: number) => {
    const strokeDashoffset = 125.6 - (125.6 * rate) / 100
    const colorClass = rate >= 90 ? 'stroke-emerald-500' : rate >= 80 ? 'stroke-amber-500' : 'stroke-rose-500'
    return (
      <div className="flex items-center gap-4 bg-background/50 border border-border/40 rounded-xl px-4 py-3">
        <div className="relative w-12 h-12 flex-shrink-0">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 50 50">
            <circle className="stroke-muted/20 fill-none" cx="25" cy="25" r="20" strokeWidth="5" />
            <circle
              className={`${colorClass} fill-none stroke-linecap-round transition-all duration-500`}
              cx="25"
              cy="25"
              r="20"
              strokeWidth="5"
              strokeDasharray="125.6"
              strokeDashoffset={strokeDashoffset}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">
            {Math.round(rate)}%
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">KRA Compliance</div>
          <div className={`text-sm font-extrabold ${rate >= 90 ? 'text-emerald-500' : rate >= 80 ? 'text-amber-500' : 'text-rose-500'}`}>
            {rate >= 90 ? 'On-Track' : rate >= 80 ? 'Warning' : 'Needs Review'}
          </div>
        </div>
      </div>
    )
  }

  // 3. Assignment Mutation Actions
  const handleReassignSingle = async (project: string, chapters: string, stage_name: string, assigneeName: string) => {
    setIsAssigning(true)
    try {
      await api.post(`/api/v1/stage-details/project/${project}/chapter/${chapters}/stage/${stage_name}/assign`, {
        assignee_name: assigneeName || null
      })
      showToast(`Successfully reassigned ${chapters} to ${assigneeName || 'Unassigned'}`)
      refetch()
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to reassign chapter'), 'error')
    } finally {
      setIsAssigning(false)
    }
  }

  const handleReassignBulk = async (assigneeName: string) => {
    if (selectedAssignments.length === 0) return
    setIsAssigning(true)
    try {
      await api.post(`/api/v1/stage-details/bulk-assign`, {
        assignee_name: assigneeName || null,
        targets: selectedAssignments
      })
      showToast(`Successfully assigned ${selectedAssignments.length} chapters to ${assigneeName || 'Unassigned'}`)
      setSelectedAssignments([])
      refetch()
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to bulk assign chapters'), 'error')
    } finally {
      setIsAssigning(false)
    }
  }

  // 4. Flattening Active Chapter Queues for sub-tabs
  const getTLAssignments = () => {
    if (!teamlead_workspace) return []
    return teamlead_workspace.members.flatMap(member =>
      member.assignments.map(item => ({
        ...item,
        current_assignee: member.username
      }))
    )
  }

  const getMgrAssignments = () => {
    if (!manager_workspace) return []
    return manager_workspace.members.flatMap(member =>
      member.assignments.map(item => ({
        ...item,
        current_assignee: member.username
      }))
    )
  }

  const handleSelectCheckbox = (checked: boolean, target: AssignmentTarget) => {
    if (checked) {
      setSelectedAssignments(prev => [...prev, target])
    } else {
      setSelectedAssignments(prev => prev.filter(item =>
        !(item.project === target.project && item.chapters === target.chapters && item.stage_name === target.stage_name)
      ))
    }
  }

  const handleSelectAll = (checked: boolean, list: AssignmentTarget[]) => {
    if (checked) {
      setSelectedAssignments(list)
    } else {
      setSelectedAssignments([])
    }
  }

  // Get active users (excluding "Unassigned" virtual row) to populate assignee options
  const getTLUserOptions = () => {
    if (!teamlead_workspace) return []
    return teamlead_workspace.members.filter(m => m.username !== 'Unassigned')
  }

  const getMgrUserOptions = () => {
    if (!manager_workspace) return []
    return manager_workspace.members.filter(m => m.username !== 'Unassigned')
  }

  return (
    <div className="space-y-6 pb-20 relative">
      {/* Toast popup */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg animate-in slide-in-from-top-4 duration-300 ${
          toast.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' 
            : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
        }`}>
          {toast.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          <span className="text-xs font-bold">{toast.message}</span>
        </div>
      )}

      {/* Hero Header */}
      <div className="relative rounded-2xl overflow-hidden bg-sidebar p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-6 shadow-sm border border-white/5">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(900px 300px at 85% -20%, rgba(224,72,62,0.15), transparent 60%)' }}
        />
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 px-3 py-1 rounded-full text-xs font-bold text-primary tracking-wider uppercase">
            <Briefcase size={12} />
            My Workspace ({role})
          </div>
          <h1 className="text-2xl md:text-3xl font-serif font-medium text-[#FBF9F4] tracking-tight">
            Welcome back, {viewer.username}.
          </h1>
          <p className="text-white/60 text-sm">
            {role === 'user' && 'Manage your active stages, track assignments, and view KRA compliance.'}
            {role === 'teamlead' && 'Monitor team workloads, assign tasks, and track KRA compliance stats.'}
            {role === 'manager' && 'Consolidated pipeline overview across editorial divisions, stages, and members.'}
          </p>
        </div>
        <div className="relative z-10 flex-shrink-0">
          {renderKraProgress(stats.kra_meet_rate)}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border/80 rounded-xl p-4 flex flex-col gap-1 shadow-subtle hover:border-border transition-all">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Calendar size={12} className="text-blue-500" />
            Today Assigned
          </div>
          <div className="text-2xl font-extrabold text-foreground mt-1">{stats.today_assigned}</div>
          <p className="text-[10px] text-muted-foreground mt-1">Files assigned since midnight</p>
        </div>

        <div className="bg-card border border-border/80 rounded-xl p-4 flex flex-col gap-1 shadow-subtle hover:border-border transition-all">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock size={12} className="text-purple-500" />
            Yesterday Assigned
          </div>
          <div className="text-2xl font-extrabold text-foreground mt-1">{stats.yesterday_assigned}</div>
          <p className="text-[10px] text-muted-foreground mt-1">Previous business day queue</p>
        </div>

        <div className="bg-card border border-border/80 rounded-xl p-4 flex flex-col gap-1 shadow-subtle hover:border-border transition-all">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <AlertCircle size={12} className="text-rose-500" />
            Delayed Files
          </div>
          <div className={`text-2xl font-extrabold mt-1 ${stats.delayed_count > 0 ? 'text-rose-500' : 'text-foreground'}`}>
            {stats.delayed_count}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">SLA target exceeded</p>
        </div>

        <div className="bg-card border border-border/80 rounded-xl p-4 flex flex-col gap-1 shadow-subtle hover:border-border transition-all">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle size={12} className="text-emerald-500" />
            Completed
          </div>
          <div className="text-2xl font-extrabold text-foreground mt-1">{stats.completed_count}</div>
          <p className="text-[10px] text-muted-foreground mt-1">Closed successfully this cycle</p>
        </div>
      </div>

      {/* Dynamic View Sections */}

      {/* ── USER VIEW ──────────────────────────────────────────────────────── */}
      {role === 'user' && user_workspace && (
        <div className="bg-card border border-border/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/50 pb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Layers size={18} className="text-primary" />
              Active Workspace Queue
            </h2>
            <div className="flex gap-2">
              {['All', 'Pre-editing', 'Proofreading', 'Copyediting'].map((stage) => (
                <button
                  key={stage}
                  onClick={() => setFilterStage(stage)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    filterStage === stage
                      ? 'bg-primary text-sidebar border-primary'
                      : 'bg-background hover:bg-muted/30 border-border/80'
                  }`}
                >
                  {stage}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {user_workspace.assignments
              .filter(item => filterStage === 'All' || item.stage_name === filterStage)
              .map(item => (
                <div
                  key={item.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between border rounded-xl p-4 gap-4 transition-all hover:bg-muted/10 ${
                    item.delayed ? 'border-rose-500/30 bg-rose-500/5' : 'border-border/60'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground">{item.chapters}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs bg-muted border border-border rounded px-1.5 py-0.5 font-bold uppercase tracking-wide">
                        {item.stage_name}
                      </span>
                      {item.delayed && (
                        <span className="text-[10px] bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded px-1.5 py-0.5 font-bold uppercase tracking-wider animate-pulse">
                          Overdue ({item.delay_days}d)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>Project: <b>{item.project}</b></span>
                      <span>•</span>
                      <span>Client: <b>{item.client}</b></span>
                      <span>•</span>
                      <span>Assigned: <b>{formatDate(item.actual_start_date)}</b></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground font-semibold">Planned End Date</p>
                      <p className={`text-xs font-bold ${item.delayed ? 'text-rose-500' : 'text-foreground'}`}>
                        {formatDate(item.planned_end_date)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

            {user_workspace.assignments.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No active files in your workspace queue.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TEAM LEAD VIEW ─────────────────────────────────────────────────── */}
      {role === 'teamlead' && teamlead_workspace && (
        <div className="bg-card border border-border/80 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/50 pb-4">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-bold flex items-center gap-2 pr-4 border-r border-border/60">
                <Users size={18} className="text-primary" />
                Team Queue Management
              </h2>
              <div className="flex bg-muted/40 p-0.5 rounded-lg border border-border/60">
                <button
                  onClick={() => { setTlActiveTab('members'); setSelectedAssignments([]) }}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                    tlActiveTab === 'members' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Team Members
                </button>
                <button
                  onClick={() => { setTlActiveTab('chapters'); setSelectedAssignments([]) }}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                    tlActiveTab === 'chapters' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Projects & Chapters Queue
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 max-w-md w-full">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={tlActiveTab === 'members' ? 'Search team member...' : 'Search chapters/project...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs border border-border/80 rounded-lg bg-background focus:outline-none focus:border-primary transition-all"
                />
              </div>
              {tlActiveTab === 'chapters' && (
                <button
                  type="button"
                  onClick={() => handleExportExcel(applyExcelFilters(getTLAssignments()))}
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-all shrink-0 cursor-pointer"
                >
                  <Download size={10} />
                  Export
                </button>
              )}
              {tlActiveTab === 'chapters' && isAnyExcelFilterActive && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClients([])
                    setSelectedPMs([])
                    setSelectedProjects([])
                    setSelectedStages([])
                    setSelectedStatuses([])
                    setSelectedAssignees([])
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 transition-all shrink-0"
                >
                  <X size={10} />
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Tab 1: Members Table */}
          {tlActiveTab === 'members' && (
            <div className="border border-border/60 rounded-xl overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border/60">
                    <th className="p-3 font-bold text-muted-foreground uppercase">Member Name</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">Role</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">Today</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">Yesterday</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase text-rose-500">Delayed</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">Completed</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">KRA Rate</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {teamlead_workspace.members
                    .filter(m => m.username.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map(member => {
                      const isExpanded = expandedMember === member.username
                      const kraColor = member.stats.kra_meet_rate >= 90 ? 'text-emerald-500' : member.stats.kra_meet_rate >= 80 ? 'text-amber-500' : 'text-rose-500'
                      return (
                        <>
                          <tr
                            key={member.username}
                            className="hover:bg-muted/10 cursor-pointer border-b border-border/40 transition-all"
                            onClick={() => setExpandedMember(isExpanded ? null : member.username)}
                          >
                            <td className="p-3 font-bold text-foreground flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${member.username === 'Unassigned' ? 'bg-amber-500/50' : 'bg-primary/50'}`} />
                              {member.username}
                            </td>
                            <td className="p-3 text-muted-foreground">{member.username === 'Unassigned' ? '-' : member.role}</td>
                            <td className="p-3 font-semibold">{member.stats.today_assigned}</td>
                            <td className="p-3 font-semibold">{member.stats.yesterday_assigned}</td>
                            <td className={`p-3 font-bold ${member.stats.delayed_count > 0 ? 'text-rose-500' : ''}`}>
                              {member.stats.delayed_count}
                            </td>
                            <td className="p-3 font-semibold">{member.stats.completed_count}</td>
                            <td className={`p-3 font-extrabold ${kraColor}`}>{member.stats.kra_meet_rate}%</td>
                            <td className="p-3 text-right">
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-muted/10">
                              <td colSpan={8} className="p-4 border-b border-border/40">
                                <div className="space-y-2">
                                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                                    Current Assignments:
                                  </div>
                                  <div className="grid gap-2">
                                    {member.assignments.map(assign => (
                                      <div
                                        key={assign.id}
                                        className={`flex items-center justify-between border rounded-lg p-3 text-xs bg-card ${
                                          assign.delayed ? 'border-rose-500/30' : 'border-border/60'
                                        }`}
                                      >
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-2">
                                            <p className="font-bold text-foreground">{assign.chapters} ({assign.project})</p>
                                            <span className="text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                              {assign.stage_name}
                                            </span>
                                          </div>
                                          <p className="text-[10px] text-muted-foreground">
                                            Assigned: {formatDate(assign.actual_start_date)}
                                          </p>
                                        </div>
                                        <div className="flex items-center gap-4">
                                          <select
                                            disabled={isAssigning}
                                            value={member.username === 'Unassigned' ? '' : member.username}
                                            onChange={(e) => handleReassignSingle(assign.project, assign.chapters, assign.stage_name, e.target.value)}
                                            className="bg-background border border-border text-[11px] font-semibold rounded px-2 py-1 focus:outline-none focus:border-primary"
                                          >
                                            <option value="">-- Unassigned --</option>
                                            {getTLUserOptions().map(opt => (
                                              <option key={opt.username} value={opt.username}>{opt.username}</option>
                                            ))}
                                          </select>
                                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                            assign.delayed ? 'bg-rose-500/10 text-rose-500' : 'bg-blue-500/10 text-blue-500'
                                          }`}>
                                            {assign.delayed ? `Overdue (${assign.delay_days}d)` : 'On Schedule'}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                    {member.assignments.length === 0 && (
                                      <div className="text-center py-4 text-muted-foreground text-xs">
                                        No assignments active for this member.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: Project & Chapters Queue */}
          {tlActiveTab === 'chapters' && (
            <div className="border border-border/60 rounded-xl overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border/60">
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-border focus:ring-primary accent-primary"
                        checked={selectedAssignments.length === applyExcelFilters(getTLAssignments()).length && applyExcelFilters(getTLAssignments()).length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked, applyExcelFilters(getTLAssignments()).map(a => ({ project: a.project, chapters: a.chapters, stage_name: a.stage_name })))}
                      />
                    </th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('client', 'Client', getTLAssignments())}</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('pm', 'PM', getTLAssignments())}</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('project', 'Project Code', getTLAssignments())}</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">Chapter Name</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">MSS Pages</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">CE Pages</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('stage', 'Stage Name', getTLAssignments())}</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">Start Date</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">End Date</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('status', 'SLA Status', getTLAssignments())}</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('assignee', 'Current Assignee', getTLAssignments())}</th>
                  </tr>
                </thead>
                <tbody>
                  {applyExcelFilters(getTLAssignments())
                    .map(assign => {
                      const isChecked = selectedAssignments.some(s => s.project === assign.project && s.chapters === assign.chapters && s.stage_name === assign.stage_name)
                      return (
                        <tr key={assign.id} className={`hover:bg-muted/10 border-b border-border/40 transition-all ${assign.delayed ? 'bg-rose-500/5' : ''}`}>
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-border focus:ring-primary accent-primary"
                              checked={isChecked}
                              onChange={(e) => handleSelectCheckbox(e.target.checked, { project: assign.project, chapters: assign.chapters, stage_name: assign.stage_name })}
                            />
                          </td>
                          <td className="p-3 text-muted-foreground font-semibold">{assign.client}</td>
                          <td className="p-3 text-muted-foreground font-semibold">{assign.project_manager_name || '-'}</td>
                          <td className="p-3 font-bold text-foreground">{assign.project}</td>
                          <td className="p-3 font-semibold text-foreground">{assign.chapters}</td>
                          <td className="p-3 text-foreground font-semibold">{assign.manuscript_pages || 0}</td>
                          <td className="p-3 text-foreground font-semibold">{assign.ce_pages || 0}</td>
                          <td className="p-3">
                            <span className="text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                              {assign.stage_name}
                            </span>
                          </td>
                          <td className="p-3 text-muted-foreground">{formatDate(assign.planned_start_date)}</td>
                          <td className="p-3 text-muted-foreground">{formatDate(assign.planned_end_date)}</td>
                          <td className="p-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              assign.delayed ? 'bg-rose-500/10 text-rose-500 animate-pulse' : 'bg-emerald-500/10 text-emerald-500'
                            }`}>
                              {assign.delayed ? `Delayed (${assign.delay_days}d)` : 'On Schedule'}
                            </span>
                          </td>
                          <td className="p-3">
                            <select
                              disabled={isAssigning}
                              value={assign.current_assignee === 'Unassigned' ? '' : assign.current_assignee}
                              onChange={(e) => handleReassignSingle(assign.project, assign.chapters, assign.stage_name, e.target.value)}
                              className="bg-background border border-border text-[11px] font-semibold rounded px-2 py-1 focus:outline-none focus:border-primary"
                            >
                              <option value="">-- Unassigned --</option>
                              {getTLUserOptions().map(opt => (
                                <option key={opt.username} value={opt.username}>{opt.username}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MANAGER VIEW ───────────────────────────────────────────────────── */}
      {role === 'manager' && manager_workspace && (
        <div className="space-y-6">
          {/* Stage breakdown grid */}
          <div className="space-y-2">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Layers size={18} className="text-primary" />
              Workflow Stage Breakdown
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {manager_workspace.stages.map(stage => (
                <div key={stage.stage_name} className="bg-card border border-border/80 rounded-xl p-4 shadow-subtle hover:border-border transition-all space-y-3">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <span className="font-bold text-sm text-foreground">{stage.stage_name}</span>
                    <span className="text-[10px] font-extrabold text-emerald-500 uppercase">{stage.kra_meet_rate}% KRA</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Active Workload</p>
                      <p className="font-bold text-foreground text-sm">{stage.active_count}</p>
                    </div>
                    <div>
                      <p className="text-rose-500 font-semibold">Delayed</p>
                      <p className={`font-bold text-sm ${stage.delayed_count > 0 ? 'text-rose-500' : 'text-foreground'}`}>
                        {stage.delayed_count}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Today Assigned</p>
                      <p className="font-bold text-foreground">{stage.today_assigned}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Yesterday</p>
                      <p className="font-bold text-foreground">{stage.yesterday_assigned}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Team Workloads Panel */}
          <div className="bg-card border border-border/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/50 pb-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-bold flex items-center gap-2 pr-4 border-r border-border/60">
                  <Users size={18} className="text-primary" />
                  Editorial Team Summary
                </h2>
                <div className="flex bg-muted/40 p-0.5 rounded-lg border border-border/60">
                  <button
                    onClick={() => { setMgrActiveTab('members'); setSelectedAssignments([]) }}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                      mgrActiveTab === 'members' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Editor Members
                  </button>
                  <button
                    onClick={() => { setMgrActiveTab('chapters'); setSelectedAssignments([]) }}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                      mgrActiveTab === 'chapters' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Project & Chapters Queue
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 max-w-md w-full">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={mgrActiveTab === 'members' ? 'Search editor member...' : 'Search chapters/project...'}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-xs border border-border/80 rounded-lg bg-background focus:outline-none focus:border-primary transition-all"
                  />
                </div>
                {mgrActiveTab === 'chapters' && (
                  <button
                    type="button"
                    onClick={() => handleExportExcel(applyExcelFilters(getMgrAssignments()))}
                    className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-all shrink-0 cursor-pointer"
                  >
                    <Download size={10} />
                    Export
                  </button>
                )}
                {mgrActiveTab === 'chapters' && isAnyExcelFilterActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedClients([])
                      setSelectedPMs([])
                      setSelectedProjects([])
                      setSelectedStages([])
                      setSelectedStatuses([])
                      setSelectedAssignees([])
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 transition-all shrink-0"
                  >
                    <X size={10} />
                    Clear Filters
                  </button>
                )}
              </div>
            </div>

            {/* Sub-View 1: Editor workloads list */}
            {mgrActiveTab === 'members' && (
              <div className="border border-border/60 rounded-xl overflow-hidden">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border/60">
                      <th className="p-3 font-bold text-muted-foreground uppercase">Member Name</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">Role</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">Today</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">Yesterday</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase text-rose-500">Delayed</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">Completed</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">KRA Rate</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manager_workspace.members
                      .filter(m => m.username.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map(member => {
                        const isExpanded = expandedMember === member.username
                        const kraColor = member.stats.kra_meet_rate >= 90 ? 'text-emerald-500' : member.stats.kra_meet_rate >= 80 ? 'text-amber-500' : 'text-rose-500'
                        return (
                          <>
                            <tr
                              key={member.username}
                              className="hover:bg-muted/10 cursor-pointer border-b border-border/40 transition-all"
                              onClick={() => setExpandedMember(isExpanded ? null : member.username)}
                            >
                              <td className="p-3 font-bold text-foreground flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full ${member.username === 'Unassigned' ? 'bg-amber-500/50' : 'bg-primary/50'}`} />
                                {member.username}
                              </td>
                              <td className="p-3 text-muted-foreground">{member.username === 'Unassigned' ? '-' : member.role}</td>
                              <td className="p-3 font-semibold">{member.stats.today_assigned}</td>
                              <td className="p-3 font-semibold">{member.stats.yesterday_assigned}</td>
                              <td className={`p-3 font-bold ${member.stats.delayed_count > 0 ? 'text-rose-500' : ''}`}>
                                {member.stats.delayed_count}
                              </td>
                              <td className="p-3 font-semibold">{member.stats.completed_count}</td>
                              <td className={`p-3 font-extrabold ${kraColor}`}>{member.stats.kra_meet_rate}%</td>
                              <td className="p-3 text-right">
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-muted/10">
                                <td colSpan={8} className="p-4 border-b border-border/40">
                                  <div className="space-y-2">
                                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                                      Current Assignments:
                                    </div>
                                    <div className="grid gap-2">
                                      {member.assignments.map(assign => (
                                        <div
                                          key={assign.id}
                                          className={`flex items-center justify-between border rounded-lg p-3 text-xs bg-card ${
                                            assign.delayed ? 'border-rose-500/30' : 'border-border/60'
                                          }`}
                                        >
                                          <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                              <p className="font-bold text-foreground">{assign.chapters} ({assign.project})</p>
                                              <span className="text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                                {assign.stage_name}
                                              </span>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground">
                                              Assigned: {formatDate(assign.actual_start_date)}
                                            </p>
                                          </div>
                                          <div className="flex items-center gap-4">
                                            <select
                                              disabled={isAssigning}
                                              value={member.username === 'Unassigned' ? '' : member.username}
                                              onChange={(e) => handleReassignSingle(assign.project, assign.chapters, assign.stage_name, e.target.value)}
                                              className="bg-background border border-border text-[11px] font-semibold rounded px-2 py-1 focus:outline-none focus:border-primary"
                                            >
                                              <option value="">-- Unassigned --</option>
                                              {getMgrUserOptions().map(opt => (
                                                <option key={opt.username} value={opt.username}>{opt.username}</option>
                                              ))}
                                            </select>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                              assign.delayed ? 'bg-rose-500/10 text-rose-500' : 'bg-blue-500/10 text-blue-500'
                                            }`}>
                                              {assign.delayed ? `Overdue (${assign.delay_days}d)` : 'On Schedule'}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                      {member.assignments.length === 0 && (
                                        <div className="text-center py-4 text-muted-foreground text-xs">
                                          No assignments active for this member.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-View 2: Unified Queue for Manager */}
            {mgrActiveTab === 'chapters' && (
              <div className="border border-border/60 rounded-xl overflow-hidden">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border/60">
                      <th className="p-3 w-10 text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-border focus:ring-primary accent-primary"
                          checked={selectedAssignments.length === applyExcelFilters(getMgrAssignments()).length && applyExcelFilters(getMgrAssignments()).length > 0}
                          onChange={(e) => handleSelectAll(e.target.checked, applyExcelFilters(getMgrAssignments()).map(a => ({ project: a.project, chapters: a.chapters, stage_name: a.stage_name })))}
                        />
                      </th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('client', 'Client', getMgrAssignments())}</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('pm', 'PM', getMgrAssignments())}</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('project', 'Project Code', getMgrAssignments())}</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">Chapter Name</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">MSS Pages</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">CE Pages</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('stage', 'Stage Name', getMgrAssignments())}</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">Start Date</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">End Date</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('status', 'SLA Status', getMgrAssignments())}</th>
                      <th className="p-3 font-bold text-muted-foreground uppercase">{renderColumnFilter('assignee', 'Current Assignee', getMgrAssignments())}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applyExcelFilters(getMgrAssignments())
                      .map(assign => {
                        const isChecked = selectedAssignments.some(s => s.project === assign.project && s.chapters === assign.chapters && s.stage_name === assign.stage_name)
                        return (
                          <tr key={assign.id} className={`hover:bg-muted/10 border-b border-border/40 transition-all ${assign.delayed ? 'bg-rose-500/5' : ''}`}>
                            <td className="p-3 text-center">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-border focus:ring-primary accent-primary"
                                checked={isChecked}
                                onChange={(e) => handleSelectCheckbox(e.target.checked, { project: assign.project, chapters: assign.chapters, stage_name: assign.stage_name })}
                              />
                            </td>
                            <td className="p-3 text-muted-foreground font-semibold">{assign.client}</td>
                            <td className="p-3 text-muted-foreground font-semibold">{assign.project_manager_name || '-'}</td>
                            <td className="p-3 font-bold text-foreground">{assign.project}</td>
                            <td className="p-3 font-semibold text-foreground">{assign.chapters}</td>
                            <td className="p-3 text-foreground font-semibold">{assign.manuscript_pages || 0}</td>
                            <td className="p-3 text-foreground font-semibold">{assign.ce_pages || 0}</td>
                            <td className="p-3">
                              <span className="text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                {assign.stage_name}
                              </span>
                            </td>
                            <td className="p-3 text-muted-foreground">{formatDate(assign.planned_start_date)}</td>
                            <td className="p-3 text-muted-foreground">{formatDate(assign.planned_end_date)}</td>
                            <td className="p-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                assign.delayed ? 'bg-rose-500/10 text-rose-500 animate-pulse' : 'bg-emerald-500/10 text-emerald-500'
                              }`}>
                                {assign.delayed ? `Delayed (${assign.delay_days}d)` : 'On Schedule'}
                              </span>
                            </td>
                            <td className="p-3">
                              <select
                                disabled={isAssigning}
                                value={assign.current_assignee === 'Unassigned' ? '' : assign.current_assignee}
                                onChange={(e) => handleReassignSingle(assign.project, assign.chapters, assign.stage_name, e.target.value)}
                                className="bg-background border border-border text-[11px] font-semibold rounded px-2 py-1 focus:outline-none focus:border-primary"
                              >
                                <option value="">-- Unassigned --</option>
                                {getMgrUserOptions().map(opt => (
                                  <option key={opt.username} value={opt.username}>{opt.username}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedAssignments.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center justify-between gap-6 px-6 py-4 rounded-2xl bg-sidebar/95 border border-white/10 backdrop-blur-md shadow-2xl animate-in slide-in-from-bottom-12 duration-300 w-full max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="bg-primary/20 text-primary border border-primary/30 px-2.5 py-1 rounded-full text-xs font-extrabold">
              {selectedAssignments.length}
            </span>
            <span className="text-white text-xs font-bold">chapters selected for assignment</span>
          </div>
          <div className="flex items-center gap-3">
            <select
              disabled={isAssigning}
              onChange={(e) => handleReassignBulk(e.target.value)}
              className="bg-card border border-border text-xs font-bold rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary"
            >
              <option value="">Assign selected to...</option>
              <option value="">-- Unassigned --</option>
              {role === 'teamlead' 
                ? getTLUserOptions().map(opt => <option key={opt.username} value={opt.username}>{opt.username}</option>)
                : getMgrUserOptions().map(opt => <option key={opt.username} value={opt.username}>{opt.username}</option>)
              }
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
