import { Hono } from 'hono'
import { z } from 'zod'
import type { Deps } from '../app'
import { CalendarCallSchema, type CalendarResult } from '../contracts'

// Orchestrator forwards the caller's phone for booking attribution (additive field).
const RequestSchema = CalendarCallSchema.extend({
  phone_number: z.string().optional(),
  purpose: z.string().optional(),
})

export function calendarRoutes(deps: Deps): Hono {
  const app = new Hono()

  app.post('/', async (c) => {
    const parsed = RequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_tool_call', details: parsed.error.flatten() }, 400)
    }
    const call = parsed.data
    const company = await deps.db.getCompanyByName(call.company_name)
    if (!company) {
      return c.json({ status: 'error', reason: `No company matching "${call.company_name}" in the dataset` } satisfies CalendarResult)
    }

    if (call.action === 'check_availability') {
      const slots = await deps.db.getOpenSlots(company.id, call.contact_role)
      return c.json({
        status: 'slots', company_name: company.name,
        slots: slots.map((s) => ({
          slot_id: s.id, contact_name: s.contact_name, contact_role: s.contact_role,
          slot_start: s.slot_start, slot_end: s.slot_end,
        })),
      } satisfies CalendarResult)
    }

    // action === 'book'
    if (!call.slot_id) {
      return c.json({ status: 'error', reason: 'book requires a slot_id from a prior check_availability' } satisfies CalendarResult)
    }
    const openSlots = await deps.db.getOpenSlots(company.id, call.contact_role)
    if (!openSlots.some((s) => s.id === call.slot_id)) {
      return c.json({ status: 'error', reason: 'That slot does not match this company/contact - want me to re-check availability?' } satisfies CalendarResult)
    }
    const purpose = call.purpose ?? `Follow-up diligence call re ${company.name}`
    const won = await deps.db.bookSlot(call.slot_id, call.phone_number ?? 'unknown', purpose)
    if (!won) {
      return c.json({ status: 'error', reason: 'That slot is no longer available - want me to check remaining times?' } satisfies CalendarResult)
    }
    return c.json({
      status: 'booked', company_name: company.name, purpose,
      slot: {
        slot_id: won.id, contact_name: won.contact_name, contact_role: won.contact_role,
        slot_start: won.slot_start, slot_end: won.slot_end,
      },
    } satisfies CalendarResult)
  })

  return app
}
