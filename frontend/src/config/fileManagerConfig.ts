/**
 * File Manager Configuration
 *
 * Drives the enterprise file manager for the publishing workflow.
 */

// ── ChapterFile ────────────────────────────────────────────────────────────

export interface ChapterFileMetadata {
  dpi?:              number
  width?:            number
  height?:           number
  colorProfile?:     string
  xmlType?:          string
  validationStatus?: 'valid' | 'invalid' | 'pending'
  packageStatus?:    string
  reviewer?:         string
  reviewStatus?:     string
}

export type ProcessingStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed'

export interface ChapterFile {
  id:               string
  folder:           FolderKey
  fileName:         string
  extension:        string
  size:             string
  sizeBytes:        number
  uploadedBy:       string
  uploadedOn:       string
  path:             string
  metadata?:        ChapterFileMetadata
  processingStatus: ProcessingStatus
}

export type FolderKey = 'manuscript' | 'art' | 'indesign' | 'proof' | 'xml' | 'misc' | 'backup'

export type ColumnKey =
  | 'fileName' | 'fileType' | 'size' | 'uploadedBy' | 'uploadedOn'
  | 'pageCount'
  | 'dimensions' | 'dpi' | 'colorProfile'
  | 'packageStatus'
  | 'reviewer' | 'reviewStatus'
  | 'xmlType' | 'validationStatus'

export interface ColumnDefinition { key: ColumnKey; header: string; width: number }

export const COLUMN_DEFINITIONS: Record<ColumnKey, ColumnDefinition> = {
  fileName:        { key: 'fileName',        header: 'File Name',      width: 240 },
  fileType:        { key: 'fileType',        header: 'Type',           width:  70 },
  pageCount:       { key: 'pageCount',       header: 'Pages',          width:  70 },
  size:            { key: 'size',            header: 'Size',           width:  80 },
  uploadedBy:      { key: 'uploadedBy',      header: 'Uploaded By',    width: 130 },
  uploadedOn:      { key: 'uploadedOn',      header: 'Uploaded On',    width: 140 },
  dimensions:      { key: 'dimensions',      header: 'Dimensions',     width: 100 },
  dpi:             { key: 'dpi',             header: 'DPI',            width:  60 },
  colorProfile:    { key: 'colorProfile',    header: 'Color Profile',  width: 110 },
  packageStatus:   { key: 'packageStatus',   header: 'Package Status', width: 120 },
  reviewer:        { key: 'reviewer',        header: 'Reviewer',       width: 120 },
  reviewStatus:    { key: 'reviewStatus',    header: 'Review Status',  width: 110 },
  xmlType:         { key: 'xmlType',         header: 'XML Type',       width: 100 },
  validationStatus:{ key: 'validationStatus',header: 'Validation',     width: 100 },
}

export interface FolderConfig { label: string; icon: string; allowUpload: boolean; allowDownload: boolean; columns: ColumnKey[] }

export const FOLDER_CONFIG: Record<FolderKey, FolderConfig> = {
  manuscript: { label:'Manuscript', icon:'FileText',      allowUpload:true,  allowDownload:true,  columns:['fileName','fileType','pageCount','size','uploadedBy','uploadedOn'] },
  art:        { label:'Art',        icon:'Image',         allowUpload:true,  allowDownload:true,  columns:['fileName','fileType','dimensions','dpi','colorProfile','size','uploadedBy','uploadedOn'] },
  indesign:   { label:'Indesign',   icon:'Layers',        allowUpload:true,  allowDownload:true,  columns:['fileName','fileType','packageStatus','size','uploadedBy','uploadedOn'] },
  proof:      { label:'Proof',      icon:'ClipboardCheck',allowUpload:true,  allowDownload:true,  columns:['fileName','fileType','reviewer','reviewStatus','size','uploadedBy','uploadedOn'] },
  xml:        { label:'XML',        icon:'Code2',         allowUpload:true,  allowDownload:true,  columns:['fileName','fileType','xmlType','validationStatus','size','uploadedBy','uploadedOn'] },
  misc:       { label:'Misc',       icon:'FolderOpen',    allowUpload:true,  allowDownload:true,  columns:['fileName','fileType','size','uploadedBy','uploadedOn'] },
  backup:     { label:'Backup',     icon:'Archive',       allowUpload:false, allowDownload:true,  columns:['fileName','fileType','size','uploadedOn'] },
}

