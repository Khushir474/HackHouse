import type { AppConfig } from '../src/config'
import type { ChatMessage, LlmClient } from '../src/llm/client'

export const testConfig: AppConfig = {
  llmBaseUrl: 'https://llm.example/v1', llmApiKey: 'k', llmModel: 'test-model',
  llmTimeoutMs: 1000, llmTemperature: 0.2, toolTimeoutMs: 1000,
  databaseUrl: 'https://db.example', databaseServiceKey: 'x',
  calendarProvider: 'seeded',
}

export class ScriptedLlm implements LlmClient {
  constructor(private script: ChatMessage[]) {}
  calls: ChatMessage[][] = []
  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    this.calls.push(messages)
    const next = this.script.shift()
    if (!next) throw new Error('ScriptedLlm: script exhausted')
    return next
  }
}
