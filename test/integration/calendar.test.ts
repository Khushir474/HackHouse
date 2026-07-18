import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app'
import { MemoryDb } from '../fakes/memory-db'
import { ScriptedLlm, testConfig } from '../helpers'
import { CalendarResultSchema } from '../../src/contracts'
import type { Hono } from 'hono'

let db: MemoryDb
let app: Hono
let slotId: string

beforeEach(() => {
  db = new MemoryDb()
  const acme = db.seedCompany({ name: 'Acme Robotics' })
  slotId = db.seedSlot({ company_id: acme.id, contact_role: 'CFO', contact_name: 'Priya Nair' }).id
  app = createApp({ db, llm: new ScriptedLlm([]), config: testConfig })
})

const post = (body: unknown) => app.request('/agents/calendar', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /agents/calendar', () => {
  it('check_availability returns open slots', async () => {
    const res = await post({
      tool: 'calendar_agent', action: 'check_availability',
      company_name: 'acme', contact_role: 'CFO',
    })
    expect(res.status).toBe(200)
    const body = CalendarResultSchema.parse(await res.json())
    if (body.status !== 'slots') throw new Error('expected slots')
    expect(body.slots).toHaveLength(1)
    expect(body.slots[0]!.contact_name).toBe('Priya Nair')
  })

  it('book wins the slot exactly once', async () => {
    const call = {
      tool: 'calendar_agent', action: 'book', company_name: 'acme',
      contact_role: 'CFO', slot_id: slotId, phone_number: '+15551234567',
    }
    const first = CalendarResultSchema.parse(await (await post(call)).json())
    expect(first.status).toBe('booked')
    const second = CalendarResultSchema.parse(await (await post(call)).json())
    expect(second.status).toBe('error')
  })

  it('book without slot_id errors cleanly', async () => {
    const res = await post({
      tool: 'calendar_agent', action: 'book', company_name: 'acme', contact_role: 'CFO',
    })
    const body = CalendarResultSchema.parse(await res.json())
    expect(body.status).toBe('error')
  })

  it('unknown company errors cleanly', async () => {
    const res = await post({
      tool: 'calendar_agent', action: 'check_availability',
      company_name: 'Globex', contact_role: 'CFO',
    })
    const body = CalendarResultSchema.parse(await res.json())
    expect(body.status).toBe('error')
  })

  it('rejects booking a slot that belongs to a different company', async () => {
    const voltway = db.seedCompany({ name: 'Voltway' })
    const voltwaySlotId = db.seedSlot({ company_id: voltway.id, contact_role: 'CFO', contact_name: 'Sam Reyes' }).id
    const res = await post({
      tool: 'calendar_agent', action: 'book', company_name: 'acme',
      contact_role: 'CFO', slot_id: voltwaySlotId, phone_number: '+15551234567',
    })
    const body = CalendarResultSchema.parse(await res.json())
    expect(body.status).toBe('error')
    const voltwaySlot = db.slots.find((s) => s.id === voltwaySlotId)!
    expect(voltwaySlot.is_booked).toBe(false)
  })

  it('notifies the injected calendar notifier on a successful booking', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(true) }
    const notifyingApp = createApp({ db, llm: new ScriptedLlm([]), config: testConfig, notifier })
    const call = {
      tool: 'calendar_agent', action: 'book', company_name: 'acme',
      contact_role: 'CFO', slot_id: slotId, phone_number: '+15551234567',
    }
    const res = await notifyingApp.request('/agents/calendar', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(call),
    })
    const body = CalendarResultSchema.parse(await res.json())
    if (body.status !== 'booked') throw new Error('expected booked')
    expect(body.email_sent).toBe(true)
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ start: body.slot.slot_start, companyName: 'Acme Robotics' }),
    )
  })
})
