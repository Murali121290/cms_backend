// S4Carlisle production workflow definitions (WF-01 … WF-08).
//
// Ported verbatim from the authoritative source:
//   "Tool Process/s4carlisle_workflows_v3_1.html" (the WFS array + ROLES table).
// This is static reference data — the single source for both the Workflow catalog
// viewer and the per-project tracking UI. Keep the `id` values stable: the backend
// validates a project's workflow_name against them.


export type StageType = "art" | "tmpl" | "pre" | "xml" | "default";

export interface WorkflowStage {
  /** Stage number, e.g. "01". Used as the tracked `workflow_stage_no`. */
  no: string;
  name: string;
  /** Activities performed in this stage. */
  acts: string[];
  /** Responsible role (see ROLES). */
  owner: string;
  /** Deliverable produced by this stage. */
  out: string;
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  /** One-line scope summary. */
  short: string;
  /** Palette index (0–7) used by the catalog viewer for color coding. */
  ci: number;
  desc: string;
  stages: WorkflowStage[];
}

export type WorkflowRole = readonly [name: string, description: string];

// ─── Stage-type classification keywords ──────────────────────────────────────

const ART_KEYWORDS = ["art processing", "art processing (sample)"];
const TMPL_KEYWORDS = ["template processing", "template validation"];
const PRE_KEYWORDS = ["pre-editing"];
const XML_KEYWORDS = ["xml conversion"];

/** Classify a stage by its name, mirroring the source `stype()` function. */
export function stageType(stageName: string): StageType {
  const l = stageName.toLowerCase();
  if (ART_KEYWORDS.some((a) => l.includes(a))) return "art";
  if (TMPL_KEYWORDS.some((t) => l.includes(t))) return "tmpl";
  if (PRE_KEYWORDS.some((p) => l.includes(p))) return "pre";
  if (XML_KEYWORDS.some((x) => l.includes(x))) return "xml";
  return "default";
}

// ─── Workflow definitions ─────────────────────────────────────────────────────

