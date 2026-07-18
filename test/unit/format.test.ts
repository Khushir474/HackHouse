import { describe, expect, it } from 'vitest'
import { formatForChannel } from '../../src/orchestrator/loop'

describe('formatForChannel', () => {
  it('leaves text replies unchanged', () => {
    const reply = '**Burn multiple** is 2.12x - that is a flag.\n- next: ask about the change'
    expect(formatForChannel(reply, 'text')).toBe(reply)
  })

  it('strips markdown and bullet symbols for voice replies', () => {
    const reply = '**Burn multiple** is about `2.1x` (>2x flag).\n- Want me to check what changed?'
    const out = formatForChannel(reply, 'voice')
    expect(out).not.toMatch(/[*_#`>]/)
    expect(out).not.toMatch(/^\s*[-•]/m)
  })

  it('collapses whitespace and trims for voice replies', () => {
    const reply = 'Runway is  eleven   months.\n\nThat is a flag.'
    const out = formatForChannel(reply, 'voice')
    expect(out).toBe('Runway is eleven months. That is a flag.')
  })
})
