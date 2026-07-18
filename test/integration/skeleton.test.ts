import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { MemoryDb } from '../fakes/memory-db'
import { ScriptedLlm, testConfig } from '../helpers'

const envelope = {
  channel: 'text', from_number: '+15551234567', text: 'hello',
  external_id: 'msg_001', timestamp: '2026-07-18T14:00:00Z',
}

describe('skeleton app', () => {
  const app = () => createApp({ db: new MemoryDb(), llm: new ScriptedLlm([]), config: testConfig })

  it('GET /health returns ok with db status', async () => {
    const res = await app().request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, db: true })
  })

  it('POST /orchestrate accepts a valid envelope and returns a reply string', async () => {
    const scriptedApp = createApp({
      db: new MemoryDb(),
      llm: new ScriptedLlm([{ role: 'assistant', content: 'hello from the analyst' }]),
      config: testConfig,
    })
    const res = await scriptedApp.request('/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { reply: string; conversation_id: string }
    expect(typeof body.reply).toBe('string')
    expect(body.reply.length).toBeGreaterThan(0)
    expect(body.conversation_id).toBeTruthy()
  })

  it('rejects a malformed envelope with 400 and error details', async () => {
    const res = await app().request('/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...envelope, channel: 'carrier-pigeon' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('invalid_envelope')
  })
})

describe('optional shared-secret auth', () => {
  const securedConfig = { ...testConfig, sharedSecret: 'team-secret' }

  it('rejects /orchestrate without the x-shared-secret header when configured', async () => {
    const securedApp = createApp({
      db: new MemoryDb(), llm: new ScriptedLlm([]), config: securedConfig,
    })
    const res = await securedApp.request('/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    expect(res.status).toBe(401)
  })

  it('accepts /orchestrate with the correct x-shared-secret header when configured', async () => {
    const securedApp = createApp({
      db: new MemoryDb(),
      llm: new ScriptedLlm([{ role: 'assistant', content: 'hello from the analyst' }]),
      config: securedConfig,
    })
    const res = await securedApp.request('/orchestrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shared-secret': 'team-secret' },
      body: JSON.stringify(envelope),
    })
    expect(res.status).toBe(200)
  })
})
