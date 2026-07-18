import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { chaptersApi } from '@/api/chapters'
import { projectsApi } from '@/api/projects'
import { workflowsApi } from '@/api/workflows'
import type { WorkflowStage } from '@/api/workflows'
import { stageDetailsApi } from '@/api/stageDetails'
import { ChapterFilePage } from '@/pages/ChapterFilePage'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { useRBAC } from '@/hooks/useRBAC'
import apiClient from '@/api/client'
import { TransitionConfirmModal } from '@/components/TransitionConfirmModal'

function orderStages(stages: WorkflowStage[]): WorkflowStage[] {
  const byName = new Map(stages.map(s => [s.stage_name, s]))
  const first  = stages.find(s => !s.previous_stage)
  if (!first) return stages
  const result: WorkflowStage[] = []
  const visited = new Set<string>()
  let cur: WorkflowStage | undefined = first
  while (cur && !visited.has(cur.stage_name)) {
    visited.add(cur.stage_name)
    result.push(cur)
    cur = cur.next_stage ? byName.get(cur.next_stage) : undefined
  }
  stages.forEach(s => { if (!visited.has(s.stage_name)) result.push(s) })
  return result
}

type ChapterFolder = {
  chapter_name: string
  folder:       string
  files:        Record<string, Array<{
    file_name:   string
    path:        string
    file_size:   string
    size_bytes:  number
    uploaded_by: string
    uploaded_on: string
  }>>
}

