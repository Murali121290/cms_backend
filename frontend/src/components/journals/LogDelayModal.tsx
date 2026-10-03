import React, { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { journalsApi, JournalArticleRow } from '@/api/journals'
import { toast } from '@/store/useToastStore'
import { getApiErrorMessage } from '@/api/client'

interface LogDelayModalProps {
  isOpen: boolean
  onClose: () => void
  article: JournalArticleRow | null
  onSuccess: () => void
}

export function LogDelayModal({ isOpen, onClose, article, onSuccess }: LogDelayModalProps) {
  const [delayCategory, setDelayCategory] = useState('Author')
  const [revisedDueDate, setRevisedDueDate] = useState('')
  const [delayDays, setDelayDays] = useState(2)
  const [delayReason, setDelayReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (article) {
      setDelayCategory('Author')
      setRevisedDueDate(article.due_date ? new Date(article.due_date).toISOString().slice(0, 10) : '')
      setDelayDays(2)
      setDelayReason('')
    }
  }, [article])

  if (!article) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!delayReason.trim()) {
      toast.error('Please enter a delay reason or mitigation plan')
      return
    }
    setSaving(true)
    try {
      await journalsApi.updateDelay(article.id, {
        delay_category: delayCategory,
        revised_due_date: revisedDueDate,
        delay_days: Number(delayDays),
        delay_reason: delayReason.trim(),
      })
      toast.success(`Logged ${delayCategory} delay for article`)
      onSuccess()
      onClose()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to log delay'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Log & Update Stage Delay"
      description={`Record delay category and revised timeline for "${article.article_title}"`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} isLoading={saving} className="bg-red-600 hover:bg-red-700 text-white">
            Log Delay Status
          </Button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-4 text-sm">
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-700 dark:text-red-400">
          <strong>Article Currently at:</strong> {article.current_stage}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
            Delay Responsibility Category
          </label>
          <select
            value={delayCategory}
            onChange={e => setDelayCategory(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="Author">Author (Proof review delay / Corrections pending)</option>
            <option value="Publisher">Publisher / Editorial Hold (Permissions / Assets missing)</option>
            <option value="Technical">Technical / QC Exception (LaTeX/MathML / Rendering issue)</option>
            <option value="Layout">InDesign Layout Rework (Frame overset / Font issue)</option>
            <option value="Vendor">Vendor / Artwork Redraw (Low-res graphics)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
              Revised Due Date
            </label>
            <input
              type="date"
              value={revisedDueDate}
              onChange={e => setRevisedDueDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
              Additional Delay (Days)
            </label>
            <input
              type="number"
              min="1"
              max="90"
              value={delayDays}
              onChange={e => setDelayDays(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1">
            Delay Reason & Mitigation Plan
          </label>
          <textarea
            rows={3}
            value={delayReason}
            onChange={e => setDelayReason(e.target.value)}
            placeholder="e.g. Author requested 48h extension for equation corrections"
            className="w-full p-3 rounded-lg border border-border bg-card text-text outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </form>
    </Modal>
  )
}
