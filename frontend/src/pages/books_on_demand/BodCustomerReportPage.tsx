import React, { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Loader2, Search, Calendar, ChevronDown, ChevronUp, FileText, CheckCircle2, Clock, Download } from 'lucide-react'
import api from '@/api/client'

export function BodCustomerReportPage() {
  const [report, setReport] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // Filters
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [dateRange, setDateRange] = useState('all') // all, today, week, month

  useEffect(() => {
    fetchReport()
  }, [status, dateRange])

  const fetchReport = async () => {
    setLoading(true)
    try {
      let params = new URLSearchParams()
      if (status !== 'all') params.append('status', status)
      
      const now = new Date()
      if (dateRange === 'today') {
        const start = new Date(now.setHours(0,0,0,0)).toISOString()
        params.append('start_date', start)
      } else if (dateRange === 'week') {
        const start = new Date(now.setDate(now.getDate() - 7)).toISOString()
        params.append('start_date', start)
      } else if (dateRange === 'month') {
        const start = new Date(now.setMonth(now.getMonth() - 1)).toISOString()
        params.append('start_date', start)
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

  const filteredReport = report.filter(job => 
    job.pdf_filename.toLowerCase().includes(search.toLowerCase()) ||
    (job.client_name && job.client_name.toLowerCase().includes(search.toLowerCase()))
  )

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
      const history = job.stage_history || {}
      
      // Determine Final Status
      let finalStatus = 'YTS'
      if (job.status === 'Completed' || job.current_stage === 'Archive') {
        finalStatus = 'Completed'
      } else if (job.current_stage === 'Production' || job.current_stage === 'QC') {
        finalStatus = 'In-progress'
      }

      // Production info
      const prodData = history['Production'] || {}
      let prodStatus = 'YTS'
      if (prodData.start_time) {
        prodStatus = prodData.end_time ? 'Completed' : 'In-progress'
      }
      const prodStart = prodData.start_time ? formatDateTime(prodData.start_time) : '-'
      const prodEnd = prodData.end_time ? formatDateTime(prodData.end_time) : '-'

      // QC info
      const qcData = history['QC'] || {}
      let qcStatus = 'YTS'
      if (qcData.start_time) {
        qcStatus = qcData.end_time ? 'Completed' : 'In-progress'
      }
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
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold font-serif text-text tracking-tight flex items-center gap-2">
              <FileText className="text-primary" /> Customer Process Report
            </h1>
            <p className="text-muted text-sm mt-1">Real-time status and historical timeline of all books.</p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Date Filter */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Calendar className="h-4 w-4 text-muted" />
              </div>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="pl-9 pr-8 py-2 bg-card border-border border rounded-md text-sm text-text focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-shadow"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last Month</option>
              </select>
            </div>
            
            {/* Status Filter */}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="px-4 py-2 bg-card border-border border rounded-md text-sm text-text focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-shadow"
            >
              <option value="all">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-muted/70" />
            </div>
            <input
              type="text"
              placeholder="Search by filename or client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-card border-border border rounded-xl text-text placeholder:text-muted focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all shadow-sm"
            />
          </div>

          <button
            onClick={downloadReport}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
          >
            <Download size={16} /> Export
          </button>
        </div>

        {/* Data Table */}
        <Card className="overflow-hidden border-border/50 shadow-sm bg-card/80 backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50 backdrop-blur-md">
                  <th className="px-4 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Job / Client</th>
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
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center text-muted">
                        <Loader2 className="h-8 w-8 animate-spin mb-2 text-primary" />
                        <p>Loading report data...</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredReport.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted">
                      No matching records found.
                    </td>
                  </tr>
                ) : (
                  filteredReport.map((job) => {
                    const history = job.stage_history || {}
                    
                    // Final Status
                    let finalStatus = 'YTS'
                    if (job.status === 'Completed' || job.current_stage === 'Archive') finalStatus = 'Completed'
                    else if (job.current_stage === 'Production' || job.current_stage === 'QC') finalStatus = 'In-progress'

                    // Production
                    const prodData = history['Production'] || {}
                    let prodStatus = 'YTS'
                    if (prodData.start_time) prodStatus = prodData.end_time ? 'Completed' : 'In-progress'

                    // QC
                    const qcData = history['QC'] || {}
                    let qcStatus = 'YTS'
                    if (qcData.start_time) qcStatus = qcData.end_time ? 'Completed' : 'In-progress'

                    const getStatusColor = (s: string) => {
                      if (s === 'Completed') return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                      if (s === 'In-progress') return 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                      return 'bg-muted/20 text-muted-foreground border-border'
                    }

                    return (
                      <tr key={job.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-4">
                          <div className="font-medium text-text truncate max-w-[200px]" title={job.pdf_filename}>
                            {job.pdf_filename}
                          </div>
                          <div className="text-xs text-muted mt-0.5 truncate max-w-[200px]">
                            {job.client_name}
                          </div>
                          {job.epub_filename && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="text-[10px] text-emerald-500/80 truncate max-w-[170px]">
                                {job.epub_filename}
                              </div>
                              <button
                                onClick={(e) => handleDownloadEpub(e, job.id, job.epub_filename)}
                                className="text-emerald-500 hover:text-emerald-400 transition-colors p-0.5 rounded-full hover:bg-emerald-500/10"
                                title="Download EPUB"
                              >
                                <Download size={12} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${getStatusColor(prodStatus)}`}>
                            {prodStatus}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-[11px]">
                          <div className="text-muted"><span className="inline-block w-10">Start:</span> <span className="text-text">{prodData.start_time ? formatDateTime(prodData.start_time) : '-'}</span></div>
                          <div className="text-muted mt-1"><span className="inline-block w-10">End:</span> <span className="text-text">{prodData.end_time ? formatDateTime(prodData.end_time) : '-'}</span></div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${getStatusColor(qcStatus)}`}>
                            {qcStatus}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-[11px]">
                          <div className="text-muted"><span className="inline-block w-10">Start:</span> <span className="text-text">{qcData.start_time ? formatDateTime(qcData.start_time) : '-'}</span></div>
                          <div className="text-muted mt-1"><span className="inline-block w-10">End:</span> <span className="text-text">{qcData.end_time ? formatDateTime(qcData.end_time) : '-'}</span></div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${getStatusColor(finalStatus)}`}>
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