export const PROCESSING_ACTIONS: Record<string, string[]> = {
  initiation:   ['Structure Tag','Metadata Check','File Integrity'],
  design:   ['Structure Tag'],
  editing:      ['Structure Tag','Reference Check','Accessibility Validation','AI QC'],
  copyediting:  ['Technical Editor','Grammar Check','Style Consistency','Reference Validation'],
  production:   ['Generate EPUB','Validate XML','Generate PDF','Package InDesign'],
  qc:           ['QC Checklist','Validation Check','Missing Elements'],
  proofreading: ['Markup Review','Correction Tracking'],
}

export function getProcessingActions(stageName: string): string[] {
  const key = stageName.toLowerCase()
  if (PROCESSING_ACTIONS[key]) return PROCESSING_ACTIONS[key]
  const found = Object.entries(PROCESSING_ACTIONS).find(([k]) => key.includes(k) || k.includes(key))
  return found ? found[1] : []
}

// ── File Actions Menu — Processing item visibility ──────────────────────────
//
// Controls which "Processing" items in the per-file actions menu (⋮) are shown for a
// given chapter stage. Each key lists the exact `stage_name` value(s) (as seeded in
// stage_master / workflow_master, see seed.py) that action belongs to — matched
// case-insensitively but otherwise as a full, exact stage name (no partial/substring match).
// Use '*' for an action that should always be visible regardless of stage.
//
// To add a new processing action: add its key here with the stage(s) it belongs to, then
// reference that key via `isProcessingActionVisibleForStage(key, stageName)` when rendering
// the corresponding <DropdownMenu.Item> in ChapterFilePage.tsx — no other code changes needed.
export type ProcessingActionKey =
  | 'structuring' | 'referenceValidation'
  | 'languageEdit' | 'technicalEdit'
  | 'manuscriptAnalysis'
  | 'permissionsCheck' | 'aiCreditExtraction' | 'biasScan' | 'wordToXml'

export const PROCESSING_ACTION_STAGE_MAP: Record<ProcessingActionKey, string[] | '*'> = {
  structuring:          ['Pre-editing'],
  referenceValidation:  ['Pre-editing'],
  languageEdit:         ['Copyediting'],
  technicalEdit:        ['Copyediting'],
  manuscriptAnalysis:   ['Manuscript Analysis'],
  permissionsCheck:     ['XML Conversion'],
  aiCreditExtraction:   ['XML Conversion'],
  biasScan:             ['XML Conversion'],
  wordToXml:            ['XML Conversion'],
}

export function isProcessingActionVisibleForStage(action: ProcessingActionKey, stageName: string): boolean {
  const rule = PROCESSING_ACTION_STAGE_MAP[action]
  if (rule === '*') return true
  const key = stageName.trim().toLowerCase()
  return rule.some(stage => stage.toLowerCase() === key)
}

export interface FileTypeIcon { icon: string; color: string }

export const FILE_TYPE_ICONS: Record<string, FileTypeIcon> = {
  doc:{ icon:'FileText',color:'#2B579A' }, docx:{ icon:'FileText',color:'#2B579A' },
  pdf:{ icon:'FileText',color:'#DC2626' }, txt:{ icon:'FileText',color:'#6B7280' },
  jpg:{ icon:'Image',color:'#D97706' },    jpeg:{ icon:'Image',color:'#D97706' },
  png:{ icon:'Image',color:'#059669' },    tif:{ icon:'Image',color:'#7C3AED' },
  tiff:{ icon:'Image',color:'#7C3AED' },   eps:{ icon:'Image',color:'#DB2777' },
  svg:{ icon:'Image',color:'#EA580C' },    bmp:{ icon:'Image',color:'#6B7280' },
  indd:{ icon:'Layers',color:'#FF3366' },  idml:{ icon:'Layers',color:'#FF3366' },
  xml:{ icon:'Code2',color:'#059669' },    zip:{ icon:'Archive',color:'#78716C' },
  default:{ icon:'File',color:'#9CA3AF' },
}

export function fileTypeIcon(ext: string): FileTypeIcon {
  return FILE_TYPE_ICONS[ext.toLowerCase().replace(/^\./, '')] ?? FILE_TYPE_ICONS['default']
}
