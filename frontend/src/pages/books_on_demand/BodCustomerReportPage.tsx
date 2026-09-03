import React, { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Loader2, Search, Calendar, FileText, CheckCircle2, Clock, Download, Layers, RefreshCw, BarChart2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '@/api/client'

export function BodCustomerReportPage() {
  const navigate = useNavigate()
  const [report, setReport] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [dateRange, setDateRange] = useState('today') // all, today, week, month, custom
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  
  const [prodStatusFilter, setProdStatusFilter] = useState('all')
  const [qcStatusFilter, setQcStatusFilter] = useState('all')
  const [finalStatusFilter, setFinalStatusFilter] = useState('all')

  useEffect(() => {
    fetchReport()
  }, [status, dateRange, fromDate, toDate])

  const fetchReport = async () => {
    setLoading(true)
    try {
      let params = new URLSearchParams()
      if (status !== 'all') params.append('status', status)

      const now = new Date()
      if (dateRange === 'today') {
        const start = new Date(now.setHours(0, 0, 0, 0)).toISOString()
        params.append('start_date', start)
      } else if (dateRange === 'week') {
        const start = new Date(now.setDate(now.getDate() - 7)).toISOString()
        params.append('start_date', start)
      } else if (dateRange === 'month') {
        const start = new Date(now.setMonth(now.getMonth() - 1)).toISOString()
        params.append('start_date', start)
      } else if (dateRange === 'custom') {
        if (fromDate) {
          const start = new Date(fromDate)
          start.setHours(0,0,0,0)
          params.append('start_date', start.toISOString())
        }
        if (toDate) {
          const end = new Date(toDate)
          end.setHours(23,59,59,999)
          params.append('end_date', end.toISOString())
        }
      }

      const { data } = await api.get(`/bod/report?${params.toString()}`)
      setReport(data.jobs || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-'
    try {
      const hasTz = dateStr.endsWith('Z') || dateStr.includes('+') || !!dateStr.match(/-\d{2}:\d{2}$/)
      const validStr = hasTz ? dateStr : `${dateStr}Z`
      const d = new Date(validStr)
      if (isNaN(d.getTime())) return 'Invalid Date'
      return d.toLocaleString('en-IN', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    } catch {
      return 'Invalid Date'
    }
  }

  const getJobStatuses = (job: any) => {
    const history = job.stage_history || {}
    let finalStatus = 'YTS'
    if (job.status === 'Completed' || job.current_stage === 'Archive') finalStatus = 'Completed'
    else if (job.current_stage === 'Production' || job.current_stage === 'QC') finalStatus = 'In-progress'

    const prodData = history['Production'] || {}
    let prodStatus = 'YTS'
    if (prodData.start_time) prodStatus = prodData.end_time ? 'Completed' : 'In-progress'

    const qcData = history['QC'] || {}
    let qcStatus = 'YTS'
    if (qcData.start_time) qcStatus = qcData.end_time ? 'Completed' : 'In-progress'

    return { finalStatus, prodStatus, qcStatus, prodData, qcData }
  }

  const filteredReport = report.filter(job => {
    const textMatch = job.pdf_filename.toLowerCase().includes(search.toLowerCase()) ||
                      (job.client_name && job.client_name.toLowerCase().includes(search.toLowerCase()))
    
    const { finalStatus, prodStatus, qcStatus } = getJobStatuses(job)

    const prodMatch = prodStatusFilter === 'all' || prodStatus === prodStatusFilter
    const qcMatch = qcStatusFilter === 'all' || qcStatus === qcStatusFilter
    const finalMatch = finalStatusFilter === 'all' || finalStatus === finalStatusFilter

    return textMatch && prodMatch && qcMatch && finalMatch
  })

  const totalJobs = filteredReport.length
  let prodCompleted = 0
  let prodInProgress = 0
  let prodPending = 0
  let qcCompleted = 0
  let qcInProgress = 0
  let overallCompleted = 0

  filteredReport.forEach(job => {
    const { finalStatus, prodStatus, qcStatus } = getJobStatuses(job)
    if (finalStatus === 'Completed') overallCompleted++
    if (prodStatus === 'Completed') prodCompleted++
    else if (prodStatus === 'In-progress') prodInProgress++
    else if (prodStatus === 'YTS') prodPending++
    
    if (qcStatus === 'Completed') qcCompleted++
    else if (qcStatus === 'In-progress') qcInProgress++
  })

  const completionPercentage = totalJobs > 0 ? Math.round((overallCompleted / totalJobs) * 100) : 0

  const downloadReport = () => {
    const headers = [
      'Job ID',
      'Client',
      'Source PDF',
      'Target EPUB',
      'Job Created Date',
      'Production Status',
      'Production Start Time',
      'Production End Time',
      'QC Status',
      'QC Start Time',
      'QC End Time',
      'Final Status'
    ]
    const csvRows = [headers.join(',')]

    filteredReport.forEach(job => {
      const { finalStatus, prodStatus, qcStatus, prodData, qcData } = getJobStatuses(job)
      
      const prodStart = prodData.start_time ? formatDateTime(prodData.start_time) : '-'
      const prodEnd = prodData.end_time ? formatDateTime(prodData.end_time) : '-'

      const qcStart = qcData.start_time ? formatDateTime(qcData.start_time) : '-'
      const qcEnd = qcData.end_time ? formatDateTime(qcData.end_time) : '-'

      const row = [
        job.id,
        `"${job.client_name || ''}"`,
        `"${job.pdf_filename || ''}"`,
        `"${job.epub_filename || ''}"`,
        `"${formatDateTime(job.created_at)}"`,
        `"${prodStatus}"`,
        `"${prodStart}"`,
        `"${prodEnd}"`,
        `"${qcStatus}"`,
        `"${qcStart}"`,
        `"${qcEnd}"`,
        `"${finalStatus}"`
      ]
      csvRows.push(row.join(','))
    })

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.setAttribute('href', url)
    a.setAttribute('download', `customer_report_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
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
      <div className="max-w-7xl mx-auto space-y-6">

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
              className="flex items-center gap-2 px-4 py-2.5 bg-card border border-border hover:bg-muted/30 text-text font-medium rounded-lg transition-colors shadow-sm"
            >
              <Layers size={16} className="text-primary" /> BOD Job Pages
            </button>
            <button
              onClick={downloadReport}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors shadow-sm"
            >
              <Download size={16} /> Export CSV
            </button>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="bg-card border border-border/70 rounded-xl p-4 flex flex-col justify-center gap-1 shadow-sm">
            <span className="text-[11px] text-muted font-bold uppercase tracking-wider flex items-center gap-1.5"><Layers size={14} className="text-primary"/> Total Books</span>
            <span className="text-2xl font-bold text-text">{totalJobs}</span>
          </div>

          <div className="bg-card border border-border/70 rounded-xl p-4 flex flex-col justify-center gap-2 shadow-sm">
            <span className="text-[11px] text-muted font-bold uppercase tracking-wider flex items-center gap-1.5"><Clock size={14} className="text-muted-foreground"/> Yet to start</span>
            <div className="flex flex-col">
              <span className="text-2xl font-bold text-text leading-tight">{prodPending}</span>
            </div>
          </div>

          <div className="bg-card border border-border/70 rounded-xl p-4 flex flex-col justify-center gap-2 shadow-sm">
            <span className="text-[11px] text-muted font-bold uppercase tracking-wider flex items-center gap-1.5"><Clock size={14} className="text-amber-500"/> Production</span>
            <div className="flex gap-4">
              <div className="flex flex-col">
                <span className="text-lg font-bold text-emerald-500 leading-tight">{prodCompleted}</span>
                <span className="text-[10px] text-muted uppercase">Completed</span>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-amber-500 leading-tight">{prodInProgress}</span>
                <span className="text-[10px] text-muted uppercase">In-Progress</span>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border/70 rounded-xl p-4 flex flex-col justify-center gap-2 shadow-sm">
            <span className="text-[11px] text-muted font-bold uppercase tracking-wider flex items-center gap-1.5"><CheckCircle2 size={14} className="text-blue-500"/> Quality Control</span>
            <div className="flex gap-4">
              <div className="flex flex-col">
                <span className="text-lg font-bold text-emerald-500 leading-tight">{qcCompleted}</span>
                <span className="text-[10px] text-muted uppercase">Completed</span>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-amber-500 leading-tight">{qcInProgress}</span>
                <span className="text-[10px] text-muted uppercase">In-Progress</span>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border/70 rounded-xl p-4 flex flex-col justify-center gap-2 shadow-sm">
            <span className="text-[11px] text-muted font-bold uppercase tracking-wider flex items-center gap-1.5"><RefreshCw size={14} className="text-primary"/> Overall Final</span>
            <div className="flex items-end justify-between">
              <div className="flex flex-col">
                <span className="text-lg font-bold text-emerald-500 leading-tight">{overallCompleted}</span>
                <span className="text-[10px] text-muted uppercase">Completed</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-2xl font-bold text-text leading-none">{completionPercentage}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-2 lg:gap-4 bg-card/50 border border-border/50 p-3 rounded-xl backdrop-blur-md overflow-x-auto hide-scrollbar">
          {/* Search */}
          <div className="relative flex-none w-[180px] lg:w-[220px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-muted/70" />
            </div>
            <input
              type="text"
              placeholder="Search by filename or client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-background border-border border rounded-lg text-sm text-text placeholder:text-muted focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
            />
          </div>

          {/* Stage Filters */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider hidden lg:inline-block mr-1">Stage:</span>
            <select
              value={prodStatusFilter}
              onChange={(e) => setProdStatusFilter(e.target.value)}
              className="px-3 py-2 bg-background border-border border rounded-lg text-sm text-text focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="all">Prod: All</option>
              <option value="Completed">Prod: Completed</option>
              <option value="In-progress">Prod: In-progress</option>
              <option value="YTS">Prod: YTS</option>
            </select>
            <select
              value={qcStatusFilter}
              onChange={(e) => setQcStatusFilter(e.target.value)}
              className="px-3 py-2 bg-background border-border border rounded-lg text-sm text-text focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="all">QC: All</option>
              <option value="Completed">QC: Completed</option>
              <option value="In-progress">QC: In-progress</option>
              <option value="YTS">QC: YTS</option>
            </select>
            <select
              value={finalStatusFilter}
              onChange={(e) => setFinalStatusFilter(e.target.value)}
              className="px-3 py-2 bg-background border-border border rounded-lg text-sm text-text focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="all">Final: All</option>
              <option value="Completed">Final: Completed</option>
              <option value="In-progress">Final: In-progress</option>
              <option value="YTS">Final: YTS</option>
            </select>
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-3 ml-auto">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Calendar className="h-4 w-4 text-muted" />
              </div>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="pl-9 pr-8 py-2 bg-background border-border border rounded-lg text-sm text-text focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-shadow"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last Month</option>
                <option value="custom">Custom Date</option>
              </select>
            </div>
            
            {dateRange === 'custom' && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="px-3 py-2 bg-background border border-border rounded-lg text-sm text-text focus:ring-1 focus:ring-primary outline-none transition-all"
                />
                <span className="text-muted text-xs font-semibold uppercase">to</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="px-3 py-2 bg-background border border-border rounded-lg text-sm text-text focus:ring-1 focus:ring-primary outline-none transition-all"
                />
              </div>
            )}
          </div>
        </div>

        {/* Data Table */}
        <Card className="overflow-hidden border-border/50 shadow-sm bg-card/80 backdrop-blur-xl">
          <div className="overflow-auto max-h-[calc(100vh-350px)] min-h-[400px]">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-10 shadow-sm bg-card">
                <tr className="bg-muted/30 border-b border-border/50 backdrop-blur-md">
                  <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Job / Client</th>
                  <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Created At</th>
                  <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Production</th>
                  <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Production Timing</th>
                  <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider">QC</th>
                  <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider">QC Timing</th>
                  <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Final Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center text-muted">
                        <Loader2 className="h-8 w-8 animate-spin mb-2 text-primary" />
                        <p>Loading report data...</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredReport.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-muted">
                      No matching records found.
                    </td>
                  </tr>
                ) : (
                  filteredReport.map((job) => {
                    const { finalStatus, prodStatus, qcStatus, prodData, qcData } = getJobStatuses(job)

                    const getStatusColor = (s: string) => {
                      if (s === 'Completed') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      if (s === 'In-progress') return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                      return 'bg-muted/10 text-muted-foreground border-border/50'
                    }

                    return (
                      <tr key={job.id} className="hover:bg-muted/5 transition-colors group">
                        <td className="px-4 py-4">
                          <div className="font-medium text-text truncate max-w-[200px]" title={job.pdf_filename}>
                            {job.pdf_filename}
                          </div>
                          <div className="text-xs text-muted mt-0.5 flex items-center gap-1.5 truncate max-w-[200px]">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary/40"></div>
                            {job.client_name}
                          </div>
                          {job.epub_filename && (
                            <div className="flex items-center gap-1.5 mt-2 bg-emerald-500/5 py-1 px-2 rounded-md w-fit border border-emerald-500/10">
                              <div className="text-[10px] text-emerald-600 font-medium truncate max-w-[150px]">
                                {job.epub_filename}
                              </div>
                              <button
                                onClick={(e) => handleDownloadEpub(e, job.id, job.epub_filename)}
                                className="text-emerald-500 hover:text-emerald-600 transition-colors p-0.5 rounded-full hover:bg-emerald-500/20"
                                title="Download EPUB"
                              >
                                <Download size={12} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-[11px] text-muted">
                          <div className="flex items-center gap-1.5">
                            <Calendar size={12} className="text-muted-foreground/60" />
                            {job.created_at ? formatDateTime(job.created_at) : '-'}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold border ${getStatusColor(prodStatus)}`}>
                            {prodStatus === 'Completed' && <CheckCircle2 size={10} className="mr-1" />}
                            {prodStatus === 'In-progress' && <Clock size={10} className="mr-1" />}
                            {prodStatus}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-[11px]">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2 text-muted">
                              <Clock size={12} className="text-primary/60" />
                              <span className="text-text">{prodData.start_time ? formatDateTime(prodData.start_time) : '-'}</span>
                            </div>
                            <div className="flex items-center gap-2 text-muted">
                              <CheckCircle2 size={12} className="text-emerald-500/60" />
                              <span className="text-text">{prodData.end_time ? formatDateTime(prodData.end_time) : '-'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold border ${getStatusColor(qcStatus)}`}>
                            {qcStatus === 'Completed' && <CheckCircle2 size={10} className="mr-1" />}
                            {qcStatus === 'In-progress' && <Clock size={10} className="mr-1" />}
                            {qcStatus}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-[11px]">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2 text-muted">
                              <Clock size={12} className="text-primary/60" />
                              <span className="text-text">{qcData.start_time ? formatDateTime(qcData.start_time) : '-'}</span>
                            </div>
                            <div className="flex items-center gap-2 text-muted">
                              <CheckCircle2 size={12} className="text-emerald-500/60" />
                              <span className="text-text">{qcData.end_time ? formatDateTime(qcData.end_time) : '-'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border shadow-sm ${getStatusColor(finalStatus)}`}>
                            {finalStatus === 'Completed' && <CheckCircle2 size={10} className="mr-1" />}
                            {finalStatus === 'In-progress' && <RefreshCw size={10} className="mr-1 animate-spin-slow" />}
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
