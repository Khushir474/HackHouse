import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { MemoryDb } from '../fakes/memory-db'
import { ScriptedLlm, testConfig } from '../helpers'
import type { ChatMessage } from '../../src/llm/client'

let db: MemoryDb
beforeEach(() => {
  db = new MemoryDb()
  const acme = db.seedCompany({ name: 'Acme Robotics' })
  db.seedSlot({ company_id: acme.id, contact_role: 'CFO', contact_name: 'Priya Nair' })
})

const envelope = (text: string, external_id: string) => ({
  channel: 'text' as const, from_number: '+15551234567', text,
  external_id, timestamp: '2026-07-18T14:00:00Z',
})

const toolCallMsg = (name: string, args: object): ChatMessage => ({
  role: 'assistant', content: null,
  tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})
const finalMsg = (content: string): ChatMessage => ({ role: 'assistant', content })

const post = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request('/orchestrate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

describe('POST /orchestrate with tool loop', () => {
  it('runs financial tool call and composes the reply from tool data', async () => {
    const llm = new ScriptedLlm([
      toolCallMsg('financial_agent', {
        company_name: 'Acme Robotics', requested_metrics: ['burn_multiple', 'runway'],
      }),
      finalMsg('Burn multiple 2.12x (>2x flag). Runway 11 months.'),
    ])
    const app = createApp({ db, llm, config: testConfig })
    const res = await post(app, envelope('burn multiple + runway for Acme?', 'msg_101'))
    expect(res.status).toBe(200)
    const body = await res.json() as { reply: string }
    expect(body.reply).toContain('2.12x')

    // The second LLM call must include the tool result with real computed numbers.
    const secondCallMessages = llm.calls[1]!
    const toolMsg = secondCallMessages.find((m) => m.role === 'tool')!
    expect(toolMsg.content).toContain('2.12')

    // State was persisted for follow-ups.
    const convo = db.conversations[0]!
    expect(convo.last_company_id).toBe(db.companies[0]!.id)
    expect(convo.last_metrics_discussed).toContain('burn_multiple')
  })

  it('replays the stored reply on duplicate external_id without calling the LLM', async () => {
    const llm = new ScriptedLlm([
      toolCallMsg('financial_agent', { company_name: 'Acme', requested_metrics: ['runway'] }),
      finalMsg('Runway 11 months.'),
    ])
    const app = createApp({ db, llm, config: testConfig })
    const first = await (await post(app, envelope('runway?', 'msg_dup'))).json() as { reply: string }
    const second = await (await post(app, envelope('runway?', 'msg_dup'))).json() as { reply: string }
    expect(second.reply).toBe(first.reply)
    expect(llm.calls.length).toBe(2) // no third call for the duplicate
  })

  it('invalid tool args from the LLM become an error tool message, not a crash', async () => {
    const llm = new ScriptedLlm([
      toolCallMsg('financial_agent', { company_name: 'Acme', requested_metrics: ['ebitda'] }),
      finalMsg('I could not pull that metric - I cover burn multiple, Rule of 40, LTV:CAC, CAC payback, runway, and concentration.'),
    ])
    const app = createApp({ db, llm, config: testConfig })
    const res = await post(app, envelope('what is their ebitda?', 'msg_102'))
    expect(res.status).toBe(200)
    const toolMsg = llm.calls[1]!.find((m) => m.role === 'tool')!
    expect(toolMsg.content).toContain('error')
  })

  it('LLM failure yields the graceful fallback reply, still 200', async () => {
    const llm = new ScriptedLlm([]) // script exhausted → chat() throws
    const app = createApp({ db, llm, config: testConfig })
    const res = await post(app, envelope('hello?', 'msg_103'))
    expect(res.status).toBe(200)
    const body = await res.json() as { reply: string }
    expect(body.reply).toContain('trouble')
  })

  it('forwards the shared secret to in-process tool dispatch so protected routes are not 401d', async () => {
    const llm = new ScriptedLlm([
      toolCallMsg('financial_agent', { company_name: 'Acme Robotics', requested_metrics: ['runway'] }),
      finalMsg('Runway 11 months.'),
    ])
    const securedConfig = { ...testConfig, sharedSecret: 'test-secret' }
    const app = createApp({ db, llm, config: securedConfig })
    const res = await app.request('/orchestrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shared-secret': 'test-secret' },
      body: JSON.stringify(envelope('runway for Acme?', 'msg_106')),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { reply: string }
    expect(body.reply).toBe('Runway 11 months.')

    const toolMsg = llm.calls[1]!.find((m) => m.role === 'tool')!
    const content = String(toolMsg.content)
    expect(content).toMatch(/runway_months|11/)
    expect(content).not.toContain('401')
    expect(content.toLowerCase()).not.toContain('unauthorized')
  })

  it('books a call end-to-end via the calendar tool', async () => {
    const slotId = db.slots[0]!.id
    const llm = new ScriptedLlm([
      toolCallMsg('calendar_agent', {
        action: 'check_availability', company_name: 'Acme Robotics', contact_role: 'CFO',
      }),
      toolCallMsg('calendar_agent', {
        action: 'book', company_name: 'Acme Robotics', contact_role: 'CFO', slot_id: slotId,
      }),
      finalMsg('Booked: Priya Nair (CFO, Acme Robotics), Tuesday 14:00-14:30 UTC.'),
    ])
    const app = createApp({ db, llm, config: testConfig })
    const res = await post(app, envelope('set up a call with their CFO', 'msg_104'))
    const body = await res.json() as { reply: string }
    expect(body.reply).toContain('Booked')
    expect(db.slots[0]!.is_booked).toBe(true)
  })

  it('conversation creation failure still yields 200 + fallback reply, never a 500', async () => {
    class ThrowingDb extends MemoryDb {
      async getOrCreateConversation(_phone: string): Promise<never> {
        throw new Error('db unreachable')
      }
    }
    const throwingDb = new ThrowingDb()
    const llm = new ScriptedLlm([finalMsg('should not be reached')])
    const app = createApp({ db: throwingDb, llm, config: testConfig })
    const res = await post(app, envelope('hello?', 'msg_105'))
    expect(res.status).toBe(200)
    const body = await res.json() as { reply: string; conversation_id: string | null }
    expect(body.reply).toContain('trouble')
    expect(body.conversation_id).toBeNull()
  })
})
