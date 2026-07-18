import { Hono } from 'hono'
import type { AppConfig } from './config'
import { EnvelopeSchema } from './contracts'
import type { Db } from './db/types'
import type { LlmClient } from './llm/client'
import { log, redactPhone } from './lib/logger'
import { financialRoutes } from './agents/financial'
import { calendarRoutes } from './agents/calendar'
import { FALLBACK_REPLY, runOrchestration } from './orchestrator/loop'

export type Deps = { db: Db; llm: LlmClient; config: AppConfig }

export function createApp(deps: Deps): Hono {
  const app = new Hono()

  app.get('/health', async (c) => {
    const dbOk = await deps.db.ping().catch(() => false)
    return c.json({ ok: dbOk, db: dbOk }, dbOk ? 200 : 503)
  })

  app.route('/agents/financial', financialRoutes(deps))
  app.route('/agents/calendar', calendarRoutes(deps))

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

    try {
      const { reply, conversationId } = await runOrchestration(deps, app, envelope)
      return c.json({ reply, conversation_id: conversationId })
    } catch (e) {
      log('error', 'orchestrate.failed', { requestId, error: String(e) })
      return c.json({ reply: FALLBACK_REPLY, conversation_id: null })
    }
  })

  return app
}
