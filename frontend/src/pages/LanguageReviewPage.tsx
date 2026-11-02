import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Languages,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Search,
  ArrowLeft,
  Download,
  Check,
  Edit3,
  Sliders,
  FileText,
  Save,
  ChevronRight,
  RefreshCw,
  Highlighter,
  MessageSquare,
  Plus,
  Trash2,
  MessageCircle,
  Sparkles,
  ArrowRight,
  Eye,
  Smile
} from 'lucide-react'
import apiClient from '@/api/client'
import { toast } from '@/store/useToastStore'
import { uiPaths } from '@/utils/appPaths'
import { useJournalReviewMode } from '@/features/journals/useJournalReviewMode'
import {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  type CommentRecord
} from '@/api/comments'
import { useFileXhtmlQuery } from '@/features/technicalReview/useFileXhtmlQuery'
import {
  WysiwygEditor,
  useEditorSave,
  type WysiwygEditorHandle,
  type Occurrence
} from '@/features/editor'
import { useSessionStore } from '@/stores/sessionStore'
import {
  upperCase,
  lowerCase,
  toTitleCase,
  applyCasePreservingStructure,
} from '@/features/language_edit/caseTransforms'
import { replaceOptionsFor } from '@/features/language_edit/replaceOptions'
import { SaveRegexAsRuleDialog, type RegexDraft } from '@/features/language_edit/SaveRegexAsRuleDialog'

interface Finding {
  id: number
  para_index: number
  start_offset: number
  end_offset: number
  rule_id: string
  category: string
  severity: string
  original_text: string
  suggestion: string
  // Alternate replacements supplied by workbook rules (Dash_Rules
  // Suggestion 2 / Detect_List Suggestion 2/3). Empty / undefined when
  // the rule has only a single replacement — same shape as legacy rules.
  alt_suggestions?: string[]
  message: string
  autofixable: boolean
  status: 'pending' | 'accepted' | 'edited' | 'rejected' | 'highlighted'
  edited_text?: string
  reviewer?: string
  decided_at?: string
  source?: 'rule' | 'term'
  term_list_id?: number | null
}

