import React, { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { journalsApi, JournalArticleRow, JournalUser } from '@/api/journals'
import { toast } from '@/store/useToastStore'
import { getApiErrorMessage } from '@/api/client'

interface AssignModalProps {
  isOpen: boolean
  onClose: () => void
  article: JournalArticleRow | null
  onSuccess: () => void
}

const FALLBACK_TEAM = ['R. Kumar', 'S. Priya', 'A. Joseph', 'M. Devi', 'K. Rahman', 'L. Thomas', 'V. Nair', 'J. Mathew']

export function AssignModal({ isOpen, onClose, article, onSuccess }: AssignModalProps) {
  const [users, setUsers] = useState<JournalUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(undefined)
  const [assigneeName, setAssigneeName] = useState('')
  const [plannedStart, setPlannedStart] = useState('')
  const [plannedEnd, setPlannedEnd] = useState('')
  const [slaHours, setSlaHours] = useState(16)
  const [complexity, setComplexity] = useState<'Low' | 'Medium' | 'High'>('Medium')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setLoadingUsers(true)
      journalsApi.getUsers()
        .then(uList => setUsers(uList))
        .catch(() => setUsers([]))
        .finally(() => setLoadingUsers(false))
    }
  }, [isOpen])

  useEffect(() => {
    if (article) {
      setAssigneeName(article.current_assignee_name || '')
      setSelectedUserId(article.current_assignee_id || undefined)
      setPlannedStart(new Date().toISOString().slice(0, 10))
      setPlannedEnd(article.due_date ? new Date(article.due_date).toISOString().slice(0, 10) : '')
      setSlaHours(16)
      setComplexity((article.complexity_level as 'Low' | 'Medium' | 'High') || 'Medium')
      setRemarks('')
    }
  }, [article])

  if (!article) return null

  const handleUserSelect = (val: string) => {
    if (!val) {
      setSelectedUserId(undefined)
      setAssigneeName('')
      return
    }
    const foundUser = users.find(u => String(u.id) === val || u.name === val || u.username === val)
    if (foundUser) {
      setSelectedUserId(foundUser.id)
      setAssigneeName(foundUser.name)
    } else {
      setSelectedUserId(undefined)
      setAssigneeName(val)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await journalsApi.assignArticle(article.id, {
        assignee_id: selectedUserId,
        assignee_name: assigneeName,
        planned_start_date: plannedStart,
        planned_end_date: plannedEnd,
        sla_hours: Number(slaHours),
        complexity_level: complexity,
        remarks: remarks.trim(),
      })
      toast.success(`Assigned stage to ${assigneeName || 'Unassigned'}`)
      onSuccess()
      onClose()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update assignment'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Assign & Plan Stage"
      description={`Assign stage lead and schedule for "${article.article_title}" (${article.article_doi ?? 'No DOI'})`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} isLoading={saving}>Save Assignment</Button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-4 text-sm">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
            Current Stage
          </label>
          <div className="p-2.5 bg-surface border border-border rounded-lg font-medium text-text">
            {article.current_stage}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
            Assignee / Stage Lead
          </label>
          <select
            value={selectedUserId ? String(selectedUserId) : assigneeName}
            onChange={e => handleUserSelect(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">-- Select Assignee / Unassigned --</option>
            {users.length > 0 ? (
              users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.role ? `(${u.role})` : ''}
                </option>
              ))
            ) : (
              FALLBACK_TEAM.map(member => (
                <option key={member} value={member}>{member}</option>
              ))
            )}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
              Planned Start Date
            </label>
            <input
              type="date"
              value={plannedStart}
              onChange={e => setPlannedStart(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
              Planned End Date
            </label>
            <input
              type="date"
              value={plannedEnd}
              onChange={e => setPlannedEnd(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
              SLA Hours
            </label>
            <input
              type="number"
              min="1"
              max="240"
              value={slaHours}
              onChange={e => setSlaHours(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
              Complexity Level
            </label>
            <select
              value={complexity}
              onChange={e => setComplexity(e.target.value as 'Low' | 'Medium' | 'High')}
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="Low">Low Complexity</option>
              <option value="Medium">Medium Complexity</option>
              <option value="High">High Complexity</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
            Remarks for Assignee
          </label>
          <textarea
            rows={3}
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            placeholder="e.g. 14 display equations; verify MathML rendering in JATS"
            className="w-full p-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </form>
    </Modal>
  )
}
