# DueBot — Agent Context

Voice + text VC due-diligence assistant. One shared Cloudflare Worker, one
Supabase Postgres, one LLM provider behind generic env vars. Three
workstreams: A = Financial Agent, B = Orchestrator + Calendar (this code),
C = Voice/Text channel adapters.

## Non-negotiables (read before writing any code)

1. **Frozen contracts** live in `src/contracts/` (zod) and `docs/contracts.md`
   (prose). Never rename a field. Additive optional fields only.
2. **Frozen schema**: `supabase/migrations/0001_schema.sql`. Additive-only.
3. **The LLM never does arithmetic.** All numbers come from deterministic
   code (`src/agents/metrics.ts`). If you need a new number, add a computed
   metric — do not let the model calculate.
4. **Identity = phone number.** `conversations.phone_number` is unique and
   shared across voice/text. Never key state on anything else.
5. **Swappability**: LLM/provider values come only from env vars
   (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `DATABASE_URL`,
   `DATABASE_SERVICE_KEY`). Never hardcode a provider URL, model name, or
   SDK. Any OpenAI-compatible endpoint must keep working.
6. **No secrets in the repo.** Local: `.dev.vars`. Prod: `wrangler secret`.
7. Plain commit messages, no attribution trailers or generated-by footers.

## Layout

- `src/app.ts` — Hono app factory; ALL deps injected via `Deps` (db, llm,
  config). Add new routes here.
- `src/orchestrator/` — `/orchestrate` tool loop (`loop.ts`) + persona
  (`persona.ts`).
- `src/agents/financial.ts` — Part A's route. STUB: replace the internals of
  `src/agents/metrics.ts`; keep the route, request/response contracts, and
  `test/integration/financial.test.ts` green.
- `src/agents/calendar.ts` — Part B owns; don't touch without asking B.
- `src/db/` — `types.ts` is the `Db` port; `supabase.ts` the adapter. Tests
  use `test/fakes/memory-db.ts` — extend BOTH when adding a method.
- `src/llm/` — provider-agnostic client + tool schemas.

## Working here

- `npm test` (Vitest) and `npm run typecheck` must pass before every commit.
- TDD: failing test first, then implementation. Integration tests inject
  `MemoryDb` + a scripted LLM — never hit the network in tests.
- Local run: `npm run dev`, then `npm run chat "message"` from another shell.
- Part C: POST the envelope (see `docs/contracts.md`) to `/orchestrate`;
  the response is `{ reply, conversation_id }`, where `conversation_id` is
  `string | null` (`null` only on the internal-failure fallback reply). Send
  each webhook delivery's ID as `external_id` — retries are safe (idempotent
  replay).