// "Term from list: <name>" or "Term from list: <name> (also in: <names>)"
const TERM_MESSAGE_RE = /^Term from list:\s*([^(]+?)(?:\s*\(also in:\s*(.+)\))?\s*$/
function parseTermMeta(message: string): { listName: string | null; alsoIn: string[] } {
  const m = TERM_MESSAGE_RE.exec(message || '')
  if (!m) return { listName: null, alsoIn: [] }
  const listName = m[1]?.trim() || null
  const alsoIn = m[2] ? m[2].split(',').map(s => s.trim()).filter(Boolean) : []
  return { listName, alsoIn }
}

interface JobData {
  job_id: string
  file_id: number
  project_id: number
  status: string
  total_findings: number
  accepted_count: number
  edited_count: number
  rejected_count: number
}

interface StyleProfile {
  name: string
  description: string
  variant_to_canonical: Record<string, string>
  rules: any[]
}

export function LanguageReviewPage() {
  const navigate = useNavigate()
  const { projectId, chapterId, fileId } = useParams<{ projectId: string; chapterId: string; fileId: string }>()

  const parsedProjectId = Number.parseInt(projectId ?? '', 10)
  const parsedChapterId = Number.parseInt(chapterId ?? '', 10)
  const parsedFileId = Number.parseInt(fileId ?? '', 10)
  const normalizedFileId = Number.isInteger(parsedFileId) && parsedFileId > 0 ? parsedFileId : null
  // Journal articles open this page on a shadow book file with no chapter (see useJournalReviewMode).
  const journal = useJournalReviewMode()

  const [activeRightTab, setActiveRightTab] = useState<'all' | 'grammar' | 'spelling' | 'sentence' | 'bias' | 'term' | 'typo' | 'hyphenation' | 'comments' | 'rules'>('all')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [job, setJob] = useState<JobData | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null)
  const [editingFindingId, setEditingFindingId] = useState<number | null>(null)

  // Inline context-menu popover anchored to a clicked occurrence span.
  interface InlinePopover {
    findingId: number
    originalText: string
    anchor: { top: number; left: number; width: number; height: number }
  }
  const [inlinePopover, setInlinePopover] = useState<InlinePopover | null>(null)
  const [inlineInput, setInlineInput] = useState('')
  const inlinePopoverRef = useRef<HTMLDivElement | null>(null)

  // Comments / Author Queries (AQ) state
  const [comments, setComments] = useState<CommentRecord[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [newCommentText, setNewCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [filterUnresolved, setFilterUnresolved] = useState(false)
  const [selectedEditorText, setSelectedEditorText] = useState<string>('')
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null)

  // Scope D: Save-as-rule dialog state. ``savedRuleDraft`` captures the
  // regex + replacement + match stats at the moment the user clicks
  // "Save as rule" in the editor's Find bar, so the modal can preview
  // the first match + its $1-expanded replacement.
  const [savedRuleDraft, setSavedRuleDraft] = useState<RegexDraft | null>(null)

  // Editor and Save Hooks
  const editorRef = useRef<WysiwygEditorHandle>(null)
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const commentCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const xhtmlQuery = useFileXhtmlQuery(normalizedFileId)
  const editorSave = useEditorSave(normalizedFileId)

  // Read the TC toggle that lives inside WysiwygEditor at the moment of each
  // replace. The TrackChanges extension writes `enabled` into the editor's
  // shared storage on every toolbar click; reading it dynamically keeps the
  // single source of truth (the TC button in the editor toolbar) and avoids
  // a second toggle on this page.
  const isTrackChangesEnabled = useCallback((): boolean => {
    const ed = editorRef.current?.editor as any
    return !!ed?.storage?.trackChanges?.enabled
  }, [])

  const viewer = useSessionStore((s) => s.viewer)
  const currentUser = viewer?.username

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [editedInputs, setEditedInputs] = useState<Record<number, string>>({})

  // Rule Manager (CE Support) state
  const [savingRules, setSavingRules] = useState(false)
  const [selectedProfileKey, setSelectedProfileKey] = useState<string>('uk')
  const [availableProfiles, setAvailableProfiles] = useState<Record<string, StyleProfile>>({})
  const [activeRulesConfig, setActiveRulesConfig] = useState<any>(null)

  // Fetch comments
  const fetchComments = useCallback(async () => {
    if (!normalizedFileId) return
    setCommentsLoading(true)
    try {
      const list = await listComments(normalizedFileId)
      setComments(list)
    } catch (err) {
      console.error('Failed to load comments:', err)
    } finally {
      setCommentsLoading(false)
    }
  }, [normalizedFileId])

  const handleCreateComment = async (customText?: string) => {
    const textToPost = customText || newCommentText
    if (!normalizedFileId || !textToPost.trim()) return
    setSubmittingComment(true)
    try {
      const commentUuid = `cm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await createComment(normalizedFileId, commentUuid, textToPost.trim())
      
      if (selectedEditorText && editorRef.current) {
        editorRef.current.addCommentToSelection(commentUuid)
      }

      setNewCommentText('')
      toast.success('AQ Comment posted!')
      fetchComments()
    } catch (err) {
      toast.error('Failed to post comment.')
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleToggleResolve = async (commentUuid: string, currentResolved: boolean) => {
    if (!normalizedFileId) return
    try {
      await updateComment(normalizedFileId, commentUuid, { resolved: !currentResolved })
      toast.success(!currentResolved ? 'Comment resolved' : 'Comment reopened')
      fetchComments()
    } catch (err) {
      toast.error('Failed to update comment status.')
    }
  }

  const handleDeleteComment = async (commentUuid: string) => {
    if (!normalizedFileId) return
    try {
      await deleteComment(normalizedFileId, commentUuid)
      toast.success('Comment deleted')
      fetchComments()
    } catch (err) {
      toast.error('Failed to delete comment.')
    }
  }

  // Parse XHTML inline comments on load
  useEffect(() => {
    if (xhtmlQuery.data?.content) {
      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(xhtmlQuery.data.content, 'text/html')
        const commentNodes = doc.querySelectorAll('span[data-comment-id], span.comment[data-comment], [data-comment-id]')
        const parsedComments: CommentRecord[] = []

        commentNodes.forEach((el, idx) => {
          const uuid = el.getAttribute('data-comment-id') || `xhtml-cm-${idx}`
          const commentText = el.getAttribute('data-comment') || el.getAttribute('title') || 'Inline XHTML Comment'
          const quotedText = el.textContent?.trim() || ''

          parsedComments.push({
            comment_uuid: uuid,
            author_id: null,
            author_name: 'Author Query',
            text: commentText + (quotedText ? ` (On: "${quotedText}")` : ''),
            resolved: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
        })

        if (parsedComments.length > 0) {
          setComments((prev) => {
            const existingUuids = new Set(prev.map((c) => c.comment_uuid))
            const newInline = parsedComments.filter((c) => !existingUuids.has(c.comment_uuid))
            return [...prev, ...newInline]
          })
        }
      } catch (e) {
        console.error('Failed to parse XHTML comments:', e)
      }
    }
  }, [xhtmlQuery.data?.content, normalizedFileId])

  // Scroll active comment card into view when selectedCommentId changes
  useEffect(() => {
    if (selectedCommentId && commentCardRefs.current[selectedCommentId]) {
      commentCardRefs.current[selectedCommentId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedCommentId])

  // Fast, independent fetch of the uploaded filename for the header. Runs on
  // mount (and whenever fileId changes) so the real filename appears without
  // waiting for the heavy analyze pass. Separate from `initJob` so a slow or
  // failing analyze never leaves a stale/generic title on screen.
  useEffect(() => {
    if (!parsedFileId) {
      setFileName('')
      return
    }
    // Reset before fetching so a previous document's name never leaks onto
    // the next one while the new fetch is in flight.
    setFileName('')
    let cancelled = false
    apiClient
      .get(`/files/${parsedFileId}/language-edit/info`)
      .then(res => {
        if (!cancelled && res.data?.file_name) {
          setFileName(res.data.file_name)
        }
      })
      .catch(() => {
        /* fall back to analyze's file_name below; header will keep showing
           the File-# placeholder in the meantime. */
      })
    return () => {
      cancelled = true
    }
  }, [parsedFileId])

  // Initialize analysis job
  const initJob = useCallback(async () => {
    if (!parsedFileId) return
    setLoading(true)
    try {
      const res = await apiClient.post(`/files/${parsedFileId}/language-edit/analyze`)
      const jobId = res.data.job_id
      if (res.data.file_name) setFileName(res.data.file_name)
      const findingsRes = await apiClient.get(`/language-edit/jobs/${jobId}/findings`)
      setJob(findingsRes.data.job)
      const fetchedFindings: Finding[] = findingsRes.data.findings || []
      setFindings(fetchedFindings)

      if (fetchedFindings.length > 0) {
        setSelectedFindingId(fetchedFindings[0].id)
      }

      const editsMap: Record<number, string> = {}
      for (const f of fetchedFindings) {
        editsMap[f.id] = f.edited_text || f.suggestion
      }
      setEditedInputs(editsMap)
    } catch (err: any) {
      console.error('Failed to run Language Edit analysis:', err)
      toast.error(err?.response?.data?.detail || 'Failed to run Language Edit analysis.')
    } finally {
      setLoading(false)
    }
  }, [parsedFileId])

  // Load Rule Profiles for CE Support
  const loadRulesConfig = useCallback(async () => {
    if (!parsedProjectId) return
    try {
      const res = await apiClient.get(`/projects/${parsedProjectId}/language-rules`)
      setAvailableProfiles(res.data.available_profiles || {})
      setActiveRulesConfig(res.data.active_rules || null)
      if (res.data.active_rules?.profile_key) {
        setSelectedProfileKey(res.data.active_rules.profile_key)
      }
    } catch (err) {
      console.error('Failed to load language rules:', err)
    }
  }, [parsedProjectId])

  useEffect(() => {
    initJob()
    loadRulesConfig()
    fetchComments()
  }, [initJob, loadRulesConfig, fetchComments])

  // Scroll active finding card into view when selectedFindingId changes
  useEffect(() => {
    if (selectedFindingId && cardRefs.current[selectedFindingId]) {
      cardRefs.current[selectedFindingId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedFindingId])

  // Handle Finding Decision
  const handleDecide = async (findingId: number, status: 'accepted' | 'edited' | 'rejected' | 'highlighted') => {
    const finding = findings.find(f => f.id === findingId)
    const editedText = editedInputs[findingId] ?? finding?.suggestion ?? ''

    try {
      await apiClient.post(`/language-edit/findings/${findingId}/decide`, {
        status,
        edited_text: status === 'edited' ? editedText : undefined,
        reviewer: 'editor'
      })

      // Replace text or apply highlight directly inside WysiwygEditor
      if (editorRef.current && finding) {
        const occ: Occurrence = {
          para_index: finding.para_index,
          match_start: finding.start_offset,
          match_end: finding.end_offset,
          surface: finding.original_text,
          category: finding.category
        }
        if (status === 'highlighted') {
          editorRef.current.replaceOccurrence(occ, '', replaceOptionsFor('highlighted', false))
        } else if (status === 'accepted' || status === 'edited') {
          const repText = status === 'edited' ? editedText : (finding.suggestion || '')
          // Honor the editor's TC toggle: ON ⇒ record a del+ins pair so the
          // original stays visible as a tracked deletion and the new text is
          // an identifiable insertion; OFF ⇒ plain in-place replace.
          editorRef.current.replaceOccurrence(
            occ,
            repText,
            replaceOptionsFor(status, isTrackChangesEnabled()),
          )
        }
      }

      setFindings(prev =>
        prev.map(f => (f.id === findingId ? { ...f, status, edited_text: editedText } : f))
      )

      setJob(prev => {
        if (!prev) return prev
        const oldStatus = findings.find(f => f.id === findingId)?.status
        let accepted = prev.accepted_count
        let edited = prev.edited_count
        let rejected = prev.rejected_count

        if (oldStatus === 'accepted') accepted--
        if (oldStatus === 'edited') edited--
        if (oldStatus === 'rejected') rejected--

        if (status === 'accepted') accepted++
        if (status === 'edited') edited++
        if (status === 'rejected') rejected++

        return { ...prev, accepted_count: accepted, edited_count: edited, rejected_count: rejected }
      })

      if (editingFindingId === findingId) {
        setEditingFindingId(null)
      }

      toast.success(`Finding ${status}`)
    } catch (err) {
      toast.error('Failed to save decision')
    }
  }

  // Batch Accept All
  const handleAcceptAll = async () => {
    const pending = findings.filter(f => f.status === 'pending')
    if (pending.length === 0) {
      toast.info('No pending findings to accept.')
      return
    }

    for (const f of pending) {
      await handleDecide(f.id, 'accepted')
    }
    toast.success(`Accepted all ${pending.length} findings!`)
  }

  // Batch Highlight All Pending
  const handleHighlightAll = async () => {
    const pending = findings.filter(f => f.status === 'pending')
    if (pending.length === 0) {
      toast.info('No pending findings to highlight.')
      return
    }

    for (const f of pending) {
      await handleDecide(f.id, 'highlighted')
    }
    toast.success(`Highlighted all ${pending.length} pending findings!`)
  }

  // Export Redlined DOCX
  const handleExportRedline = async () => {
    if (!job?.job_id) return
    setExporting(true)
    try {
      const response = await apiClient.post(
        `/language-edit/jobs/${job.job_id}/export`,
        {},
        { responseType: 'blob' }
      )

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      const stem = (fileName || `file_${parsedFileId ?? ''}`).replace(/\.[^/.]+$/, '')
      link.setAttribute('download', `${stem}_redline.docx`)
      document.body.appendChild(link)
      link.click()
      link.remove()

      toast.success('Redlined DOCX exported!')
    } catch (err) {
      toast.error('Failed to export redlined DOCX.')
    } finally {
      setExporting(false)
    }
  }

  // Save Rule Configuration to CE Support
  const handleSaveRulesToCESupport = async () => {
    if (!parsedProjectId || !activeRulesConfig) return
    setSavingRules(true)
    try {
      await apiClient.post(`/projects/${parsedProjectId}/language-rules`, {
        profile_key: selectedProfileKey,
        rules: activeRulesConfig.rules,
        variant_to_canonical: activeRulesConfig.variant_to_canonical,
        profile_name: activeRulesConfig.name
      })
      toast.success('Language rules saved to project CE support directory!')
    } catch (err) {
      toast.error('Failed to save language rules.')
    } finally {
      setSavingRules(false)
    }
  }

  // Map findings to editor occurrences.
  //
  // Decoration lifecycle, scoped per finding (per-finding — this is why we
  // don't throw out the whole occurrence array when a single finding is
  // resolved; term highlights and other unrelated findings keep their
  // decorations because their `surface` is untouched):
  //   * pending / highlighted → decorate the original word.
  //   * edited → decorate the user's new text (the original is no longer in
  //     the document). Without this swap OccurrenceHighlight can't locate
  //     the surface and the user perceives the highlight as "disappeared"
  //     even though the finding is still live.
  //   * accepted → replaceOccurrence left `<del>` on the old span and
  //     inserted `<ins>` for the new text; OccurrenceHighlight already
  //     skips any range covered by `<del>`. We clear surface to make this
  //     explicit (the plugin treats empty surfaces as "no decoration").
  //   * rejected → user has dismissed this finding; clear surface so just
  //     this one's decoration is removed, no index renumbering.
  //
  // We keep this array index-aligned with `findings`: the decoration's
  // data-occ-index comes from this array's position, and handleOccurrenceClick
  // looks up `findings[idx]` to find the matching card.
  const editorOccurrences = useMemo(() => {
    return findings.map((f) => {
      let surface = f.original_text
      if (f.status === 'edited') {
        surface = f.edited_text || f.suggestion || f.original_text
      } else if (f.status === 'accepted' || f.status === 'rejected') {
        surface = ''
      }
      return {
        para_index: f.para_index,
        match_start: f.start_offset,
        match_end: f.end_offset,
        surface,
        category: f.category,
      } as Occurrence
    })
  }, [findings])

  const selectedOccurrenceIndex = useMemo(() => {
    if (selectedFindingId === null) return -1
    return findings.findIndex((f) => f.id === selectedFindingId)
  }, [findings, selectedFindingId])

  // Direct scroll-to-span via the OccurrenceHighlight decoration's data-occ-index
  // attribute. This bypasses the WysiwygEditor useEffect roundtrip (which can
  // miss when selectedFindingId doesn't change value or when the found block
  // isn't a <p>/<h*>), so clicking any finding card reliably focuses its span.
  const focusOccurrenceInEditor = useCallback((findingId: number) => {
    const occIdx = findings.findIndex(ff => ff.id === findingId)
    if (occIdx < 0) return
    const tryScroll = () => {
      const editorDom = (editorRef.current?.editor as any)?.view?.dom as HTMLElement | undefined
      if (!editorDom) return false
      const el = editorDom.querySelector<HTMLElement>(`[data-occ-index="${occIdx}"]`)
      if (!el) return false
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }
    // Two RAFs: first lets React commit, second lets ProseMirror re-render decorations.
    requestAnimationFrame(() => {
      if (tryScroll()) return
      requestAnimationFrame(() => { tryScroll() })
    })
  }, [findings])

  // Close inline popover: clear state + input.
  const closeInlinePopover = useCallback(() => {
    setInlinePopover(null)
    setInlineInput('')
  }, [])

  // Apply the user's replacement text to the exact occurrence span in the editor.
  // Mutates the editor state (dirties it) but does NOT persist to DOCX — the user
  // must still click "Save Edits to DOCX".
  const applyInlineReplace = useCallback((rawText: string) => {
    if (!inlinePopover) return
    const target = findings.find(f => f.id === inlinePopover.findingId)
    if (!target) { closeInlinePopover(); return }
    const newText = rawText
    if (!newText || newText === target.original_text) { closeInlinePopover(); return }

    const occ: Occurrence = {
      para_index: target.para_index,
      match_start: target.start_offset,
      match_end: target.end_offset,
      surface: target.original_text,
      category: target.category,
    }
    // Honor the editor's TC toggle: ON ⇒ record a del+ins pair (same as the
    // sidebar Accept/Edit path and the editor's Backspace behavior), OFF ⇒
    // plain in-place replace that preserves surrounding marks without new
    // track-changes markup. The case-conversion buttons feed through this
    // same path, so UPPERCASE/lowercase/Title Case replacements are tracked
    // when TC is ON.
    const ok = editorRef.current?.replaceOccurrence(
      occ,
      newText,
      replaceOptionsFor('edited', isTrackChangesEnabled()),
    )
    if (!ok) {
      toast.error('Could not locate the exact text to replace. The document may have changed.')
      closeInlinePopover()
      return
    }

    // Persist decision — non-blocking.
    apiClient.post(`/language-edit/findings/${target.id}/decide`, {
      status: 'edited',
      edited_text: newText,
      reviewer: 'editor',
    }).catch(err => console.warn('Failed to persist edit decision:', err))

    // Mark this finding `edited` and record the new text. editorOccurrences
    // reads `edited_text` as the new decoration surface so the highlight
    // tracks onto the replacement, preserving navigation + status while
    // leaving unrelated findings' decorations untouched.
    setFindings(prev => prev.map(f => f.id === target.id
      ? { ...f, status: 'edited', edited_text: newText }
      : f
    ))

    toast.success('Replaced')
    closeInlinePopover()
  }, [inlinePopover, findings, closeInlinePopover])

  // Bi-directional click: when user clicks an occurrence in WysiwygEditor canvas,
  // (a) select the matching sidebar card, (b) open the inline edit popover.
  const handleOccurrenceClick = useCallback((idx: number) => {
    const target = findings[idx]
    if (!target) return
    setSelectedFindingId(target.id)
    // Legacy 'compounds' / 'compound' category findings (from pre-merge
    // analyze runs) share the Hyphenation tab now, so map them to the
    // right tab on click rather than trying to switch to a tab that no
    // longer exists.
    const legacyCompoundCat = target.category === 'compounds' || target.category === 'compound'
    const resolvedCat = legacyCompoundCat ? 'hyphenation' : target.category
    if (activeRightTab !== 'all' && ['grammar', 'spelling', 'sentence', 'bias', 'term', 'typo', 'hyphenation'].includes(resolvedCat)) {
      setActiveRightTab(resolvedCat as any)
    }

    // Anchor the popover to the clicked span's rect. Two RAFs so ProseMirror
    // has finished its decoration render before we read the DOM.
    requestAnimationFrame(() => {
      const dom = (editorRef.current?.editor as any)?.view?.dom as HTMLElement | undefined
      const el = dom?.querySelector<HTMLElement>(`[data-occ-index="${idx}"]`)
      if (!el) return
      const r = el.getBoundingClientRect()
      setInlinePopover({
        findingId: target.id,
        originalText: target.original_text,
        anchor: { top: r.top, left: r.left, width: r.width, height: r.height },
      })
      const initial = target.edited_text || target.suggestion || target.original_text
      setInlineInput(initial)
    })
  }, [findings, activeRightTab])

  // Esc closes popover; click outside the popover also closes.
  useEffect(() => {
    if (!inlinePopover) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeInlinePopover() }
    }
    const onPointerDown = (e: MouseEvent) => {
      const el = inlinePopoverRef.current
      if (el && !el.contains(e.target as Node)) {
        // Clicking another occurrence span will immediately re-open the popover
        // via handleOccurrenceClick, so this close + reopen is harmless.
        closeInlinePopover()
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [inlinePopover, closeInlinePopover])

  // Category counts & filtered findings
  const grammarFindings = useMemo(() => findings.filter(f => f.category === 'grammar'), [findings])
  const spellingFindings = useMemo(() => findings.filter(f => f.category === 'spelling'), [findings])
  const sentenceFindings = useMemo(() => findings.filter(f => f.category === 'sentence'), [findings])
  const biasFindings = useMemo(() => findings.filter(f => f.category === 'bias' || f.category === 'article'), [findings])
  const termFindings = useMemo(() => findings.filter(f => f.category === 'term' || f.source === 'term'), [findings])
  const typoFindings = useMemo(() => findings.filter(f => f.category === 'typo'), [findings])
  // Hyphenation absorbs the old Compounds category (single tab per the
  // Option B merge). Legacy jobs persisted with category='compounds' /
  // 'compound' still show up here so previously-analysed documents keep
  // rendering their MC_COMPOUNDS findings without re-analyze.
  const hyphenationFindings = useMemo(
    () => findings.filter(f => f.category === 'hyphenation' || f.category === 'compounds' || f.category === 'compound'),
    [findings],
  )

  const activeCategoryFindings = useMemo(() => {
    let list: Finding[] = []
    if (activeRightTab === 'all') list = findings
    else if (activeRightTab === 'grammar') list = grammarFindings
    else if (activeRightTab === 'spelling') list = spellingFindings
    else if (activeRightTab === 'sentence') list = sentenceFindings
    else if (activeRightTab === 'bias') list = biasFindings
    else if (activeRightTab === 'term') list = termFindings
    else if (activeRightTab === 'typo') list = typoFindings
    else if (activeRightTab === 'hyphenation') list = hyphenationFindings

    if (!searchQuery.trim()) return list
    const q = searchQuery.toLowerCase()
    return list.filter(
      (f) =>
        f.original_text.toLowerCase().includes(q) ||
        f.message.toLowerCase().includes(q) ||
        f.rule_id.toLowerCase().includes(q),
    )
  }, [activeRightTab, findings, grammarFindings, spellingFindings, sentenceFindings, biasFindings, termFindings, typoFindings, hyphenationFindings, searchQuery])

  // Realtime progress statistics
  const totalFindingsCount = job?.total_findings || findings.length || 0
  const resolvedCount = (job?.accepted_count || 0) + (job?.edited_count || 0) + (job?.rejected_count || 0)
  const remainingCount = Math.max(0, totalFindingsCount - resolvedCount)
  const progressPercentage = totalFindingsCount > 0 ? Math.min(100, Math.round((resolvedCount / totalFindingsCount) * 100)) : 0

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-800 font-sans antialiased overflow-hidden">
      
      {/* Dynamic CSS for Clarity design system highlights & diffs */}
      <style>{`
        .diff-old { text-decoration: line-through; color: #b91c1c; background-color: #fee2e2; }
        .diff-new { color: #047857; background-color: #d1fae5; }
        .chip { transition: all 0.15s ease; }
        .card-enter { animation: cardIn 0.25s ease; }
        @keyframes cardIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

        .occurrence-highlight { border-radius: 3px; padding: 0 2px; cursor: pointer; transition: all 0.15s ease; box-decoration-break: clone; }
        .occurrence-highlight:hover { filter: brightness(0.92); }
        /* Category palette per spec (consistent with sidebar legend/chips):
             Sentence   = soft yellow        #fef9c3
             Term       = light lavender     #ede9fe
             Grammar    = soft orange        #ffedd5
             Spelling   = light blue         #e0f2fe
             Compounds  = soft green         #d1fae5
             Inclusive  = soft pink          #ffe4e6
           All opaque pastels so when decorations overlap (ProseMirror nests
           spans by range), the inner (more specific / later) decoration shows
           its own distinct color instead of blending into mud with the outer.
           Higher-specificity selector (.ProseMirror .occurrence-*) + !important
           beats the WysiwygEditor base .occurrence-highlight !important rule,
           preventing the base orange from ever leaking through — this is the
           "generic rule overriding category colors" case from req #5. */
        .ProseMirror .occurrence-grammar    { background-color: #ffedd5 !important; box-shadow: none !important; border-bottom: 0 !important; text-decoration: none !important; }
        .ProseMirror .occurrence-spelling   { background-color: #e0f2fe !important; box-shadow: none !important; border-bottom: 0 !important; text-decoration: none !important; }
        .ProseMirror .occurrence-sentence   { background-color: #fef9c3 !important; box-shadow: none !important; border-bottom: 0 !important; text-decoration: none !important; }
        .ProseMirror .occurrence-bias       { background-color: #ffe4e6 !important; box-shadow: none !important; border-bottom: 0 !important; text-decoration: none !important; }
        .ProseMirror .occurrence-term       { background-color: #ede9fe !important; box-shadow: none !important; border-bottom: 0 !important; text-decoration: none !important; }
        /* Typo (pyspellchecker) — soft red/salmon so it's unmistakable but
           not alarming. Distinct from the Spelling (house-style) soft blue. */
        .ProseMirror .occurrence-typo       { background-color: #fecaca !important; box-shadow: none !important; border-bottom: 0 !important; text-decoration: none !important; }
        /* Hyphenation (workbook: Dash_Rules + Detect_List + En_Dash_Terms +
           the LWW curated compound list). Teal pastel.
           '.occurrence-compounds' is aliased to the same teal so legacy jobs
           persisted with the pre-merge 'compounds' category render
           consistently alongside new 'hyphenation' findings. */
        .ProseMirror .occurrence-hyphenation,
        .ProseMirror .occurrence-compounds,
        .ProseMirror .occurrence-compound   { background-color: #ccfbf1 !important; box-shadow: none !important; border-bottom: 0 !important; text-decoration: none !important; }
        /* Abbreviations (Do_Not_Use regex + Phase-B expansion rules).
           Soft indigo — distinct from Hyphenation teal but shares the
           cool-palette family. */
        .ProseMirror .occurrence-abbreviations { background-color: #e0e7ff !important; box-shadow: none !important; border-bottom: 0 !important; text-decoration: none !important; }
        /* Medical Terms workbook — pale green highlight so medical findings
           are visually distinct from the teal (Hyphenation) and indigo
           (Abbreviations) workbook categories. */
        .ProseMirror .occurrence-medical_terms { background-color: #d1fae5 !important; box-shadow: none !important; border-bottom: 0 !important; text-decoration: none !important; }
        .ProseMirror .occurrence-medical_terms:hover { background-color: #a7f3d0 !important; }
        .ProseMirror .occurrence-grammar:hover   { background-color: #fed7aa !important; }
        .ProseMirror .occurrence-spelling:hover  { background-color: #bae6fd !important; }
        .ProseMirror .occurrence-sentence:hover  { background-color: #fef08a !important; }
        .ProseMirror .occurrence-bias:hover      { background-color: #fecdd3 !important; }
        .ProseMirror .occurrence-term:hover      { background-color: #ddd6fe !important; }
        .ProseMirror .occurrence-typo:hover      { background-color: #fca5a5 !important; }
        .ProseMirror .occurrence-hyphenation:hover,
        .ProseMirror .occurrence-compounds:hover,
        .ProseMirror .occurrence-compound:hover  { background-color: #99f6e4 !important; }
        .ProseMirror .occurrence-abbreviations:hover { background-color: #c7d2fe !important; }
        /* Selected (click-to-edit focus) — distinct green, no underline, no
           pulsing animation. The decoration only wraps the finding's exact
           range (never the paragraph node), so even for a long sentence
           finding this colors exactly its surface — not the paragraph. Higher
           specificity (.ProseMirror + 2 attrs) beats the WysiwygEditor base
           [class*=][class*=] rule that would otherwise force a thick green
           border-bottom underline. */
        .ProseMirror .occurrence-highlight-selected,
        .ProseMirror [class*="occurrence-"][class*="-selected"] {
          background-color: #bbf7d0 !important;
          border-bottom: 0 !important;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.6) !important;
          color: #052e16 !important;
          font-weight: 600 !important;
          text-decoration: none !important;
          outline: 2px solid #16a34a !important;
          outline-offset: 1px !important;
          border-radius: 4px !important;
          animation: none !important;
        }
        /* Keep DOCX-origin yellow highlights (TipTap <mark>) distinguishable
           from the finding overlays: use a warmer saturated yellow with a
           subtle shadow outline, so <mark> reads as "manually highlighted
           by Word" vs the finding palette's pastels. Scoped to editor root
           to avoid touching mark badges elsewhere. */
        .ProseMirror mark { background-color: #fde047 !important; color: #713f12 !important; box-shadow: inset 0 0 0 1px rgba(161, 98, 7, 0.35) !important; }
      `}</style>

      {/* ══ HEADER BAR (CLARITY DESIGN) ════════════════════════════════════════ */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(journal ? journal.backHref : uiPaths.chapterDetail(parsedProjectId, parsedChapterId))}
            className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title={journal ? journal.backLabel : 'Back to Chapter'}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              {journal ? (
                <Link to={journal.backHref} className="hover:text-slate-600">Journal article #{journal.articleId}</Link>
              ) : (
                <>
                  <Link to={uiPaths.projectDetail(parsedProjectId)} className="hover:text-slate-600">
                    Project #{parsedProjectId}
                  </Link>
                  <span>/</span>
                  <Link to={uiPaths.chapterDetail(parsedProjectId, parsedChapterId)} className="hover:text-slate-600">
                    Chapter #{parsedChapterId}
                  </Link>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className="font-semibold text-slate-800 text-sm"
                title={fileName || undefined}
              >
                {fileName || (parsedFileId ? `File #${parsedFileId}` : 'Loading…')}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-100 text-violet-600">
                Language Review
              </span>
            </div>
          </div>
        </div>

        {/* Realtime Progress Bar */}
        <div className="flex items-center gap-3 flex-1 max-w-md mx-8">
          <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
            {resolvedCount} of {totalFindingsCount} resolved
          </span>
          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-violet-600">{progressPercentage}%</span>
        </div>

        {/* Action Pills */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleAcceptAll}
            className="px-3.5 py-2 rounded-full text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            <Check size={14} /> Accept remaining
          </button>
          <button
            onClick={handleHighlightAll}
            className="px-3.5 py-2 rounded-full text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1.5"
          >
            <Highlighter size={14} /> Highlight pending
          </button>
          <button
            onClick={handleExportRedline}
            disabled={exporting}
            className="px-4 py-2 rounded-full text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 shadow-sm shadow-violet-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export clean copy
          </button>
        </div>
      </header>

      {/* ══ SPLIT SCREEN WORKSPACE ═════════════════════════════════════════════ */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 bg-slate-50">
          <Loader2 className="animate-spin text-violet-600" size={32} />
          <p className="text-sm font-medium">Running Language Editing engine on document...</p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          
          {/* ── LEFT SIDE: WYSIWYG MANUSCRIPT CANVAS (FULL WIDTH) ── */}
          <main className="flex-1 bg-white flex flex-col border-r border-slate-200 overflow-hidden relative w-full h-full">
            <div className="w-full flex-1 flex flex-col overflow-hidden relative">
              <div className="h-10 bg-slate-50 border-b border-slate-100 px-6 flex items-center justify-between text-xs text-slate-500 flex-shrink-0">
                <span className="font-semibold text-slate-700">Document Manuscript Canvas</span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-300"></span> Grammar
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-300"></span> Spelling
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-300"></span> Sentence
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-300"></span> Inclusive
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-violet-300"></span> Terms
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-300"></span> Spell Check
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-teal-300"></span> Hyphenation
                  </span>
                </div>
              </div>

              <div className="flex-1 relative min-h-0 overflow-hidden bg-white text-slate-800">
                {xhtmlQuery.isPending ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-white text-slate-500">
                    <RefreshCw className="w-8 h-8 text-violet-600 animate-spin" />
                    <div className="text-sm font-bold text-slate-800">Loading Document Manuscript...</div>
                    <div className="text-xs text-slate-400">Preparing interactive document layout</div>
                  </div>
                ) : xhtmlQuery.isError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center space-y-3 bg-white">
                    <AlertTriangle className="w-8 h-8 text-rose-500" />
                    <div className="text-sm font-bold text-slate-800">Manuscript View Unavailable</div>
                    <div className="text-xs text-slate-400 max-w-sm">Failed to fetch XHTML document. Verify file status.</div>
                  </div>
                ) : (
                  <WysiwygEditor
                    ref={editorRef}
                    key={`editor-${parsedFileId}`}
                    initialContent={xhtmlQuery.data?.content ?? ''}
                    onSave={async (html) => {
                      await editorSave.save(html)
                    }}
                    isSaving={editorSave.isPending}
                    saveLabel="Save Edits to DOCX"
                    documentTitle={fileName}
                    height="100%"
                    // Track Changes defaults ON for every opened document so
                    // Accept / Edit / popover Replace / case-conversion
                    // produce visible red-strikethrough + green-highlight
                    // revisions out of the box. The toolbar's TC toggle is
                    // still the live source of truth — if the editor
                    // switches it OFF, the plugin's storage.enabled follows
                    // and subsequent replacements are plain in-place swaps.
                    // The parent `key={editor-${parsedFileId}}` remounts the
                    // editor whenever the file changes, so switching
                    // documents (or chapters) resets the default back to ON
                    // for the next document — a manual OFF never leaks past
                    // the current document session.
                    trackChangesEnabled={true}
                    occurrences={editorOccurrences}
                    selectedOccurrenceIndex={selectedOccurrenceIndex}
                    onOccurrenceClick={handleOccurrenceClick}
                    onSelectionChange={(text) => setSelectedEditorText(text)}
                    onCommentClick={(commentId) => {
                      setActiveRightTab('comments')
                      setSelectedCommentId(commentId)
                    }}
                    currentUser={currentUser}
                    fileId={parsedFileId.toString()}
                    onSaveAsRule={Number.isInteger(parsedProjectId) && parsedProjectId > 0
                      ? (draft) => setSavedRuleDraft(draft)
                      : undefined}
                  />
                )}
              </div>
            </div>
          </main>

          {/* Scope D: Save-as-rule modal (opens from the editor Find bar) */}
          {Number.isInteger(parsedProjectId) && parsedProjectId > 0 && (
            <SaveRegexAsRuleDialog
              open={!!savedRuleDraft}
              projectId={parsedProjectId}
              draft={savedRuleDraft}
              onClose={() => setSavedRuleDraft(null)}
              onSaved={(rule) => {
                toast.success(
                  `Saved custom rule "${rule.message ?? rule.id}". It will fire on the next analyze.`,
                )
              }}
            />
          )}

          {/* ── RIGHT SIDE: SIDE PANEL (CLARITY DESIGN) ── */}
          <aside className="w-[420px] bg-white border-l border-slate-100 flex flex-col flex-shrink-0 overflow-hidden">
            
            {/* Header Greeting & Search & Chips */}
            <div className="p-5 border-b border-slate-100 flex-shrink-0">
              <p className="text-sm font-semibold text-slate-800">👋 Nice progress, Editor!</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {remainingCount > 0 ? `${remainingCount} suggestions left to look at. You've got this.` : 'All suggestions reviewed! Excellent work.'}
              </p>

              {/* Pill Search Input */}
              {activeRightTab !== 'rules' && activeRightTab !== 'comments' && (
                <div className="relative mt-4">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search suggestions…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-full pl-9 pr-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all"
                  />
                </div>
              )}

              {/* Category Filter Chips */}
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                <button
                  onClick={() => setActiveRightTab('all')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-semibold ${
                    activeRightTab === 'all'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All {findings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('grammar')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'grammar'
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                  }`}
                >
                  Grammar {grammarFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('spelling')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'spelling'
                      ? 'bg-sky-500 text-white shadow-sm'
                      : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                  }`}
                >
                  Spelling {spellingFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('sentence')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'sentence'
                      ? 'bg-yellow-500 text-white shadow-sm'
                      : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                  }`}
                >
                  Sentence {sentenceFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('bias')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'bias'
                      ? 'bg-rose-500 text-white shadow-sm'
                      : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                  }`}
                >
                  Inclusive {biasFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('term')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'term'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                  }`}
                >
                  Terms {termFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('typo')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'typo'
                      ? 'bg-red-500 text-white shadow-sm'
                      : 'bg-red-50 text-red-700 hover:bg-red-100'
                  }`}
                  title="Likely typos detected by the spell checker"
                >
                  Spell Check {typoFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('hyphenation')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'hyphenation'
                      ? 'bg-teal-500 text-white shadow-sm'
                      : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                  }`}
                  title="Hyphen and en-dash workbook rules"
                >
                  Hyphenation {hyphenationFindings.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('comments')}
                  className={`chip px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 ${
                    activeRightTab === 'comments'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                  }`}
                >
                  <MessageSquare size={12} />
                  Comments {comments.length}
                </button>

                <button
                  onClick={() => setActiveRightTab('rules')}
                  className={`chip p-1.5 rounded-full text-xs font-medium ${
                    activeRightTab === 'rules'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  title="CE Support Rules Manager"
                >
                  <Sliders size={14} />
                </button>
              </div>
            </div>

            {/* Panel Content Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
              {activeRightTab === 'comments' ? (
                /* ── DEDICATED COMMENTS / AUTHOR QUERIES (AQ) TAB ── */
                <div className="space-y-4">
                  {/* Compose New AQ Comment */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <MessageCircle size={14} className="text-violet-600" /> Post Author Query / AQ Comment
                      </span>
                      <span className="text-[10px] text-slate-400">Attached to document</span>
                    </div>

                    {/* Attached Selection Badge */}
                    {selectedEditorText ? (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-800 flex items-center justify-between shadow-xs">
                        <span className="truncate max-w-[280px]">
                          <strong>Attached to selection:</strong> "{selectedEditorText}"
                        </span>
                        <span className="text-[10px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full font-bold uppercase shrink-0">Selected</span>
                      </div>
                    ) : (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-500 italic">
                        💡 Select text in the document editor to anchor your AQ comment directly.
                      </div>
                    )}

                    {/* Quick Preset Buttons */}
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        'AQ: Please cite reference in text.',
                        'AQ: Define abbreviation on first use.',
                        'AQ: Verify numerical data accuracy.',
                        'AQ: Confirm author name spelling.'
                      ].map((preset, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleCreateComment(preset)}
                          className="px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-medium transition-colors flex items-center gap-1"
                        >
                          <Plus size={10} /> {preset}
                        </button>
                      ))}
                    </div>

                    <textarea
                      rows={3}
                      placeholder="Type an Author Query (AQ) comment or editor note..."
                      value={newCommentText}
                      onChange={(e) => setNewCommentText(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 resize-none"
                    />

                    <div className="flex justify-end">
                      <button
                        onClick={() => handleCreateComment()}
                        disabled={submittingComment || !newCommentText.trim()}
                        className="px-4 py-1.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                      >
                        {submittingComment ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
                        Post AQ Comment
                      </button>
                    </div>
                  </div>

                  {/* Filter Header */}
                  <div className="flex items-center justify-between px-1 text-xs text-slate-500">
                    <span>
                      Total Comments: <strong className="text-slate-800">{comments.length}</strong>
                    </span>
                    <button
                      onClick={() => setFilterUnresolved(prev => !prev)}
                      className={`text-[11px] font-medium transition-colors ${
                        filterUnresolved ? 'text-violet-600 underline' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {filterUnresolved ? 'Showing Open AQ Only' : 'Show Open AQ Only'}
                    </button>
                  </div>

                  {/* Comments List */}
                  {commentsLoading ? (
                    <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                      <Loader2 className="animate-spin text-violet-600" size={20} />
                      Loading file comments...
                    </div>
                  ) : comments.filter(c => !filterUnresolved || !c.resolved).length === 0 ? (
                    <div className="py-12 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                      <MessageSquare size={24} className="mx-auto mb-2 text-slate-300" />
                      No comments or author queries found. Post a comment above to get started.
                    </div>
                  ) : (
                    comments
                      .filter(c => !filterUnresolved || !c.resolved)
                      .map(comment => (
                        <div
                          key={comment.comment_uuid}
                          ref={(el) => (commentCardRefs.current[comment.comment_uuid] = el)}
                          onClick={() => {
                            setSelectedCommentId(comment.comment_uuid)
                            editorRef.current?.scrollToComment(comment.comment_uuid)
                          }}
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                            selectedCommentId === comment.comment_uuid
                              ? 'ring-2 ring-violet-400 border-violet-400 shadow-md bg-violet-50/20'
                              : comment.resolved
                              ? 'bg-slate-50/60 border-slate-100 opacity-60'
                              : 'bg-white border-slate-100 shadow-sm hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 font-bold text-[10px] flex items-center justify-center">
                                {(comment.author_name || 'AQ').slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="text-xs font-semibold text-slate-800">
                                  {comment.author_name || 'Reviewer'}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {comment.created_at ? new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                </div>
                              </div>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                comment.resolved
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                  : 'bg-amber-50 text-amber-700 border border-amber-100'
                              }`}
                            >
                              {comment.resolved ? 'Resolved' : 'Open AQ'}
                            </span>
                          </div>

                          <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed mb-3">
                            {comment.text}
                          </p>

                          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2 text-[11px]">
                            <button
                              onClick={() => handleToggleResolve(comment.comment_uuid, comment.resolved)}
                              className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                                comment.resolved
                                  ? 'text-slate-500 hover:text-slate-800 bg-slate-100'
                                  : 'text-emerald-700 hover:bg-emerald-100 bg-emerald-50 border border-emerald-200'
                              }`}
                            >
                              <CheckCircle2 size={12} />
                              {comment.resolved ? 'Reopen AQ' : 'Resolve AQ'}
                            </button>

                            <button
                              onClick={() => handleDeleteComment(comment.comment_uuid)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded-full hover:bg-slate-100 transition-colors"
                              title="Delete comment"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              ) : activeRightTab !== 'rules' ? (
                activeCategoryFindings.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs">
                    No suggestions found in this category.
                  </div>
                ) : (
                  activeCategoryFindings.map(f => {
                    const isSelected = f.id === selectedFindingId
                    const isAccepted = f.status === 'accepted'
                    const isEdited = f.status === 'edited'
                    const isRejected = f.status === 'rejected'
                    const isTerm = f.category === 'term' || f.source === 'term'

                    const catColorMap: Record<string, { border: string; text: string; bg: string }> = {
                      grammar: { border: 'border-l-orange-400', text: 'text-orange-600', bg: 'bg-orange-50' },
                      spelling: { border: 'border-l-sky-400', text: 'text-sky-600', bg: 'bg-sky-50' },
                      sentence: { border: 'border-l-yellow-400', text: 'text-yellow-700', bg: 'bg-yellow-50' },
                      // Hyphenation absorbs the old Compounds category. Legacy
                      // category values stay in the map (teal) so pre-merge
                      // jobs render consistently alongside new findings.
                      hyphenation: { border: 'border-l-teal-400', text: 'text-teal-600', bg: 'bg-teal-50' },
                      compounds:   { border: 'border-l-teal-400', text: 'text-teal-600', bg: 'bg-teal-50' },
                      compound:    { border: 'border-l-teal-400', text: 'text-teal-600', bg: 'bg-teal-50' },
                      bias: { border: 'border-l-rose-400', text: 'text-rose-600', bg: 'bg-rose-50' },
                      article: { border: 'border-l-rose-400', text: 'text-rose-600', bg: 'bg-rose-50' },
                      term: { border: 'border-l-violet-400', text: 'text-violet-700', bg: 'bg-violet-50' },
                      typo: { border: 'border-l-red-400', text: 'text-red-600', bg: 'bg-red-50' },
                      medical_terms: { border: 'border-l-green-500', text: 'text-green-700', bg: 'bg-green-50' },
                      abbreviations: { border: 'border-l-indigo-400', text: 'text-indigo-600', bg: 'bg-indigo-50' },
                    }

                    const catStyle = catColorMap[f.category] || { border: 'border-l-violet-400', text: 'text-violet-600', bg: 'bg-violet-50' }
                    // Rename legacy "compounds"/"compound" labels to "HYPHENATION"
                    // in the card header so the unified category reads consistently
                    // regardless of when the job was analysed.
                    const displayCategory = (f.category === 'compounds' || f.category === 'compound')
                      ? 'hyphenation'
                      : f.category === 'medical_terms'
                        ? 'medical'
                        : f.category
                    // Provenance badge: distinguishes workbook rules from the
                    // smaller hand-curated LWW compound list without needing a
                    // second filter tab.
                    const hyphSource = displayCategory === 'hyphenation'
                      ? (f.rule_id?.startsWith('compound_') ? 'LWW list' : 'Workbook')
                      : null

                    if (isTerm) {
                      const { listName, alsoIn } = parseTermMeta(f.message)
                      return (
                        <div
                          key={f.id}
                          ref={(el) => (cardRefs.current[f.id] = el)}
                          onClick={() => {
                            setSelectedFindingId(f.id)
                            focusOccurrenceInEditor(f.id)
                          }}
                          className={`finding-card card-enter p-4 rounded-2xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-all cursor-pointer border-l-4 ${catStyle.border} ${
                            isSelected ? 'ring-2 ring-violet-400 border-violet-400 shadow-md' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-[11px] font-bold uppercase tracking-wide ${catStyle.text}`}>
                              Term
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Para {f.para_index + 1}
                            </span>
                          </div>

                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-violet-100 text-violet-800 text-sm font-semibold">
                              {f.original_text}
                            </span>
                            {listName && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-violet-200 bg-white text-violet-700 text-[11px] font-medium">
                                {listName}
                              </span>
                            )}
                          </div>

                          {alsoIn.length > 0 && (
                            <p className="text-[11px] text-slate-500 mt-2">
                              Also in: {alsoIn.join(', ')}
                            </p>
                          )}

                          {!listName && (
                            <p className="text-xs text-slate-500 mt-2 leading-snug">{f.message}</p>
                          )}
                        </div>
                      )
                    }

                    return (
                      <div
                        key={f.id}
                        ref={(el) => (cardRefs.current[f.id] = el)}
                        onClick={() => {
                          setSelectedFindingId(f.id)
                          focusOccurrenceInEditor(f.id)
                        }}
                        className={`finding-card card-enter p-4 rounded-2xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-all cursor-pointer border-l-4 ${catStyle.border} ${
                          isSelected
                            ? 'ring-2 ring-violet-400 border-violet-400 shadow-md'
                            : isAccepted
                            ? 'bg-emerald-50/40 opacity-70 border-emerald-200'
                            : isEdited
                            ? 'bg-amber-50/40 opacity-80 border-amber-200'
                            : isRejected
                            ? 'bg-slate-100/60 opacity-40'
                            : ''
                        }`}
                      >
                        {/* Card Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[11px] font-bold uppercase tracking-wide ${catStyle.text}`}>
                              {displayCategory}
                            </span>
                            {hyphSource && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-500 border border-slate-200"
                                title={
                                  hyphSource === 'Workbook'
                                    ? 'Rule from the hyphen & en-dash workbook'
                                    : 'Rule from the LWW curated compound list'
                                }
                              >
                                {hyphSource}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">
                            Para {f.para_index + 1}
                          </span>
                        </div>

                        {/* Finding Message */}
                        <p className="text-sm text-slate-700 mt-1.5 font-medium leading-snug">
                          {f.message}
                        </p>

                        {/* Visual Diff Box */}
                        <div className="mt-3 flex items-center gap-2 text-sm font-medium flex-wrap">
                          <span className="diff-old px-2 py-1 rounded-lg">
                            {f.original_text}
                          </span>
                          <ArrowRight size={14} className="text-slate-300 flex-shrink-0" />
                          <span className="diff-new px-2 py-1 rounded-lg">
                            {f.edited_text || f.suggestion}
                          </span>
                        </div>

                        {/* Action Buttons */}
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDecide(f.id, 'accepted')
                            }}
                            className="flex-1 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1 shadow-sm"
                          >
                            <Check size={13} /> Accept
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingFindingId(prev => prev === f.id ? null : f.id)
                            }}
                            className="px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 transition-colors"
                          >
                            Edit
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDecide(f.id, 'highlighted')
                            }}
                            className="px-3 py-1.5 rounded-full border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-700 transition-colors"
                          >
                            Highlight
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDecide(f.id, 'rejected')
                            }}
                            className="px-3 py-1.5 rounded-full border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-400 transition-colors"
                          >
                            Ignore
                          </button>
                        </div>

                        {/* Inline Custom Edit Row */}
                        {editingFindingId === f.id && (
                          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editedInputs[f.id] ?? f.suggestion}
                              onChange={(e) => setEditedInputs({ ...editedInputs, [f.id]: e.target.value })}
                              className="flex-1 text-sm border border-violet-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-200 bg-slate-50"
                              placeholder="Type custom text..."
                            />
                            <button
                              onClick={() => handleDecide(f.id, 'edited')}
                              className="px-3.5 py-1.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                            >
                              Save Edit
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })
                )
              ) : (
                /* ── CE SUPPORT RULES MANAGER TAB ── */
                <div className="space-y-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-800">CE Support Rules Manager</h3>
                      <button
                        onClick={handleSaveRulesToCESupport}
                        disabled={savingRules}
                        className="px-3.5 py-1.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {savingRules ? 'Saving...' : 'Save to CE Support'}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">Select active style profile template for project:</p>
                    <select
                      value={selectedProfileKey}
                      onChange={e => setSelectedProfileKey(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-200 font-medium"
                    >
                      {Object.entries(availableProfiles).map(([key, prof]) => (
                        <option key={key} value={key}>{prof.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </aside>

        </div>
      )}

      {/* ══ INLINE EDIT CONTEXT POPOVER ═══════════════════════════════════════ */}
      {inlinePopover && (() => {
        const target = findings.find(f => f.id === inlinePopover.findingId)
        const dict: Record<string, string> = activeRulesConfig?.variant_to_canonical || {}
        const expansion = dict[inlinePopover.originalText] || dict[inlinePopover.originalText.toLowerCase()] || null
        const ruleSuggestion = target?.suggestion && target.suggestion !== target.original_text ? target.suggestion : null
        // Position below the span, clamp to viewport.
        const POPOVER_W = 320
        const top = inlinePopover.anchor.top + inlinePopover.anchor.height + 6
        const left = Math.max(8, Math.min(window.innerWidth - POPOVER_W - 8, inlinePopover.anchor.left))
        return (
          <div
            ref={inlinePopoverRef}
            style={{ position: 'fixed', top, left, width: POPOVER_W, zIndex: 100 }}
            className="bg-white border border-slate-200 shadow-2xl rounded-2xl p-3 text-slate-800"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-violet-600">Edit occurrence</span>
              <button
                onClick={closeInlinePopover}
                className="text-slate-400 hover:text-slate-700 text-xs leading-none"
                title="Close (Esc)"
                aria-label="Close"
              >✕</button>
            </div>

            <div className="text-[11px] text-slate-500 mb-1">Original</div>
            <div className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-md px-2 py-1 mb-2 break-words">
              {inlinePopover.originalText}
            </div>

            {(expansion || ruleSuggestion || (target?.alt_suggestions && target.alt_suggestions.length > 0)) && (
              <div className="mb-2 flex flex-wrap gap-1">
                {expansion && (
                  <button
                    type="button"
                    onClick={() => setInlineInput(expansion)}
                    className="px-2 py-1 rounded-full text-[11px] font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100"
                    title="From project dictionary"
                  >
                    Expand: {expansion}
                  </button>
                )}
                {ruleSuggestion && (
                  <button
                    type="button"
                    onClick={() => setInlineInput(ruleSuggestion)}
                    className="px-2 py-1 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                    title="Rule suggestion"
                  >
                    Suggestion: {ruleSuggestion}
                  </button>
                )}
                {/* Alternate replacements shipped by workbook rules (Dash_Rules
                    Suggestion 2 / Detect_List Suggestion 2 & 3). Picking an
                    alt writes it into the input; the existing Replace flow
                    then applies the chosen value through Track Changes. */}
                {target?.alt_suggestions?.map((alt, i) => (
                  <button
                    key={`alt-${i}`}
                    type="button"
                    onClick={() => setInlineInput(alt)}
                    className="px-2 py-1 rounded-full text-[11px] font-medium bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100"
                    title="Alternate suggestion"
                  >
                    Alt: {alt}
                  </button>
                ))}
              </div>
            )}

            <div className="text-[11px] text-slate-500 mb-1">Replace with</div>
            <input
              autoFocus
              type="text"
              value={inlineInput}
              onChange={e => setInlineInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); applyInlineReplace(inlineInput) }
                else if (e.key === 'Escape') { e.preventDefault(); closeInlinePopover() }
              }}
              className="w-full text-sm px-2.5 py-1.5 bg-white border border-violet-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-200"
              placeholder="Type replacement…"
            />

            <div className="flex flex-wrap gap-1 mt-2">
              <button
                type="button"
                onClick={() => setInlineInput(
                  applyCasePreservingStructure(inlineInput, inlinePopover.originalText, upperCase),
                )}
                className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >UPPERCASE</button>
              <button
                type="button"
                onClick={() => setInlineInput(
                  applyCasePreservingStructure(inlineInput, inlinePopover.originalText, lowerCase),
                )}
                className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >lowercase</button>
              <button
                type="button"
                onClick={() => setInlineInput(
                  applyCasePreservingStructure(inlineInput, inlinePopover.originalText, toTitleCase),
                )}
                className="px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >Title Case</button>
            </div>

            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => applyInlineReplace(inlineInput)}
                disabled={!inlineInput || inlineInput === inlinePopover.originalText}
                className="flex-1 py-1.5 rounded-full bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >Replace</button>
              <button
                type="button"
                onClick={closeInlinePopover}
                className="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >Cancel</button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
