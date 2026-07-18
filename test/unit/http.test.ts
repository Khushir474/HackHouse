import { describe, expect, it, vi } from 'vitest'
import { HttpStatusError, isRetryableHttpError, withRetry } from '../../src/lib/http'

describe('withRetry', () => {
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await withRetry(fn)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries once by default then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok')
    expect(await withRetry(fn, { backoffMs: 0 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws the last error when retries are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'))
    await expect(withRetry(fn, { backoffMs: 0 })).rejects.toThrow('always')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('respects shouldRetry = false', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpStatusError(400, 'bad request'))
    await expect(withRetry(fn, { shouldRetry: isRetryableHttpError, backoffMs: 0 })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('isRetryableHttpError', () => {
  it('classifies statuses', () => {
    expect(isRetryableHttpError(new HttpStatusError(429, ''))).toBe(true)
    expect(isRetryableHttpError(new HttpStatusError(503, ''))).toBe(true)
    expect(isRetryableHttpError(new HttpStatusError(400, ''))).toBe(false)
    expect(isRetryableHttpError(new Error('network'))).toBe(true)
  })
})
