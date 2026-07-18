import { describe, expect, it } from 'vitest'
import {
  EnvelopeSchema, FinancialCallSchema, CalendarCallSchema,
} from '../../src/contracts'

describe('EnvelopeSchema', () => {
  const good = {
    channel: 'text', from_number: '+15551234567',
    text: 'burn multiple for Acme', external_id: 'msg_abc123',
    timestamp: '2026-07-18T14:00:00Z',
  }
  it('accepts a valid envelope', () => {
    expect(EnvelopeSchema.parse(good)).toEqual(good)
  })
  it('rejects unknown channel', () => {
    expect(EnvelopeSchema.safeParse({ ...good, channel: 'email' }).success).toBe(false)
  })
  it('rejects empty text and missing external_id', () => {
    expect(EnvelopeSchema.safeParse({ ...good, text: '' }).success).toBe(false)
    const { external_id, ...rest } = good
    expect(EnvelopeSchema.safeParse(rest).success).toBe(false)
  })
})

describe('FinancialCallSchema', () => {
  it('accepts the spec example', () => {
    const call = {
      tool: 'financial_agent', company_name: 'Acme Robotics',
      requested_metrics: ['burn_multiple', 'rule_of_40', 'runway'],
    }
    expect(FinancialCallSchema.parse(call)).toEqual(call)
  })
  it('rejects unknown metric names', () => {
    expect(FinancialCallSchema.safeParse({
      tool: 'financial_agent', company_name: 'Acme', requested_metrics: ['ebitda'],
    }).success).toBe(false)
  })
})

describe('CalendarCallSchema', () => {
  it('accepts check_availability without preferred_window', () => {
    const call = {
      tool: 'calendar_agent', action: 'check_availability',
      company_name: 'Acme Robotics', contact_role: 'CFO',
    }
    expect(CalendarCallSchema.parse(call)).toMatchObject(call)
  })
  it('accepts book with slot_id', () => {
    const call = {
      tool: 'calendar_agent', action: 'book', company_name: 'Acme Robotics',
      contact_role: 'CFO', slot_id: '3f8a1c2e-0000-0000-0000-000000000001',
    }
    expect(CalendarCallSchema.parse(call)).toMatchObject(call)
  })
  it('rejects bad contact_role', () => {
    expect(CalendarCallSchema.safeParse({
      tool: 'calendar_agent', action: 'book', company_name: 'Acme', contact_role: 'CTO',
    }).success).toBe(false)
  })
})
