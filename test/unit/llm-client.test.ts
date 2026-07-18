import { describe, expect, it, vi } from 'vitest'
import { OpenAiCompatClient } from '../../src/llm/client'
import type { AppConfig } from '../../src/config'

const cfg: AppConfig = {
  llmBaseUrl: 'https://llm.example/v1', llmApiKey: 'k', llmModel: 'test-model',
  llmTimeoutMs: 1000, toolTimeoutMs: 1000,
  databaseUrl: 'https://db.example', databaseServiceKey: 'x',
}

function okResponse(message: unknown) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

describe('OpenAiCompatClient', () => {
  it('POSTs to {base}/chat/completions with auth header and returns the message', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse({ role: 'assistant', content: 'hi' }))
    const client = new OpenAiCompatClient(cfg, fetchSpy)
    const out = await client.chat([{ role: 'user', content: 'hello' }])
    expect(out.content).toBe('hi')
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://llm.example/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer k')
    expect(JSON.parse(init.body).model).toBe('test-model')
  })

  it('retries once on 500 then succeeds', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValue(okResponse({ role: 'assistant', content: 'recovered' }))
    const client = new OpenAiCompatClient(cfg, fetchSpy, 0)
    const out = await client.chat([{ role: 'user', content: 'hello' }])
    expect(out.content).toBe('recovered')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not retry on 400', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }))
    const client = new OpenAiCompatClient(cfg, fetchSpy, 0)
    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow('HTTP 400')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
