import { create } from 'zustand'
import { stagesApi, ProcessingActionDefinition } from '@/api/stages'
import { setDynamicStageActionsMap } from '@/config/fileManagerConfig'

interface StageActionsState {
  definitions: ProcessingActionDefinition[]
  mapping: Record<string, string[]>
  loading: boolean
  loaded: boolean
  fetchMapping: (force?: boolean) => Promise<void>
  updateMapping: (newMapping: Record<string, string[]>) => Promise<boolean>
}

export const DEFAULT_PROCESSING_ACTION_DEFINITIONS: ProcessingActionDefinition[] = [
  { key: 'structuring', label: 'Structuring', description: 'Generate structured document tags, styling, and XML markers', icon: 'Layers', category: 'Pre-editing' },
  { key: 'structuringQa', label: 'Run QA Report', description: 'Run automated style and structuring QA report', icon: 'ShieldCheck', category: 'Pre-editing' },
  { key: 'referenceValidation', label: 'Reference Validation', description: 'Validate citations and references against CrossRef and PubMed APIs', icon: 'BookCheck', category: 'Pre-editing' },
  { key: 'referenceReview', label: 'Reference Review', description: 'Review and edit bibliography references in the Reference Editor', icon: 'BookCheck', category: 'Pre-editing' },
  { key: 'styleValidation', label: 'Style Validation & Match', description: 'Validate and match manuscript styling against publisher templates', icon: 'ShieldCheck', category: 'Styling' },
  { key: 'artValidation', label: 'Art Validation', description: 'Inspect and validate embedded figures, resolution, and color profiles', icon: 'Image', category: 'Artwork' },
  { key: 'languageEdit', label: 'Language Edit', description: 'Linguistic copyediting for grammar, syntax, and phrasing', icon: 'Languages', category: 'Editorial' },
  { key: 'technicalEdit', label: 'Technical Edit', description: 'Review mathematical notation, equations, and technical nomenclature', icon: 'Wrench', category: 'Editorial' },
  { key: 'unifiedReview', label: 'Review Studio', description: 'Unified interactive editor with track changes, comments, and side-by-side view', icon: 'Layout', category: 'Editorial' },
  { key: 'manuscriptAnalysis', label: 'Manuscript Analysis', description: 'Automated analysis of manuscript content, structural integrity, and word count', icon: 'FileOutput', category: 'Analysis' },
  { key: 'permissionsCheck', label: 'Permissions Check', description: 'Audit and track third-party copyright, figures, and citation permissions', icon: 'ShieldCheck', category: 'Digital Processing' },
  { key: 'aiCreditExtraction', label: 'AI Credit Extraction', description: 'Extract contributor credits, affiliations, and funding sources using AI', icon: 'Sparkles', category: 'Digital Processing' },
  { key: 'biasScan', label: 'Bias Scan', description: 'Scan text for cultural, gender, accessibility, or inclusivity bias', icon: 'ScanLine', category: 'Digital Processing' },
  { key: 'wordToXml', label: 'Word to XML', description: 'Convert Word DOCX manuscript directly into JATS or BITS XML', icon: 'FileCode', category: 'Conversion' },
  { key: 'wordToIndesign', label: 'Word to InDesign', description: 'Typeset Word document into Adobe InDesign INDD/IDML layout', icon: 'Layers', category: 'Layout & Proofing' },
  { key: 'xmlToIndesign', label: 'Generate InDesign (XML to INDD)', description: 'Flow structured XML content into an InDesign template layout', icon: 'Layers', category: 'Layout & Proofing' },
  { key: 'indesignToXml', label: 'InDesign to XML', description: 'Extract structured XML from an InDesign document', icon: 'FileCode', category: 'Layout & Proofing' },
  { key: 'indesignToXhtml', label: 'InDesign to XHTML (Stage R1)', description: 'Export InDesign layout to editable XHTML proof for author review (stored strictly in Proof folder)', icon: 'FileCode', category: 'Layout & Proofing' },
  { key: 'xhtmlToIndesign', label: 'Apply XHTML to InDesign (Stage R2)', description: 'Apply reviewed XHTML corrections back into InDesign layout and regenerate visual proof', icon: 'Layers', category: 'Layout & Proofing' },
  { key: 'viewProof', label: 'View Proof', description: 'Inspect and view rendered page proof PDF', icon: 'Eye', category: 'Layout & Proofing' },
]

export const useStageActionsStore = create<StageActionsState>((set, get) => ({
  definitions: DEFAULT_PROCESSING_ACTION_DEFINITIONS,
  mapping: {},
  loading: false,
  loaded: false,

  fetchMapping: async (force = false) => {
    if (get().loading || (get().loaded && !force)) return
    set({ loading: true })
    try {
      const data = await stagesApi.getMapping()
      if (data?.mapping) {
        setDynamicStageActionsMap(data.mapping)
        set({
          definitions: data.definitions || [],
          mapping: data.mapping,
          loaded: true,
          loading: false,
        })
      } else {
        set({ loading: false })
      }
    } catch {
      set({ loading: false })
    }
  },

  updateMapping: async (newMapping: Record<string, string[]>) => {
    set({ loading: true })
    try {
      const res = await stagesApi.updateMapping(newMapping)
      if (res?.mapping) {
        setDynamicStageActionsMap(res.mapping)
        set({
          definitions: res.definitions || get().definitions,
          mapping: res.mapping,
          loaded: true,
          loading: false,
        })
        return true
      }
      set({ loading: false })
      return false
    } catch {
      set({ loading: false })
      return false
    }
  },
}))
