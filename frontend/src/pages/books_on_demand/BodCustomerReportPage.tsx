import React, { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Loader2, Search, Calendar, FileText, CheckCircle2, Clock, Download, Layers, RefreshCw, BarChart2, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, X, Filter, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '@/api/client'
import { toast } from '@/store/useToastStore'
import * as XLSX from 'xlsx'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { formatDateTime as fmtUtcDateTime } from '@/utils/dateUtils'

export function BodCustomerReportPage() {
  const navigate = useNavigate()
  const [report, setReport] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingFastrackId, setTogglingFastrackId] = useState<number | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  type QuickFilter = 'all' | 'total_all' | 'total_intake' | 'total_backlog' | 'yts' | 'yts_fresh' | 'yts_other' | 'in_progress' | 'completed' | 'completed_ahead' | 'completed_ontime' | 'completed_delay' | 'overdue'
  const [cardFilter, setCardFilter] = useState<QuickFilter>('all')

  // Date Filter states (identical to internal page)
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'yesterday' | 'tomorrow' | 'day_3' | 'day_4' | 'day_5' | 'week' | 'month' | 'custom'>('today')
  const [customFromDate, setCustomFromDate] = useState('')
  const [customToDate, setCustomToDate] = useState('')

  // Table heading filters & sorting
  const [colFilters, setColFilters] = useState({
    job: '',
    pages: '',
    type: 'all',
    language: 'all',
    created: '',
    dueDate: '',
    prodStatus: 'all',
    prodTiming: '',
    qcStatus: 'all',
    qcTiming: '',
    finalStatus: 'all',
    fastrack: 'all'
  })
  const [sortField, setSortField] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const handleSort = (field: string) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else {
        setSortField(null)
        setSortDirection('asc')
      }
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const renderSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ArrowUpDown size={11} className="opacity-35 group-hover:opacity-100 transition-opacity ml-1 shrink-0" />
    }
    return sortDirection === 'asc' ? (
      <ArrowUp size={11} className="text-primary font-bold ml-1 shrink-0" />
    ) : (
      <ArrowDown size={11} className="text-primary font-bold ml-1 shrink-0" />
    )
  }

  const resetColFilters = () => {
    setColFilters({
      job: '',
      pages: '',
      type: 'all',
      language: 'all',
      created: '',
      dueDate: '',
      prodStatus: 'all',
      prodTiming: '',
      qcStatus: 'all',
      qcTiming: '',
      finalStatus: 'all',
      fastrack: 'all'
    })
    setSortField(null)
    setSortDirection('asc')
  }

  const hasActiveColFilters = Object.values(colFilters).some(v => v !== '' && v !== 'all')

  useEffect(() => {
    fetchReport()
  }, [])

  const fetchReport = async () => {
    setLoading(true)
    try {
      // Fetch all customer report data and filter client-side for immediate responsive presets
      const { data } = await api.get(`/bod/report`)
      setReport(data.jobs || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const toggleFastrack = async (e: React.MouseEvent, jobId: number, currentVal: boolean) => {
    e.stopPropagation()
    const nextVal = !currentVal
    setTogglingFastrackId(jobId)
    try {
      await api.put(`/bod/jobs/${jobId}/fastrack`, { is_fastrack: nextVal })
      setReport(prev => prev.map(j => j.id === jobId ? { ...j, is_fastrack: nextVal } : j))
      toast.success(nextVal ? "Fastrack enabled" : "Fastrack disabled")
    } catch (err: any) {
      console.error(err)
      toast.error(err.response?.data?.detail || "Failed to update Fastrack status")
    } finally {
      setTogglingFastrackId(null)
    }
  }

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return fmtUtcDateTime(dateStr)
  }

  const parseSafeDate = (dateStr: string | null | undefined): Date | null => {
    if (!dateStr) return null
    if (/([+-]\d{2}:?\d{2}|Z)$/.test(dateStr)) {
      return new Date(dateStr)
    }
    return new Date(dateStr + 'Z')
  }

  const isJobCompleted = (job: any) => job.status === 'Completed' || job.current_stage === 'Archive'

  const getCompletedDate = (job: any): string | null => {
    const history = job.stage_history || {}
    if (history['Archive']?.end_time) return history['Archive'].end_time
    if (history['Archive']?.start_time) return history['Archive'].start_time
    if (history['Ready to Dispatch']?.end_time) return history['Ready to Dispatch'].end_time
    if (job.status === 'Completed' && job.updated_at) return job.updated_at
    return null
  }

  const getCompletionTiming = (completedAtStr: string | null, dueDateStr: string | null): 'Ahead' | 'On-time' | 'Delay' => {
    if (!dueDateStr || !completedAtStr) return 'On-time'

    const compDate = parseSafeDate(completedAtStr)
    const dueDate = parseSafeDate(dueDateStr)

    if (!compDate || !dueDate || isNaN(compDate.getTime()) || isNaN(dueDate.getTime())) return 'On-time'

    const compDay = compDate.toISOString().slice(0, 10)
    const dueDay = dueDate.toISOString().slice(0, 10)

    if (compDay < dueDay) {
      return 'Ahead'
    } else if (compDay === dueDay) {
      return 'On-time'
    } else {
      return 'Delay'
    }
  }

  const isOverdue = (dateStr: string | null | undefined, asOfDate?: Date) => {
    const dueDate = parseSafeDate(dateStr)
    if (!dueDate || isNaN(dueDate.getTime())) return false
    const ref = asOfDate ? new Date(asOfDate) : new Date()
    ref.setHours(0, 0, 0, 0)
    dueDate.setHours(0, 0, 0, 0)
    return dueDate < ref
  }

  const isDueTomorrow = (dateStr: string | null | undefined) => {
    const dueDate = parseSafeDate(dateStr)
    if (!dueDate || isNaN(dueDate.getTime())) return false
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    dueDate.setHours(0, 0, 0, 0)
    return dueDate.getTime() === tomorrow.getTime()
  }

  const isDateInPreset = (dateStr: string | null | undefined, preset: string): boolean => {
    if (!dateStr) return false
    const d = parseSafeDate(dateStr)
    if (!d || isNaN(d.getTime())) return false
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    const startOfAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0, 0)
    const startOfDay4 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 0, 0, 0, 0)
    const startOfDay5 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4, 0, 0, 0, 0)
    const startOfDay6 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 0, 0, 0, 0)
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0)

    if (preset === 'today') return d >= startOfToday && d < startOfTomorrow
    if (preset === 'yesterday') return d >= startOfYesterday && d < startOfToday
    if (preset === 'tomorrow') return d >= startOfTomorrow && d < startOfAfterTomorrow
    if (preset === 'day_3') return d >= startOfAfterTomorrow && d < startOfDay4
    if (preset === 'day_4') return d >= startOfDay4 && d < startOfDay5
    if (preset === 'day_5') return d >= startOfDay5 && d < startOfDay6
    if (preset === 'week') return d >= startOfWeek && d < startOfTomorrow
    if (preset === 'month') return d >= startOfMonth && d < startOfTomorrow
    if (preset === 'custom') {
      if (customFromDate) {
        const from = new Date(`${customFromDate}T00:00:00`)
        if (d < from) return false
      }
      if (customToDate) {
        const to = new Date(`${customToDate}T23:59:59.999`)
        if (d > to) return false
      }
      return true
    }
    return true
  }

  const matchesDateFilter = (job: any): boolean => {
    if (datePreset === 'all' && !customFromDate && !customToDate) return true

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    const startOfAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0, 0)
    const startOfDay4 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 0, 0, 0, 0)
    const startOfDay5 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4, 0, 0, 0, 0)
    const startOfDay6 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 0, 0, 0, 0)
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0, 0)

    const dateMatchesPreset = (dateStr: string | null | undefined): boolean => {
      if (!dateStr) return false
      const d = parseSafeDate(dateStr)
      if (!d || isNaN(d.getTime())) return false

      if (datePreset === 'today') return d >= startOfToday && d < startOfTomorrow
      if (datePreset === 'yesterday') return d >= startOfYesterday && d < startOfToday
      if (datePreset === 'tomorrow') return d >= startOfTomorrow && d < startOfAfterTomorrow
      if (datePreset === 'day_3') return d >= startOfAfterTomorrow && d < startOfDay4
      if (datePreset === 'day_4') return d >= startOfDay4 && d < startOfDay5
      if (datePreset === 'day_5') return d >= startOfDay5 && d < startOfDay6
      if (datePreset === 'week') return d >= startOfWeek && d < startOfTomorrow
      if (datePreset === 'month') return d >= startOfMonth && d < startOfTomorrow
      if (datePreset === 'custom') {
        if (customFromDate) {
          const from = new Date(`${customFromDate}T00:00:00`)
          if (d < from) return false
        }
        if (customToDate) {
          const to = new Date(`${customToDate}T23:59:59.999`)
          if (d > to) return false
        }
        return true
      }
      return true
    }

    // Active pipeline jobs are part of the daily operational floor
    if (!isJobCompleted(job)) {
      return true
    }

    // For tomorrow and future days, no jobs completed in the future
    if (datePreset === 'tomorrow' || datePreset === 'day_3' || datePreset === 'day_4' || datePreset === 'day_5') {
      return false
    }

    // Completed jobs are included only if completed or created within the selected date window
    const compDateStr = getCompletedDate(job)
    return dateMatchesPreset(compDateStr) || dateMatchesPreset(job.created_at)
  }

  const isDateFilterActive = datePreset !== 'all' || Boolean(customFromDate || customToDate)

  const getOverdueDateRef = (): Date | null => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    if (datePreset === 'tomorrow' || datePreset === 'day_3' || datePreset === 'day_4' || datePreset === 'day_5') {
      return null
    }
    if (datePreset === 'today' || datePreset === 'all') {
      return now
    }
    if (datePreset === 'yesterday') {
      const yest = new Date(now)
      yest.setDate(yest.getDate() - 1)
      return yest
    }
    if (datePreset === 'custom' && customFromDate) {
      const from = new Date(`${customFromDate}T00:00:00`)
      if (!isNaN(from.getTime())) return from
    }
    if (datePreset === 'month') {
      const m = new Date(now)
      m.setDate(m.getDate() - 30)
      return m
    }
    return now
  }
  const overdueRefDate = getOverdueDateRef()

  const getJobStatuses = (job: any) => {
    const history = job.stage_history || {}
    let finalStatus = 'YTS'
    let completionTiming: 'Ahead' | 'On-time' | 'Delay' | null = null

    if (isJobCompleted(job)) {
      completionTiming = getCompletionTiming(getCompletedDate(job), job.due_date)
      finalStatus = completionTiming
    } else {
      if (overdueRefDate && isOverdue(job.due_date, overdueRefDate)) {
        finalStatus = 'Overdue'
      } else if (job.current_stage === 'Add job') {
        finalStatus = 'YTS'
      } else if (job.current_stage === 'Production' || job.current_stage === 'QC' || job.current_stage === 'Ready to Dispatch') {
        finalStatus = 'In-progress'
      }
    }

    const prodData = history['Production'] || {}
    let prodStatus = 'YTS'
    if (prodData.start_time) prodStatus = prodData.end_time ? 'Completed' : 'In-progress'

    const qcData = history['QC'] || {}
    let qcStatus = 'YTS'
    if (qcData.start_time) qcStatus = qcData.end_time ? 'Completed' : 'In-progress'

    return { finalStatus, prodStatus, qcStatus, prodData, qcData, completionTiming }
  }

  // Base jobs filtered by Search and Date Filter
  const baseJobs = report.filter(job => {
    const textMatch = !search.trim() ||
      job.pdf_filename.toLowerCase().includes(search.toLowerCase().trim()) ||
      (job.client_name && job.client_name.toLowerCase().includes(search.toLowerCase().trim()))

    return textMatch && matchesDateFilter(job)
  })

  // Quick Card Filtering
  const filteredReport = baseJobs.filter(job => {
    if (cardFilter === 'all' || cardFilter === 'total_all') return true

    const completed = isJobCompleted(job)
    const { finalStatus } = getJobStatuses(job)

    if (cardFilter === 'total_intake') {
      return isDateInPreset(job.created_at, datePreset === 'all' ? 'today' : datePreset)
    }
    if (cardFilter === 'total_backlog') {
      return !isDateInPreset(job.created_at, datePreset === 'all' ? 'today' : datePreset)
    }
    if (cardFilter === 'yts') {
      return !completed && job.current_stage === 'Add job'
    }
    if (cardFilter === 'in_progress') {
      return !completed && (job.current_stage === 'Add job' || job.current_stage === 'Production' || job.current_stage === 'QC' || job.current_stage === 'Ready to Dispatch')
    }
    if (cardFilter === 'overdue') {
      return !completed && Boolean(overdueRefDate && isOverdue(job.due_date, overdueRefDate))
    }
    if (cardFilter === 'completed') {
      return completed
    }
    if (cardFilter === 'completed_ahead') {
      return completed && finalStatus === 'Ahead'
    }
    if (cardFilter === 'completed_ontime') {
      return completed && finalStatus === 'On-time'
    }
    if (cardFilter === 'completed_delay') {
      return completed && finalStatus === 'Delay'
    }
    return true
  })

  // Metrics counts computed dynamically from baseJobs
  const totalJobs = baseJobs.length
  const totalIntakeJobs = baseJobs.filter(j => isDateInPreset(j.created_at, datePreset === 'all' ? 'today' : datePreset)).length
  const totalBacklogJobs = baseJobs.filter(j => !isDateInPreset(j.created_at, datePreset === 'all' ? 'today' : datePreset)).length

  // YTS: Add job stage
  const ytsJobs = baseJobs.filter(j => !isJobCompleted(j) && j.current_stage === 'Add job').length

  // In-Progress: Add job, Production, QC, Ready to Dispatch
  const inProgressJobs = baseJobs.filter(j => !isJobCompleted(j) && (j.current_stage === 'Add job' || j.current_stage === 'Production' || j.current_stage === 'QC' || j.current_stage === 'Ready to Dispatch')).length

  // Overdue
  const overdueJobs = baseJobs.filter(j => !isJobCompleted(j) && Boolean(overdueRefDate && isOverdue(j.due_date, overdueRefDate))).length

  // Completed metrics
  const completedJobs = baseJobs.filter(isJobCompleted).length
  const completedAhead = baseJobs.filter(j => isJobCompleted(j) && getCompletionTiming(getCompletedDate(j), j.due_date) === 'Ahead').length
  const completedOnTime = baseJobs.filter(j => isJobCompleted(j) && getCompletionTiming(getCompletedDate(j), j.due_date) === 'On-time').length
  const completedDelay = baseJobs.filter(j => isJobCompleted(j) && getCompletionTiming(getCompletedDate(j), j.due_date) === 'Delay').length
  const completionPercentage = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0


  const chartDataMap = new Map<string, { date: string, inflow: number, due: number, completed: number, delay: number }>()

  const getDateKey = (dateStr: string | null) => {
    if (!dateStr) return null
    const hasTz = dateStr.endsWith('Z') || dateStr.includes('+') || !!dateStr.match(/-\d{2}:\d{2}$/)
    const validStr = hasTz ? dateStr : `${dateStr}Z`
    const d = new Date(validStr)
    if (isNaN(d.getTime())) return null
    return d.toISOString().split('T')[0]
  }

  filteredReport.forEach(job => {
    const createdDate = getDateKey(job.created_at)
    const dueDate = getDateKey(job.due_date)
    const completedDate = (job.status === 'Completed' || job.current_stage === 'Archive') ? getDateKey(getCompletedDate(job)) : null

    if (createdDate) {
      if (!chartDataMap.has(createdDate)) chartDataMap.set(createdDate, { date: createdDate, inflow: 0, due: 0, completed: 0, delay: 0 })
      chartDataMap.get(createdDate)!.inflow += 1
    }

    if (dueDate) {
      if (!chartDataMap.has(dueDate)) chartDataMap.set(dueDate, { date: dueDate, inflow: 0, due: 0, completed: 0, delay: 0 })
      chartDataMap.get(dueDate)!.due += 1

      let delayed = false
      if (job.status !== 'Completed' && job.current_stage !== 'Archive') {
        if (new Date(job.due_date) < new Date()) delayed = true
      } else {
        const comp = getCompletedDate(job)
        if (comp && getDateKey(comp)! > getDateKey(job.due_date)!) delayed = true
      }
      if (delayed) {
        chartDataMap.get(dueDate)!.delay += 1
      }
    }

    if (completedDate) {
      if (!chartDataMap.has(completedDate)) chartDataMap.set(completedDate, { date: completedDate, inflow: 0, due: 0, completed: 0, delay: 0 })
      chartDataMap.get(completedDate)!.completed += 1
    }
  })

  const chartData = Array.from(chartDataMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  const uniqueTypes = Array.from(
    new Set(report.map(j => (j.pdf_type || '').trim()).filter(Boolean))
  ).sort()

  const uniqueLanguages = Array.from(
    new Set(report.map(j => (j.pdf_language || '').trim()).filter(Boolean))
  ).sort()

  const tableJobs = filteredReport.filter(job => {
    const { finalStatus, prodStatus, qcStatus, prodData, qcData } = getJobStatuses(job)

    // 1. Job
    if (colFilters.job.trim()) {
      const q = colFilters.job.trim().toLowerCase()
      const match = (job.pdf_filename && job.pdf_filename.toLowerCase().includes(q)) ||
        (job.client_name && job.client_name.toLowerCase().includes(q)) ||
        (job.epub_filename && job.epub_filename.toLowerCase().includes(q))
      if (!match) return false
    }

    // 2. Pages
    if (colFilters.pages.trim()) {
      const q = colFilters.pages.trim()
      const pages = job.pdf_page_count ?? 0
      if (q.startsWith('>=')) {
        const n = parseInt(q.slice(2), 10)
        if (isNaN(n) || pages < n) return false
      } else if (q.startsWith('>')) {
        const n = parseInt(q.slice(1), 10)
        if (isNaN(n) || pages <= n) return false
      } else if (q.startsWith('<=')) {
        const n = parseInt(q.slice(2), 10)
        if (isNaN(n) || pages > n) return false
      } else if (q.startsWith('<')) {
        const n = parseInt(q.slice(1), 10)
        if (isNaN(n) || pages >= n) return false
      } else {
        if (!String(job.pdf_page_count ?? '').includes(q)) return false
      }
    }

    // 3. Type
    if (colFilters.type !== 'all') {
      if ((job.pdf_type || '').toLowerCase() !== colFilters.type.toLowerCase()) return false
    }

    // 4. Language
    if (colFilters.language !== 'all') {
      if ((job.pdf_language || '').toLowerCase() !== colFilters.language.toLowerCase()) return false
    }

    // 5. Created At
    if (colFilters.created) {
      if (getDateKey(job.created_at) !== colFilters.created) return false
    }

    // 6. Due Date
    if (colFilters.dueDate) {
      if (getDateKey(job.due_date) !== colFilters.dueDate) return false
    }

    // 7. Production Status
    if (colFilters.prodStatus !== 'all') {
      if (prodStatus !== colFilters.prodStatus) return false
    }

    // 8. Production Timing
    if (colFilters.prodTiming.trim()) {
      const q = colFilters.prodTiming.trim().toLowerCase()
      const s = prodData.start_time ? formatDateTime(prodData.start_time).toLowerCase() : ''
      const e = prodData.end_time ? formatDateTime(prodData.end_time).toLowerCase() : ''
      if (!s.includes(q) && !e.includes(q)) return false
    }

    // 9. QC Status
    if (colFilters.qcStatus !== 'all') {
      if (qcStatus !== colFilters.qcStatus) return false
    }

    // 10. QC Timing
    if (colFilters.qcTiming.trim()) {
      const q = colFilters.qcTiming.trim().toLowerCase()
      const s = qcData.start_time ? formatDateTime(qcData.start_time).toLowerCase() : ''
      const e = qcData.end_time ? formatDateTime(qcData.end_time).toLowerCase() : ''
      if (!s.includes(q) && !e.includes(q)) return false
    }

    // 11. Final Status
    if (colFilters.finalStatus !== 'all') {
      if (colFilters.finalStatus === 'Completed') {
        if (!['Ahead', 'On-time', 'Delay', 'Completed'].includes(finalStatus)) return false
      } else if (finalStatus !== colFilters.finalStatus) {
        return false
      }
    }

    // 12. Fastrack
    if (colFilters.fastrack !== 'all') {
      const isFast = Boolean(job.is_fastrack)
      if (colFilters.fastrack === 'fastrack' && !isFast) return false
      if (colFilters.fastrack === 'normal' && isFast) return false
    }

    return true
  }).sort((a, b) => {
    if (!sortField) return 0
    const { finalStatus: finalA, prodStatus: prodA, qcStatus: qcA, prodData: pDataA, qcData: qDataA } = getJobStatuses(a)
    const { finalStatus: finalB, prodStatus: prodB, qcStatus: qcB, prodData: pDataB, qcData: qDataB } = getJobStatuses(b)

    let valA: any = ''
    let valB: any = ''

    if (sortField === 'job') {
      valA = (a.pdf_filename || '').toLowerCase()
      valB = (b.pdf_filename || '').toLowerCase()
    } else if (sortField === 'pages') {
      valA = a.pdf_page_count || 0
      valB = b.pdf_page_count || 0
    } else if (sortField === 'type') {
      valA = (a.pdf_type || '').toLowerCase()
      valB = (b.pdf_type || '').toLowerCase()
    } else if (sortField === 'language') {
      valA = (a.pdf_language || '').toLowerCase()
      valB = (b.pdf_language || '').toLowerCase()
    } else if (sortField === 'created') {
      valA = a.created_at ? new Date(a.created_at).getTime() : 0
      valB = b.created_at ? new Date(b.created_at).getTime() : 0
    } else if (sortField === 'dueDate') {
      valA = a.due_date ? new Date(a.due_date).getTime() : 0
      valB = b.due_date ? new Date(b.due_date).getTime() : 0
    } else if (sortField === 'fastrack') {
      valA = a.is_fastrack ? 1 : 0
      valB = b.is_fastrack ? 1 : 0
    } else if (sortField === 'prodStatus') {
      valA = prodA
      valB = prodB
    } else if (sortField === 'prodTiming') {
      valA = pDataA.start_time ? new Date(pDataA.start_time).getTime() : 0
      valB = pDataB.start_time ? new Date(pDataB.start_time).getTime() : 0
    } else if (sortField === 'qcStatus') {
      valA = qcA
      valB = qcB
    } else if (sortField === 'qcTiming') {
      valA = qDataA.start_time ? new Date(qDataA.start_time).getTime() : 0
      valB = qDataB.start_time ? new Date(qDataB.start_time).getTime() : 0
    } else if (sortField === 'finalStatus') {
      valA = finalA
      valB = finalB
    }

    if (valA < valB) return sortDirection === 'asc' ? -1 : 1
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  const downloadReport = () => {
    const headers = [
      'Client',
      'Source PDF',
      'Fastrack',
      'PDF Type',
      'PDF Language',
      'PDF Page Count',
      'Target EPUB',
      'Job Created Date',
      'Due Date',
      'Production Status',
      'Production Start Time',
      'Production End Time',
      'QC Status',
      'QC Start Time',
      'QC End Time',
      'Final Status'
    ]
    const data = [headers]
    const dataToExport = tableJobs.length > 0 ? tableJobs : filteredReport

    dataToExport.forEach(job => {
      const { finalStatus, prodStatus, qcStatus, prodData, qcData } = getJobStatuses(job)

      const prodStart = prodData.start_time ? formatDateTime(prodData.start_time) : '-'
      const prodEnd = prodData.end_time ? formatDateTime(prodData.end_time) : '-'

      const qcStart = qcData.start_time ? formatDateTime(qcData.start_time) : '-'
      const qcEnd = qcData.end_time ? formatDateTime(qcData.end_time) : '-'

      data.push([
        job.client_name || '',
        job.pdf_filename || '',
        job.is_fastrack ? 'Yes' : 'No',
        job.pdf_type || '-',
        job.pdf_language || '-',
        job.pdf_page_count || '-',
        job.epub_filename || '',
        formatDateTime(job.created_at),
        job.due_date ? formatDateTime(job.due_date) : '-',
        prodStatus,
        prodStart,
        prodEnd,
        qcStatus,
        qcStart,
        qcEnd,
        finalStatus
      ])
    })

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, "Report")

    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    let filename = `report_${datePreset}_${todayStr}.xlsx`

    if (datePreset === 'custom') {
      const start = customFromDate || 'beginning'
      const end = customToDate || todayStr
      filename = `report_${start}_to_${end}.xlsx`
    }

    XLSX.writeFile(wb, filename)
  }

  const handleDownloadEpub = async (e: React.MouseEvent, jobId: number, filename: string) => {
    e.stopPropagation()
    try {
      const response = await api.get(`/bod/jobs/${jobId}/download-epub`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
    } catch (err) {
      console.error('Failed to download EPUB:', err)
      alert('Failed to download EPUB file.')
    }
  }

  return (
    <div className="min-h-screen bg-background/50 p-6">
      <div className="w-full space-y-5">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-xl">
              <BarChart2 className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold font-serif text-text tracking-tight">
                Books on Demand process Report
              </h1>
              <p className="text-muted text-sm mt-1">Real-time status and historical timeline of all books.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/bod/internal')}
              className="flex items-center gap-2 px-4 py-2.5 bg-card border border-border hover:bg-muted/30 text-text font-medium rounded-lg transition-colors shadow-sm text-sm"
            >
              <Layers size={16} className="text-primary" /> BOD Job Pages
            </button>
            <button onClick={downloadReport} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm">
              <Download size={16} /> Export Report
            </button>
          </div>
        </div>

        {/* Action Bar (Search + Date Presets like internal page) */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-card/60 border border-border/70 p-3 rounded-xl backdrop-blur-md shadow-xs">
          {/* Search */}
          <div className="relative flex-none w-full lg:w-[280px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-muted/70" />
            </div>
            <input
              type="text"
              placeholder="Search by Job name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 bg-background border-border border rounded-lg text-xs text-text placeholder:text-muted focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Date Presets Toolbar */}
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            {/* Fastrack Filter Pills */}
            <div className="flex items-center gap-1 bg-background/80 border border-border/80 rounded-lg p-1">
              <div className="flex items-center gap-1 px-1.5 text-muted">
                <Zap size={12} className="text-amber-500 fill-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 hidden sm:inline">Fastrack:</span>
              </div>
              {[
                { id: 'all', label: 'All' },
                { id: 'fastrack', label: 'Fastrack' },
                { id: 'normal', label: 'Normal' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setColFilters(prev => ({ ...prev, fastrack: f.id }))}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all border ${colFilters.fastrack === f.id
                    ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                    : 'bg-transparent border-transparent text-muted hover:text-text hover:bg-accent/50'
                    }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-background/80 border border-border/80 rounded-lg p-1">
              <div className="flex items-center gap-1 px-1.5 text-muted">
                <Calendar size={13} className="text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary hidden sm:inline">Date:</span>
              </div>
              {[
                { id: 'all', label: 'All' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'today', label: 'Today' },
                { id: 'tomorrow', label: 'Tomorrow' },
                { id: 'month', label: 'Month' },
                { id: 'custom', label: 'Custom' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDatePreset(p.id as any)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all border ${datePreset === p.id
                    ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                    : 'bg-transparent border-transparent text-muted hover:text-text hover:bg-accent/50'
                    }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {datePreset === 'custom' && (
              <div className="flex items-center gap-1.5 bg-background/80 border border-border/80 rounded-lg px-2 py-1 text-[10px]">
                <span className="text-[9px] text-muted uppercase font-bold">From</span>
                <input
                  type="date"
                  value={customFromDate}
                  onChange={(e) => setCustomFromDate(e.target.value)}
                  className="bg-transparent border-0 text-[10px] text-text p-0 focus:outline-none focus:ring-0 cursor-pointer"
                />
                <span className="text-[9px] text-muted uppercase font-bold ml-1">To</span>
                <input
                  type="date"
                  value={customToDate}
                  onChange={(e) => setCustomToDate(e.target.value)}
                  className="bg-transparent border-0 text-[10px] text-text p-0 focus:outline-none focus:ring-0 cursor-pointer"
                />
              </div>
            )}

            {isDateFilterActive && (
              <button
                type="button"
                onClick={() => {
                  setDatePreset('all')
                  setCustomFromDate('')
                  setCustomToDate('')
                }}
                className="text-[10px] text-muted hover:text-red-500 font-semibold px-2 py-1 rounded hover:bg-red-500/10 transition-colors border border-border/60"
                title="Reset to All"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Metrics Row: Total (intake & backlogs), In-Progress, Completed (3 split: Ahead, On-time, Delay), Overdue */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. Total (Intake + Backlogs) */}
          <div
            className={`bg-card border rounded-xl px-3 py-2 flex flex-col justify-between transition-all duration-200 shadow-xs hover:shadow-sm min-h-[72px] ${(cardFilter === 'all' || cardFilter === 'total_all' || cardFilter === 'total_intake' || cardFilter === 'total_backlog') && cardFilter !== 'all' ? 'border-primary/60 ring-2 ring-primary/20 bg-primary/[0.02]' : 'border-border/80 hover:border-primary/40'}`}
          >
            <div className="flex items-center justify-between pb-1 border-b border-border/50">
              <div
                onClick={() => setCardFilter(cardFilter === 'total_all' ? 'all' : 'total_all')}
                className="flex items-center gap-1.5 cursor-pointer select-none group/title"
                title="Show all jobs"
              >
                <div className="p-1 bg-primary/10 text-primary rounded-md">
                  <Layers size={13} />
                </div>
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider group-hover/title:underline">Total Books</span>
              </div>
              <button
                type="button"
                onClick={() => setCardFilter(cardFilter === 'total_all' ? 'all' : 'total_all')}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${cardFilter === 'total_all' ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}
              >
                Total {totalJobs}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-1.5">
              <button
                type="button"
                onClick={() => setCardFilter(cardFilter === 'total_intake' ? 'all' : 'total_intake')}
                className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'total_intake' ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/30' : 'bg-background/60 border-border/60 hover:border-primary/30 hover:bg-accent/40'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-primary flex items-center gap-1 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0"></span>
                    {datePreset === 'yesterday' ? 'Yest Intake' : datePreset === 'tomorrow' ? 'Tmrw Intake' : datePreset === 'today' ? 'Today Intake' : 'Intake'}
                  </span>
                  <span className="text-xs font-bold text-text ml-1">{totalIntakeJobs}</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCardFilter(cardFilter === 'total_backlog' ? 'all' : 'total_backlog')}
                className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'total_backlog' ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30' : 'bg-background/60 border-border/60 hover:border-amber-500/30 hover:bg-accent/40'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-amber-600/80 dark:text-amber-400/80 flex items-center gap-1 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 shrink-0"></span>
                    Backlogs
                  </span>
                  <span className="text-xs font-bold text-text ml-1">{totalBacklogJobs}</span>
                </div>
              </button>
            </div>
          </div>

          {/* 2. In-Progress */}
          <div
            onClick={() => setCardFilter(cardFilter === 'in_progress' ? 'all' : 'in_progress')}
            className={`bg-card border rounded-xl px-3 py-2 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm min-h-[72px] ${cardFilter === 'in_progress' ? 'border-purple-500/60 ring-2 ring-purple-500/20 bg-purple-500/[0.04]' : 'border-border/80 hover:border-purple-500/40'}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="p-1 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-md">
                  <RefreshCw size={13} />
                </div>
                <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold uppercase tracking-wider">In-Progress</span>
              </div>
              <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400">Active</span>
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-xl font-bold text-purple-600 dark:text-purple-400 leading-none">{inProgressJobs}</span>
              <span className="text-[9px] text-purple-600/80 dark:text-purple-400/80 truncate">Active</span>
            </div>
          </div>

          {/* 4. Completed: 3 split (Ahead, On-time, Delay) */}
          <div
            className={`bg-card border rounded-xl px-3 py-2 flex flex-col justify-between transition-all duration-200 shadow-xs hover:shadow-sm min-h-[72px] ${(cardFilter === 'completed' || cardFilter.startsWith('completed_')) ? 'border-emerald-500/60 ring-2 ring-emerald-500/20' : 'border-border/80 hover:border-emerald-500/30'}`}
          >
            <div className="flex items-center justify-between pb-1 border-b border-border/50">
              <div
                onClick={() => setCardFilter(cardFilter === 'completed' ? 'all' : 'completed')}
                className="flex items-center gap-1.5 cursor-pointer select-none group/title"
                title="Show all Completed jobs"
              >
                <div className="p-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md">
                  <CheckCircle2 size={13} />
                </div>
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider group-hover/title:underline">Completed</span>
              </div>
              <button
                type="button"
                onClick={() => setCardFilter(cardFilter === 'completed' ? 'all' : 'completed')}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${cardFilter === 'completed' ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'}`}
              >
                Total {completedJobs} ({completionPercentage}%)
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 pt-1.5">
              <button
                type="button"
                onClick={() => setCardFilter(cardFilter === 'completed_ahead' ? 'all' : 'completed_ahead')}
                className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'completed_ahead' ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/30' : 'bg-background/60 border-border/60 hover:border-emerald-500/30 hover:bg-accent/40'}`}
                title="Completed ahead of schedule"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                    Ahead
                  </span>
                  <span className="text-xs font-bold text-text">{completedAhead}</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCardFilter(cardFilter === 'completed_ontime' ? 'all' : 'completed_ontime')}
                className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'completed_ontime' ? 'bg-blue-500/10 border-blue-500/40 ring-1 ring-blue-500/30' : 'bg-background/60 border-border/60 hover:border-blue-500/30 hover:bg-accent/40'}`}
                title="Completed on time"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-0.5 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                    On-time
                  </span>
                  <span className="text-xs font-bold text-text">{completedOnTime}</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCardFilter(cardFilter === 'completed_delay' ? 'all' : 'completed_delay')}
                className={`px-1.5 py-1 rounded text-left transition-all border ${cardFilter === 'completed_delay' ? 'bg-rose-500/10 border-rose-500/40 ring-1 ring-rose-500/30' : 'bg-background/60 border-border/60 hover:border-rose-500/30 hover:bg-accent/40'}`}
                title="Completed with delay"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-0.5 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                    Delay
                  </span>
                  <span className="text-xs font-bold text-text">{completedDelay}</span>
                </div>
              </button>
            </div>
          </div>

          {/* 5. Overdue */}
          <div
            onClick={() => setCardFilter(cardFilter === 'overdue' ? 'all' : 'overdue')}
            className={`bg-card border rounded-xl px-3 py-2 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xs hover:shadow-sm min-h-[72px] ${cardFilter === 'overdue' ? 'border-red-500/60 ring-2 ring-red-500/20 bg-red-500/[0.04]' : 'border-border/80 hover:border-red-500/40'}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="p-1 bg-red-500/10 text-red-600 dark:text-red-400 rounded-md">
                  <AlertCircle size={13} />
                </div>
                <span className="text-[10px] text-red-500 font-bold uppercase tracking-wider">Overdue</span>
              </div>
              <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400">Pending</span>
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-xl font-bold text-red-600 dark:text-red-400 leading-none">{overdueJobs}</span>
              <span className="text-[9px] text-red-500/80 truncate">Past customer due</span>
            </div>
          </div>
        </div>

        {/* Chart Section */}
        {chartData.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
            {/* Chart 1: Inflow vs Completed (Area) */}
            <div className="bg-card border border-border/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="mb-6">
                <h3 className="text-lg font-bold font-serif text-text">Production Flow</h3>
                <p className="text-xs text-muted mt-1">Comparison of new jobs arriving vs jobs being completed.</p>
              </div>
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorInflow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/40" />
                    <XAxis dataKey="date" stroke="currentColor" className="text-muted text-xs" tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="currentColor" className="text-muted text-xs" tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', color: 'hsl(var(--text))', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                      itemStyle={{ fontWeight: 600 }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} iconType="circle" />
                    <Area type="monotone" dataKey="inflow" name="Inflow" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorInflow)" />
                    <Area type="monotone" dataKey="completed" name="Delivered" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorCompleted)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Due vs Delays (Bar) */}
            <div className="bg-card border border-border/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="mb-6">
                <h3 className="text-lg font-bold font-serif text-text">Deadlines & Delays</h3>
                <p className="text-xs text-muted mt-1">Jobs due on a given date vs jobs that were delayed.</p>
              </div>
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/40" />
                    <XAxis dataKey="date" stroke="currentColor" className="text-muted text-xs" tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="currentColor" className="text-muted text-xs" tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--accent))', opacity: 0.4 }}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', color: 'hsl(var(--text))', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                      itemStyle={{ fontWeight: 600 }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} iconType="circle" />
                    <Bar dataKey="due" name="Total Due" fill="#f59e0b" radius={[6, 6, 6, 6]} barSize={24} />
                    <Bar dataKey="delay" name="Due but not delivered" fill="#ef4444" radius={[6, 6, 6, 6]} barSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}


        {/* Data Table */}
        <Card className="overflow-hidden border-border/50 shadow-sm bg-card/80 backdrop-blur-xl">
          <div className="flex items-center justify-between px-3.5 py-2 border-b border-border/50 bg-muted/15 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted font-medium">
                Showing <strong className="text-text">{tableJobs.length}</strong> of {filteredReport.length} jobs
              </span>
              {hasActiveColFilters && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-semibold">
                  Filtered
                </span>
              )}
            </div>
            {(hasActiveColFilters || sortField !== null) && (
              <button
                onClick={resetColFilters}
                className="flex items-center gap-1 text-[11px] text-primary hover:underline font-semibold"
              >
                <X size={12} /> Reset sort & table filters
              </button>
            )}
          </div>

          <div className="overflow-auto max-h-[calc(100vh-350px)] min-h-[400px]">
            <table className="w-full min-w-[1150px] text-left border-collapse">
              <thead className="sticky top-0 z-10 shadow-sm bg-card">
                {/* Header Row with Sort */}
                <tr className="bg-muted/30 border-b border-border/50 backdrop-blur-md">
                  <th onClick={() => handleSort('job')} className="px-2 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors group select-none w-[16%]">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Job</span>
                      {renderSortIcon('job')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('fastrack')} className="px-2 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors group select-none text-center w-[9%]">
                    <div className="flex items-center justify-center gap-0.5">
                      <Zap size={10} className="text-amber-500 fill-amber-500" />
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Fastrack</span>
                      {renderSortIcon('fastrack')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('pages')} className="px-2 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors group select-none text-center w-[6%]">
                    <div className="flex items-center justify-center gap-0.5">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Pages</span>
                      {renderSortIcon('pages')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('type')} className="px-2 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors group select-none w-[8%]">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Type</span>
                      {renderSortIcon('type')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('language')} className="px-2 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors group select-none w-[8%]">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Language</span>
                      {renderSortIcon('language')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('created')} className="px-2 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors group select-none w-[9%]">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Received On</span>
                      {renderSortIcon('created')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('dueDate')} className="px-2 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors group select-none w-[9%]">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Due Date</span>
                      {renderSortIcon('dueDate')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('finalStatus')} className="px-2 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors group select-none w-[15%]">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Final Status</span>
                      {renderSortIcon('finalStatus')}
                    </div>
                  </th>
                </tr>

                {/* Filter Row */}
                <tr className="border-b border-border/50 bg-muted/20 font-normal normal-case tracking-normal">
                  {/* Job */}
                  <th className="px-1.5 py-1.5 font-normal">
                    <div className="relative">
                      <input
                        type="text"
                        value={colFilters.job}
                        onChange={(e) => setColFilters(prev => ({ ...prev, job: e.target.value }))}
                        placeholder="Filter..."
                        className="w-full bg-background border border-border/60 rounded px-1.5 py-0.5 text-[11px] text-text placeholder:text-muted/50 focus:outline-none focus:border-primary transition-colors font-sans font-normal"
                      />
                      {colFilters.job && (
                        <button
                          onClick={() => setColFilters(prev => ({ ...prev, job: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                          title="Clear"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  </th>

                  {/* Fastrack filter */}
                  <th className="px-1.5 py-1.5 font-normal">
                    <select
                      value={colFilters.fastrack}
                      onChange={(e) => setColFilters(prev => ({ ...prev, fastrack: e.target.value }))}
                      className="w-full bg-background border border-border/60 rounded px-1 py-0.5 text-[11px] text-text focus:outline-none focus:border-primary transition-colors font-sans font-normal cursor-pointer truncate"
                    >
                      <option value="all">All</option>
                      <option value="fastrack">⚡ Fastrack</option>
                      <option value="normal">Normal</option>
                    </select>
                  </th>

                  {/* Pages */}
                  <th className="px-1 py-1.5 font-normal">
                    <div className="relative">
                      <input
                        type="text"
                        value={colFilters.pages}
                        onChange={(e) => setColFilters(prev => ({ ...prev, pages: e.target.value }))}
                        placeholder="e.g. >250"
                        className="w-full bg-background border border-border/60 rounded px-1 py-0.5 text-[11px] text-center text-text placeholder:text-muted/50 focus:outline-none focus:border-primary transition-colors font-sans font-normal"
                      />
                      {colFilters.pages && (
                        <button
                          onClick={() => setColFilters(prev => ({ ...prev, pages: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                          title="Clear"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  </th>

                  {/* Type */}
                  <th className="px-1.5 py-1.5 font-normal">
                    <select
                      value={colFilters.type}
                      onChange={(e) => setColFilters(prev => ({ ...prev, type: e.target.value }))}
                      className="w-full bg-background border border-border/60 rounded px-1 py-0.5 text-[11px] text-text focus:outline-none focus:border-primary transition-colors font-sans font-normal cursor-pointer truncate"
                    >
                      <option value="all">All Types</option>
                      {uniqueTypes.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </th>

                  {/* Language */}
                  <th className="px-1.5 py-1.5 font-normal">
                    <select
                      value={colFilters.language}
                      onChange={(e) => setColFilters(prev => ({ ...prev, language: e.target.value }))}
                      className="w-full bg-background border border-border/60 rounded px-1 py-0.5 text-[11px] text-text focus:outline-none focus:border-primary transition-colors font-sans font-normal cursor-pointer truncate"
                    >
                      <option value="all">All Langs</option>
                      {uniqueLanguages.map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </th>

                  {/* Created At */}
                  <th className="px-1.5 py-1.5 font-normal">
                    <div className="relative">
                      <input
                        type="date"
                        value={colFilters.created}
                        onChange={(e) => setColFilters(prev => ({ ...prev, created: e.target.value }))}
                        className="w-full bg-background border border-border/60 rounded px-1 py-0.5 text-[10px] text-text focus:outline-none focus:border-primary transition-colors font-sans font-normal cursor-pointer"
                        style={{ colorScheme: 'light dark' }}
                      />
                      {colFilters.created && (
                        <button
                          onClick={() => setColFilters(prev => ({ ...prev, created: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-text bg-background"
                          title="Clear"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  </th>

                  {/* Due Date */}
                  <th className="px-1.5 py-1.5 font-normal">
                    <div className="relative">
                      <input
                        type="date"
                        value={colFilters.dueDate}
                        onChange={(e) => setColFilters(prev => ({ ...prev, dueDate: e.target.value }))}
                        className="w-full bg-background border border-border/60 rounded px-1 py-0.5 text-[10px] text-text focus:outline-none focus:border-primary transition-colors font-sans font-normal cursor-pointer"
                        style={{ colorScheme: 'light dark' }}
                      />
                      {colFilters.dueDate && (
                        <button
                          onClick={() => setColFilters(prev => ({ ...prev, dueDate: '' }))}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-text bg-background"
                          title="Clear"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  </th>

                  {/* Final Status */}
                  <th className="px-1.5 py-1.5 font-normal">
                    <select
                      value={colFilters.finalStatus}
                      onChange={(e) => setColFilters(prev => ({ ...prev, finalStatus: e.target.value }))}
                      className="w-full bg-background border border-border/60 rounded px-1 py-0.5 text-[11px] text-text focus:outline-none focus:border-primary transition-colors font-sans font-normal cursor-pointer truncate"
                    >
                      <option value="all">All</option>
                      <option value="Completed">Completed (All)</option>
                      <option value="Ahead">Ahead</option>
                      <option value="On-time">On-time</option>
                      <option value="Delay">Delay</option>
                      <option value="In-progress">In-progress</option>
                      <option value="Overdue">Overdue</option>
                      <option value="YTS">YTS</option>
                    </select>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center text-muted">
                        <Loader2 className="h-8 w-8 animate-spin mb-2 text-primary" />
                        <p>Loading report data...</p>
                      </div>
                    </td>
                  </tr>
                ) : tableJobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-muted">
                      No matching records found.
                    </td>
                  </tr>
                ) : (
                  tableJobs.map((job) => {
                    const { finalStatus } = getJobStatuses(job)

                    const getStatusColor = (s: string) => {
                      if (s === 'Ahead') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                      if (s === 'On-time') return 'bg-blue-500/10 text-blue-600 border-blue-500/30'
                      if (s === 'Delay') return 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                      if (s === 'Completed') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      if (s === 'In-progress') return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                      if (s === 'Overdue') return 'bg-red-500/10 text-red-600 border-red-500/20'
                      return 'bg-muted/10 text-muted-foreground border-border/50'
                    }

                    return (
                      <tr key={job.id} className="hover:bg-muted/5 transition-colors group">
                        <td className="px-2 py-3">
                          <div className="font-medium text-text break-all whitespace-normal max-w-[260px]" title={job.pdf_filename}>
                            {job.pdf_filename}
                          </div>
                          <div className="text-[10px] text-muted mt-0.5 flex items-center gap-1.5 truncate max-w-[200px]">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary/40"></div>
                            {job.client_name}
                          </div>
                          {job.epub_filename && (
                            <div className="flex items-start gap-1.5 mt-2 bg-emerald-500/5 py-1 px-2 rounded-md w-fit border border-emerald-500/10 max-w-[260px]">
                              <div className="text-[10px] text-emerald-600 font-medium break-all whitespace-normal flex-1">
                                {job.epub_filename}
                              </div>
                              <button
                                onClick={(e) => handleDownloadEpub(e, job.id, job.epub_filename)}
                                className="text-emerald-500 hover:text-emerald-600 transition-colors p-0.5 rounded-full hover:bg-emerald-500/20 shrink-0 mt-0.5"
                                title="Download EPUB"
                              >
                                <Download size={12} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-3 text-center">
                          {(() => {
                            const completed = isJobCompleted(job)
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  if (completed) return
                                  toggleFastrack(e, job.id, Boolean(job.is_fastrack))
                                }}
                                disabled={completed || togglingFastrackId === job.id}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border transition-all shadow-xs select-none ${
                                  completed
                                    ? job.is_fastrack
                                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-600/60 dark:text-amber-400/60 opacity-60 cursor-not-allowed'
                                      : 'bg-background/40 border-border/40 text-muted/50 opacity-50 cursor-not-allowed'
                                    : job.is_fastrack
                                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 ring-1 ring-amber-500/30 cursor-pointer'
                                      : 'bg-background/80 border-border/70 text-muted hover:text-text hover:border-border hover:bg-muted/30 cursor-pointer'
                                }`}
                                title={
                                  completed
                                    ? "Job completed — Fastrack status is locked"
                                    : job.is_fastrack
                                      ? "Fastrack Enabled — Click to set Normal"
                                      : "Normal — Click to enable Fastrack"
                                }
                              >
                                {togglingFastrackId === job.id ? (
                                  <Loader2 size={11} className="animate-spin text-amber-500" />
                                ) : (
                                  <Zap size={11} className={job.is_fastrack ? "text-amber-500 fill-amber-500" : "text-muted/60"} />
                                )}
                                <span>{job.is_fastrack ? "Fastrack" : "Normal"}</span>
                              </button>
                            )
                          })()}
                        </td>
                        <td className="px-2 py-3 text-[10px] text-muted text-center">
                          {job.pdf_page_count || '-'}
                        </td>
                        <td className="px-2 py-3 text-[10px] font-medium text-muted">
                          {job.pdf_type || '-'}
                        </td>
                        <td className="px-2 py-3 text-[10px] font-medium text-muted">
                          {job.pdf_language || '-'}
                        </td>
                        <td className="px-2 py-3 text-[10px] text-muted whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Calendar size={10} className="text-muted-foreground/60" />
                            {job.created_at ? formatDateTime(job.created_at) : '-'}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-[10px] text-muted whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Calendar size={10} className="text-amber-500/80" />
                            {job.due_date ? formatDateTime(job.due_date) : '-'}
                          </div>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border shadow-sm ${getStatusColor(finalStatus)}`}>
                            {finalStatus === 'Ahead' && <CheckCircle2 size={10} className="mr-1 text-emerald-500" />}
                            {finalStatus === 'On-time' && <CheckCircle2 size={10} className="mr-1 text-blue-500" />}
                            {finalStatus === 'Delay' && <AlertCircle size={10} className="mr-1 text-rose-500" />}
                            {finalStatus === 'Completed' && <CheckCircle2 size={10} className="mr-1" />}
                            {finalStatus === 'In-progress' && <RefreshCw size={10} className="mr-1 animate-spin-slow" />}
                            {finalStatus === 'Overdue' && <AlertCircle size={10} className="mr-1" />}
                            {finalStatus}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
