import { useState, useEffect } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { getSession } from '@/api/session'
import { useRegister } from '@/features/session/useRegister'
import { getApiErrorMessage } from '@/api/client'
import { uiPaths } from '@/utils/appPaths'

const registerSchema = z
  .object({
    username: z.string().min(2, 'Username must be at least 2 characters'),
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type RegisterFormValues = z.infer<typeof registerSchema>

const css = `
  .pph-page-wrapper {
    --navy:   #1a2742;
    --navy2:  #223059;
    --coral:  #e8604a;
    --orange: #e87722;
    --gold:   #e8b84b;
    --ice:    #f0f4fb;
    --white:  #ffffff;
    --muted:  #8492a6;
    --border: #dde3ef;
    
    font-family: 'DM Sans', sans-serif;
    background: var(--ice);
    color: var(--navy);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    text-align: left;
    margin: 0;
    padding: 0;
    width: 100%;
  }
  .pph-page-wrapper *, .pph-page-wrapper *::before, .pph-page-wrapper *::after {
    box-sizing: border-box;
  }
  .pph-page-wrapper .page {
    position: relative;
    overflow: hidden;
    flex: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .pph-page-wrapper .b1, .pph-page-wrapper .b2, .pph-page-wrapper .b3 {
    position: fixed;
    border-radius: 50%;
    filter: blur(80px);
    pointer-events: none;
    z-index: 0;
  }
  .pph-page-wrapper .b1 { width: 520px; height: 520px; background: rgba(232,96,74,.18); top: -160px; left: -160px; }
  .pph-page-wrapper .b2 { width: 400px; height: 400px; background: rgba(232,135,34,.14); bottom: -120px; right: -100px; }
  .pph-page-wrapper .b3 { width: 300px; height: 300px; background: rgba(26,39,66,.12); top: 40%; left: 38%; }

  .pph-page-wrapper header.hdr {
    position: relative;
    z-index: 10;
    background: var(--white);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 36px;
    box-shadow: 0 2px 10px rgba(0,0,0,.08);
    border-bottom: 1px solid var(--border);
  }
  .pph-page-wrapper .hdr-logo { display: flex; align-items: center; }
  .pph-page-wrapper .hdr-logo img { height: 42px; width: auto; }
  .pph-page-wrapper .hdr-info { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; flex: 1; margin-left: 24px; }
  .pph-page-wrapper .hdr-title {
    font-family: 'Playfair Display', serif;
    font-size: 2.6rem;
    font-weight: 700;
    color: var(--navy);
    line-height: 1.1;
  }
  .pph-page-wrapper .hdr-title .red { color: var(--coral); }
  .pph-page-wrapper .hdr-tagline {
    font-size: .75rem;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .pph-page-wrapper main {
    position: relative;
    z-index: 5;
    display: grid;
    grid-template-columns: 1fr 420px;
    flex: 1;
    min-height: 0;
  }

  .pph-page-wrapper section.hero { position: relative; overflow: hidden; min-height: 480px; }
  .pph-page-wrapper .hero-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
  }
  .pph-page-wrapper .hero-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(26,39,66,.82) 0%, rgba(232,119,34,.55) 100%);
  }
  .pph-page-wrapper .hero-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    padding: 56px 48px;
  }
  .pph-page-wrapper .hero-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(232,184,75,.18);
    border: 1px solid rgba(232,184,75,.4);
    color: var(--gold);
    font-size: .75rem;
    font-weight: 600;
    letter-spacing: .08em;
    padding: 6px 14px;
    border-radius: 100px;
    margin-bottom: 22px;
    width: fit-content;
  }
  .pph-page-wrapper .hero-h {
    font-family: 'Playfair Display', serif;
    font-size: clamp(2rem, 3.5vw, 3rem);
    font-weight: 700;
    line-height: 1.15;
    color: var(--white);
    margin-bottom: 18px;
  }
  .pph-page-wrapper .hero-h em { color: var(--gold); font-style: normal; }
  .pph-page-wrapper .hero-p {
    font-size: .97rem;
    color: rgba(255,255,255,.75);
    line-height: 1.7;
    max-width: 440px;
  }

  .pph-page-wrapper aside.login-panel {
    background: var(--white);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 36px;
    box-shadow: -4px 0 24px rgba(0,0,0,.08);
  }
  .pph-page-wrapper .login-card { width: 100%; max-width: 340px; }
  .pph-page-wrapper .card-title {
    font-family: 'Playfair Display', serif;
    font-size: 1.45rem;
    font-weight: 700;
    color: var(--navy);
    text-align: center;
    margin-bottom: 4px;
  }
  .pph-page-wrapper .card-sub {
    font-size: .83rem;
    color: var(--muted);
    text-align: center;
    margin-bottom: 28px;
  }

  .pph-page-wrapper .flash-messages { margin-bottom: 16px; }
  .pph-page-wrapper .alert {
    padding: 10px 14px;
    border-radius: 8px;
    font-size: .85rem;
    margin-bottom: 8px;
  }
  .pph-page-wrapper .alert-error, .pph-page-wrapper .alert-danger {
    background: rgba(232,96,74,.1);
    color: var(--coral);
    border: 1px solid rgba(232,96,74,.3);
  }

  .pph-page-wrapper .field { margin-bottom: 18px; }
  .pph-page-wrapper .field label {
    display: block;
    font-size: .78rem;
    font-weight: 600;
    color: var(--navy);
    margin-bottom: 6px;
    letter-spacing: .04em;
    text-transform: none;
  }
  .pph-page-wrapper .iw { position: relative; }
  .pph-page-wrapper .iw i {
    position: absolute;
    left: 13px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    font-size: .88rem;
    pointer-events: none;
  }
  .pph-page-wrapper .iw input {
    width: 100%;
    padding: 11px 14px 11px 36px;
    border: 1.5px solid var(--border);
    border-radius: 9px;
    font-family: 'DM Sans', sans-serif;
    font-size: .92rem;
    color: var(--navy);
    background: var(--ice);
    transition: border-color .2s, box-shadow .2s;
  }
  .pph-page-wrapper .iw input:focus {
    outline: none;
    border-color: var(--coral);
    box-shadow: 0 0 0 3px rgba(232,96,74,.15);
    background: var(--white);
  }

  .pph-page-wrapper .btn-login {
    width: 100%;
    padding: 12px;
    background: linear-gradient(135deg, var(--coral), var(--orange));
    color: var(--white);
    border: none;
    border-radius: 9px;
    font-family: 'DM Sans', sans-serif;
    font-size: .95rem;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: .03em;
    transition: opacity .2s, transform .15s, box-shadow .2s;
    box-shadow: 0 4px 14px rgba(232,96,74,.35);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .pph-page-wrapper .btn-login:hover { opacity: .9; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(232,96,74,.4); }
  .pph-page-wrapper .btn-login:active { transform: translateY(0); }

  .pph-page-wrapper .card-footer {
    margin-top: 22px;
    text-align: center;
    font-size: .8rem;
    color: var(--muted);
  }
  .pph-page-wrapper .card-footer a { color: var(--coral); text-decoration: none; font-weight: 600; }
  .pph-page-wrapper .card-footer a:hover { text-decoration: underline; }

  .pph-page-wrapper section.perf {
    position: relative;
    z-index: 10;
    background: var(--navy);
    padding: 16px 32px;
    display: flex;
    flex-wrap: wrap;
    gap: 16px 24px;
    align-items: center;
  }
  .pph-page-wrapper .perf-section { display: flex; flex-direction: column; gap: 6px; }
  .pph-page-wrapper .perf-label {
    font-size: .63rem;
    font-weight: 700;
    letter-spacing: .8px;
    text-transform: uppercase;
    color: #f07a62;
  }
  .pph-page-wrapper .kpis { display: flex; gap: 28px; flex-wrap: wrap; }
  .pph-page-wrapper .kpi { display: flex; flex-direction: column; align-items: center; }
  .pph-page-wrapper .kpi-val {
    font-family: 'Playfair Display', serif;
    font-size: 1.45rem;
    font-weight: 700;
    color: var(--gold);
    line-height: 1;
  }
  .pph-page-wrapper .kpi-lbl { font-size: .68rem; color: rgba(255,255,255,.5); margin-top: 3px; text-align: center; }

  .pph-page-wrapper .svc-grid { display: flex; gap: 12px; flex-wrap: wrap; }
  .pph-page-wrapper .svc-item { display: flex; align-items: center; gap: 6px; font-size: .75rem; color: var(--white); }
  .pph-page-wrapper .svc-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--coral); }
  .pph-page-wrapper .svc-text { display: flex; align-items: center; gap: 6px; }
  .pph-page-wrapper .svc-link { color: var(--gold); cursor: pointer; text-decoration: none; font-size: .65rem; margin-left: 4px; }
  .pph-page-wrapper .svc-link:hover { text-decoration: underline; }

  .pph-page-wrapper footer.ftr {
    position: relative;
    z-index: 5;
    background: var(--navy2);
    padding: 14px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: .76rem;
    color: rgba(255,255,255,.4);
    flex-wrap: wrap;
    gap: 10px;
  }
  .pph-page-wrapper .ftr a { color: rgba(255,255,255,.45); text-decoration: none; margin-left: 16px; }
  .pph-page-wrapper .ftr a:hover { color: var(--gold); }
  .pph-page-wrapper .fbrand { font-weight: 700; color: var(--gold); letter-spacing: .04em; }

  @media (max-width: 900px) {
    .pph-page-wrapper main { grid-template-columns: 1fr; }
    .pph-page-wrapper section.hero { min-height: 260px; }
    .pph-page-wrapper .hero-content { padding: 36px 28px; }
  }
`

export function RegisterPage() {
  const registerMutation = useRegister()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [metrics, setMetrics] = useState({ total_files: 0, total_macro: 0, active_jobs: 0 })
  const [overviewStats, setOverviewStats] = useState({ total: 0, validation: 0 })

  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: getSession,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    const origin = typeof window !== 'undefined' && window.location && window.location.origin.startsWith('http')
      ? window.location.origin
      : 'http://localhost'

    fetch(`${origin}/api/metrics`)
      .then(r => {
        if (!r.ok) throw new Error('API failure')
        return r.json()
      })
      .then(data => {
        if (data.metrics) setMetrics(data.metrics)
        if (data.overview_stats) setOverviewStats(data.overview_stats)
      })
      .catch(e => console.error('Failed to load metrics', e))
  }, [])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  })

  const onSubmit = (values: RegisterFormValues) => {
    registerMutation.mutate({
      username: values.username,
      email: values.email,
      password: values.password,
      confirm_password: values.confirmPassword,
      redirect_to: uiPaths.login,
    })
  }

  // Session query redirects if authenticated
  if (sessionQuery.isPending) {
    return (
      <div className="pph-page-wrapper" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <style>{css}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16, color: '#1a2742', fontWeight: 600 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: '#e8604a' }} />
          Checking session…
        </div>
      </div>
    )
  }

  if (sessionQuery.data?.authenticated) {
    return <Navigate replace to={uiPaths.dashboard} />
  }

  // Handle success states with alert/toast or visual transition
  if (registerMutation.isSuccess) {
    return <Navigate replace to={uiPaths.login} />
  }

  const errorMsg = registerMutation.isError
    ? getApiErrorMessage(registerMutation.error, 'Registration failed. Please try again.')
    : ''

  const isLoading = registerMutation.isPending

  const formatNumber = (num: number) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  return (
    <div className="pph-page-wrapper">
      <style>{css}</style>
      <div className="page">
        <div className="b1"></div>
        <div className="b2"></div>
        <div className="b3"></div>

        {/* Header */}
        <header className="hdr">
          <div className="hdr-logo">
            <Link to="/">
              <img src="/logo.png" alt="S4Carlisle Logo" />
            </Link>
          </div>
          <div className="hdr-info">
            <div className="hdr-title">Prep<span className="red">Ops</span> | Pre-Production Hub</div>
          </div>
          <div className="hdr-tagline">Your Partner in Publishing Excellence</div>
        </header>

        {/* Main */}
        <main>
          {/* Hero */}
          <section className="hero">
            <img className="hero-img" src="/hero-bg.jpg" alt="" />
            <div className="hero-overlay"></div>
            <div className="hero-content">
              <div className="hero-badge fu">LIVE PRODUCTION SYSTEM</div>
              <h1 className="hero-h fu">Intelligent<br /><em>Pre-Production</em><br />at Scale</h1>
              <p className="hero-p fu">
                Automate pre-editing, mechanical editing, reference validation, alt-text generation, and more — with
                real-time SLA visibility and AI-assisted QA across every imprint.
              </p>
            </div>
          </section>

          {/* Registration Panel */}
          <aside className="login-panel">
            <div className="login-card">
              <div className="card-title fu">Create an account</div>
              <div className="card-sub fu">Join the PrepOps workspace</div>

              {/* API error banner */}
              {errorMsg && (
                <div className="flash-messages" role="alert">
                  <div className="alert alert-error">{errorMsg}</div>
                </div>
              )}

              <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
                <div className="field fu">
                  <label htmlFor="username">Username</label>
                  <div className="iw">
                    <i className="fa-regular fa-user"></i>
                    <input
                      type="text"
                      id="username"
                      placeholder="your.username"
                      disabled={isLoading}
                      {...register('username')}
                    />
                  </div>
                  {errors.username && (
                    <p style={{ fontSize: 11, color: '#e8604a', marginTop: 4, fontWeight: 500 }}>
                      {errors.username.message}
                    </p>
                  )}
                </div>

                <div className="field fu">
                  <label htmlFor="email">Email address</label>
                  <div className="iw">
                    <i className="fa-regular fa-envelope"></i>
                    <input
                      type="email"
                      id="email"
                      placeholder="you@example.com"
                      disabled={isLoading}
                      {...register('email')}
                    />
                  </div>
                  {errors.email && (
                    <p style={{ fontSize: 11, color: '#e8604a', marginTop: 4, fontWeight: 500 }}>
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div className="field fu">
                  <label htmlFor="password">Password</label>
                  <div className="iw" style={{ position: 'relative' }}>
                    <i className="fa-solid fa-lock"></i>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      placeholder="••••••••"
                      disabled={isLoading}
                      {...register('password')}
                      style={{ paddingRight: '44px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(p => !p)}
                      style={{
                        position: 'absolute',
                        right: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#8492a6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {errors.password && (
                    <p style={{ fontSize: 11, color: '#e8604a', marginTop: 4, fontWeight: 500 }}>
                      {errors.password.message}
                    </p>
                  )}
                </div>

                <div className="field fu">
                  <label htmlFor="confirm_password">Confirm Password</label>
                  <div className="iw" style={{ position: 'relative' }}>
                    <i className="fa-solid fa-lock"></i>
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      id="confirm_password"
                      placeholder="••••••••"
                      disabled={isLoading}
                      {...register('confirmPassword')}
                      style={{ paddingRight: '44px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(p => !p)}
                      style={{
                        position: 'absolute',
                        right: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#8492a6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <p style={{ fontSize: 11, color: '#e8604a', marginTop: 4, fontWeight: 500 }}>
                      {errors.confirmPassword.message}
                    </p>
                  )}
                </div>

                <button type="submit" aria-label="Create Account" disabled={isLoading} className="btn-login fu">
                  {isLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    <>
                      Create Account &rarr;
                    </>
                  )}
                </button>
              </form>

              <div className="card-footer fu">
                Already have an account? <Link to={uiPaths.login}>Sign in here</Link>
              </div>
            </div>
          </aside>
        </main>

        {/* Performance Strip */}
        <section className="perf">
          <div className="perf-label">Platform Metrics</div>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-val">
                {formatNumber(overviewStats.total)}
              </div>
              <div className="kpi-lbl">Total Files Processed</div>
            </div>
            <div className="kpi">
              <div className="kpi-val">98.7%</div>
              <div className="kpi-lbl">SLA Adherence</div>
            </div>
            <div className="kpi">
              <div className="kpi-val">
                {formatNumber(metrics.total_macro)}
              </div>
              <div className="kpi-lbl">Preproduction Jobs</div>
            </div>
          </div>
          <div className="perf-section">
            <p className="perf-label">Service Catalog Quick View</p>
            <div className="svc-grid">
              <div className="svc-item"><span className="svc-dot"></span><span className="svc-text">Pre-Editing &amp; Standardization<span className="svc-link">Learn More</span></span></div>
              <div className="svc-item"><span className="svc-dot"></span><span className="svc-text">Style Guide Implementation<span className="svc-link">Learn More</span></span></div>
              <div className="svc-item"><span className="svc-dot"></span><span className="svc-text">Mechanical Editing &amp; Formatting<span className="svc-link">Learn More</span></span></div>
              <div className="svc-item"><span className="svc-dot"></span><span className="svc-text">Language &amp; Tone Refinement<span className="svc-link">Learn More</span></span></div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="ftr">
          <div>&copy; 2026 <span className="fbrand">S4Carlisle Publishing Services Pvt Ltd</span>. All rights reserved.</div>
          <div>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Use</a>
            <a href="#">Support</a>
          </div>
        </footer>
      </div>
    </div>
  )
}
