import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  THEMES,
  BOOK_HUBS,
  JOURNAL_HUBS,
  GENERAL_HUBS,
  PEOPLE_HUBS,
  LIFECYCLE_STEPS,
  type HubData,
  type LifecycleStep
} from '@/config/portalConfig'

type Screen = 'choose' | 'portal' | 'journal' | 'general' | 'people'

const css = `
  .ink-root *, .ink-root *::before, .ink-root *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .ink-root, .ink-root[data-theme=""] {
    --accent:#F48B29; --accent-2:#1B4F9C; --accent-deep:#0F366E; --accent-soft:#FFD8B3; --accent-wash:#EEF5FC;
    --surface:#131922; --surface-2:#1B2330; --surface-3:#222D3D; --surface-2b:#18202B; --surface-deep:#0D1218; --surface-line:#2C3B50; --border-dark:#33455D;
    --n-0:#FFFFFF; --n-50:#F8FAFC; --n-100:#F1F4F9; --n-page:#EBF1F7; --n-soft:#DEE7F2; --border:#CFDCEB;
    --n-line:#9AB0C9; --n-mid:#839BB8; --n-muted:#68809D; --n-dim:#4F6580; --ink:#121822;
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
  .ink-hubcard:hover { transform: translateY(-3px); border-color: var(--accent-2) !important; background: var(--n-0) !important; box-shadow: 0 12px 28px rgba(19, 25, 34, 0.08) !important; }
  .ink-hubcard:hover .ink-hubicon { background: var(--accent-2) !important; color: var(--n-0) !important; }
  .ink-hubcard:hover .ink-enter { background: var(--accent) !important; color: var(--n-0) !important; }

  .ink-pill { transition: border-color .2s ease, box-shadow .2s ease, background .2s ease; cursor: pointer; }
  .ink-pill:hover { border-color: var(--accent-2) !important; background: var(--n-0) !important; box-shadow: 0 6px 18px color-mix(in srgb, var(--accent-2) 12%, transparent); }
  .ink-pill:hover .ink-pillicon { background: var(--accent-wash) !important; color: var(--accent-deep) !important; }

  .ink-choicecard { transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease; cursor: pointer; }
  .ink-choicecard:hover { transform: translateY(-3px); border-color: var(--accent-2) !important; box-shadow: 0 12px 28px rgba(19, 25, 34, 0.08) !important; }
  .ink-choicecard:hover .ink-choiceglow { opacity: 1 !important; }
  .ink-choicecard:hover .ink-choiceicon { transform: scale(1.06) rotate(-2deg); background: var(--accent-2) !important; color: var(--n-0) !important; }
  .ink-choicecard:hover .ink-choiceenter { background: var(--accent) !important; color: var(--n-0) !important; }

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
            <div style={{ fontFamily: 'Spectral, serif', fontSize: 20, fontWeight: 700, color: 'var(--accent-2)', lineHeight: 1, letterSpacing: '-0.01em' }}>
              <span style={{ color: 'var(--accent)' }}>Ninja</span> Inkflow
            </div>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--n-muted)', fontWeight: 600, marginTop: 5 }}>{subtitle}</div>
          </div>
        </div>
        <div style={{ fontFamily: 'Spectral, serif', fontWeight: 700, fontSize: 14, color: 'var(--accent-2)' }}>Streamline. Collaborate. Deliver Excellence.</div>
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
    <div onClick={onLogin} className="ink-hubcard" style={{ display: 'flex', flexDirection: 'column', background: '#FFFFFF', border: '1px solid var(--border)', borderRadius: 8, padding: '22px 20px 18px', color: 'var(--ink)', boxShadow: '0 4px 12px rgba(19, 25, 34, 0.04)' }}>
      <div style={{ marginBottom: 14 }}>
        <span className="ink-hubicon" style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--accent-wash)', color: 'var(--accent-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .22s, color .22s', border: '1px solid var(--border)' }}>
          <HubIcon paths={hub.svg} />
        </span>
      </div>
      <div style={{ fontFamily: 'Spectral, serif', fontSize: 16, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.28, marginBottom: 7 }}>{hub.title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--n-muted)', lineHeight: 1.6, flex: 1, marginBottom: 16 }}>{hub.desc}</div>
      <div className="ink-enter" style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 700,
        color: '#FFFFFF',
        background: 'var(--accent-2)',
        borderRadius: 8,
        padding: '8px 14px',
        width: 'fit-content',
        transition: 'background-color .22s, transform .22s',
        marginTop: 'auto'
      }}>
        Enter Hub <ArrowRight size={12} />
      </div>
    </div>
  )
}

function ChooseScreen({ onBook, onJournal, onGeneral, onPeople }: { onBook: () => void; onJournal: () => void; onGeneral: () => void; onPeople: () => void }) {
  const cardStyle: React.CSSProperties = {
    position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column',
    background: '#FFFFFF',
    border: '1px solid var(--border)', borderRadius: 8,
    padding: '24px', color: 'var(--ink)', boxShadow: '0 4px 12px rgba(19, 25, 34, 0.04)',
  }
  const iconStyle: React.CSSProperties = {
    width: 44, height: 44, borderRadius: 12, background: 'var(--accent-wash)', color: 'var(--accent-2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'transform .25s, background-color .25s, color .25s',
    border: '1px solid var(--border)',
  }
  const tagStyle: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 600, color: 'var(--accent-deep)',
    background: 'var(--accent-wash)',
    border: '1px solid var(--border)',
    padding: '3px 8px', borderRadius: 6,
  }
  const ctaStyle: React.CSSProperties = {
    position: 'relative', display: 'inline-flex', alignItems: 'center',
    gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--n-0)', background: 'var(--accent-2)',
    borderRadius: 8, padding: '8px 14px', width: 'fit-content', transition: 'background-color .2s, transform .2s',
    marginTop: 'auto',
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <NavBar subtitle="Workflow Management Hubs" />

      {/* Hero band — spacious */}
      <div style={{ position: 'relative', overflow: 'hidden', background: '#F2F2F2', flexShrink: 0, padding: '48px 36px', minHeight: 200, display: 'flex', alignItems: 'center', borderBottom: '1px solid #E5E5E5' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(1000px 400px at 80% 10%, rgba(27, 79, 156, 0.05), transparent)' }} />
        <img src="/portal-assets/workflow-hero.png" alt="" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', width: '64%', objectFit: 'cover', objectPosition: 'right center', opacity: 0.9, WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 34%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 34%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1320, margin: '0 auto', width: '100%' }}>
          {/* <div style={{ fontSize: 18, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent-2)', fontWeight: 800, marginBottom: 8 }}>S4C Ninja Inkflow</div> */}
          <h1 style={{ fontFamily: 'Spectral, serif', fontSize: 20, fontWeight: 700, color: '#262626', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 6 }}>
            <em style={{ color: 'var(--accent-2)', fontStyle: 'italic' }}>Manuscript-to-Market</em>
            {/* Choose your <em style={{ color: 'var(--accent-2)', fontStyle: 'italic' }}>production line</em> */}
          </h1>
          <h2 style={{ fontFamily: 'Spectral, serif', fontSize: 20, fontWeight: 700, color: '#262626', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 6 }}>An End-to-End Digital Publishing Ecosystem</h2>
          <p style={{ fontSize: 14.5, color: '#505050', maxWidth: 580 }}>Select a publishing stream to enter its dedicated workflow hubs. Designed with professional corporate layouts.</p>
        </div>
      </div>

      {/* Choice cards — compact, always 4 columns */}
      <main style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 1320, margin: '0 auto', padding: '16px 36px 20px', boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, width: '100%' }}>

          {/* Book card */}
          <div onClick={onBook} className="ink-choicecard" style={cardStyle}>
            <div className="ink-choiceglow" style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(27, 79, 156, 0.06), transparent 70%)', opacity: 0, transition: 'opacity .25s' }} />
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <span className="ink-choiceicon" style={iconStyle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5z" /><path d="M4 4.5A2.5 2.5 0 0 0 6.5 7H20" /><path d="M9 12h7" />
                </svg>
              </span>
            </div>
            <h2 style={{ position: 'relative', fontFamily: 'Spectral, serif', fontSize: 19, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Book Production</h2>
            <p style={{ position: 'relative', fontSize: 12, color: 'var(--n-muted)', lineHeight: 1.6, marginBottom: 12 }}>End-to-end monograph and textbook publishing — manuscript analysis, copyediting, XML, pages and accessibility across {BOOK_HUBS.length} dedicated hubs.</p>
            <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {[`${BOOK_HUBS.length} Stages`, '15-step pipeline', 'NLM XML'].map(tag => <span key={tag} style={tagStyle}>{tag}</span>)}
            </div>
            <div className="ink-choiceenter" style={ctaStyle}>Enter Book Workflow <ArrowRight size={13} /></div>
          </div>

          {/* Journal card */}
          <div onClick={onJournal} className="ink-choicecard" style={cardStyle}>
            <div className="ink-choiceglow" style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(27, 79, 156, 0.06), transparent 70%)', opacity: 0, transition: 'opacity .25s' }} />
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <span className="ink-choiceicon" style={iconStyle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v15a1 1 0 0 1-1.4.9L13 19l-2.6 1.9A1 1 0 0 1 9 20V5z" /><path d="M17 6h1a2 2 0 0 1 2 2v11" /><path d="M7 7h6M7 10.5h6" />
                </svg>
              </span>
            </div>
            <h2 style={{ position: 'relative', fontFamily: 'Spectral, serif', fontSize: 19, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Journal Production</h2>
            <p style={{ position: 'relative', fontSize: 12, color: 'var(--n-muted)', lineHeight: 1.6, marginBottom: 12 }}>Full journal lifecycle from submission and peer review through JATS XML, typesetting, proofing and online publication — {JOURNAL_HUBS.length} vendor stages.</p>
            <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {[`${JOURNAL_HUBS.length} Stages`, 'Peer review', 'JATS · DOI'].map(tag => <span key={tag} style={tagStyle}>{tag}</span>)}
            </div>
            <div className="ink-choiceenter" style={ctaStyle}>Enter Journal Workflow <ArrowRight size={13} /></div>
          </div>

          {/* Operations & Services card */}
          <div onClick={onGeneral} className="ink-choicecard" style={cardStyle}>
            <div className="ink-choiceglow" style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(27, 79, 156, 0.06), transparent 70%)', opacity: 0, transition: 'opacity .25s' }} />
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <span className="ink-choiceicon" style={iconStyle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              </span>
            </div>
            <h2 style={{ position: 'relative', fontFamily: 'Spectral, serif', fontSize: 19, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Operations & Services</h2>
            <p style={{ position: 'relative', fontSize: 12, color: 'var(--n-muted)', lineHeight: 1.6, marginBottom: 12 }}>Internal operations, client services and admin hubs — HR, billing, reporting, archive and support — all in one portal.</p>
            <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {[`${GENERAL_HUBS.length} services`, 'Support', 'Billing', 'Reports'].map(tag => <span key={tag} style={tagStyle}>{tag}</span>)}
            </div>
            <div className="ink-choiceenter" style={ctaStyle}>Enter Operations Hub <ArrowRight size={13} /></div>
          </div>

          {/* People Hub card */}
          <div onClick={onPeople} className="ink-choicecard" style={cardStyle}>
            <div className="ink-choiceglow" style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(27, 79, 156, 0.06), transparent 70%)', opacity: 0, transition: 'opacity .25s' }} />
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <span className="ink-choiceicon" style={iconStyle}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
            </div>
            <h2 style={{ position: 'relative', fontFamily: 'Spectral, serif', fontSize: 19, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>S4C People Hub</h2>
            <p style={{ position: 'relative', fontSize: 12, color: 'var(--n-muted)', lineHeight: 1.6, marginBottom: 12 }}>Manage employee directory, staff onboarding workflows, benefits packages, and payroll operations.</p>
            <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {[`${PEOPLE_HUBS.length} services`, 'HR · Payroll', 'Staff directory'].map(tag => <span key={tag} style={tagStyle}>{tag}</span>)}
            </div>
            <div className="ink-choiceenter" style={ctaStyle}>Enter People Hub <ArrowRight size={13} /></div>
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
      <NavBar subtitle="Book Prodution Hubs" />

      {/* Hero */}
      <div style={{ position: 'relative', overflow: 'hidden', background: '#F2F2F2', minHeight: 200, padding: '36px 36px', borderBottom: '1px solid #E5E5E5' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(900px 360px at 80% 10%, rgba(27, 79, 156, 0.05), transparent)' }} />
        <img src="/portal-assets/book-hero.png" alt="" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', width: '58%', objectFit: 'cover', objectPosition: 'right center', opacity: 0.9, WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1320, margin: '0 auto' }}>
          <div onClick={onBack} className="ink-back" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--n-muted)', marginBottom: 12 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            All workflows
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent-2)', fontWeight: 800, marginBottom: 11 }}>Book Production · S4C Ninja Inkflow</div>
          <h1 style={{ fontFamily: 'Spectral, serif', fontSize: 34, fontWeight: 700, color: '#262626', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 9 }}>
            Book <em style={{ color: 'var(--accent-2)', fontStyle: 'italic' }}>Prodution Hubs</em>
          </h1>
          <p style={{ fontSize: 14.5, color: '#505050', maxWidth: 500 }}>Select a hub below to access your workspace. All hubs require authentication.</p>
        </div>
      </div>

      {/* Main panel */}
      <main style={{ flex: 1, width: '100%', maxWidth: 1320, margin: '0 auto', padding: '36px 36px 48px' }}>
        <div style={{ background: 'var(--n-0)', border: '1px solid var(--border)', borderRadius: 20, padding: 36, boxShadow: '0 4px 28px rgba(28,26,23,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 26, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: 'Spectral, serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>Publishing Workflow Hubs</h2>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{BOOK_HUBS.length} Stages Available</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {BOOK_HUBS.map(hub => <HubCard key={hub.title} hub={hub} onLogin={onLogin} />)}
          </div>

        </div>
      </main>

      <PortalFooter />
    </>
  )
}

function JournalPortalScreen({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  return (
    <>
      <NavBar subtitle="Journal Prodution Hubs" />

      {/* Hero */}
      <div style={{ position: 'relative', overflow: 'hidden', background: '#F2F2F2', minHeight: 200, padding: '36px 36px', borderBottom: '1px solid #E5E5E5' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(900px 360px at 80% 10%, rgba(27, 79, 156, 0.05), transparent)' }} />
        <img src="/portal-assets/journal-hero.png" alt="" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', width: '58%', objectFit: 'cover', objectPosition: 'right center', opacity: 0.9, WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1320, margin: '0 auto' }}>
          <div onClick={onBack} className="ink-back" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--n-muted)', marginBottom: 12 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            All workflows
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent-2)', fontWeight: 800, marginBottom: 11 }}>Journal Production · S4C Ninja Inkflow</div>
          <h1 style={{ fontFamily: 'Spectral, serif', fontSize: 34, fontWeight: 700, color: '#262626', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 9 }}>
            Journal <em style={{ color: 'var(--accent-2)', fontStyle: 'italic' }}>Prodution Hubs</em>
          </h1>
          <p style={{ fontSize: 14.5, color: '#505050', maxWidth: 520 }}>From manuscript submission through peer review to online publication.</p>
        </div>
      </div>

      <main style={{ flex: 1, width: '100%', maxWidth: 1320, margin: '0 auto', padding: '36px 36px 48px', display: 'flex', flexDirection: 'column', gap: 22 }}>

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
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{JOURNAL_HUBS.length} Stages Available</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 16 }}>
            {JOURNAL_HUBS.map(hub => <HubCard key={hub.title} hub={hub} onLogin={onLogin} />)}
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
      <div style={{ position: 'relative', overflow: 'hidden', background: '#F2F2F2', minHeight: 200, padding: '36px 36px', borderBottom: '1px solid #E5E5E5' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(900px 360px at 80% 10%, rgba(27, 79, 156, 0.05), transparent)' }} />
        <img src="/portal-assets/operations-hero.png" alt="" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', width: '58%', objectFit: 'cover', objectPosition: 'right center', opacity: 0.9, WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1320, margin: '0 auto' }}>
          <div onClick={onBack} className="ink-back" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--n-muted)', marginBottom: 12 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            All workflows
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent-2)', fontWeight: 800, marginBottom: 11 }}>Operations · S4C Ninja Inkflow</div>
          <h1 style={{ fontFamily: 'Spectral, serif', fontSize: 34, fontWeight: 700, color: '#262626', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 9 }}>
            Operations <em style={{ color: 'var(--accent-2)', fontStyle: 'italic' }}>&amp; Services</em>
          </h1>
          <p style={{ fontSize: 14.5, color: '#505050', maxWidth: 500 }}>Access Billing, Reporting and Admin hubs. All hubs require authentication.</p>
        </div>
      </div>

      {/* Main panel */}
      <main style={{ flex: 1, width: '100%', maxWidth: 1320, margin: '0 auto', padding: '36px 36px 48px' }}>
        <div style={{ background: 'var(--n-0)', border: '1px solid var(--border)', borderRadius: 20, padding: 36, boxShadow: '0 4px 28px rgba(28,26,23,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 26, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: 'Spectral, serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>Operations Hubs</h2>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{GENERAL_HUBS.length} Services Available</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {GENERAL_HUBS.map(hub => <HubCard key={hub.title} hub={hub} onLogin={onLogin} />)}
          </div>
        </div>
      </main>

      <PortalFooter />
    </>
  )
}

function PeoplePortalScreen({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  return (
    <>
      <NavBar subtitle="People Management Hubs" />

      {/* Hero */}
      <div style={{ position: 'relative', overflow: 'hidden', background: '#F2F2F2', minHeight: 200, padding: '36px 36px', borderBottom: '1px solid #E5E5E5' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(900px 360px at 80% 10%, rgba(27, 79, 156, 0.05), transparent)' }} />
        <img src="/portal-assets/people-hero.png" alt="" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', width: '58%', objectFit: 'cover', objectPosition: 'right center', opacity: 0.9, WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1320, margin: '0 auto' }}>
          <div onClick={onBack} className="ink-back" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--n-muted)', marginBottom: 12 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            All workflows
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--accent-2)', fontWeight: 800, marginBottom: 11 }}>HRMS · S4C People Hub</div>
          <h1 style={{ fontFamily: 'Spectral, serif', fontSize: 34, fontWeight: 700, color: '#262626', lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 9 }}>
            S4C People <em style={{ color: 'var(--accent-2)', fontStyle: 'italic' }}>Hubs</em>
          </h1>
          <p style={{ fontSize: 14.5, color: '#505050', maxWidth: 500 }}>Secure HR records, staff onboarding status, benefits packages, and payroll operations hub.</p>
        </div>
      </div>

      {/* Main panel */}
      <main style={{ flex: 1, width: '100%', maxWidth: 1320, margin: '0 auto', padding: '36px 36px 48px' }}>
        <div style={{ background: 'var(--n-0)', border: '1px solid var(--border)', borderRadius: 20, padding: 36, boxShadow: '0 4px 28px rgba(28,26,23,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 26, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontFamily: 'Spectral, serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>People & HR Hubs</h2>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--n-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{PEOPLE_HUBS.length} Services Available</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {PEOPLE_HUBS.map(hub => <HubCard key={hub.title} hub={hub} onLogin={onLogin} />)}
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

      {screen === 'choose' && <ChooseScreen onBook={() => goTo('portal')} onJournal={() => goTo('journal')} onGeneral={() => goTo('general')} onPeople={() => goTo('people')} />}
      {screen === 'portal' && <BookPortalScreen onBack={() => goTo('choose')} onLogin={goLogin} />}
      {screen === 'journal' && <JournalPortalScreen onBack={() => goTo('choose')} onLogin={goLogin} />}
      {screen === 'general' && <GeneralPortalScreen onBack={() => goTo('choose')} onLogin={goLogin} />}
      {screen === 'people' && <PeoplePortalScreen onBack={() => goTo('choose')} onLogin={goLogin} />}
    </div>
  )
}
