import type { AppConfig } from '../config'
import { HttpStatusError, isRetryableHttpError, withRetry } from '../lib/http'

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export type ToolDef = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface LlmClient {
  chat(messages: ChatMessage[], opts?: { tools?: ToolDef[]; toolChoice?: 'auto' | 'required' }): Promise<ChatMessage>
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** Works against any OpenAI-compatible /chat/completions endpoint
 * (Groq, NVIDIA NIM, Ollama, vLLM...). Provider = env vars, not code. */
export class OpenAiCompatClient implements LlmClient {
  constructor(
    private cfg: AppConfig,
    private fetchImpl: FetchLike = (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(cfg.llmTimeoutMs) }),
    private backoffMs = 300,
  ) {}

  async chat(
    messages: ChatMessage[],
    opts: { tools?: ToolDef[]; toolChoice?: 'auto' | 'required' } = {},
  ): Promise<ChatMessage> {
    return withRetry(
      async () => {
        const res = await this.fetchImpl(`${this.cfg.llmBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${this.cfg.llmApiKey}`,
          },
          body: JSON.stringify({
            model: this.cfg.llmModel,
            messages,
            ...(opts.tools ? { tools: opts.tools, tool_choice: opts.toolChoice ?? 'auto' } : {}),
            temperature: this.cfg.llmTemperature,
          }),
        })
        if (!res.ok) throw new HttpStatusError(res.status, await res.text())
        const body = (await res.json()) as { choices: { message: ChatMessage }[] }
        const message = body.choices[0]?.message
        if (!message) throw new HttpStatusError(502, 'no choices in LLM response')
        return message
      },
      { retries: 1, shouldRetry: isRetryableHttpError, backoffMs: this.backoffMs },
    )
  }
}
