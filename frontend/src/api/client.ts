import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v2',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // enables cookie-based auth for cms_backend
})

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
      if ('message' in data) return data.message
      if ('detail' in data) return data.detail
      if ('error' in data) return data.error
    }
  }
  if (fallback) return fallback
  return error instanceof Error ? error.message : 'An error occurred'
}

export const apiClient = api
export default api
