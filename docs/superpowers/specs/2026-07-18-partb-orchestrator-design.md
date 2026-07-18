# Part B — Orchestrator Agent + Calendar Agent: Design

**Date:** 2026-07-18
**Scope:** Part B of the DueBot multi-agent spec (`DueBot_MultiAgent_Spec.pdf`), built end-to-end production grade on a free-tier stack with a fully swappable LLM provider layer.

## Goals

- Implement the Orchestrator Agent (`POST /orchestrate`) and Calendar Agent (`POST /agents/calendar`) exactly per the frozen Section 4 schema and Section 5 contracts.
- Ship a contract-faithful Financial Agent stub (`POST /agents/financial`) so Part B demos end-to-end before Part A lands; the teammate replaces only the internals.
- Every provider choice (LLM, database) is configured by generically named env vars so components swap with zero code change (e.g. Groq today → NVIDIA NIM later).
- Production-grade edges: input validation, idempotency, timeouts, retries, graceful fallbacks, structured logging, tests.

## Stack

| Layer | Choice | Swap path |
|---|---|---|
| Framework | Hono (open source, portable) | Same code runs on Node/Bun/Deno if we leave Workers |
| Compute | Cloudflare Workers free tier | Any Hono-compatible runtime |
| Database | Supabase free tier (Postgres) | Any Postgres via `DATABASE_URL` |
| LLM | Groq free tier, `llama-3.3-70b-versatile` | `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` env vars; NIM = `https://integrate.api.nvidia.com/v1` + `meta/llama-3.3-70b-instruct` |
| Tests | Vitest | — |

The LLM client speaks plain OpenAI chat-completions + tools over `fetch` — no provider SDK, so any OpenAI-compatible endpoint works.

## Project structure

```
HackHouse/
├── wrangler.jsonc              # Worker config; secrets via .dev.vars locally
├── package.json / tsconfig.json
├── .dev.vars.example           # documents every env var, no real values
├── src/
│   ├── index.ts                # Hono app: mounts /orchestrate, /agents/*, /health
│   ├── config.ts               # typed env parsing — all swappable knobs live here
│   ├── contracts/              # zod schemas = the three frozen Section 5 contracts
│   ├── llm/                    # OpenAI-compatible client + tool definitions
│   ├── db/                     # supabase-js client + conversation/message helpers
│   ├── orchestrator/           # /orchestrate route, tool loop, reply composition
│   ├── agents/                 # calendar.ts (real), financial.ts (contract stub)
│   └── lib/                    # retry, timeout, idempotency, logger
├── supabase/migrations/        # SQL for all 5 tables + seed data + book_slot() fn
├── test/                       # Vitest: unit + route-level integration
├── scripts/chat.ts             # local CLI to play VC against wrangler dev
└── docs/contracts.md           # frozen contracts, published to the team
```

## Data layer

The five Section 4 tables (`companies`, `conversations`, `messages`, `calendar_slots`, `calendar_bookings`) created via checked-in SQL migrations. Two additive extensions (do not break the frozen schema):

1. Unique index on `messages.external_id` — idempotency for webhook retries.
2. Postgres function `book_slot(slot_id, phone, purpose)` — atomic booking via `UPDATE … WHERE is_booked = false RETURNING`; concurrent bookings cannot double-book.

Conversation helpers keyed on `phone_number` (the identity rule): `getOrCreateConversation(phone)`, `appendMessage(...)`, `getRecentContext(conversationId, n)`.

Seed data: 2–3 fictional companies (one with a planted red flag) and pre-seeded `calendar_slots` per company contact for the next 5 business days (no real calendar OAuth, per spec).

## Orchestrator lifecycle (`POST /orchestrate`)

1. **Validate** the Section 5 envelope (`channel`, `from_number`, `text`, `external_id`, `timestamp`) with zod → malformed input returns 400, never crashes.
2. **Idempotency**: if `external_id` was already processed, return the previously composed reply without re-running the LLM.
3. **Load state**: `getOrCreateConversation(from_number)`, last ~10 messages, `last_company_id`, `last_metrics_discussed`; record inbound message.
4. **LLM turn**: system prompt (diligence-analyst tone, numbers-first, one flag + one suggested next question, never compute arithmetic — always call tools) + context + two tool definitions mirroring the frozen contracts: `financial_agent(company_name, requested_metrics[])`, `calendar_agent(action, company_name, contact_role, preferred_window)`.
5. **Tool loop** (max 3 iterations): each LLM tool call is validated against its contract schema and dispatched in-process via `app.request()` — no network hop, but the same HTTP contract, so Part A's real agent swaps in without changes. Results return to the LLM as tool messages until it emits a final reply.
6. **Persist & respond**: update `last_company_id` / `last_metrics_discussed` / `channel_last_used`, store outbound message, return `{ reply, conversation_id }`.

Multi-turn follow-ups ("yeah, that one", "book it") resolve against the injected state fields; the system prompt instructs the model to use them.

## Agents

**Calendar Agent (real; Part B owns):**
- `check_availability`: fuzzy company match (`ilike`), filter `calendar_slots` by `contact_role`, `is_booked = false`, preferred window → open slots.
- `book`: call atomic `book_slot()`; return confirmed slot + contact, or a clean "slot just got taken" error the LLM relays honestly.

**Financial Agent (contract-faithful stub; Part A replaces internals):**
- Validates Section 5 tool-call JSON, reads seeded `companies` row, computes requested metrics with pure deterministic functions (burn multiple, Rule of 40, LTV:CAC, CAC payback, runway, concentration flag — exact Part A formulas), returns clean JSON.

## Resilience

- **LLM**: `AbortSignal` timeout (default 15s, `LLM_TIMEOUT_MS`), one retry on 429/5xx/network with short backoff; on total failure → graceful canned reply (voice never hears dead air).
- **Tools**: 10s timeout per dispatch; failures return structured errors to the LLM, which is prompted to acknowledge honestly, never invent numbers.
- **DB writes** after reply composition are best-effort: log loudly, never turn a good reply into a 500.
- **Observability**: structured JSON logs per request (`request_id`, hashed phone, channel, tool calls, per-stage latency); `/health` checks DB reachability.

## Testing

- **Unit**: contract schemas accept/reject, metric formulas vs hand-computed values, state updates, retry/timeout helpers.
- **Route-level integration**: full Hono app via `app.request()` with a deterministic fake LLM (scripted tool calls) and an in-memory fake of the `db/` helper layer — proves orchestrate→tool→compose end-to-end without network flakiness or a live database in CI.
- **Manual**: `scripts/chat.ts` CLI against `wrangler dev`.

## Delivery order (maps to spec sync points)

1. Migrations + seed data.
2. Contracts (`src/contracts/`, `docs/contracts.md`) + skeleton `/orchestrate` returning a canned reply — unblocks Part C at Sync 1.
3. Calendar Agent (tables already seeded) behind `/agents/calendar`.
4. LLM tool loop + financial stub wired into `/orchestrate` — Sync 2 equivalent.
5. Resilience polish: idempotency, timeouts, fallbacks, logging.
6. Teammate docs: contracts, env setup, how to replace the financial stub.

## Secrets & setup

Supabase project + Cloudflare account + Groq API key created at implementation start (user-guided, ~10 min). Secrets live in `.dev.vars` (gitignored) locally and `wrangler secret` in production — never committed.
