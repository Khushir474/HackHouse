import { z } from 'zod'

/** Frozen Section 5 contract: Channel → Orchestrator. Do not rename fields. */
export const EnvelopeSchema = z.object({
  channel: z.enum(['voice', 'text']),
  from_number: z.string().regex(/^\+?[0-9]{7,15}$/, 'E.164-ish phone number'),
  text: z.string().min(1),
  external_id: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
}).strict()

export type Envelope = z.infer<typeof EnvelopeSchema>
