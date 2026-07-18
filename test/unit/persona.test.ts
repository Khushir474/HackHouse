import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, SYSTEM_PROMPT } from '../../src/orchestrator/persona'

describe('buildSystemPrompt', () => {
  it('returns the base prompt unchanged when no state is given', () => {
    expect(buildSystemPrompt({})).toBe(SYSTEM_PROMPT)
  })

  it('includes the company and metrics state lines when provided', () => {
    const prompt = buildSystemPrompt({ companyName: 'Acme Robotics', lastMetrics: 'burn_multiple,runway' })
    expect(prompt).toContain('Company currently under discussion: Acme Robotics.')
    expect(prompt).toContain('Metrics last discussed: burn_multiple,runway.')
  })

  it('omits company and metrics lines when absent', () => {
    const prompt = buildSystemPrompt({ channel: 'text' })
    expect(prompt).not.toContain('Company currently under discussion:')
    expect(prompt).not.toContain('Metrics last discussed:')
  })

  it('appends the voice channel line for voice', () => {
    const prompt = buildSystemPrompt({ channel: 'voice' })
    expect(prompt).toContain('Current channel: voice - spoken prose only.')
  })

  it('appends the text channel line for text', () => {
    const prompt = buildSystemPrompt({ channel: 'text' })
    expect(prompt).toContain('Current channel: text.')
  })

  it('omits the channel line when channel is not given', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).not.toContain('Current channel:')
  })
})
