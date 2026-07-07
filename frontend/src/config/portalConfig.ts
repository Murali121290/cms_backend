export interface Theme {
  id: string
  name: string
  dot: string
}

export const THEMES: Theme[] = [
  { id: 'default', name: 'Warm Amber',      dot: '#C8841C' },
  { id: 'ocean',   name: 'Ocean Blue',      dot: '#2A6FDB' },
  { id: 'slate',   name: 'Slate Dark',      dot: '#5866C4' },
  { id: 'forest',  name: 'Forest Green',    dot: '#2C8C5B' },
  { id: 'plum',    name: 'Royal Plum',      dot: '#8A4BC2' },
  { id: 'storm',   name: 'Stormy Morning',  dot: '#6A89A7' },
  { id: 'teal',    name: 'Coastal Teal',    dot: '#34A99D' },
  { id: 'earth',   name: 'Earthbound',      dot: '#A98E72' },
]

export interface HubData {
  num: string
  title: string
  desc: string
  svg: string
}

export const BOOK_HUBS: HubData[] = [
  { num:'01', title:'Manuscript Analysis', desc:'Automated structure detection, style validation and DOCX compliance checks across uploaded manuscripts.',
    svg:'<path d="M7 3h7l4 4v9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><circle cx="11" cy="14" r="2.6"/><path d="M15 18l-1.8-1.8"/>' },
  { num:'02', title:'Project Management', desc:'Chapter-level project tracking with team roles, file versioning, checkout control and delivery milestones.',
    svg:'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 11l1.6 1.6L14 9.2"/><path d="M9 16.5h6"/>' },
  { num:'03', title:'Tagging', desc:'Semantic NLM XML tagging for academic journals and structured publishing outputs with AI-assisted classification.',
    svg:'<path d="M11.6 3.4l7 7a2 2 0 0 1 0 2.8l-5.4 5.4a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 10.2V5a2 2 0 0 1 2-2h5.2a2 2 0 0 1 1.4.4z"/><circle cx="8" cy="9" r="1.5"/>' },
  { num:'04', title:'Copyediting', desc:'Grammar, style and tone refinement with tracked-changes workflow, bias scanning and editorial sign-off.',
    svg:'<path d="M16.5 3.5a2 2 0 0 1 2.8 2.8L8.5 17.1 4 18.5l1.4-4.5Z"/><path d="M14.2 5.8l2.8 2.8"/>' },
  { num:'05', title:'XML', desc:'Full DOCX-to-NLM XML pipeline with LaTeX / MathML / OMML conversion, element validation and output packaging.',
    svg:'<path d="M9 8L4.5 12 9 16"/><path d="M15 8l4.5 4-4.5 4"/><path d="M13 5l-2 14"/>' },
  { num:'06', title:'Production', desc:'End-to-end 11-step automated pipeline managing structuring, technical editing and SLA-tracked job processing.',
    svg:'<circle cx="12" cy="12" r="3"/><path d="M12 4v2.4M12 17.6V20M4 12h2.4M17.6 12H20M6.3 6.3l1.7 1.7M16 16l1.7 1.7M17.7 6.3L16 8M8 16l-1.7 1.7"/>' },
  { num:'07', title:'Editorial Proof Reading', desc:'In-browser proofing via Collabora / OnlyOffice with WOPI integration, comment threads and version control.',
    svg:'<rect x="3.5" y="5" width="17" height="12" rx="1.6"/><path d="M9 20.5h6M12 17v3.5"/><path d="M8.5 11l2 2 4-4.4"/>' },
  { num:'08', title:'Final Proof', desc:'PDF proof review, annotation and multi-stage approval workflow before press-ready and digital release.',
    svg:'<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.6 2.6L16.2 9"/>' },
  { num:'09', title:'eDeliverables', desc:'Digital output packaging — EPUB, HTML, XML bundles and accessibility-compliant formats for client delivery.',
    svg:'<path d="M12 3l7 3.6v6.8c0 4.2-3 6.6-7 7.6-4-1-7-3.4-7-7.6V6.6L12 3z"/><path d="M9 11.5l2 2 4-4.5"/>' },
  { num:'10', title:'Accessibility', desc:'WCAG compliance checking, alt-text management and accessible publishing standards across all output formats.',
    svg:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="7.3" r="1.3"/><path d="M7 10.2c1.6.7 3.4 1 5 1s3.4-.3 5-1"/><path d="M12 11.2V18M12 18l-3 3M12 18l3 3"/>' },
  { num:'11', title:'Web Accessibility', desc:'Web content conformance to WCAG 2.1 AA/AAA, screen-reader testing and digital remediation workflows.',
    svg:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.4 3.6 5.7 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.7-3.6-9s1.2-6.6 3.6-9z"/>' },
  { num:'12', title:'Rights & Permissions', desc:'Copyright clearance tracking, AI permissions logging, contributor credit extraction and third-party licensing records.',
    svg:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="16" r="1.3"/>' },
  { num:'13', title:'Indexing', desc:'Automated back-of-the-book indexing, terminology extraction, entry compilation and cross-reference linking.',
    svg:'<path d="M4 6h16M4 12h16M4 18h12M4 6h.01M4 12h.01M4 18h.01"/>' },
  { num:'14', title:'Distribution Hub', desc:'Global metadata syndication, digital retailer feed management, ONIX updates and asset packaging pipeline.',
    svg:'<circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><circle cx="5" cy="5" r="2"/><path d="M12 9l5-3M12 15l-5 3M12 15l5 3M12 9l-5-3"/>' },
  { num:'15', title:'Content Management', desc:'Centralized content repository, digital asset lifecycle, component-level reuse tracking and version control.',
    svg:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17h6M9 12h6M9 7h6"/>' },
]

export const JOURNAL_HUBS: HubData[] = [
  { num:'01', title:'Submission Intake', desc:'Author submission, metadata capture, file-upload validation and compliance checks.',
    svg:'<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>' },
  { num:'02', title:'Manuscript Analysis', desc:'File and component identification, figure/table extraction, reference count and validation.',
    svg:'<path d="M7 3h7l4 4v9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><circle cx="11" cy="14" r="2.6"/><path d="M15 18l-1.8-1.8"/>' },
  { num:'03', title:'Pre-editing', desc:'File preparation, template normalization and structural validation.',
    svg:'<path d="M4 5h16M4 12h16M4 19h10"/><path d="M18 16l3 3-3 3" transform="translate(0,-3)"/>' },
  { num:'04', title:'Copyediting', desc:'Grammar and style corrections, journal-style compliance and reference formatting.',
    svg:'<path d="M16.5 3.5a2 2 0 0 1 2.8 2.8L8.5 17.1 4 18.5l1.4-4.5Z"/><path d="M14.2 5.8l2.8 2.8"/>' },
  { num:'05', title:'XML Conversion', desc:'JATS XML generation, schema validation and cross-reference checks.',
    svg:'<path d="M9 8L4.5 12 9 16"/><path d="M15 8l4.5 4-4.5 4"/><path d="M13 5l-2 14"/>' },
  { num:'06', title:'Typesetting', desc:'PDF proof creation, HTML and ePub generation for multi-format output.',
    svg:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>' },
  { num:'07', title:'QA Review', desc:'Editorial, layout, accessibility and XML quality assurance checks.',
    svg:'<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4 12 14.01l-3-3"/>' },
  { num:'08', title:'Author Proof', desc:'Proof delivery to author, correction capture and incorporation.',
    svg:'<rect x="3.5" y="5" width="17" height="12" rx="1.6"/><path d="M9 20.5h6M12 17v3.5"/><path d="M8.5 11l2 2 4-4.4"/>' },
  { num:'09', title:'Corrections', desc:'Proof-correction implementation and verification against author markup.',
    svg:'<path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2 2 0 0 1 2.8 2.8L12 14.6 8 16l1.4-4z"/>' },
  { num:'10', title:'Final QA', desc:'Final quality check before publication readiness sign-off.',
    svg:'<path d="M12 2l2.4 5 5.6.5-4.2 3.7 1.3 5.5L12 19l-5.1 2.7 1.3-5.5L4 12.5 9.6 12z"/>' },
  { num:'11', title:'Publication Package', desc:'DOI registration, metadata delivery and indexing-package preparation.',
    svg:'<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>' },
  { num:'12', title:'Archive & Closure', desc:'Crossref deposit, indexing submission and corrections/errata management.',
    svg:'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>' },
]

export const GENERAL_HUBS: HubData[] = [
  { num:'01', title:'Human Resources', desc:'Staff records, contracts, onboarding workflows and role-based access provisioning across all teams.',
    svg:'<circle cx="9" cy="8" r="2.8"/><path d="M3.8 19c.8-3 2.7-4.6 5.2-4.6s4.4 1.6 5.2 4.6"/><circle cx="17" cy="8.5" r="2.2"/><path d="M15.5 14.7c2 .2 3.6 1.8 4.3 4.3"/>' },
  { num:'02', title:'Billing & Invoices', desc:'Invoice generation, payment tracking and client billing reconciliation with audit trail.',
    svg:'<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9.5h16"/><path d="M8 14h3"/><circle cx="16" cy="14" r="1.4"/>' },
  { num:'03', title:'Status & Reports Hub', desc:'Real-time project dashboards, SLA tracking and scheduled report delivery to stakeholders.',
    svg:'<path d="M4 20V10M9 20V6M14 20v-8M19 20V4"/>' },
  { num:'04', title:'Archive Files', desc:'Long-term document archiving, structured retrieval and retention-policy management across all projects.',
    svg:'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>' },
  { num:'05', title:'Payroll & Benefits', desc:'Payroll processing, benefit enrolment, payslip distribution and statutory compliance reporting.',
    svg:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 11a4 4 0 0 1-8 0"/><path d="M2 10h20"/>' },
  { num:'06', title:'Client Management', desc:'Client profile management, engagement history, contact records and relationship tracking.',
    svg:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
  { num:'07', title:'Analytics & Insights', desc:'Cross-project performance metrics, throughput trends, capacity planning and executive summaries.',
    svg:'<path d="M3 3v18h18"/><path d="M18 9l-5 5-2-2-4 4"/>' },
  { num:'08', title:'Support Portal', desc:'Internal helpdesk tickets, SLA escalations, knowledge-base management and issue resolution tracking.',
    svg:'<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>' },
  { num:'09', title:'Outsourcing Hub', desc:'Manage third-party vendor contracts, statement of work allocation, job dispatching and deliverable ingestion.',
    svg:'<path d="M16 3h5v5M8 21H3v-5M21 3L12 12M3 21l9-9"/>' },
  { num:'10', title:'QMS (Quality Management)', desc:'Raise issues from previous stages and resolve them on the issues and solves page.',
    svg:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 11l2 2 4-4"/>' },
]

export interface LifecycleStep {
  label: string
  active?: boolean
  done?: boolean
  svg: string
}

export const LIFECYCLE_STEPS: LifecycleStep[] = [
  { label: 'Submission', done: true, svg: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>' },
  { label: 'Initial Screening', svg: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>' },
  { label: 'Editor Assignment', svg: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/>' },
  { label: 'Reviewer Selection', svg: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3 3-1.5-1.5"/>' },
  { label: 'Peer Review', active: true, svg: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.5"/>' },
  { label: 'Editorial Decision', svg: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
  { label: 'Author Revision', svg: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
  { label: 'Final Acceptance', svg: '<polyline points="20 6 9 17 4 12"/>' },
]