export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    id: "WF-01",
    title: "Fresh Book",
    short: "New title · full end-to-end",
    ci: 0,
    desc: "End-to-end production of a brand-new manuscript — from receipt through final print-ready and digital file delivery. Includes template setup, art processing, pre-editing, and XML conversion stages.",
    stages: [
      { no: "01", name: "Job Initiation", acts: ["Receive MS & style guide", "Create job order / project ID", "Assign project team", "Send author questionnaire"], owner: "Project Manager", out: "Job Order Sheet" },
      { no: "02", name: "Editorial Assessment", acts: ["Check completeness of files", "Log missing elements (art, permissions)", "Initial quality check", "Raise queries to publisher"], owner: "Editorial Lead", out: "Completeness Report" },
      { no: "03", name: "Template Processing", acts: ["Set up master pages and grids", "Create paragraph & character styles", "Configure XML mapping and scripts", "Validate with sample pages"], owner: "Template Team", out: "Approved Template" },
      { no: "04", name: "Art Processing", acts: ["Log and collect all figures", "Enhance, resize & colour-correct", "Redraw low-resolution figures", "QC artwork vs. spec", "Place final artwork in layout"], owner: "Graphics Team", out: "Processed Artwork Files" },
      { no: "05", name: "Pre-editing", acts: ["Structural review of MS before copyediting", "Check heading hierarchy and chapter structure", "Identify tables, lists and special elements", "Flag gross formatting inconsistencies for author", "Log pre-edit queries for CE team"], owner: "Pre-editor Team", out: "Pre-edit Report / Styled MS" },
      { no: "06", name: "Copyediting", acts: ["Grammar, syntax & style edits", "Consistency & terminology check", "Apply publisher house style", "Compile author queries (AQs)"], owner: "Copyeditor", out: "Edited MS + AQ List" },
      { no: "07", name: "AQ Resolution — PM Review", acts: ["Send AQs to author/publisher", "Receive & incorporate responses", "PM reviews all resolved queries", "Log approved changes"], owner: "Editor / Author / PM", out: "Resolved AQ Log" },
      { no: "08", name: "XML Conversion", acts: ["Convert edited MS to structured XML", "Apply semantic tagging (JATS / BITS / house DTD)", "Validate XML against schema", "Reconcile XML with typesetting template", "Flag conversion issues for correction"], owner: "Conversion Team", out: "Validated XML File" },
      { no: "09", name: "Typesetting", acts: ["Convert MS to layout using template", "Place figures, tables, equations", "Apply typographic styles", "Generate 1st Proof"], owner: "Compositor / DTP", out: "1st Proof PDF" },
      { no: "10", name: "Proofreading (1P)", acts: ["Check layout vs. edited MS", "Verify all artwork placed correctly", "Check running heads, TOC, folios", "Raise proof corrections"], owner: "Proofreader", out: "Marked 1P PDF" },
      { no: "11", name: "Corrections & 2P", acts: ["Incorporate all 1P corrections", "Generate 2nd proof (2P)", "Author/editor review of 2P"], owner: "Compositor / Editor", out: "2nd Proof PDF" },
      { no: "12", name: "Final Sign-off", acts: ["Final check for open issues", "Publisher/author approval", "Sign-off record logged"], owner: "Project Manager", out: "Approved Final Proof" },
      { no: "13", name: "QC & Pre-flight", acts: ["Pre-flight (fonts, colour, bleed)", "XML/metadata validation", "Accessibility check (alt text)"], owner: "QC Specialist", out: "QC Report" },
      { no: "14", name: "File Delivery", acts: ["Package print-ready PDF", "Deliver eBook/XML files", "Archive source files"], owner: "Project Manager", out: "Final Delivered Files" },
    ],
  },
  {
    id: "WF-02",
    title: "Reprint",
    short: "Errata corrections only",
    ci: 1,
    desc: "Reprint of an existing title with errata corrections only — no new editorial or layout work beyond approved fixes.",
    stages: [
      { no: "01", name: "Reprint Request", acts: ["Receive reprint authorization", "Retrieve archived source files", "Confirm errata list (if any)"], owner: "Project Manager", out: "Reprint Job Sheet" },
      { no: "02", name: "Template Processing", acts: ["Validate existing template & stylesheets", "Check font availability and links", "Update template version if required"], owner: "Template Team", out: "Validated Template" },
      { no: "03", name: "Art Processing", acts: ["Verify all artwork links are intact", "Replace or re-link broken image files", "Confirm artwork resolution meets print spec"], owner: "Graphics Team", out: "Verified Artwork Files" },
      { no: "04", name: "Errata Integration", acts: ["Apply approved errata corrections", "Log all changes made", "Version-control updated files"], owner: "Compositor", out: "Updated Source Files" },
      { no: "05", name: "Proof Generation", acts: ["Generate revised PDF proof", "Internal verification of corrections"], owner: "Compositor / QC", out: "Reprint Proof PDF" },
      { no: "06", name: "Publisher Review", acts: ["Publisher confirms corrections applied", "Sign-off on reprint proof"], owner: "Publisher / PM", out: "Signed-off Proof" },
      { no: "07", name: "Pre-flight & Delivery", acts: ["Pre-flight PDF for print", "Deliver print-ready files", "Update archive with new version"], owner: "QC / PM", out: "Final Print-ready PDF" },
    ],
  },
  {
    id: "WF-03",
    title: "Revision",
    short: "New edition · major update",
    ci: 2,
    desc: "Production of a new edition with major content updates — diffed against the previous edition, with repagination and updated front/back matter.",
    stages: [
      { no: "01", name: "Revision Initiation", acts: ["Receive revised MS & change summary", "Diff analysis vs. previous edition", "Create revision job order"], owner: "Project Manager", out: "Revision Scope Document" },
      { no: "02", name: "Template Processing", acts: ["Review & update template for new edition", "Revise master pages and styles as needed", "Test updated template with revised content"], owner: "Template Team", out: "Updated Template" },
      { no: "03", name: "Pre-editing", acts: ["Structural review of MS before copyediting", "Check heading hierarchy and chapter structure", "Identify tables, lists and special elements", "Flag gross formatting inconsistencies", "Log pre-edit queries for CE team"], owner: "Pre-editor Team", out: "Pre-edit Report / Styled MS" },
      { no: "04", name: "Copyediting (Revised)", acts: ["Edit new/revised sections only", "Consistency check across editions", "Flag queries on revised passages"], owner: "Copyeditor", out: "Edited Revised MS" },
      { no: "05", name: "AQ Resolution", acts: ["Compile and send revision AQs", "Receive & incorporate responses"], owner: "Editor / Author", out: "Resolved AQ Log" },
      { no: "06", name: "Typesetting (Revised)", acts: ["Update layout with new content", "Repaginate entire book", "Update TOC, index, cross-refs"], owner: "Compositor / DTP", out: "Revised 1st Proof" },
      { no: "07", name: "Art Processing", acts: ["Log all new and replaced figures", "Enhance or redraw updated artwork", "QC revised artwork vs. new spec", "Place and verify all updated artwork"], owner: "Graphics Team", out: "Updated Artwork Files" },
      { no: "08", name: "Proofreading", acts: ["Full proof of revised sections", "Check repagination, running heads", "Verify new and updated figures/tables"], owner: "Proofreader", out: "Marked Proof PDF" },
      { no: "09", name: "Corrections & 2P", acts: ["Incorporate proof corrections", "Targeted check of changed areas"], owner: "Compositor / Editor", out: "2nd Proof PDF" },
      { no: "10", name: "Sign-off & QC", acts: ["Publisher/author final approval", "Pre-flight & metadata check", "eBook/XML update if applicable"], owner: "PM / QC", out: "Approved Final Files" },
      { no: "11", name: "Delivery & Archiving", acts: ["Deliver revised edition files", "Update archive with new edition"], owner: "Project Manager", out: "Delivered Revised Edition" },
    ],
  },
  {
    id: "WF-04",
    title: "Copyediting Only",
    short: "Editorial only · no art/template",
    ci: 3,
    desc: "Editorial processing only — no art processing or template setup. Scope is strictly editorial; layout is handled by another party.",
    stages: [
      { no: "01", name: "Job Intake", acts: ["Receive MS and style brief", "Confirm scope: CE only — no DTP, art or template", "Set schedule and assign copyeditor"], owner: "Project Manager", out: "Job Confirmation" },
      { no: "02", name: "Editorial Review", acts: ["Assess editing level required", "Identify terminology/consistency issues", "Note structural concerns for author"], owner: "Lead Editor", out: "Editorial Assessment Note" },
      { no: "03", name: "Technical Editing", acts: ["Check scientific/academic terminology", "Verify reference and citation formatting", "Validate cross-references and footnotes"], owner: "Technical Editor", out: "Technically Edited MS" },
      { no: "04", name: "Copyediting", acts: ["Grammar, syntax & house-style edits", "Terminology & consistency pass", "References, citations & abbreviations", "Compile author query list (AQs)"], owner: "Copyeditor", out: "Edited MS + AQ List" },
      { no: "05", name: "AQ Resolution", acts: ["Send AQs to publisher/author", "Incorporate responses", "Finalize clean MS"], owner: "Editor / Author", out: "Resolved AQ Log" },
      { no: "06", name: "Quality Review", acts: ["Internal peer review of edited MS", "Style compliance check", "Final tracked-changes cleanup"], owner: "Senior Editor", out: "QR Sign-off" },
      { no: "07", name: "Delivery", acts: ["Deliver edited DOCX file", "Deliver AQ resolution summary", "Archive job files"], owner: "Project Manager", out: "Final Edited MS" },
    ],
  },
  {
    id: "WF-05",
    title: "Paging Only",
    short: "Layout + art · template validated",
    ci: 4,
    desc: "Layout/typesetting from a supplied edited MS. Includes art processing, template validation, pre-editing review, and XML conversion — no new template creation or full editorial work.",
    stages: [
      { no: "01", name: "Job Intake", acts: ["Receive edited MS & design spec", "Confirm template/stylesheet to use", "Check all assets (figures, tables)"], owner: "PM / DTP Lead", out: "DTP Job Sheet" },
      { no: "02", name: "Template Validation", acts: ["Validate supplied template vs. design spec", "Confirm all paragraph & character styles", "Test template with sample pages"], owner: "Template Team", out: "Validated Template" },
      { no: "03", name: "Art Processing", acts: ["Log and categorise all received artwork", "Check image resolution and colour mode", "Re-link or replace low-quality images", "Prepare figures for placement"], owner: "Graphics Team", out: "Processed Artwork Files" },
      { no: "04", name: "Pre-editing", acts: ["Structural review of supplied MS before layout", "Check heading hierarchy and element tagging", "Identify unresolved queries or missing content", "Flag formatting issues that would affect pagination", "Log pre-edit notes for compositor"], owner: "Pre-editor Team", out: "Pre-edit Report / Marked MS" },
      { no: "05", name: "XML Conversion", acts: ["Convert supplied MS to structured XML", "Apply semantic tagging aligned to template DTD", "Validate XML against schema", "Reconcile XML structure with layout template", "Flag conversion issues before typesetting begins"], owner: "Conversion Team", out: "Validated XML File" },
      { no: "06", name: "Typesetting / Layout", acts: ["Import MS into composition tool", "Apply master pages & styles", "Place all processed figures, tables, equations"], owner: "Compositor / DTP", out: "1st Proof PDF" },
      { no: "07", name: "Proofreading (1P)", acts: ["Compare proof vs. supplied MS", "Verify all content and artwork placed", "Check running heads, folios, TOC"], owner: "Proofreader", out: "Marked 1P" },
      { no: "08", name: "Correction Round", acts: ["Apply all 1P corrections", "Generate 2P for publisher review"], owner: "Compositor", out: "2nd Proof PDF" },
      { no: "09", name: "Sign-off", acts: ["Publisher confirms corrections complete", "Sign-off record logged"], owner: "Publisher / PM", out: "Approved Proof" },
      { no: "10", name: "Pre-flight & Delivery", acts: ["Pre-flight PDF (fonts, bleed, colour)", "Deliver print-ready & screen PDF", "Archive InDesign source"], owner: "QC / PM", out: "Print-ready PDF" },
    ],
  },
  {
    id: "WF-06",
    title: "Template Only",
    short: "Template design + sample art testing",
    ci: 5,
    desc: "Design and delivery of a reusable typesetting template. Includes sample art placement testing and automation setup.",
    stages: [
      { no: "01", name: "Requirement Gathering", acts: ["Receive design brief & brand guidelines", "Collect sample pages / reference titles", "Agree deliverables (InDesign, CSS, scripts)"], owner: "PM / Designer", out: "Design Brief" },
      { no: "02", name: "Template Processing", acts: ["Define master pages, grids & margins", "Create para., char., object & table styles", "Design page furniture (headers, openers)", "Configure XML mapping & automation"], owner: "Designer / Template Team", out: "Draft Template" },
      { no: "03", name: "Art Processing (Sample)", acts: ["Source representative sample artwork", "Test figure, table & equation placement", "Verify image colour modes and resolution", "Confirm art frames and captioning styles"], owner: "Graphics Team", out: "Sample Art Test Report" },
      { no: "04", name: "Internal Review", acts: ["Review against brief & brand", "Test-typeset full sample chapter with art", "Raise feedback / revision notes"], owner: "Senior Designer / PM", out: "Feedback Notes" },
      { no: "05", name: "Revision", acts: ["Incorporate review feedback", "Refine styles, layout & automation scripts"], owner: "Designer / Template Team", out: "Revised Template" },
      { no: "06", name: "Publisher Approval", acts: ["Present final template with sample output", "Obtain written sign-off"], owner: "Publisher / PM", out: "Approved Template" },
      { no: "07", name: "Documentation & Delivery", acts: ["Write template usage guide incl. art notes", "Package & deliver all template files", "Train team on workflow if required"], owner: "Designer / PM", out: "Template Package + Guide" },
    ],
  },
  {
    id: "WF-07",
    title: "Digital Conversion",
    short: "Print/legacy → EPUB, XML, HTML",
    ci: 6,
    desc: "Conversion of print-ready or legacy content to EPUB, XML, HTML or accessible PDF. Covers new conversions and back-list digitisation projects.",
    stages: [
      { no: "01", name: "Job Initiation", acts: ["Receive source files (PDF, InDesign, Word)", "Confirm target formats (EPUB, XML, HTML5)", "Identify complexity (tables, equations, math)", "Create job order and assign team"], owner: "Project Manager", out: "Conversion Job Sheet" },
      { no: "02", name: "Source Analysis", acts: ["Audit source file quality and structure", "Identify OCR requirements for scanned pages", "Map print styles to digital semantic tags", "Flag complex elements needing special handling"], owner: "Conversion Lead", out: "Source Analysis Report" },
      { no: "03", name: "Template / Structure Setup", acts: ["Set up XML/HTML conversion stylesheet", "Define semantic tagging schema (JATS, BITS)", "Configure output templates per target format", "Test structure with sample content"], owner: "Template Team / Automation", out: "Conversion Template" },
      { no: "04", name: "Content Conversion", acts: ["Convert text & structure to target format", "Apply semantic tagging (headings, lists, tables)", "Convert equations (MathML / LaTeX)", "Handle footnotes, cross-refs and hyperlinks"], owner: "Conversion Team", out: "Converted Raw Files" },
      { no: "05", name: "Art Processing", acts: ["Extract/re-export figures at screen & retina res.", "Convert images to web-optimised formats", "Add descriptive alt-text to all images", "Verify figures render correctly in target format"], owner: "Graphics Team", out: "Digital Artwork Package" },
      { no: "06", name: "QC & Validation", acts: ["Validate EPUB (EPUBCheck / ACE)", "Validate XML against DTD or schema", "Check all links, cross-refs and TOC entries", "Verify reading order and metadata"], owner: "QC Specialist", out: "Validation Report" },
      { no: "07", name: "Client Review", acts: ["Deliver review copy in target format(s)", "Collect and log client corrections", "Incorporate approved corrections"], owner: "PM / Conversion Team", out: "Approved Corrected Files" },
      { no: "08", name: "Final QC & Delivery", acts: ["Final validation pass", "Package all output formats", "Deliver to publisher / platform", "Archive all source and output files"], owner: "QC / PM", out: "Final Digital Deliverables" },
    ],
  },
  {
    id: "WF-08",
    title: "Accessibility / Alt-text",
    short: "WCAG / PDF·UA remediation",
    ci: 7,
    desc: "Full accessibility remediation — alt-text authoring, PDF tagging, reading-order remediation, and WCAG/PDF/UA conformance testing for existing publications.",
    stages: [
      { no: "01", name: "Job Initiation", acts: ["Receive source files (PDF, EPUB, InDesign)", "Confirm standard (WCAG 2.1 AA, PDF/UA-1)", "Identify scope: alt-text, tagging, remediation", "Create job order; assign accessibility team"], owner: "Project Manager", out: "Accessibility Job Sheet" },
      { no: "02", name: "Accessibility Audit", acts: ["Run automated checker (PAC 2024, ACE, Acrobat)", "Manual inspection: reading order, heading tree", "Identify untagged figures and complex tables", "Produce prioritised issues list"], owner: "Accessibility Specialist", out: "Audit Report" },
      { no: "03", name: "Alt-text Authoring", acts: ["Review all figures, charts, maps & diagrams", "Write descriptive contextual alt-text per image", "Mark decorative images as artefacts", "Write extended descriptions for complex figures"], owner: "Alt-text Author / Graphics", out: "Alt-text Log / Content" },
      { no: "04", name: "Art Processing", acts: ["Re-export / optimise images for accessibility", "Generate SVG versions of charts where applicable", "Verify image colour contrast meets WCAG", "Confirm no text embedded in images"], owner: "Graphics Team", out: "Accessible Artwork Files" },
      { no: "05", name: "Document Remediation", acts: ["Apply semantic tags (headings, lists, tables)", "Set reading order and logical structure tree", "Add document title, language & metadata", "Tag tables with headers, scope & summary", "Set tab order and keyboard navigation"], owner: "Accessibility Specialist", out: "Remediated Document" },
      { no: "06", name: "QC & Conformance", acts: ["Run PAC 2024 / ACE / Acrobat Check", "Manual screen-reader test (NVDA, JAWS, VO)", "Verify all alt-texts present and meaningful", "Confirm heading levels and table structure", "Check colour contrast ratios"], owner: "QC / Accessibility Lead", out: "Conformance QC Report" },
      { no: "07", name: "Client Review", acts: ["Deliver accessible version for review", "Collect and log correction requests", "Incorporate approved changes"], owner: "PM / Accessibility Team", out: "Client-approved File" },
      { no: "08", name: "Final Certification", acts: ["Generate accessibility conformance statement", "Final PAC / ACE validation pass", "Package and deliver all accessible outputs", "Archive source, remediated and report files"], owner: "QC / PM", out: "Files + Conformance Statement" },
    ],
  },
];

