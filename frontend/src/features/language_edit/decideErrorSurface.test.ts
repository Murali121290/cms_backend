/**
 * Regression test for the "Failed to save decision" surface.
 *
 * The LanguageReviewPage.handleDecide handler now surfaces the
 * backend's own error detail via ``getApiErrorMessage`` instead of
 * swallowing the error behind a generic "Failed to save decision"
 * toast. The specific case this guards against is a FastAPI 404 with
 * ``{detail: "Finding ID N not found."}`` — the body shape returned
 * by ``decide_finding`` when the id doesn't exist.
 *
 * Without this surface, the root cause of the Accept / Ignore
 * regression (stale AB finding ids after re-analysis) was invisible
 * to reviewers: every card click just said "Failed to save decision".
 * We assert that the real detail now flows through to the toast.
 */
import { describe, it, expect } from 'vitest'
import type { AxiosError } from 'axios'
import { getApiErrorMessage } from '@/api/client'

function mkAxiosError(status: number, data: any): AxiosError {
  const err = new Error('Request failed') as AxiosError
  // Minimal stub matching axios.isAxiosError's duck-type check.
  ;(err as any).isAxiosError = true
  ;(err as any).toJSON = () => ({})
  err.name = 'AxiosError'
  err.response = {
    status,
    statusText: 'Not Found',
    data,
    headers: {},
    config: {} as any,
  }
  return err
}

describe('handleDecide error surface (getApiErrorMessage pass-through)', () => {
  it('surfaces the FastAPI 404 detail string the decide endpoint returns', () => {
    const err = mkAxiosError(404, { detail: 'Finding ID 88045 not found.' })
    expect(getApiErrorMessage(err, 'fallback')).toBe('Finding ID 88045 not found.')
  })

  it('surfaces a 400 decision-validation detail the decide endpoint returns', () => {
    const err = mkAxiosError(400, {
      detail: 'Invalid status. Must be accepted, edited, rejected, or highlighted.',
    })
    expect(getApiErrorMessage(err, 'fallback')).toContain('Invalid status')
  })

  it('falls back to the provided default when the response has no body', () => {
    const err = mkAxiosError(500, '')
    // Empty string body → fallback.
    expect(getApiErrorMessage(err, 'Failed to save decision')).toBe('Failed to save decision')
  })

  it('handles the FastAPI validation-error array shape', () => {
    const err = mkAxiosError(422, {
      detail: [
        { type: 'missing', loc: ['body', 'status'], msg: 'Field required' },
      ],
    })
    const msg = getApiErrorMessage(err, 'fallback')
    expect(msg).toContain('status')
    expect(msg).toContain('Field required')
  })
})
