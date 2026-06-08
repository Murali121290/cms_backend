import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v2',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // enables cookie-based auth for cms_backend
})

// ── Request: strip baseURL for /api/v1 endpoints ────────────────────────────────
api.interceptors.request.use(
  (config) => {
    if (config.url?.startsWith('/api/v1')) {
      config.baseURL = ''
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ── Response: on 401 redirect to login ──────────────────────────────────────────
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      if (window.location.pathname !== '/login') {
        window.location.replace('/login')
      }
    }
    return Promise.reject(error)
  }
)

export const getApiErrorMessage = (error: unknown, fallback?: string): string => {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data as any
    if (typeof data === 'object' && data !== null) {
      if ('message' in data && typeof data.message === 'string') return data.message
      if ('detail' in data) {
        const detail = data.detail
        if (typeof detail === 'string') return detail
        if (Array.isArray(detail)) {
          // Format FastAPI validation error array: [{type, loc, msg, input}, ...]
          return detail
            .map((err: any) => {
              if (err && typeof err === 'object') {
                const locStr = Array.isArray(err.loc) ? err.loc.join('.') : (err.loc || '')
                return `${locStr ? locStr + ': ' : ''}${err.msg || err.message || JSON.stringify(err)}`
              }
              return String(err)
            })
            .join(', ')
        }
        if (typeof detail === 'object' && detail !== null) {
          if ('message' in detail && typeof detail.message === 'string') return detail.message
          if ('msg' in detail && typeof detail.msg === 'string') return detail.msg
          return JSON.stringify(detail)
        }
      }
      if ('error' in data && typeof data.error === 'string') return data.error
      return JSON.stringify(data)
    }
  }
  if (fallback) return fallback
  return error instanceof Error ? error.message : 'An error occurred'
}

export const apiClient = api
export default api
