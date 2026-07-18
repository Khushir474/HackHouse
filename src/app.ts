import { Hono } from 'hono'
import type { AppConfig } from './config'
import { EnvelopeSchema } from './contracts'
import type { Db } from './db/types'
import type { LlmClient } from './llm/client'
import { log, redactPhone } from './lib/logger'

export type Deps = { db: Db; llm: LlmClient; config: AppConfig }

export function createApp(deps: Deps): Hono {
  const app = new Hono()

  app.get('/health', async (c) => {
    const dbOk = await deps.db.ping().catch(() => false)
    return c.json({ ok: dbOk, db: dbOk }, dbOk ? 200 : 503)
  })

  app.post('/orchestrate', async (c) => {
    const parsed = EnvelopeSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_envelope', details: parsed.error.flatten() }, 400)
    }
    const envelope = parsed.data
    const requestId = crypto.randomUUID().slice(0, 8)
    log('info', 'orchestrate.received', {
      requestId, channel: envelope.channel, from: redactPhone(envelope.from_number),
    })

    const conversation = await deps.db.getOrCreateConversation(envelope.from_number)

    // Skeleton (Sync 1): canned reply. Task 10 replaces this block with the tool loop.
    const reply =
      "DueBot here - the analyst brain is being wired up. Your channel integration works; ask me again after Sync 2."

    await deps.db.appendMessage({
      conversation_id: conversation.id, channel: envelope.channel,
      direction: 'in', content: envelope.text, external_id: envelope.external_id,
    }).catch((e) => log('error', 'db.append_in_failed', { requestId, error: String(e) }))

    return c.json({ reply, conversation_id: conversation.id })
  })

  return app
}
