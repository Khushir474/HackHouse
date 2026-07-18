import type { Hono } from 'hono'
import type { Deps } from '../app'
import type { Envelope } from '../contracts'
import { CalendarCallSchema, FinancialCallSchema } from '../contracts'
import type { ChatMessage, ToolCall } from '../llm/client'
import { TOOL_DEFS } from '../llm/tools'
import { buildSystemPrompt } from './persona'
import { log, redactPhone } from '../lib/logger'

const MAX_ITERATIONS = 3
export const FALLBACK_REPLY =
  "I'm having trouble pulling that up right now - give me a moment and try again."

// Sent by the voice channel as envelope.text when a call connects, before the
// caller has said anything. Not a real utterance — triggers a same-day
// recap + "anything else?" instead of the normal tool loop. Channel-agent's
// server.js must send this exact string.
export const CALL_START_SENTINEL = '__call_start__'
const FRESH_GREETING = "Hi, this is DueBot. What can I help you with today?"

function isToday(isoTimestamp: string): boolean {
  return isoTimestamp.slice(0, 10) === new Date().toISOString().slice(0, 10)
}

async function buildCallStartReply(deps: Deps, todayMessages: ChatMessage[]): Promise<string> {
  if (todayMessages.length === 0) return FRESH_GREETING
  try {
    const assistant = await deps.llm.chat([
      { role: 'system', content: 'Summarize the conversation below from earlier today in one short spoken sentence (under 30 words, numbers-first if any were discussed), then ask "Anything else I can help with?" No preamble, no extra commentary.' },
      { role: 'user', content: todayMessages.map((m) => `${m.role}: ${m.content}`).join('\n') },
    ])
    return sanitizeReply(assistant.content ?? FALLBACK_REPLY)
  } catch {
    return `Welcome back. ${FRESH_GREETING}`
  }
}

const TEXT_TOOL_CALL_RE = /<function=(\w+)>\s*(\{[\s\S]*?\})\s*(?:<\/function>)?/g

/** Llama sometimes emits tool calls as text. Recover them into structured ToolCall objects. */
export function extractTextToolCalls(content: string): { calls: ToolCall[]; cleaned: string } {
  const calls: ToolCall[] = []
  let i = 0
  const cleaned = content.replace(TEXT_TOOL_CALL_RE, (_m, name: string, args: string) => {
    calls.push({ id: `text_call_${++i}`, type: 'function', function: { name, arguments: args } })
    return ''
  }).trim()
  return { calls, cleaned }
}

/** Strip any residual text-form tool-call fragments before a reply reaches a channel. */
export function sanitizeReply(reply: string): string {
  const cleaned = reply.replace(TEXT_TOOL_CALL_RE, '').replace(/<\/?function[^>]*>/g, '').trim()
  return cleaned.length > 0 ? cleaned : FALLBACK_REPLY
}

/** Voice replies get spoken by TTS - strip markdown and symbols that read badly aloud. */
export function formatForChannel(reply: string, channel: 'voice' | 'text'): string {
  if (channel === 'text') return reply
  return reply
    .replace(/[*_#`>]/g, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Validate + dispatch one LLM tool call to its in-process route. */
async function dispatchTool(
  app: Hono, call: ToolCall, envelope: Envelope, toolTimeoutMs: number, sharedSecret?: string,
): Promise<string> {
  let args: unknown
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    return JSON.stringify({ error: 'tool arguments were not valid JSON' })
  }

  let path: string
  let body: Record<string, unknown>
  if (call.function.name === 'financial_agent') {
    const parsed = FinancialCallSchema.safeParse({ tool: 'financial_agent', ...(args as object) })
    if (!parsed.success) return JSON.stringify({ error: 'invalid financial_agent args', details: parsed.error.flatten() })
    path = '/agents/financial'
    body = parsed.data
  } else if (call.function.name === 'calendar_agent') {
    const parsed = CalendarCallSchema.safeParse({ tool: 'calendar_agent', ...(args as object) })
    if (!parsed.success) return JSON.stringify({ error: 'invalid calendar_agent args', details: parsed.error.flatten() })
    path = '/agents/calendar'
    body = { ...parsed.data, phone_number: envelope.from_number }
  } else {
    return JSON.stringify({ error: `unknown tool: ${call.function.name}` })
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const res = await Promise.race([
      app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(sharedSecret ? { 'x-shared-secret': sharedSecret } : {}),
        },
        body: JSON.stringify(body),
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('tool timeout')), toolTimeoutMs)
      }),
    ])
    const text = await res.text()
    return res.ok ? text : JSON.stringify({ error: `tool returned ${res.status}`, body: text })
  } catch (e) {
    return JSON.stringify({ error: `tool call failed: ${String(e)}` })
  } finally {
    clearTimeout(timer)
  }
}

