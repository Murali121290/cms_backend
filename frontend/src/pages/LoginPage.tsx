import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { Eye, EyeOff, GitBranch, Loader2, Lock, User } from 'lucide-react'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/useAuthStore'
import { toast } from '@/store/useToastStore'

export function LoginPage() {
  const navigate        = useNavigate()
  const location        = useLocation()
  const setAuth         = useAuthStore(s => s.setAuth)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const from            = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/'

  // Already logged in — go straight to the app
  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true })
  }, [isAuthenticated, navigate, from])

  const [username,    setUsername]    = useState('')
  const [password,    setPassword]    = useState('')
  const [rememberMe,  setRememberMe]  = useState(false)
  const [showPass,    setShowPass]    = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Username and password are required.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login({ username: username.trim(), password, remember_me: rememberMe })
      setAuth(res.user, res.access_token, rememberMe)
      toast.success(`Welcome back, ${res.user.user_name}!`)
      navigate(from, { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail ?? 'Login failed. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <GitBranch size={22} className="text-white"/>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-text">Workflow Management</h1>
            <p className="text-sm text-muted mt-0.5">Sign in to your account</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl shadow-lg p-6">

          {/* Error banner */}
          {error && (
            <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>

            {/* Username */}
            <div>
              <label className="block text-xs font-semibold text-text mb-1.5">
                Username or Email
              </label>
              <div className="relative">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"/>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setError('') }}
                  placeholder="admin"
                  disabled={loading}
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-surface border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all disabled:opacity-50"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-text mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"/>
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  placeholder="••••••••"
                  disabled={loading}
                  className="w-full pl-9 pr-10 py-2.5 text-sm bg-surface border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
                >
                  {showPass ? <EyeOff size={14}/> : <Eye size={14}/>}
                </button>
              </div>
            </div>

            {/* Remember me + Forgot password */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border accent-primary"
                />
                <span className="text-xs text-muted">Remember me</span>
              </label>
              <Link
                to="/forgot-password"
                className="text-xs text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed mt-1"
            >
              {loading ? <><Loader2 size={15} className="animate-spin"/> Signing in…</> : 'Sign In'}
            </button>

          </form>
        </div>

        {/* Footer hint */}
        <p className="text-center text-[11px] text-muted mt-5">
          Default credentials: <span className="font-mono font-semibold text-text">admin / admin123</span>
        </p>

      </div>
    </div>
  )
}
