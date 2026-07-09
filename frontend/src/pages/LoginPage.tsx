import { useState } from 'react'
import { useLocation, Link, Navigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { getSession } from '@/api/session'
import { useLogin, getLoginErrorMessage } from '@/features/session/useLogin'
import { uiPaths } from '@/utils/appPaths'

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

type LoginFormValues = z.infer<typeof loginSchema>

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

  .ink-input:focus {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent) !important;
    background: rgba(255,255,255,0.12) !important;
  }
  .ink-input::placeholder { color: var(--n-muted); }
`

export function LoginPage() {
  const location = useLocation()
  const loginMutation = useLogin()
  const [showPass, setShowPass] = useState(false)
  const [theme] = useState<string>(() => {
    try { return localStorage.getItem('inkflow-theme') || 'default' } catch { return 'default' }
  })

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? uiPaths.dashboard

  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: getSession,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  })

  const onSubmit = (values: LoginFormValues) => {
    loginMutation.mutate({
      username: values.username,
      password: values.password,
      redirect_to: from,
    })
  }

  if (sessionQuery.isPending) {
    return (
      <div className="ink-root" data-theme={theme === 'default' ? '' : theme}
        style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--n-page)' }}>
        <style>{css}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16, color: 'var(--ink)', fontWeight: 600 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-2)' }} />
          Checking session…
        </div>
      </div>
    )
  }

  if (sessionQuery.data?.authenticated) {
    return <Navigate replace to={from} />
  }

  const errorMsg = loginMutation.isError ? getLoginErrorMessage(loginMutation.error) : ''
  const isLoading = loginMutation.isPending

  return (
    <div
      className="ink-root"
      data-theme={theme === 'default' ? '' : theme}
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--n-page)' }}
    >
      <style>{css}</style>

      {/* Header */}
      <header style={{ background: 'var(--n-50)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 36px', boxShadow: '0 1px 10px rgba(28,26,23,0.05)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link to="/">
            <img src="/portal-assets/s4c-logo.png" alt="S4Carlisle" style={{ height: 44, width: 'auto', display: 'block' }} />
          </Link>
          <div style={{ width: 1, height: 30, background: 'var(--border)' }} />
          <div style={{ fontFamily: 'Spectral, serif', fontSize: 26, fontWeight: 700, color: 'var(--accent-2)', lineHeight: 1, letterSpacing: '-0.01em' }}>
            <span style={{ color: 'var(--accent)' }}>Ninja</span> Inkflow
          </div>
        </div>
        <div style={{ fontFamily: 'Spectral, serif', fontWeight: 700, fontSize: 13, color: 'var(--accent-2)' }}>
          Streamline. Collaborate. Deliver Excellence.
        </div>
      </header>

      {/* Main — full-screen hero + glass card */}
      <main style={{ position: 'relative', overflow: 'hidden', flex: 1, minHeight: 0, background: 'var(--surface)' }}>
        <img
          src="/portal-assets/login-hero.png"
          alt=""
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
        />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(90deg, rgba(20,18,15,0.92) 0%, rgba(24,22,18,0.74) 32%, rgba(28,26,23,0.42) 66%, rgba(28,26,23,0.66) 100%)' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'radial-gradient(620px 480px at 14% 30%, color-mix(in srgb, var(--accent-2) 20%, transparent), transparent 64%)' }} />

        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 48, flexWrap: 'wrap', height: '100%', overflowY: 'auto', maxWidth: 1320, margin: '0 auto', padding: '48px 56px' }}>

          {/* Left hero badge */}
          <div style={{ flex: '1 1 380px', minWidth: 300 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'color-mix(in srgb, var(--accent-2) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-2) 40%, transparent)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', padding: '5px 13px', borderRadius: 100, backdropFilter: 'blur(4px)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'pulseDot 2s ease-in-out infinite', display: 'inline-block' }} />
              S4C NINJA INKFLOW PLATFORM
            </div>
          </div>

          {/* Glass login card */}
          <div style={{ flex: '0 0 auto', width: '100%', maxWidth: 392, background: 'rgba(28,26,23,0.34)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 20, padding: '36px 38px', boxShadow: '0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.10)', backdropFilter: 'blur(20px) saturate(135%)', WebkitBackdropFilter: 'blur(20px) saturate(135%)' }}>

            <div style={{ fontFamily: 'Spectral, serif', fontSize: 25, fontWeight: 700, color: 'var(--n-50)', textAlign: 'center', marginBottom: 5 }}>Welcome back</div>
            <div style={{ fontSize: 13, color: 'var(--n-line)', textAlign: 'center', marginBottom: 28 }}>Sign in to your Ninja Inkflow workspace</div>

            {errorMsg && (
              <div role="alert" style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 16, background: 'rgba(220,60,60,0.18)', border: '1px solid rgba(220,60,60,0.35)', color: '#ff9090' }}>
                {errorMsg}
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>

              {/* Username */}
              <div style={{ marginBottom: 18 }}>
                <label htmlFor="username" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--n-50)', marginBottom: 7, letterSpacing: '0.02em' }}>Username</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--n-mid)', display: 'flex', pointerEvents: 'none' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                    </svg>
                  </span>
                  <input
                    className="ink-input"
                    type="text"
                    id="username"
                    placeholder="username"
                    disabled={isLoading}
                    style={{ width: '100%', padding: '11px 14px 11px 37px', border: '1.5px solid rgba(255,255,255,0.16)', borderRadius: 10, fontFamily: 'Hanken Grotesk, sans-serif', fontSize: 14, color: 'var(--n-50)', background: 'rgba(255,255,255,0.07)', outline: 'none', transition: 'border-color .2s, box-shadow .2s' }}
                    {...register('username')}
                  />
                </div>
                {errors.username && (
                  <p style={{ fontSize: 11, color: '#ff9090', marginTop: 4, fontWeight: 500 }}>{errors.username.message}</p>
                )}
              </div>

              {/* Password */}
              <div style={{ marginBottom: 8 }}>
                <label htmlFor="password" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--n-50)', marginBottom: 7, letterSpacing: '0.02em' }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--n-mid)', display: 'flex', pointerEvents: 'none' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    className="ink-input"
                    type={showPass ? 'text' : 'password'}
                    id="password"
                    placeholder="••••••••"
                    disabled={isLoading}
                    style={{ width: '100%', padding: '11px 40px 11px 37px', border: '1.5px solid rgba(255,255,255,0.16)', borderRadius: 10, fontFamily: 'Hanken Grotesk, sans-serif', fontSize: 14, color: 'var(--n-50)', background: 'rgba(255,255,255,0.07)', outline: 'none', transition: 'border-color .2s, box-shadow .2s' }}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(p => !p)}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n-mid)', display: 'flex', padding: 4 }}
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && (
                  <p style={{ fontSize: 11, color: '#ff9090', marginTop: 4, fontWeight: 500 }}>{errors.password.message}</p>
                )}
              </div>

              {/* Forgot password */}
              <div style={{ textAlign: 'right', fontSize: 12.5, marginBottom: 22 }}>
                <Link to="/forgot-password" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Forgot password?</Link>
              </div>

              {/* Sign in */}
              <button
                type="submit"
                aria-label="Sign in"
                disabled={isLoading}
                style={{ width: '100%', padding: 13, background: 'linear-gradient(100deg, var(--accent-2) 0%, var(--accent-2) 100%)', color: 'var(--n-0)', border: 'none', borderRadius: 10, fontFamily: 'Hanken Grotesk, sans-serif', fontSize: 15, fontWeight: 700, cursor: isLoading ? 'not-allowed' : 'pointer', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 5px 16px color-mix(in srgb, var(--accent-2) 32%, transparent)', opacity: isLoading ? 0.75 : 1 }}
              >
                {isLoading
                  ? <><Loader2 size={16} className="animate-spin" /> Signing in...</>
                  : 'Sign In →'}
              </button>
            </form>

            <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: 'var(--n-line)' }}>
              Don't have an account?{' '}
              <Link to={uiPaths.register} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Register here</Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ background: 'var(--surface-deep)', padding: '13px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--n-dim)', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
        <div>© 2026 <span style={{ fontWeight: 700, color: 'var(--accent)' }}>S4Carlisle Publishing Services Pvt Ltd</span>. All rights reserved.</div>
        <div style={{ display: 'flex', gap: 18 }}>
          <a href="#" style={{ color: 'var(--n-muted)', textDecoration: 'none' }}>Privacy Policy</a>
          <a href="#" style={{ color: 'var(--n-muted)', textDecoration: 'none' }}>Terms of Use</a>
          <a href="#" style={{ color: 'var(--n-muted)', textDecoration: 'none' }}>Support</a>
        </div>
      </footer>
    </div>
  )
}
