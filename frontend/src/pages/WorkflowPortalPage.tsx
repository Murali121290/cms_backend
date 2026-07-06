import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

type Screen = 'choose' | 'portal' | 'journal' | 'general'

const THEMES = [
  { id: 'default', name: 'Warm Amber',      dot: '#C8841C' },
  { id: 'ocean',   name: 'Ocean Blue',      dot: '#2A6FDB' },
  { id: 'slate',   name: 'Slate Dark',      dot: '#5866C4' },
  { id: 'forest',  name: 'Forest Green',    dot: '#2C8C5B' },
  { id: 'plum',    name: 'Royal Plum',      dot: '#8A4BC2' },
  { id: 'storm',   name: 'Stormy Morning',  dot: '#6A89A7' },
  { id: 'teal',    name: 'Coastal Teal',    dot: '#34A99D' },
  { id: 'earth',   name: 'Earthbound',      dot: '#A98E72' },
]

interface HubData { num: string; title: string; desc: string; svg: string }

const BOOK_HUBS: HubData[] = [
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
]

const JOURNAL_HUBS: HubData[] = [
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

const GENERAL_HUBS: HubData[] = [
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
]

const css = `
  .ink-root *, .ink-root *::before, .ink-root *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .ink-root, .ink-root[data-theme=""] {
    --accent:#E8C896; --accent-2:#C8841C; --accent-deep:#A66A12; --accent-soft:#F0D5A8; --accent-wash:#FBEFD9;
    --surface:#1C1A17; --surface-2:#242019; --surface-3:#2A251D; --surface-2b:#201D18; --surface-deep:#161412; --surface-line:#34302A; --border-dark:#3A352D;
    --n-0:#FFFFFF; --n-50:#FBF9F4; --n-100:#FAF7F0; --n-page:#F4F1EA; --n-soft:#F0EADB; --border:#E6DFD1;
    --n-line:#C7BEAC; --n-mid:#B5AC9B; --n-muted:#8C8475; --n-dim:#6B6357; --ink:#211E1A;
  }
  .ink-root[data-theme="ocean"] {
    --accent:#86B7E6; --accent-2:#2A6FDB; --accent-deep:#1B4F9C; --accent-soft:#AFD0F0; --accent-wash:#E3EEFB;
    --surface:#14181F; --surface-2:#1B212B; --surface-3:#222A36; --surface-2b:#191E27; --surface-deep:#0F1218; --surface-line:#2A3340; --border-dark:#2E3948;
    --n-0:#FFFFFF; --n-50:#F7F9FB; --n-100:#F2F5F9; --n-page:#EEF2F7; --n-soft:#E4EBF3; --border:#D8E0EA;
    --n-line:#C7BEAC; --n-mid:#B5AC9B; --n-muted:#8C8475; --n-dim:#6B6357; --ink:#211E1A;
  }
  .ink-root[data-theme="slate"] {
    --accent:#A5B0DE; --accent-2:#5866C4; --accent-deep:#3D49A0; --accent-soft:#C3CBEC; --accent-wash:#E8EAF7;
    --surface:#1A1C22; --surface-2:#22252D; --surface-3:#2A2E38; --surface-2b:#1E212A; --surface-deep:#141519; --surface-line:#30343E; --border-dark:#343945;
    --n-0:#FFFFFF; --n-50:#F8F9FB; --n-100:#F3F4F7; --n-page:#EEF0F4; --n-soft:#E5E8EE; --border:#D9DCE4;
    --n-line:#C7BEAC; --n-mid:#B5AC9B; --n-muted:#8C8475; --n-dim:#6B6357; --ink:#211E1A;
  }
  .ink-root[data-theme="forest"] {
    --accent:#93C9A6; --accent-2:#2C8C5B; --accent-deep:#1C6640; --accent-soft:#BEE0C9; --accent-wash:#E3F2E9;
    --surface:#15201A; --surface-2:#1C2921; --surface-3:#233229; --surface-2b:#19241E; --surface-deep:#101812; --surface-line:#2A3A30; --border-dark:#2F4038;
    --n-0:#FFFFFF; --n-50:#F7FAF8; --n-100:#F1F6F3; --n-page:#EDF3EF; --n-soft:#E2ECE5; --border:#D6E1DA;
    --n-line:#C7BEAC; --n-mid:#B5AC9B; --n-muted:#8C8475; --n-dim:#6B6357; --ink:#211E1A;
  }
  .ink-root[data-theme="plum"] {
    --accent:#C9A6E0; --accent-2:#8A4BC2; --accent-deep:#63328F; --accent-soft:#DDC4EE; --accent-wash:#F1E8F8;
    --surface:#1C1723; --surface-2:#26202E; --surface-3:#2F2839; --surface-2b:#211B29; --surface-deep:#150F1B; --surface-line:#382F44; --border-dark:#3D3349;
    --n-0:#FFFFFF; --n-50:#FAF8FC; --n-100:#F5F1F8; --n-page:#F2EEF6; --n-soft:#EAE3F0; --border:#DFD8E6;
    --n-line:#C7BEAC; --n-mid:#B5AC9B; --n-muted:#8C8475; --n-dim:#6B6357; --ink:#211E1A;
  }
  .ink-root[data-theme="storm"] {
    --accent:#A9C5DE; --accent-2:#6A89A7; --accent-deep:#48647E; --accent-soft:#C6DAEC; --accent-wash:#EAF1F8;
    --surface:#232D38; --surface-2:#2C3845; --surface-3:#354352; --surface-2b:#28323D; --surface-deep:#1A222B; --surface-line:#3B4856; --border-dark:#3F4D5C;
    --n-0:#FFFFFF; --n-50:#F8FAFC; --n-100:#F2F5F8; --n-page:#EEF2F6; --n-soft:#E3EAF1; --border:#D7DFE8;
    --n-line:#C7BEAC; --n-mid:#B5AC9B; --n-muted:#8C8475; --n-dim:#6B6357; --ink:#211E1A;
  }
  .ink-root[data-theme="teal"] {
    --accent:#E5CB90; --accent-2:#34A99D; --accent-deep:#2C7E76; --accent-soft:#F0DEB0; --accent-wash:#FFF3C8;
    --surface:#123138; --surface-2:#173C44; --surface-3:#1D4750; --surface-2b:#153840; --surface-deep:#0D242A; --surface-line:#25525B; --border-dark:#295A63;
    --n-0:#FFFFFF; --n-50:#FCFAF3; --n-100:#F8F4E8; --n-page:#F4EFE0; --n-soft:#EDE6D2; --border:#DED6C0;
    --n-line:#C7BEAC; --n-mid:#B5AC9B; --n-muted:#8C8475; --n-dim:#6B6357; --ink:#211E1A;
  }
  .ink-root[data-theme="earth"] {
    --accent:#EAC9A8; --accent-2:#6F7F62; --accent-deep:#54634A; --accent-soft:#F2DAC1; --accent-wash:#F7EFE4;
    --surface:#241E17; --surface-2:#2E271E; --surface-3:#372F24; --surface-2b:#28221A; --surface-deep:#1A150F; --surface-line:#3C3327; --border-dark:#42392C;
    --n-0:#FFFFFF; --n-50:#FBF8F3; --n-100:#F6F1E9; --n-page:#F2ECE1; --n-soft:#EAE0D1; --border:#DFD3C0;
    --n-line:#C7BEAC; --n-mid:#B5AC9B; --n-muted:#8C8475; --n-dim:#6B6357; --ink:#211E1A;
  }

  .ink-root { font-family: 'Hanken Grotesk', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }

  @keyframes pulseDot { 0%,100%{opacity:1} 50%{opacity:.4} }

  .ink-hubcard { transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease, background .22s ease; cursor: pointer; }
  .ink-hubcard:hover { transform: translateY(-3px); border-color: var(--accent-2) !important; background: linear-gradient(165deg, var(--surface-3) 0%, var(--surface-2b) 100%) !important; box-shadow: 0 14px 34px rgba(0,0,0,0.4); }
  .ink-hubcard:hover .ink-hubicon { background: var(--accent) !important; color: var(--surface) !important; }
  .ink-hubcard:hover .ink-enter { opacity: 1 !important; color: var(--accent) !important; }

  .ink-pill { transition: border-color .2s ease, box-shadow .2s ease, background .2s ease; cursor: pointer; }
  .ink-pill:hover { border-color: var(--accent-2) !important; background: var(--n-0) !important; box-shadow: 0 6px 18px color-mix(in srgb, var(--accent-2) 12%, transparent); }
  .ink-pill:hover .ink-pillicon { background: var(--accent-wash) !important; color: var(--accent-deep) !important; }

  .ink-choicecard { transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; cursor: pointer; }
  .ink-choicecard:hover { transform: translateY(-4px); border-color: var(--accent-2) !important; box-shadow: 0 20px 46px rgba(0,0,0,0.42); }
  .ink-choicecard:hover .ink-choiceglow { opacity: 1 !important; }
  .ink-choicecard:hover .ink-choiceicon { transform: scale(1.06) rotate(-3deg); }
  .ink-choicecard:hover .ink-choiceenter { background: var(--accent-soft) !important; }

  .ink-swatch-item { transition: background .16s ease; cursor: pointer; }
  .ink-swatch-item:hover { background: var(--accent-wash) !important; }

  .ink-back { transition: color .18s ease; cursor: pointer; }
  .ink-back:hover { color: var(--accent-deep) !important; }
`

function HubIcon({ paths }: { paths: string }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  )
}

