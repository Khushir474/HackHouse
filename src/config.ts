import { z } from 'zod'

/** Worker bindings. All generic names — provider choice lives in values, not code. */
export type Env = {
  LLM_BASE_URL: string
  LLM_API_KEY: string
  LLM_MODEL: string
  LLM_TIMEOUT_MS?: string
  TOOL_TIMEOUT_MS?: string
  DATABASE_URL: string
  DATABASE_SERVICE_KEY: string
  SHARED_SECRET?: string
  CALENDAR_PROVIDER?: string
  CALCOM_API_KEY?: string
  CALCOM_EVENT_TYPE_ID?: string
  CALCOM_ATTENDEE_EMAIL?: string
}

const ConfigSchema = z.object({
  llmBaseUrl: z.string().url(),
  llmApiKey: z.string().min(1),
  llmModel: z.string().min(1),
  llmTimeoutMs: z.number().int().positive().default(15_000),
  toolTimeoutMs: z.number().int().positive().default(10_000),
  databaseUrl: z.string().url(),
  databaseServiceKey: z.string().min(1),
  sharedSecret: z.string().optional(),
  calendarProvider: z.enum(['seeded', 'calcom']).default('seeded'),
  calcom: z.object({
    apiKey: z.string().min(1),
    eventTypeId: z.number().int(),
    attendeeEmail: z.string().email(),
    attendeeName: z.string().optional(),
  }).optional(),
})
export type AppConfig = z.infer<typeof ConfigSchema>

export function getConfig(env: Env): AppConfig {
  const hasCalcom = env.CALCOM_API_KEY && env.CALCOM_EVENT_TYPE_ID && env.CALCOM_ATTENDEE_EMAIL
  return ConfigSchema.parse({
    llmBaseUrl: env.LLM_BASE_URL,
    llmApiKey: env.LLM_API_KEY,
    llmModel: env.LLM_MODEL,
    llmTimeoutMs: env.LLM_TIMEOUT_MS ? Number(env.LLM_TIMEOUT_MS) : undefined,
    toolTimeoutMs: env.TOOL_TIMEOUT_MS ? Number(env.TOOL_TIMEOUT_MS) : undefined,
    databaseUrl: env.DATABASE_URL,
    databaseServiceKey: env.DATABASE_SERVICE_KEY,
    sharedSecret: env.SHARED_SECRET,
    calendarProvider: env.CALENDAR_PROVIDER,
    calcom: hasCalcom
      ? {
          apiKey: env.CALCOM_API_KEY,
          eventTypeId: Number(env.CALCOM_EVENT_TYPE_ID),
          attendeeEmail: env.CALCOM_ATTENDEE_EMAIL,
        }
      : undefined,
  })
}
