import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, GitBranch, Loader2, Mail } from 'lucide-react'
import { authApi } from '@/api/auth'

export function ForgotPasswordPage() {
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [sent,      setSent]      = useState(false)
  const [error,     setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Email is required.'); return }
    setError('')
    setLoading(true)
    try {
      await authApi.forgotPassword(email.trim())
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
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
            <h1 className="text-xl font-bold text-text">Reset Password</h1>
            <p className="text-sm text-muted mt-0.5">Enter your email to receive a reset link</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-lg p-6">

          {sent ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <Mail size={20} className="text-emerald-600"/>
              </div>
              <div>
                <p className="text-sm font-semibold text-text">Check your email</p>
                <p className="text-xs text-muted mt-1">
                  If <span className="font-medium text-text">{email}</span> is registered,
                  a reset link has been sent.
                </p>
              </div>
              <Link
                to="/login"
                className="block w-full text-center py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label className="block text-xs font-semibold text-text mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"/>
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError('') }}
                      placeholder="you@example.com"
                      disabled={loading}
                      className="w-full pl-9 pr-3 py-2.5 text-sm bg-surface border border-border rounded-xl text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all disabled:opacity-50"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading
                    ? <><Loader2 size={15} className="animate-spin"/> Sending…</>
                    : 'Send Reset Link'
                  }
                </button>
              </form>
            </>
          )}

        </div>

        {!sent && (
          <div className="text-center mt-5">
            <Link to="/login" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors">
              <ArrowLeft size={12}/> Back to Sign In
            </Link>
          </div>
        )}

      </div>
    </div>
  )
}
