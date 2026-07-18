import { describe, expect, it } from 'vitest'
import { extractTextToolCalls, sanitizeReply, FALLBACK_REPLY } from '../../src/orchestrator/loop'

describe('extractTextToolCalls', () => {
  it('recovers a text-form tool call from the observed Llama 3.3 output', () => {
    const content =
      'Rule of 40: 122. Healthy. What\'s their burn multiple? ' +
      '<function=financial_agent>{"company_name":"Acme Robotics","requested_metrics":["burn_multiple"]}</function>'
    const { calls, cleaned } = extractTextToolCalls(content)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.function.name).toBe('financial_agent')
    const args = JSON.parse(calls[0]!.function.arguments) as {
      company_name: string; requested_metrics: string[]
    }
    expect(args.company_name).toBe('Acme Robotics')
    expect(args.requested_metrics).toEqual(['burn_multiple'])
    expect(cleaned).not.toContain('<function')
  })

  it('finds no calls in plain text without markers', () => {
    const content = 'Rule of 40: 122. Healthy.'
    const { calls, cleaned } = extractTextToolCalls(content)
    expect(calls).toHaveLength(0)
    expect(cleaned).toBe(content)
  })

  it('recovers two function blocks in order', () => {
    const content =
      '<function=financial_agent>{"company_name":"Acme"}</function> then ' +
      '<function=calendar_agent>{"action":"check_availability"}</function>'
    const { calls } = extractTextToolCalls(content)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.function.name).toBe('financial_agent')
    expect(calls[1]!.function.name).toBe('calendar_agent')
  })
})

describe('sanitizeReply', () => {
  it('strips residual text-form tool-call fragments from a reply', () => {
    const reply = 'Runway 11 months. <function=financial_agent>{"foo":"bar"}</function>'
    expect(sanitizeReply(reply)).toBe('Runway 11 months.')
  })

  it('falls back when the reply is only a function block', () => {
    const reply = '<function=financial_agent>{"company_name":"Acme"}</function>'
    expect(sanitizeReply(reply)).toBe(FALLBACK_REPLY)
  })
})
