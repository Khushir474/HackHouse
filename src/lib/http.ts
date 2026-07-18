export class HttpStatusError extends Error {
  constructor(public status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`)
  }
}

export function isRetryableHttpError(e: unknown): boolean {
  if (e instanceof HttpStatusError) return e.status === 429 || e.status >= 500
  return true // aborts, network failures
}

export async function fetchWithTimeout(
  input: string, init: RequestInit, timeoutMs: number,
): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; shouldRetry?: (e: unknown) => boolean; backoffMs?: number } = {},
): Promise<T> {
  const { retries = 1, shouldRetry = () => true, backoffMs = 300 } = opts
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (attempt === retries || !shouldRetry(e)) throw e
      if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)))
    }
  }
  throw lastError
}