export function ChapterDetailPage() {
  const { clientId, projectId, chapterId } = useParams<{
    clientId?:  string
    projectId:  string
    chapterId:  string
  }>()
  const navigate = useNavigate()
  const { viewer } = useRBAC()

  const [chapter,        setChapter]        = useState<import('@/api/chapters').Chapter | null>(null)
  const [project,        setProject]        = useState<any | null>(null)
  const [orderedStages,  setOrderedStages]  = useState<WorkflowStage[]>([])
  type FileEntry = ChapterFolder['files'][string][number]
  const [backupFiles, setBackupFiles] = useState<FileEntry[]>([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState<string | null>(null)
  const [proceedLoading, setProceedLoading] = useState(false)
  const [refreshKey,     setRefreshKey]     = useState(0)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [transitionConfig, setTransitionConfig] = useState<{
    custom_message?: string;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
  } | null>(null)
  const [transitionParams, setTransitionParams] = useState<{
    fromStage: string;
    toStage: string;
  } | null>(null)

  useEffect(() => {
    if (!chapterId || !projectId) return
    setLoading(true)
    Promise.all([
      chaptersApi.getById(Number(chapterId)),
      projectsApi.getById(Number(projectId)),
    ])
      .then(async ([ch, projResponse]) => {
        setChapter(ch)
        const proj = projResponse.project
        setProject(proj)
        // Use the chapter's own workflow (Art/Design track) if set,
        // falling back to the project's main (Manuscript) workflow.
        const chapterWorkflow = ch.workflow || proj.workflow_name
        if (chapterWorkflow) {
          const stages = await workflowsApi.getWorkflow(chapterWorkflow).catch(() => [])
          setOrderedStages(orderStages(stages))
        }
        // Fetch backup files for this chapter
        const chNo = ch.chapters.match(/\d+/)?.[0]
        if (chNo) {
          import('@/api/client').then(({ default: api }) =>
            api.get(`/uploads/${projectId}/chapter/chapter-${chNo}/backup-list`)
              .then(r => setBackupFiles(r.data.files ?? []))
              .catch(() => setBackupFiles([]))
          )
        }
      })
      .catch(() => setError('Failed to load chapter'))
      .finally(() => setLoading(false))
  }, [chapterId, projectId, refreshKey])

  // Proceed: same logic as the old ChapterDetailModal's confirmProceed
  async function executeTransitionAndEmail() {
    if (!chapter || !transitionParams || !transitionConfig) return
    setProceedLoading(true)
    try {
      await apiClient.post(`/chapters/${chapter.id}/transition-email`, {
        from_stage: transitionParams.fromStage,
        to_stage: transitionParams.toStage,
        to_emails: transitionConfig.to,
        cc_emails: transitionConfig.cc,
        subject: transitionConfig.subject,
        body: transitionConfig.body,
      })
      toast.success(`Moved to ${transitionParams.toStage}`)
      setConfirmModalOpen(false)
      navigate(-1)
    } catch {
      toast.error('Failed to transition stage')
    } finally {
      setProceedLoading(false)
    }
  }

  async function handleProceed() {
    if (!chapter || !project) return
    const projectCode = project.code || project.project_code
    if (!projectCode) {
      toast.error('Project code not found')
      return
    }
    const currentStage = chapter.stage_name
    let nextStage: string | null = null

    if (!currentStage) {
      nextStage = orderedStages.length > 0 ? orderedStages[0].stage_name : null
    } else {
      const stageIdx = orderedStages.findIndex(s => s.stage_name === currentStage)
      if (stageIdx >= 0 && stageIdx < orderedStages.length - 1) {
        nextStage = orderedStages[stageIdx + 1].stage_name
      } else if (stageIdx === -1 && orderedStages.length > 0) {
        nextStage = orderedStages[0].stage_name
      }
    }

    if (!nextStage) { toast.error('Already on the last stage'); return }

    setProceedLoading(true)
    try {
      const { data } = await apiClient.get(`/chapters/${chapter.id}/transition-config?next_stage=${encodeURIComponent(nextStage)}`)
      if (data && data.has_config) {
        setTransitionConfig(data)
        setTransitionParams({ fromStage: currentStage ?? '', toStage: nextStage })
        setConfirmModalOpen(true)
      } else {
        const result = await stageDetailsApi.stageTransition(
          projectCode, chapter.chapters, currentStage ?? '', nextStage
        )
        const isLastStage = orderedStages.length > 0 && nextStage === orderedStages[orderedStages.length - 1].stage_name
        await chaptersApi.update(chapter.id, {
          stage_name:            nextStage,
          current_assignee_name: null,
          status:                isLastStage ? 'complete' : chapter.status,
          due_date:              result?.planned_end_date ? result.planned_end_date.split('T')[0] : chapter.due_date,
        })
        toast.success(`Moved to ${nextStage}`)
        navigate(-1)
      }
    } catch {
      toast.error('Failed to proceed')
    } finally {
      setProceedLoading(false)
    }
  }

  // Derive chapter folder data from project.file_details, merging in backup files
  const chapterFolderData: ChapterFolder | null = (() => {
    if (!chapter || !project?.file_details) return null
    const chName = chapter.chapters
    const isVirtual = chName.toLowerCase() === 'design' || chName.toLowerCase() === 'ce support'

    const cf = (project.file_details as { chapter_folders?: { chapters?: ChapterFolder[] } }).chapter_folders
    const base = cf?.chapters?.find(c => {
      const cName = c.chapter_name.toLowerCase()
      const chNameLower = chName.toLowerCase()
      
      if (isVirtual) {
        return cName === chNameLower || cName === `chapter-${chNameLower}`
      }

      // Direct exact match
      if (cName === chNameLower || cName === `chapter-${chNameLower}`) return true
      // Suffix match
      if (cName.includes(chNameLower)) return true
      
      // Match by digits and track type (Manuscript vs Art)
      const digitsMatch = chName.match(/\d+/)?.[0]
      if (digitsMatch) {
        const cDigits = cName.match(/\d+/)?.[0]
        if (cDigits === digitsMatch) {
          const chIsArt = chNameLower.includes('art')
          const folderIsArt = cName.includes('art')
          return chIsArt === folderIsArt
        }
      }
      return false
    }) ?? null
    if (!base) return null
    return {
      ...base,
      files: { ...base.files, Backup: backupFiles },
    }
  })()

  if (loading) return <FullPageSpinner/>
  if (error || !chapter || !project) {
    return (
      <div className="flex items-center justify-center h-64 text-muted text-sm">
        {error ?? 'Chapter not found'}
      </div>
    )
  }

  return (
    <>
      <ChapterFilePage
        chapterFolderData={chapterFolderData}
        projectId={project.id}
        chapterId={chapter.id}
        chapterName={chapter.chapters}
        chapterTitle={chapter.chapter_title}
        clientId={clientId}
        clientName={project.client_name ?? undefined}
        projectName={project.project_title ?? project.code ?? project.project_code ?? undefined}
        stageName={chapter.stage_name ?? ''}
        isAssigned={chapter.current_assignee_name === viewer?.username}
        onRefresh={() => setRefreshKey(k => k + 1)}
        onProceed={proceedLoading ? undefined : handleProceed}
      />

      {transitionConfig && transitionParams && (
        <TransitionConfirmModal
          isOpen={confirmModalOpen}
          onClose={() => setConfirmModalOpen(false)}
          onConfirm={executeTransitionAndEmail}
          loading={proceedLoading}
          currentStage={transitionParams.fromStage}
          nextStage={transitionParams.toStage}
          config={transitionConfig}
        />
      )}
    </>
  )
}
