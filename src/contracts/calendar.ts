import { z } from 'zod'

/** Frozen Section 5 contract: Orchestrator → Calendar Agent.
 * `slot_id` is an additive optional field used for the book action. */
export const CalendarCallSchema = z.object({
  tool: z.literal('calendar_agent'),
  action: z.enum(['check_availability', 'book']),
  company_name: z.string().min(1),
  contact_role: z.enum(['CFO', 'customer_reference']),
  preferred_window: z.string().optional(),
  slot_id: z.string().uuid().optional(),
})
export type CalendarCall = z.infer<typeof CalendarCallSchema>

export const SlotSchema = z.object({
  slot_id: z.string().uuid(),
  contact_name: z.string(),
  contact_role: z.enum(['CFO', 'customer_reference']),
  slot_start: z.string(),
  slot_end: z.string(),
})
export type Slot = z.infer<typeof SlotSchema>

export const CalendarResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('slots'), company_name: z.string(), slots: z.array(SlotSchema) }),
  z.object({ status: z.literal('booked'), company_name: z.string(), slot: SlotSchema, purpose: z.string() }),
  z.object({ status: z.literal('error'), reason: z.string() }),
])
export type CalendarResult = z.infer<typeof CalendarResultSchema>