function ArrowRight({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function NavBar({ subtitle }: { subtitle: string }) {
  return (
    <nav style={{ background: 'var(--n-50)', borderBottom: '1px solid var(--border)', boxShadow: '0 1px 10px rgba(28,26,23,0.04)' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '14px 36px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/portal-assets/s4c-logo.png" alt="S4Carlisle Publishing Services" style={{ height: 40, width: 'auto', display: 'block' }} />
          <div style={{ width: 1, height: 30, background: 'var(--border)' }} />
          <div>
            <div style={{ fontFamily: 'Spectral, serif', fontSize: 20, fontWeight: 700, color: 'var(--surface)', lineHeight: 1, letterSpacing: '-0.01em' }}>
              Inkflow <span style={{ color: 'var(--accent-deep)' }}>Platform</span>
            </div>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--n-muted)', fontWeight: 600, marginTop: 5 }}>{subtitle}</div>
          </div>
        </div>
        <div style={{ fontFamily: 'Spectral, serif', fontStyle: 'italic', fontSize: 14, color: 'var(--n-muted)' }}>Streamline. Collaborate. Deliver Excellence.</div>
      </div>
    </nav>
  )
}

function PortalFooter() {
  return (
    <footer style={{ background: 'var(--surface)', padding: '16px 32px', textAlign: 'center', fontSize: 12, color: 'var(--n-dim)' }}>
      © 2026 <strong style={{ color: 'var(--accent)', fontWeight: 700 }}>S4Carlisle Publishing Services Ltd</strong>. All rights reserved.
    </footer>
  )
}

function HubCard({ hub, onLogin }: { hub: HubData; onLogin: () => void }) {
  return (
    <div onClick={onLogin} className="ink-hubcard" style={{ display: 'flex', flexDirection: 'column', background: 'linear-gradient(165deg, var(--surface-2) 0%, var(--surface) 100%)', border: '1.5px solid var(--border-dark)', borderRadius: 15, padding: '22px 20px 18px', color: 'inherit' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <span className="ink-hubicon" style={{ width: 42, height: 42, borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .22s, color .22s' }}>
          <HubIcon paths={hub.svg} />
        </span>
        <span style={{ fontFamily: 'Spline Sans Mono, monospace', fontSize: 11, fontWeight: 600, color: 'var(--n-dim)', marginTop: 4 }}>{hub.num}</span>
      </div>
      <div style={{ fontFamily: 'Spectral, serif', fontSize: 16, fontWeight: 600, color: 'var(--n-50)', lineHeight: 1.28, marginBottom: 7 }}>{hub.title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--n-mid)', lineHeight: 1.6, flex: 1, marginBottom: 16 }}>{hub.desc}</div>
      <div className="ink-enter" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.07em', textTransform: 'uppercase', opacity: 0, transition: 'opacity .22s, color .22s', marginTop: 'auto' }}>
        Enter Hub <ArrowRight size={12} />
      </div>
    </div>
  )
}

function ChooseScreen({ onBook, onJournal, onGeneral }: { onBook: () => void; onJournal: () => void; onGeneral: () => void }) {
  const cardStyle: React.CSSProperties = {
    position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column',
    background: 'linear-gradient(165deg, var(--surface-2) 0%, var(--surface) 100%)',
    border: '1.5px solid var(--border-dark)', borderRadius: 14,
    padding: '18px 18px 16px', color: 'inherit', boxShadow: '0 8px 28px rgba(28,26,23,0.20)',
  }
  const iconStyle: React.CSSProperties = {
    width: 42, height: 42, borderRadius: 11, background: 'var(--accent)', color: 'var(--surface)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'transform .25s',
  }
  const tagStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: 'var(--accent)',
    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
    border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
    padding: '3px 8px', borderRadius: 6,
  }
  const ctaStyle: React.CSSProperties = {
    position: 'relative', display: 'inline-flex', alignItems: 'center',
    gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--surface)', background: 'var(--accent)',
    borderRadius: 8, padding: '8px 12px', width: 'fit-content', transition: 'background .2s',
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <NavBar subtitle="Workflow Management Portal" />

      {/* Hero band — spacious */}
      <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface)', flexShrink: 0, padding: '36px 36px', minHeight: 180, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(900px 360px at 80% 10%, color-mix(in srgb, var(--accent-2) 26%, transparent), transparent 60%)' }} />
        <img src="/portal-assets/workflow-hero.png" alt="" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', width: '64%', objectFit: 'cover', objectPosition: 'right center', mixBlendMode: 'lighten', WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 34%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 34%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1320, margin: '0 auto', width: '100%' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700, marginBottom: 8 }}>S4C Inkflow Platform · 2026</div>
          <h1 style={{ fontFamily: 'Spectral, serif', fontSize: 32, fontWeight: 700, color: 'var(--n-50)', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 6, textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
            Choose your <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>production line</em>
          </h1>
          <p style={{ fontSize: 14.5, color: 'var(--n-line)', textShadow: '0 1px 10px rgba(0,0,0,0.5)' }}>Select a publishing stream to enter its dedicated workflow hubs.</p>
        </div>
      </div>

      {/* Choice cards — compact, always 3 columns */}
      <main style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 1040, margin: '0 auto', padding: '16px 36px 20px', boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, width: '100%' }}>

          {/* Book card */}
          <div onClick={onBook} className="ink-choicecard" style={cardStyle}>
            <div className="ink-choiceglow" style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, color-mix(in srgb, var(--accent-2) 14%, transparent), transparent 70%)', opacity: 0, transition: 'opacity .25s' }} />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="ink-choiceicon" style={iconStyle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5z" /><path d="M4 4.5A2.5 2.5 0 0 0 6.5 7H20" /><path d="M9 12h7" />
                </svg>
              </span>
              <span style={{ fontFamily: 'Spline Sans Mono, monospace', fontSize: 11, fontWeight: 600, color: 'var(--n-dim)' }}>01</span>
            </div>
            <h2 style={{ position: 'relative', fontFamily: 'Spectral, serif', fontSize: 19, fontWeight: 700, color: 'var(--n-50)', marginBottom: 6 }}>Book Production</h2>
            <p style={{ position: 'relative', fontSize: 12, color: 'var(--n-mid)', lineHeight: 1.6, marginBottom: 12 }}>End-to-end monograph and textbook publishing — manuscript analysis, copyediting, XML, pages and accessibility across 12 dedicated hubs.</p>
            <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {['12 Hubs', '11-step pipeline', 'NLM XML'].map(tag => <span key={tag} style={tagStyle}>{tag}</span>)}
            </div>
            <div className="ink-choiceenter" style={ctaStyle}>Enter Book Workflow <ArrowRight size={13} /></div>
          </div>

          {/* Journal card */}
          <div onClick={onJournal} className="ink-choicecard" style={cardStyle}>
            <div className="ink-choiceglow" style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, color-mix(in srgb, var(--accent-2) 14%, transparent), transparent 70%)', opacity: 0, transition: 'opacity .25s' }} />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="ink-choiceicon" style={iconStyle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v15a1 1 0 0 1-1.4.9L13 19l-2.6 1.9A1 1 0 0 1 9 20V5z" /><path d="M17 6h1a2 2 0 0 1 2 2v11" /><path d="M7 7h6M7 10.5h6" />
                </svg>
              </span>
              <span style={{ fontFamily: 'Spline Sans Mono, monospace', fontSize: 11, fontWeight: 600, color: 'var(--n-dim)' }}>02</span>
            </div>
            <h2 style={{ position: 'relative', fontFamily: 'Spectral, serif', fontSize: 19, fontWeight: 700, color: 'var(--n-50)', marginBottom: 6 }}>Journal Production</h2>
            <p style={{ position: 'relative', fontSize: 12, color: 'var(--n-mid)', lineHeight: 1.6, marginBottom: 12 }}>Full journal lifecycle from submission and peer review through JATS XML, typesetting, proofing and online publication — 16 vendor stages.</p>
            <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {['16 Stages', 'Peer review', 'JATS · DOI'].map(tag => <span key={tag} style={tagStyle}>{tag}</span>)}
            </div>
            <div className="ink-choiceenter" style={ctaStyle}>Enter Journal Workflow <ArrowRight size={13} /></div>
          </div>

          {/* Operations & Services card */}
          <div onClick={onGeneral} className="ink-choicecard" style={cardStyle}>
            <div className="ink-choiceglow" style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, color-mix(in srgb, var(--accent-2) 14%, transparent), transparent 70%)', opacity: 0, transition: 'opacity .25s' }} />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className="ink-choiceicon" style={iconStyle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              </span>
              <span style={{ fontFamily: 'Spline Sans Mono, monospace', fontSize: 11, fontWeight: 600, color: 'var(--n-dim)' }}>03</span>
            </div>
            <h2 style={{ position: 'relative', fontFamily: 'Spectral, serif', fontSize: 19, fontWeight: 700, color: 'var(--n-50)', marginBottom: 6 }}>Operations & Services</h2>
            <p style={{ position: 'relative', fontSize: 12, color: 'var(--n-mid)', lineHeight: 1.6, marginBottom: 12 }}>Internal operations, client services and admin hubs — HR, billing, reporting, archive and support — all in one portal.</p>
            <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {['8 Hubs', 'HR · Billing', 'Reports'].map(tag => <span key={tag} style={tagStyle}>{tag}</span>)}
            </div>
            <div className="ink-choiceenter" style={ctaStyle}>Enter Operations Hub <ArrowRight size={13} /></div>
          </div>

        </div>
      </main>

      <PortalFooter />
    </div>
  )
}

