# DueBot

A voice + text due-diligence assistant for venture investors — ask it about
a portfolio company's financials or get it to book a follow-up call with
their CFO, over SMS/text or a phone call, and it answers like an analyst,
not a chatbot.

## Architecture

```
                 ┌───────────────┐
  Voice call ──▶ │  Twilio /     │
  Text/SMS   ──▶ │  Blooio       │──▶  POST /orchestrate
                 │  webhook (C)  │        │
                 └───────────────┘        │  Hono app, one Cloudflare Worker
                                           ▼
                              ┌────────────────────────┐
                              │   Orchestrator (B)      │
                              │   tool loop + persona   │
                              └───────────┬─────────────┘
                                  in-process tool calls
                            ┌──────────────┴──────────────┐
                            ▼                              ▼
                 ┌─────────────────────┐        ┌─────────────────────┐
                 │ /agents/financial (A)│        │ /agents/calendar (B)│
                 │ deterministic metrics│        │ availability + book │
                 └──────────┬───────────┘        └──────────┬──────────┘
                            └───────────────┬────────────────┘
                                             ▼
                                   Supabase (Postgres)
                          companies · conversations · messages
                          calendar_slots · calendar_bookings
```

Everything runs in one Hono app on one Cloudflare Worker. `/orchestrate`
validates the inbound envelope, loads conversation state keyed on phone
number, runs an LLM tool loop that dispatches to the specialist agent
routes in-process, then persists state and returns the composed reply.

## Tech stack

| Layer | Choice | Swap path |
|---|---|---|
| Framework | Hono | Portable — same code runs on Node/Bun/Deno, not locked to Workers |
| Compute | Cloudflare Workers (free tier) | Any Hono-compatible runtime |
| Database | Supabase (Postgres, free tier) | Any Postgres via `DATABASE_URL` / `DATABASE_SERVICE_KEY` |
| LLM | Groq, `llama-3.3-70b-versatile` (default) | Any OpenAI-compatible endpoint via `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` — e.g. NVIDIA NIM is an env-var swap, no code change |
| Tests | Vitest | — |

The LLM client speaks plain OpenAI-style chat-completions + tools over
`fetch` — no provider SDK — so any OpenAI-compatible endpoint keeps working.

## Quickstart

```bash
git clone <repo-url>
cd HackHouse
npm install
cp .dev.vars.example .dev.vars   # fill in values shared by the team — see docs/setup.md
npm run dev                      # starts the worker locally
npm run chat "burn multiple for Acme Robotics"   # from another shell
```

Full first-time setup (Supabase project, LLM provider keys, Cloudflare
deploy) is in [`docs/setup.md`](docs/setup.md) — follow it in order the
first time you stand up the stack.

## Routes

| Route | Method | Description |
|---|---|---|
| `/orchestrate` | POST | Main entry point. Takes a channel envelope, runs the LLM tool loop, returns `{ reply, conversation_id }`. Idempotent on `external_id`. |
| `/agents/financial` | POST | Computes financial metrics for a company deterministically. No chat, no LLM. |
| `/agents/calendar` | POST | Checks CFO/customer-reference availability or books a slot atomically. No chat, no LLM. |
| `/health` | GET | Liveness + DB connectivity check. |

See [`docs/contracts.md`](docs/contracts.md) for full request/response
shapes.

## Team split

| Part | Owns | Entry points |
|---|---|---|
| A — Financial Agent | The internals of `src/agents/metrics.ts` (real financial data + calculations), behind the frozen route and contract. | `src/agents/metrics.ts`; keep `test/integration/financial.test.ts` green. |
| B — Orchestrator + Calendar (this code) | `/orchestrate` tool loop and persona, `/agents/calendar`, the DB layer, and the frozen contracts. | `src/orchestrator/`, `src/agents/calendar.ts`, `src/db/`, `src/contracts/`. |
| C — Voice/Text channels | Twilio/Blooio (or equivalent) webhooks that translate inbound calls/texts into the envelope and POST it to `/orchestrate`. | Anything upstream of `POST /orchestrate`; send each webhook delivery's ID as `external_id`. |

## Further reading

- [`docs/setup.md`](docs/setup.md) — infrastructure setup: Supabase, LLM
  provider, Cloudflare deploy, local dev.
- [`docs/contracts.md`](docs/contracts.md) — frozen wire contracts (envelope,
  financial, calendar) with JSON examples and ownership rules.
- [`docs/personas.md`](docs/personas.md) — DueBot's persona, what each
  specialist agent does and doesn't do, and the reply-style contract.
- [`AGENTS.md`](AGENTS.md) — context for coding agents working in this repo.
- [`docs/superpowers/specs/2026-07-18-partb-orchestrator-design.md`](docs/superpowers/specs/2026-07-18-partb-orchestrator-design.md) — the design doc.
- [`docs/superpowers/plans/2026-07-18-partb-orchestrator.md`](docs/superpowers/plans/2026-07-18-partb-orchestrator.md) — the implementation plan.
