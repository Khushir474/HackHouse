import type { Env } from './config'
import { getConfig } from './config'
import { createApp, type Deps } from './app'
import { SupabaseDb } from './db/supabase'
import { OpenAiCompatClient } from './llm/client'
import { CalcomNotifier } from './calendar/calcom'

let deps: Deps | null = null

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!deps) {
      const config = getConfig(env)
      const notifier = config.calendarProvider === 'calcom' && config.calcom
        ? new CalcomNotifier(config.calcom)
        : undefined
      deps = { config, db: new SupabaseDb(config), llm: new OpenAiCompatClient(config), notifier }
    }
    return createApp(deps).fetch(request)
  },
}