function BookPortalScreen({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  return (
    <>
      <NavBar subtitle="Workflow Management Portal" />

      {/* Hero */}
      <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface)', minHeight: 210, padding: '36px 36px' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(900px 360px at 80% 10%, color-mix(in srgb, var(--accent-2) 26%, transparent), transparent 60%)' }} />
        <img src="/portal-assets/book-hero.png" alt="" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', width: '58%', objectFit: 'cover', objectPosition: 'right center', mixBlendMode: 'lighten', WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1320, margin: '0 auto' }}>
          <div onClick={onBack} className="ink-back" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--n-muted)', marginBottom: 12 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            All workflows
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700, marginBottom: 11 }}>Book Production · S4C Inkflow</div>
          <h1 style={{ fontFamily: 'Spectral, serif', fontSize: 34, fontWeight: 700, color: 'var(--n-50)', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 9, textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
            Book <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Workflow Hubs</em>
          </h1>
          <p style={{ fontSize: 14.5, color: 'var(--n-line)', maxWidth: 500, textShadow: '0 1px 10px rgba(0,0,0,0.5)' }}>Select a hub below to access your workspace. All hubs require authentication.</p>
        </div>
      </div>

      {/* Main panel */}
      <main style={{ maxWidth: 1320, margin: '0 auto', padding: '36px 36px 48px' }}>
        <div style={{ background: 'var(--n-0)', border: '1px solid var(--border)', borderRadius: 20, padding: 36, boxShadow: '0 4px 28px rgba(28,26,23,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 26, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: 'Spectral, serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>Publishing Workflow Hubs</h2>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>12 Hubs Available</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {BOOK_HUBS.map(hub => <HubCard key={hub.num} hub={hub} onLogin={onLogin} />)}
          </div>

        </div>
      </main>

      <PortalFooter />
    </>
  )
}

interface LifecycleStep {
  label: string
  active?: boolean
  done?: boolean
  svg: string
}

const LIFECYCLE_STEPS: LifecycleStep[] = [
  { label: 'Submission', done: true, svg: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>' },
  { label: 'Initial Screening', svg: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>' },
  { label: 'Editor Assignment', svg: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/>' },
  { label: 'Reviewer Selection', svg: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3 3-1.5-1.5"/>' },
  { label: 'Peer Review', active: true, svg: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.5"/>' },
  { label: 'Editorial Decision', svg: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
  { label: 'Author Revision', svg: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
  { label: 'Final Acceptance', svg: '<polyline points="20 6 9 17 4 12"/>' },
]

function JournalPortalScreen({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  return (
    <>
      <NavBar subtitle="Journal Management System" />

      {/* Hero */}
      <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface)', minHeight: 210, padding: '36px 36px' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(900px 360px at 80% 10%, color-mix(in srgb, var(--accent-2) 26%, transparent), transparent 60%)' }} />
        <img src="/portal-assets/journal-hero.png" alt="" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', width: '58%', objectFit: 'cover', objectPosition: 'right center', mixBlendMode: 'lighten', WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1320, margin: '0 auto' }}>
          <div onClick={onBack} className="ink-back" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--n-muted)', marginBottom: 12 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            All workflows
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700, marginBottom: 11 }}>Journal Production · S4C Inkflow</div>
          <h1 style={{ fontFamily: 'Spectral, serif', fontSize: 34, fontWeight: 700, color: 'var(--n-50)', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 9, textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
            Journal <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Workflow Hubs</em>
          </h1>
          <p style={{ fontSize: 14.5, color: 'var(--n-line)', maxWidth: 520, textShadow: '0 1px 10px rgba(0,0,0,0.5)' }}>From manuscript submission through peer review to online publication.</p>
        </div>
      </div>

      <main style={{ maxWidth: 1320, margin: '0 auto', padding: '36px 36px 48px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Editorial Lifecycle */}
        <div style={{ background: 'var(--n-0)', border: '1px solid var(--border)', borderRadius: 20, padding: '30px 36px', boxShadow: '0 4px 28px rgba(28,26,23,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: 'Spectral, serif', fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>Editorial Lifecycle</h2>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Pre-production · Stages 1–8</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 4 }}>
            {LIFECYCLE_STEPS.map((step, i) => (
              <div key={step.label} style={{ display: 'flex', alignItems: 'flex-start', flexShrink: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 112 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: step.active ? 'var(--accent-2)' : step.done ? 'var(--surface)' : 'var(--n-soft)',
                    color: step.active ? 'var(--surface)' : step.done ? 'var(--accent)' : 'var(--n-dim)',
                    border: step.active || step.done ? 'none' : '1.5px solid var(--border)',
                    ...(step.label === 'Final Acceptance' ? { background: '#2E7D52', color: 'white' } : {}),
                  }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={step.label === 'Final Acceptance' ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"
                      dangerouslySetInnerHTML={{ __html: step.svg }} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: step.active ? 700 : 600, color: step.active ? 'var(--accent-deep)' : 'var(--border-dark)', textAlign: 'center', marginTop: 9, lineHeight: 1.25 }}>{step.label}</div>
                </div>
                {i < LIFECYCLE_STEPS.length - 1 && (
                  <div style={{ width: 30, height: 2, background: 'var(--border)', marginTop: 17, flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Production hubs */}
        <div style={{ background: 'var(--n-0)', border: '1px solid var(--border)', borderRadius: 20, padding: 36, boxShadow: '0 4px 28px rgba(28,26,23,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 26, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: 'Spectral, serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>Production Workflow Hubs</h2>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>12 Stages Available</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 16 }}>
            {JOURNAL_HUBS.map(hub => <HubCard key={hub.num} hub={hub} onLogin={onLogin} />)}
          </div>
        </div>
      </main>

      <PortalFooter />
    </>
  )
}

function GeneralPortalScreen({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  return (
    <>
      <NavBar subtitle="Operations & Services Portal" />

      {/* Hero */}
      <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface)', minHeight: 210, padding: '36px 36px' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(900px 360px at 80% 10%, color-mix(in srgb, var(--accent-2) 26%, transparent), transparent 60%)' }} />
        <img src="/portal-assets/workflow-hero.png" alt="" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', width: '58%', objectFit: 'cover', objectPosition: 'right center', mixBlendMode: 'lighten', WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1320, margin: '0 auto' }}>
          <div onClick={onBack} className="ink-back" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--n-muted)', marginBottom: 12 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            All workflows
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700, marginBottom: 11 }}>Operations · S4C Inkflow</div>
          <h1 style={{ fontFamily: 'Spectral, serif', fontSize: 34, fontWeight: 700, color: 'var(--n-50)', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 9, textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
            Operations <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>&amp; Services</em>
          </h1>
          <p style={{ fontSize: 14.5, color: 'var(--n-line)', maxWidth: 500, textShadow: '0 1px 10px rgba(0,0,0,0.5)' }}>Access HR, billing, reporting and admin hubs. All hubs require authentication.</p>
        </div>
      </div>

      {/* Main panel */}
      <main style={{ maxWidth: 1320, margin: '0 auto', padding: '36px 36px 48px' }}>
        <div style={{ background: 'var(--n-0)', border: '1px solid var(--border)', borderRadius: 20, padding: 36, boxShadow: '0 4px 28px rgba(28,26,23,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 26, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: 'Spectral, serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>Operations Hubs</h2>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>8 Hubs Available</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {GENERAL_HUBS.map(hub => <HubCard key={hub.num} hub={hub} onLogin={onLogin} />)}
          </div>
        </div>
      </main>

      <PortalFooter />
    </>
  )
}

export function WorkflowPortalPage() {
  const navigate = useNavigate()
  const [screen, setScreen] = useState<Screen>('choose')
  const [theme, setTheme] = useState<string>(() => {
    try { return localStorage.getItem('inkflow-theme') || 'default' } catch { return 'default' }
  })
  const [themeOpen, setThemeOpen] = useState(false)

  const goTo = (s: Screen) => { setScreen(s); window.scrollTo(0, 0) }
  const goLogin = () => navigate('/login')
  const pickTheme = (id: string) => {
    try { localStorage.setItem('inkflow-theme', id) } catch { /* noop */ }
    setTheme(id)
    setThemeOpen(false)
  }

  return (
    <div
      className="ink-root"
      data-theme={theme === 'default' ? '' : theme}
      style={{ minHeight: '100vh', background: 'var(--n-page)', display: 'flex', flexDirection: 'column' }}
    >
      <style>{css}</style>

      {/* Theme switcher */}
      <div style={{ position: 'fixed', left: 18, bottom: 18, zIndex: 400 }}>
        {themeOpen && (
          <div style={{ position: 'absolute', bottom: 52, left: 0, width: 210, background: 'var(--n-0)', border: '1px solid var(--border)', borderRadius: 14, padding: 7, boxShadow: '0 16px 44px rgba(0,0,0,0.22)' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--n-muted)', padding: '8px 10px 6px' }}>Change theme</div>
            {THEMES.map(t => (
              <div key={t.id} onClick={() => pickTheme(t.id)} className="ink-swatch-item"
                style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 9, background: t.id === theme ? 'var(--accent-wash)' : 'transparent' }}>
                <span style={{ width: 15, height: 15, borderRadius: '50%', background: t.dot, boxShadow: `0 0 0 2px var(--n-0), 0 0 0 3px ${t.dot}`, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: t.id === theme ? 700 : 500, color: 'var(--ink)' }}>{t.name}</span>
                {t.id === theme && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-2)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto' }}>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => setThemeOpen(o => !o)}
          aria-label="Change theme"
          style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--border-dark)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,0.28)' }}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="13.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="17.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="8.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="6.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
            <path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-.9.7-1.5 1.5-1.5H16a6 6 0 0 0 6-6c0-4.4-4.5-8-10-8z" />
          </svg>
        </button>
      </div>

      {screen === 'choose'  && <ChooseScreen onBook={() => goTo('portal')} onJournal={() => goTo('journal')} onGeneral={() => goTo('general')} />}
      {screen === 'portal'  && <BookPortalScreen onBack={() => goTo('choose')} onLogin={goLogin} />}
      {screen === 'journal' && <JournalPortalScreen onBack={() => goTo('choose')} onLogin={goLogin} />}
      {screen === 'general' && <GeneralPortalScreen onBack={() => goTo('choose')} onLogin={goLogin} />}
    </div>
  )
}