export async function runOrchestration(
  deps: Deps, app: Hono, envelope: Envelope, requestId: string,
): Promise<{ reply: string; conversationId: string }> {
  const t0 = Date.now()

  // 1. Idempotency: webhook retries get the stored reply, no LLM re-run.
  const priorReply = await deps.db.findReplyByExternalId(envelope.external_id).catch(() => null)
  const conversation = await deps.db.getOrCreateConversation(envelope.from_number)
  if (priorReply !== null) {
    log('info', 'orchestrate.replay', { requestId, external_id: envelope.external_id })
    return { reply: priorReply, conversationId: conversation.id }
  }

  // 2. Load state, scoped to today only — memory does not carry across days.
  const recentAll = await deps.db.getRecentMessages(conversation.id, 50)
  const recent = recentAll.filter((m) => isToday(m.created_at)).slice(-16)
  const company = conversation.last_company_id
    ? await deps.db.getCompanyById(conversation.last_company_id).catch(() => null)
    : null

  // 2b. Call just connected, caller hasn't spoken yet: recap today so far (or
  // greet fresh) instead of running the tool loop on a synthetic message.
  if (envelope.text === CALL_START_SENTINEL) {
    const reply = formatForChannel(await buildCallStartReply(deps, recent.map((m): ChatMessage => ({
      role: m.direction === 'in' ? 'user' : 'assistant', content: m.content,
    }))), envelope.channel)
    await deps.db.appendMessage({
      conversation_id: conversation.id, channel: envelope.channel, direction: 'out',
      content: reply, external_id: `${envelope.external_id}:reply`,
    }).catch((e) => log('error', 'db.persist_failed', { requestId, error: String(e) }))
    return { reply, conversationId: conversation.id }
  }

  // 2c. Record inbound.
  await deps.db.appendMessage({
    conversation_id: conversation.id, channel: envelope.channel, direction: 'in',
    content: envelope.text, external_id: envelope.external_id,
  }).catch((e) => log('error', 'db.append_in_failed', { requestId, error: String(e) }))

  // 3. Build the transcript for the LLM.
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt({
      companyName: company?.name,
      lastMetrics: conversation.last_metrics_discussed ?? undefined,
      channel: envelope.channel,
    }) },
    ...recent.map((m): ChatMessage => ({
      role: m.direction === 'in' ? 'user' : 'assistant', content: m.content,
    })),
    { role: 'user', content: `[channel: ${envelope.channel}] ${envelope.text}` },
  ]

  // 4. Tool loop.
  let reply = FALLBACK_REPLY
  const toolsUsed: string[] = []
  let lastCompanyNamed: string | null = null
  let lastMetricsRequested: string | null = null
  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      let assistant = await deps.llm.chat(messages, { tools: TOOL_DEFS })
      // A first-turn reply that quotes numbers without any tool call is a
      // hallucination risk - force one tool round before accepting it.
      if (i === 0 && !assistant.tool_calls?.length
          && extractTextToolCalls(assistant.content ?? '').calls.length === 0
          && /\d/.test(assistant.content ?? '')) {
        log('warn', 'orchestrate.forced_tool_call', { requestId })
        assistant = await deps.llm.chat(messages, { tools: TOOL_DEFS, toolChoice: 'required' })
      }
      let toolCalls = assistant.tool_calls
      if (!toolCalls?.length) {
        const { calls, cleaned } = extractTextToolCalls(assistant.content ?? '')
        if (calls.length > 0) {
          messages.push({ ...assistant, content: cleaned || null, tool_calls: calls })
          toolCalls = calls
        } else {
          messages.push(assistant)
          reply = sanitizeReply(assistant.content ?? FALLBACK_REPLY)
          break
        }
      } else {
        messages.push(assistant)
      }
      for (const call of toolCalls) {
        toolsUsed.push(call.function.name)
        try {
          const args = JSON.parse(call.function.arguments) as Record<string, unknown>
          if (typeof args.company_name === 'string') lastCompanyNamed = args.company_name
          if (Array.isArray(args.requested_metrics)) lastMetricsRequested = args.requested_metrics.join(',')
        } catch { /* dispatchTool reports the parse error to the LLM */ }
        const result = await dispatchTool(app, call, envelope, deps.config.toolTimeoutMs, deps.config.sharedSecret)
        messages.push({ role: 'tool', content: result, tool_call_id: call.id })
      }
      // Loop exhausted without a final answer → ask for composition without tools.
      if (i === MAX_ITERATIONS - 1) {
        const final = await deps.llm.chat(messages)
        reply = sanitizeReply(final.content ?? FALLBACK_REPLY)
      }
    }
  } catch (e) {
    log('error', 'orchestrate.llm_failed', { requestId, error: String(e) })
    reply = FALLBACK_REPLY
  }
  reply = formatForChannel(reply, envelope.channel)

  // 5. Persist state + outbound (best-effort — never fail the reply).
  const namedCompany = lastCompanyNamed
    ? await deps.db.getCompanyByName(lastCompanyNamed).catch(() => null)
    : null
  await Promise.all([
    deps.db.updateConversation(conversation.id, {
      channel_last_used: envelope.channel,
      ...(namedCompany ? { last_company_id: namedCompany.id } : {}),
      ...(lastMetricsRequested ? { last_metrics_discussed: lastMetricsRequested } : {}),
    }),
    deps.db.appendMessage({
      conversation_id: conversation.id, channel: envelope.channel, direction: 'out',
      content: reply, external_id: `${envelope.external_id}:reply`,
    }),
  ]).catch((e) => log('error', 'db.persist_failed', { requestId, error: String(e) }))

  log('info', 'orchestrate.done', {
    requestId, channel: envelope.channel, from: redactPhone(envelope.from_number),
    tools: toolsUsed, ms: Date.now() - t0,
  })
  return { reply, conversationId: conversation.id }
}
