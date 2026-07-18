import type { Env } from './config'
import { getConfig } from './config'
import { createApp, type Deps } from './app'
import { SupabaseDb } from './db/supabase'
import { OpenAiCompatClient } from './llm/client'

let deps: Deps | null = null

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!deps) {
      const config = getConfig(env)
      deps = { config, db: new SupabaseDb(config), llm: new OpenAiCompatClient(config) }
    }
    return createApp(deps).fetch(request)
  },
}