// ─── Roles responsibility table ───────────────────────────────────────────────

export const WORKFLOW_ROLES: WorkflowRole[] = [
  ["Project Manager (PM)", "Oversees job initiation, scheduling, team assignment, delivery, and archiving across all workflow types."],
  ["Editorial Lead / Senior Editor", "Manages editorial quality, peer reviews edited manuscripts, escalates issues."],
  ["Copyeditor (CE)", "Applies grammar, style, consistency, and house-style edits; raises AQs."],
  ["Technical Editor", "Checks scientific/academic terminology, reference formatting, and cross-references."],
  ["Compositor / DTP Operator", "Performs typesetting, page layout, figure placement, and proof generation."],
  ["Template Team", "Creates and maintains InDesign templates, master pages, paragraph/character styles, and XML mapping."],
  ["Graphics Team", "Handles image enhancement, figure redrawing, artwork QC, alt-text creation, and image optimisation for all formats."],
  ["Proofreader", "Reads proofs against MS; raises corrections for layout accuracy and completeness."],
  ["QC Specialist", "Runs pre-flight checks, metadata/XML validation, EPUBCheck/ACE validation, and accessibility audits."],
  ["Conversion Team", "Converts source content to EPUB, XML, HTML or structured digital formats with correct semantic tagging."],
  ["Accessibility Specialist", "Performs PDF/EPUB tagging, reading-order remediation, and WCAG/PDF/UA conformance testing."],
  ["Designer", "Creates templates, master pages, and visual design elements per brand guidelines."],
  ["Author / Publisher (External)", "Provides manuscript, approves queries and proofs, gives final sign-off."],
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

const BY_ID = new Map(WORKFLOW_DEFINITIONS.map((wf) => [wf.id, wf]));

export function getWorkflowDefinition(id: string | null | undefined): WorkflowDefinition | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

/** Valid workflow ids — useful for select options and validation. */
export const WORKFLOW_IDS = WORKFLOW_DEFINITIONS.map((wf) => wf.id);
