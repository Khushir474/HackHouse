# Part B — Orchestrator + Calendar Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build DueBot Part B — the `/orchestrate` LLM tool-calling brain and `/agents/calendar` booking agent, plus a contract-faithful `/agents/financial` stub — production grade on free-tier infra, with team docs so Parts A/C and their coding agents have full context.

**Architecture:** Single Hono app on Cloudflare Workers. `/orchestrate` validates the frozen channel envelope, loads conversation state from Supabase keyed on `phone_number`, runs an OpenAI-compatible LLM tool loop (max 3 iterations) that dispatches tool calls in-process to `/agents/*` routes, then persists state and returns the composed reply. All provider choices sit behind generic env vars.

**Tech Stack:** TypeScript (strict), Hono, zod, @supabase/supabase-js, Vitest, wrangler. LLM = any OpenAI-compatible endpoint (default Groq `llama-3.3-70b-versatile`; NVIDIA NIM swap = env vars only).

## Global Constraints

- **Frozen contracts (Section 5 of DueBot spec) — copy verbatim, never rename fields:** envelope `{channel: "voice"|"text", from_number, text, external_id, timestamp}`; financial tool call `{tool: "financial_agent", company_name, requested_metrics: []}`; calendar tool call `{tool: "calendar_agent", action: "check_availability"|"book", company_name, contact_role: "CFO"|"customer_reference", preferred_window}`.
- **Frozen schema (Section 4):** tables `companies`, `conversations`, `messages`, `calendar_slots`, `calendar_bookings` with exactly the specced columns. Additive-only extensions allowed (e.g. `messages.external_id`).
- **Identity rule:** `conversations.phone_number` is unique and is the cross-channel identity key.
- **LLM never does arithmetic.** All numbers come from tool results; deterministic code computes every metric.
- **Generic env var names only:** `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT_MS`, `TOOL_TIMEOUT_MS`, `DATABASE_URL`, `DATABASE_SERVICE_KEY`. No provider names in code identifiers.
- **No provider SDKs for the LLM** — plain `fetch` against `{LLM_BASE_URL}/chat/completions`.
- **No secrets in the repo.** Local: `.dev.vars` (gitignored). Prod: `wrangler secret put`.
- **No AI-assistant attribution anywhere:** commit messages have no Co-Authored-By trailers; agent context file is `AGENTS.md` (cross-tool standard; Claude Code, Codex, Cursor all read it) — do NOT create a `CLAUDE.md`.
- TypeScript `strict: true`; every contract boundary validated with zod; commit after every task.
- Node ≥ 20 locally. Workers compat: `nodejs_compat` flag (supabase-js needs it).

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `.dev.vars.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `Env` type in `src/config.ts` is defined in Task 2's config step; this task only produces the toolchain every later task runs on (`npm test`, `npm run typecheck`, `npm run dev`).

- [ ] **Step 1: Write config files**

`package.json`:
```json
{
  "name": "duebot",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "chat": "tsx scripts/chat.ts"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "hono": "^4.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240925.0",
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.80.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "scripts"]
}
```

`wrangler.jsonc`:
```jsonc
{
  "name": "duebot",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true }
  // Secrets (never here): LLM_API_KEY, DATABASE_SERVICE_KEY → `wrangler secret put`
  // Local dev: copy .dev.vars.example → .dev.vars and fill in values.
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
```

`.dev.vars.example`:
```ini
# Copy to .dev.vars (gitignored) and fill in. Every value is swappable —
# point LLM_* at any OpenAI-compatible endpoint (Groq, NVIDIA NIM, Ollama...).

# --- LLM provider ---
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=your-key-here
LLM_MODEL=llama-3.3-70b-versatile
LLM_TIMEOUT_MS=15000

# NVIDIA NIM swap (no code change):
# LLM_BASE_URL=https://integrate.api.nvidia.com/v1
# LLM_MODEL=meta/llama-3.3-70b-instruct

# --- Database (Supabase project → Settings → API) ---
DATABASE_URL=https://your-project-ref.supabase.co
DATABASE_SERVICE_KEY=your-service-role-key

# --- Tuning ---
TOOL_TIMEOUT_MS=10000
```

Append to `.gitignore`:
```
node_modules/
.dev.vars
.wrangler/
dist/
```

- [ ] **Step 2: Install and verify toolchain**

Run: `npm install && npm run typecheck && npm test`
Expected: install succeeds; typecheck passes (no files yet is fine); vitest reports "no test files found" and exits 0 (if it exits 1 on empty, add `--passWithNoTests` to the `test` script).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.jsonc vitest.config.ts .dev.vars.example .gitignore
git commit -m "Scaffold Part B worker project (Hono + TypeScript + Vitest)"
```

---

### Task 2: Frozen contracts as zod schemas + typed config

**Files:**
- Create: `src/contracts/envelope.ts`, `src/contracts/financial.ts`, `src/contracts/calendar.ts`, `src/contracts/index.ts`, `src/config.ts`
- Test: `test/unit/contracts.test.ts`

**Interfaces:**
- Produces:
  - `EnvelopeSchema` / type `Envelope = {channel: 'voice'|'text', from_number: string, text: string, external_id: string, timestamp: string}`
  - `FinancialCallSchema` / type `FinancialCall = {tool: 'financial_agent', company_name: string, requested_metrics: Metric[]}` where `Metric = 'burn_multiple'|'rule_of_40'|'ltv_cac'|'cac_payback'|'runway'|'concentration'`
  - `CalendarCallSchema` / type `CalendarCall = {tool: 'calendar_agent', action: 'check_availability'|'book', company_name: string, contact_role: 'CFO'|'customer_reference', preferred_window?: string, slot_id?: string}`
  - `FinancialResultSchema`, `CalendarResultSchema` (response shapes, below)
  - `getConfig(env: Env): AppConfig` and the `Env` binding type

- [ ] **Step 1: Write failing tests**

`test/unit/contracts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  EnvelopeSchema, FinancialCallSchema, CalendarCallSchema,
} from '../../src/contracts'

describe('EnvelopeSchema', () => {
  const good = {
    channel: 'text', from_number: '+15551234567',
    text: 'burn multiple for Acme', external_id: 'msg_abc123',
    timestamp: '2026-07-18T14:00:00Z',
  }
  it('accepts a valid envelope', () => {
    expect(EnvelopeSchema.parse(good)).toEqual(good)
  })
  it('rejects unknown channel', () => {
    expect(EnvelopeSchema.safeParse({ ...good, channel: 'email' }).success).toBe(false)
  })
  it('rejects empty text and missing external_id', () => {
    expect(EnvelopeSchema.safeParse({ ...good, text: '' }).success).toBe(false)
    const { external_id, ...rest } = good
    expect(EnvelopeSchema.safeParse(rest).success).toBe(false)
  })
})

describe('FinancialCallSchema', () => {
  it('accepts the spec example', () => {
    const call = {
      tool: 'financial_agent', company_name: 'Acme Robotics',
      requested_metrics: ['burn_multiple', 'rule_of_40', 'runway'],
    }
    expect(FinancialCallSchema.parse(call)).toEqual(call)
  })
  it('rejects unknown metric names', () => {
    expect(FinancialCallSchema.safeParse({
      tool: 'financial_agent', company_name: 'Acme', requested_metrics: ['ebitda'],
    }).success).toBe(false)
  })
})

describe('CalendarCallSchema', () => {
  it('accepts check_availability without preferred_window', () => {
    const call = {
      tool: 'calendar_agent', action: 'check_availability',
      company_name: 'Acme Robotics', contact_role: 'CFO',
    }
    expect(CalendarCallSchema.parse(call)).toMatchObject(call)
  })
  it('accepts book with slot_id', () => {
    const call = {
      tool: 'calendar_agent', action: 'book', company_name: 'Acme Robotics',
      contact_role: 'CFO', slot_id: '3f8a1c2e-0000-0000-0000-000000000001',
    }
    expect(CalendarCallSchema.parse(call)).toMatchObject(call)
  })
  it('rejects bad contact_role', () => {
    expect(CalendarCallSchema.safeParse({
      tool: 'calendar_agent', action: 'book', company_name: 'Acme', contact_role: 'CTO',
    }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run test/unit/contracts.test.ts`
Expected: FAIL — cannot resolve `../../src/contracts`.

- [ ] **Step 3: Implement contracts and config**

`src/contracts/envelope.ts`:
```ts
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
```

`src/contracts/financial.ts`:
```ts
import { z } from 'zod'

export const MetricSchema = z.enum([
  'burn_multiple', 'rule_of_40', 'ltv_cac', 'cac_payback', 'runway', 'concentration',
])
export type Metric = z.infer<typeof MetricSchema>

/** Frozen Section 5 contract: Orchestrator → Financial Agent. */
export const FinancialCallSchema = z.object({
  tool: z.literal('financial_agent'),
  company_name: z.string().min(1),
  requested_metrics: z.array(MetricSchema).min(1),
}).strict()
export type FinancialCall = z.infer<typeof FinancialCallSchema>

/** Response shape (Part B defines it; Part A's real agent must keep it). */
export const FinancialResultSchema = z.object({
  company_name: z.string(),
  metrics: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
  flags: z.array(z.string()),
  benchmarks: z.record(z.string(), z.string()).optional(),
})
export type FinancialResult = z.infer<typeof FinancialResultSchema>
```

`src/contracts/calendar.ts`:
```ts
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
```

`src/contracts/index.ts`:
```ts
export * from './envelope'
export * from './financial'
export * from './calendar'
```

`src/config.ts`:
```ts
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
}

const ConfigSchema = z.object({
  llmBaseUrl: z.string().url(),
  llmApiKey: z.string().min(1),
  llmModel: z.string().min(1),
  llmTimeoutMs: z.number().int().positive().default(15_000),
  toolTimeoutMs: z.number().int().positive().default(10_000),
  databaseUrl: z.string().url(),
  databaseServiceKey: z.string().min(1),
})
export type AppConfig = z.infer<typeof ConfigSchema>

export function getConfig(env: Env): AppConfig {
  return ConfigSchema.parse({
    llmBaseUrl: env.LLM_BASE_URL,
    llmApiKey: env.LLM_API_KEY,
    llmModel: env.LLM_MODEL,
    llmTimeoutMs: env.LLM_TIMEOUT_MS ? Number(env.LLM_TIMEOUT_MS) : undefined,
    toolTimeoutMs: env.TOOL_TIMEOUT_MS ? Number(env.TOOL_TIMEOUT_MS) : undefined,
    databaseUrl: env.DATABASE_URL,
    databaseServiceKey: env.DATABASE_SERVICE_KEY,
  })
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run test/unit/contracts.test.ts && npm run typecheck`
Expected: all tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/contracts src/config.ts test/unit/contracts.test.ts
git commit -m "Add frozen Section 5 contracts as zod schemas + typed config"
```

---

### Task 3: Supabase migrations + seed data

**Files:**
- Create: `supabase/migrations/0001_schema.sql`, `supabase/migrations/0002_book_slot.sql`, `supabase/migrations/0003_seed.sql`, `docs/setup.md`

**Interfaces:**
- Produces: the five Section 4 tables (+ additive `messages.external_id`), atomic `book_slot(p_slot_id uuid, p_phone text, p_purpose text)` returning the booked slot row or nothing, and seed rows Tasks 8–10 rely on: companies `Acme Robotics` (planted red flags), `Nimbus Analytics` (healthy), `Voltway` (low runway); Acme CFO contact `Priya Nair`.

- [ ] **Step 1: Write the schema migration**

`supabase/migrations/0001_schema.sql`:
```sql
-- Section 4 frozen schema. Additive-only changes allowed (external_id below is additive).
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  stage text not null,
  sector text not null,
  ask_amount numeric,
  pre_money numeric,
  arr numeric not null,
  arr_growth_yoy numeric not null,          -- percent, e.g. 62
  gross_margin numeric not null,            -- percent, e.g. 71
  net_burn_monthly numeric not null,
  net_new_arr_monthly numeric not null,
  cash_on_hand numeric not null,
  cac numeric not null,
  ltv numeric not null,
  cac_payback_months numeric not null,
  cac_payback_months_prior numeric not null,
  top3_pct_arr numeric not null,            -- percent of ARR from top 3 customers
  largest_customer_pct_arr numeric not null,
  largest_customer_renewal_months numeric,
  multi_year_contracts boolean not null default false,
  cohort_m1 numeric, cohort_m6 numeric, cohort_m12 numeric,
  arr_proj_12mo numeric, arr_proj_18mo numeric
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,        -- identity key across channels
  channel_last_used text,
  last_company_id uuid references companies(id),
  last_metrics_discussed text,
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  channel text not null,
  direction text not null check (direction in ('in', 'out')),
  content text not null,
  external_id text,                          -- additive: webhook idempotency
  created_at timestamptz not null default now()
);
create unique index messages_external_id_key on messages (external_id) where external_id is not null;
create index messages_conversation_created_idx on messages (conversation_id, created_at desc);

create table calendar_slots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  contact_name text not null,
  contact_role text not null check (contact_role in ('CFO', 'customer_reference')),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  is_booked boolean not null default false
);

create table calendar_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references calendar_slots(id) unique,
  phone_number text not null,
  purpose text not null,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 2: Write the atomic booking function**

`supabase/migrations/0002_book_slot.sql`:
```sql
-- Atomic booking: UPDATE ... WHERE is_booked = false guarantees two
-- concurrent calls cannot both win the same slot.
create or replace function book_slot(p_slot_id uuid, p_phone text, p_purpose text)
returns setof calendar_slots
language plpgsql
as $$
declare
  won calendar_slots;
begin
  update calendar_slots
     set is_booked = true
   where id = p_slot_id and is_booked = false
   returning * into won;

  if won.id is null then
    return;  -- empty set = slot missing or already booked
  end if;

  insert into calendar_bookings (slot_id, phone_number, purpose)
  values (p_slot_id, p_phone, p_purpose);

  return next won;
end;
$$;
```

- [ ] **Step 3: Write the seed migration**

`supabase/migrations/0003_seed.sql`:
```sql
-- Fictional companies. Acme carries the planted, catchable red flags
-- (customer concentration 41%/19%, CAC payback stretched 13 -> 19mo).
insert into companies (name, stage, sector, ask_amount, pre_money, arr, arr_growth_yoy,
  gross_margin, net_burn_monthly, net_new_arr_monthly, cash_on_hand, cac, ltv,
  cac_payback_months, cac_payback_months_prior, top3_pct_arr, largest_customer_pct_arr,
  largest_customer_renewal_months, multi_year_contracts,
  cohort_m1, cohort_m6, cohort_m12, arr_proj_12mo, arr_proj_18mo)
values
  ('Acme Robotics', 'Series B', 'Industrial automation', 30000000, 170000000,
   12000000, 58, 64, 700000, 330000, 7700000, 48000, 210000,
   19, 13, 41, 19, 4, false,
   100, 88, 79, 19000000, 24500000),
  ('Nimbus Analytics', 'Series A', 'Data infrastructure', 12000000, 48000000,
   4200000, 96, 78, 250000, 260000, 6100000, 21000, 96000,
   9, 10, 22, 9, 11, true,
   100, 93, 90, 8400000, 11800000),
  ('Voltway', 'Series B', 'Fleet electrification', 25000000, 120000000,
   9000000, 44, 52, 900000, 210000, 8200000, 61000, 150000,
   16, 14, 28, 12, 8, false,
   100, 84, 71, 12600000, 15300000);

-- Calendar contacts + availability: 2 slots/day (14:00, 16:00 UTC) for the
-- next 7 days, weekends skipped, per contact.
with contacts (company_name, contact_name, contact_role) as (
  values
    ('Acme Robotics',    'Priya Nair',     'CFO'),
    ('Acme Robotics',    'Jordan Malik',   'customer_reference'),
    ('Nimbus Analytics', 'Sofia Reyes',    'CFO'),
    ('Nimbus Analytics', 'Ben Okafor',     'customer_reference'),
    ('Voltway',          'Dana Whitfield', 'CFO'),
    ('Voltway',          'Alex Kim',       'customer_reference')
), days as (
  select d::date as day
  from generate_series(current_date + 1, current_date + 7, interval '1 day') d
  where extract(dow from d) not in (0, 6)
), hours (h) as (values (14), (16))
insert into calendar_slots (company_id, contact_name, contact_role, slot_start, slot_end)
select c.id, k.contact_name, k.contact_role,
       (d.day + make_interval(hours => h.h)),
       (d.day + make_interval(hours => h.h, mins => 30))
from contacts k
join companies c on c.name = k.company_name
cross join days d
cross join hours h;
```

- [ ] **Step 4: Write `docs/setup.md`** — team-facing infra guide. Content: (1) Supabase: create free project `duebot`, run the three migration files in order in the SQL Editor, copy Project URL → `DATABASE_URL` and service_role key → `DATABASE_SERVICE_KEY`, share in team chat, never commit. (2) LLM: create key at console.groq.com (`LLM_API_KEY`), model `llama-3.3-70b-versatile`; NIM swap = set `LLM_BASE_URL=https://integrate.api.nvidia.com/v1`, `LLM_MODEL=meta/llama-3.3-70b-instruct`, key from build.nvidia.com — no code change. (3) Cloudflare: sign up, `npx wrangler login`, `npm run deploy`, secrets via `npx wrangler secret put LLM_API_KEY` and `... DATABASE_SERVICE_KEY`, plain vars (`LLM_BASE_URL`, `LLM_MODEL`, `DATABASE_URL`) in `wrangler.jsonc` `"vars"`. (4) Local dev: `npm install`, `cp .dev.vars.example .dev.vars`, paste shared values, `npm run dev`, `npm run chat "burn multiple for Acme Robotics"`.

- [ ] **Step 5: Verify migration files are non-empty and well-ordered**

Run: `ls supabase/migrations/ && node -e "['0001_schema.sql','0002_book_slot.sql','0003_seed.sql'].forEach(f=>{if(!require('fs').readFileSync('supabase/migrations/'+f,'utf8').trim())throw f});console.log('ok')"`
Expected: three files listed; `ok`. (Live validation happens when applied to Supabase during infra setup — if the Supabase project already exists, apply them now and confirm `select count(*) from calendar_slots` returns 60.)

- [ ] **Step 6: Commit**

```bash
git add supabase/ docs/setup.md
git commit -m "Add Section 4 schema, atomic book_slot(), and demo seed data"
```

---

### Task 4: Database access layer (port + Supabase adapter + in-memory fake)

**Files:**
- Create: `src/db/types.ts`, `src/db/supabase.ts`, `test/fakes/memory-db.ts`
- Test: `test/unit/memory-db.test.ts`

**Interfaces:**
- Consumes: `AppConfig` from Task 2.
- Produces the `Db` port every later task depends on:
```ts
interface Db {
  getOrCreateConversation(phone: string): Promise<Conversation>
  updateConversation(id: string, patch: ConversationPatch): Promise<void>
  appendMessage(m: NewMessage): Promise<void>
  findReplyByExternalId(externalId: string): Promise<string | null>
  getRecentMessages(conversationId: string, limit: number): Promise<Message[]>
  getCompanyByName(name: string): Promise<Company | null>
  getCompanyById(id: string): Promise<Company | null>
  getOpenSlots(companyId: string, role: ContactRole): Promise<SlotRow[]>
  bookSlot(slotId: string, phone: string, purpose: string): Promise<SlotRow | null>
  ping(): Promise<boolean>
}
```
- Idempotency convention: inbound message stored with `external_id`; outbound reply stored with `external_id = <inbound external_id> + ':reply'`; `findReplyByExternalId(eid)` looks up `eid + ':reply'` and returns its `content`.

- [ ] **Step 1: Write the types + port**

`src/db/types.ts`:
```ts
export type ContactRole = 'CFO' | 'customer_reference'

export type Conversation = {
  id: string
  phone_number: string
  channel_last_used: string | null
  last_company_id: string | null
  last_metrics_discussed: string | null
}

export type ConversationPatch = Partial<
  Pick<Conversation, 'channel_last_used' | 'last_company_id' | 'last_metrics_discussed'>
>

export type NewMessage = {
  conversation_id: string
  channel: 'voice' | 'text'
  direction: 'in' | 'out'
  content: string
  external_id?: string
}

export type Message = NewMessage & { id: string; created_at: string }

export type Company = {
  id: string
  name: string
  stage: string
  sector: string
  arr: number
  arr_growth_yoy: number
  gross_margin: number
  net_burn_monthly: number
  net_new_arr_monthly: number
  cash_on_hand: number
  cac: number
  ltv: number
  cac_payback_months: number
  cac_payback_months_prior: number
  top3_pct_arr: number
  largest_customer_pct_arr: number
  largest_customer_renewal_months: number | null
  multi_year_contracts: boolean
}

export type SlotRow = {
  id: string
  company_id: string
  contact_name: string
  contact_role: ContactRole
  slot_start: string
  slot_end: string
  is_booked: boolean
}

export interface Db {
  getOrCreateConversation(phone: string): Promise<Conversation>
  updateConversation(id: string, patch: ConversationPatch): Promise<void>
  appendMessage(m: NewMessage): Promise<void>
  findReplyByExternalId(externalId: string): Promise<string | null>
  getRecentMessages(conversationId: string, limit: number): Promise<Message[]>
  getCompanyByName(name: string): Promise<Company | null>
  getCompanyById(id: string): Promise<Company | null>
  getOpenSlots(companyId: string, role: ContactRole): Promise<SlotRow[]>
  bookSlot(slotId: string, phone: string, purpose: string): Promise<SlotRow | null>
  ping(): Promise<boolean>
}
```

- [ ] **Step 2: Write failing tests against the in-memory fake**

`test/unit/memory-db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryDb } from '../fakes/memory-db'

describe('MemoryDb (reference behavior for the Db port)', () => {
  let db: MemoryDb
  beforeEach(() => {
    db = new MemoryDb()
    db.seedCompany({ name: 'Acme Robotics' })
  })

  it('getOrCreateConversation is idempotent per phone', async () => {
    const a = await db.getOrCreateConversation('+15551234567')
    const b = await db.getOrCreateConversation('+15551234567')
    expect(a.id).toBe(b.id)
  })

  it('stores and retrieves the reply by external_id convention', async () => {
    const c = await db.getOrCreateConversation('+15551234567')
    await db.appendMessage({ conversation_id: c.id, channel: 'text', direction: 'in', content: 'hi', external_id: 'msg_1' })
    await db.appendMessage({ conversation_id: c.id, channel: 'text', direction: 'out', content: 'hello!', external_id: 'msg_1:reply' })
    expect(await db.findReplyByExternalId('msg_1')).toBe('hello!')
    expect(await db.findReplyByExternalId('msg_2')).toBeNull()
  })

  it('fuzzy-matches company names case-insensitively on substring', async () => {
    expect((await db.getCompanyByName('acme'))?.name).toBe('Acme Robotics')
    expect(await db.getCompanyByName('globex')).toBeNull()
  })

  it('bookSlot wins once and only once', async () => {
    const co = (await db.getCompanyByName('Acme'))!
    const slot = db.seedSlot({ company_id: co.id, contact_role: 'CFO', contact_name: 'Priya Nair' })
    expect(await db.bookSlot(slot.id, '+1555', 'diligence call')).not.toBeNull()
    expect(await db.bookSlot(slot.id, '+1666', 'second try')).toBeNull()
  })

  it('getOpenSlots excludes booked slots and other roles', async () => {
    const co = (await db.getCompanyByName('Acme'))!
    const s1 = db.seedSlot({ company_id: co.id, contact_role: 'CFO', contact_name: 'Priya Nair' })
    db.seedSlot({ company_id: co.id, contact_role: 'customer_reference', contact_name: 'Jordan Malik' })
    await db.bookSlot(s1.id, '+1555', 'x')
    expect(await db.getOpenSlots(co.id, 'CFO')).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run tests, verify failure**

Run: `npx vitest run test/unit/memory-db.test.ts`
Expected: FAIL — cannot resolve `../fakes/memory-db`.

- [ ] **Step 4: Implement the in-memory fake**

`test/fakes/memory-db.ts`:
```ts
import type {
  Company, ContactRole, Conversation, ConversationPatch, Db, Message, NewMessage, SlotRow,
} from '../../src/db/types'

let n = 0
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

const COMPANY_DEFAULTS: Omit<Company, 'id' | 'name'> = {
  stage: 'Series B', sector: 'Industrial automation',
  arr: 12_000_000, arr_growth_yoy: 58, gross_margin: 64,
  net_burn_monthly: 700_000, net_new_arr_monthly: 330_000, cash_on_hand: 7_700_000,
  cac: 48_000, ltv: 210_000, cac_payback_months: 19, cac_payback_months_prior: 13,
  top3_pct_arr: 41, largest_customer_pct_arr: 19,
  largest_customer_renewal_months: 4, multi_year_contracts: false,
}

export class MemoryDb implements Db {
  conversations: Conversation[] = []
  messages: Message[] = []
  companies: Company[] = []
  slots: SlotRow[] = []

  seedCompany(partial: Partial<Company> & { name: string }): Company {
    const c: Company = { id: uid(), ...COMPANY_DEFAULTS, ...partial }
    this.companies.push(c)
    return c
  }

  seedSlot(partial: Partial<SlotRow> & { company_id: string; contact_role: ContactRole; contact_name: string }): SlotRow {
    const s: SlotRow = {
      id: uid(), slot_start: '2026-07-21T14:00:00Z', slot_end: '2026-07-21T14:30:00Z',
      is_booked: false, ...partial,
    }
    this.slots.push(s)
    return s
  }

  async getOrCreateConversation(phone: string): Promise<Conversation> {
    const found = this.conversations.find((c) => c.phone_number === phone)
    if (found) return found
    const c: Conversation = {
      id: uid(), phone_number: phone, channel_last_used: null,
      last_company_id: null, last_metrics_discussed: null,
    }
    this.conversations.push(c)
    return c
  }

  async updateConversation(id: string, patch: ConversationPatch): Promise<void> {
    const c = this.conversations.find((x) => x.id === id)
    if (c) Object.assign(c, patch)
  }

  async appendMessage(m: NewMessage): Promise<void> {
    if (m.external_id && this.messages.some((x) => x.external_id === m.external_id)) {
      throw new Error(`duplicate external_id: ${m.external_id}`)
    }
    this.messages.push({ ...m, id: uid(), created_at: new Date().toISOString() })
  }

  async findReplyByExternalId(externalId: string): Promise<string | null> {
    return this.messages.find((x) => x.external_id === `${externalId}:reply`)?.content ?? null
  }

  async getRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
    return this.messages.filter((m) => m.conversation_id === conversationId).slice(-limit)
  }

  async getCompanyByName(name: string): Promise<Company | null> {
    const q = name.toLowerCase()
    return this.companies.find((c) => c.name.toLowerCase().includes(q)) ?? null
  }

  async getCompanyById(id: string): Promise<Company | null> {
    return this.companies.find((c) => c.id === id) ?? null
  }

  async getOpenSlots(companyId: string, role: ContactRole): Promise<SlotRow[]> {
    return this.slots.filter((s) => s.company_id === companyId && s.contact_role === role && !s.is_booked)
  }

  async bookSlot(slotId: string, _phone: string, _purpose: string): Promise<SlotRow | null> {
    const s = this.slots.find((x) => x.id === slotId && !x.is_booked)
    if (!s) return null
    s.is_booked = true
    return s
  }

  async ping(): Promise<boolean> { return true }
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run test/unit/memory-db.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Implement the Supabase adapter** (same port; thin translation, exercised live in Task 11's smoke test)

`src/db/supabase.ts`:
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from '../config'
import type {
  Company, ContactRole, Conversation, ConversationPatch, Db, Message, NewMessage, SlotRow,
} from './types'

export class SupabaseDb implements Db {
  private client: SupabaseClient

  constructor(cfg: AppConfig) {
    this.client = createClient(cfg.databaseUrl, cfg.databaseServiceKey, {
      auth: { persistSession: false },
    })
  }

  async getOrCreateConversation(phone: string): Promise<Conversation> {
    const { data, error } = await this.client
      .from('conversations')
      .upsert({ phone_number: phone }, { onConflict: 'phone_number', ignoreDuplicates: false })
      .select()
      .single()
    if (error) throw new Error(`conversations upsert: ${error.message}`)
    return data as Conversation
  }

  async updateConversation(id: string, patch: ConversationPatch): Promise<void> {
    const { error } = await this.client
      .from('conversations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error(`conversations update: ${error.message}`)
  }

  async appendMessage(m: NewMessage): Promise<void> {
    const { error } = await this.client.from('messages').insert(m)
    if (error) throw new Error(`messages insert: ${error.message}`)
  }

  async findReplyByExternalId(externalId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('messages')
      .select('content')
      .eq('external_id', `${externalId}:reply`)
      .maybeSingle()
    if (error) throw new Error(`messages lookup: ${error.message}`)
    return data?.content ?? null
  }

  async getRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(`messages select: ${error.message}`)
    return (data as Message[]).reverse()
  }

  async getCompanyByName(name: string): Promise<Company | null> {
    const { data, error } = await this.client
      .from('companies')
      .select('*')
      .ilike('name', `%${name}%`)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`companies select: ${error.message}`)
    return (data as Company) ?? null
  }

  async getCompanyById(id: string): Promise<Company | null> {
    const { data, error } = await this.client
      .from('companies').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(`companies select: ${error.message}`)
    return (data as Company) ?? null
  }

  async getOpenSlots(companyId: string, role: ContactRole): Promise<SlotRow[]> {
    const { data, error } = await this.client
      .from('calendar_slots')
      .select('*')
      .eq('company_id', companyId)
      .eq('contact_role', role)
      .eq('is_booked', false)
      .order('slot_start', { ascending: true })
      .limit(6)
    if (error) throw new Error(`calendar_slots select: ${error.message}`)
    return data as SlotRow[]
  }

  async bookSlot(slotId: string, phone: string, purpose: string): Promise<SlotRow | null> {
    const { data, error } = await this.client
      .rpc('book_slot', { p_slot_id: slotId, p_phone: phone, p_purpose: purpose })
    if (error) throw new Error(`book_slot rpc: ${error.message}`)
    const rows = data as SlotRow[] | null
    return rows && rows.length > 0 ? rows[0]! : null
  }

  async ping(): Promise<boolean> {
    const { error } = await this.client.from('companies').select('id').limit(1)
    return !error
  }
}
```

- [ ] **Step 7: Typecheck + full test run, then commit**

Run: `npm run typecheck && npm test`
Expected: clean.

```bash
git add src/db test/fakes test/unit/memory-db.test.ts
git commit -m "Add Db port with Supabase adapter and in-memory test fake"
```

---

### Task 5: Resilience helpers (timeout fetch, retry, logger)

**Files:**
- Create: `src/lib/http.ts`, `src/lib/logger.ts`
- Test: `test/unit/http.test.ts`

**Interfaces:**
- Produces:
  - `fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response>` — aborts via `AbortSignal.timeout`.
  - `withRetry<T>(fn: () => Promise<T>, opts?: {retries?: number, shouldRetry?: (e: unknown) => boolean, backoffMs?: number}): Promise<T>` — default 1 retry, retries on any error.
  - `isRetryableHttpError(e: unknown): boolean` — true for `HttpStatusError` with 429/5xx and for abort/network errors.
  - `class HttpStatusError extends Error { constructor(public status: number, body: string) }`
  - `log(level: 'info'|'warn'|'error', event: string, fields?: Record<string, unknown>): void` — one JSON line to console.

- [ ] **Step 1: Write failing tests**

`test/unit/http.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { HttpStatusError, isRetryableHttpError, withRetry } from '../../src/lib/http'

describe('withRetry', () => {
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await withRetry(fn)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries once by default then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok')
    expect(await withRetry(fn, { backoffMs: 0 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws the last error when retries are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'))
    await expect(withRetry(fn, { backoffMs: 0 })).rejects.toThrow('always')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('respects shouldRetry = false', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpStatusError(400, 'bad request'))
    await expect(withRetry(fn, { shouldRetry: isRetryableHttpError, backoffMs: 0 })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('isRetryableHttpError', () => {
  it('classifies statuses', () => {
    expect(isRetryableHttpError(new HttpStatusError(429, ''))).toBe(true)
    expect(isRetryableHttpError(new HttpStatusError(503, ''))).toBe(true)
    expect(isRetryableHttpError(new HttpStatusError(400, ''))).toBe(false)
    expect(isRetryableHttpError(new Error('network'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run test/unit/http.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/http`.

- [ ] **Step 3: Implement**

`src/lib/http.ts`:
```ts
export class HttpStatusError extends Error {
  constructor(public status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`)
  }
}

export function isRetryableHttpError(e: unknown): boolean {
  if (e instanceof HttpStatusError) return e.status === 429 || e.status >= 500
  return true // aborts, network failures
}

export async function fetchWithTimeout(
  input: string, init: RequestInit, timeoutMs: number,
): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; shouldRetry?: (e: unknown) => boolean; backoffMs?: number } = {},
): Promise<T> {
  const { retries = 1, shouldRetry = () => true, backoffMs = 300 } = opts
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (attempt === retries || !shouldRetry(e)) throw e
      if (backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)))
    }
  }
  throw lastError
}
```

`src/lib/logger.ts`:
```ts
export function log(
  level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {},
): void {
  // One JSON line per event — readable in `wrangler tail` / Workers Logs.
  console[level](JSON.stringify({ level, event, ...fields }))
}

/** Last 4 digits only — phone numbers never appear whole in logs. */
export function redactPhone(phone: string): string {
  return `***${phone.slice(-4)}`
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run test/unit/http.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib test/unit/http.test.ts
git commit -m "Add timeout/retry helpers and structured logger"
```

---

### Task 6: LLM client (OpenAI-compatible) + tool definitions + persona

**Files:**
- Create: `src/llm/client.ts`, `src/llm/tools.ts`, `src/orchestrator/persona.ts`
- Test: `test/unit/llm-client.test.ts`

**Interfaces:**
- Consumes: `AppConfig` (Task 2), `fetchWithTimeout`/`withRetry`/`HttpStatusError` (Task 5).
- Produces:
  - `type ChatMessage = { role: 'system'|'user'|'assistant'|'tool', content: string | null, tool_calls?: ToolCall[], tool_call_id?: string }`
  - `type ToolCall = { id: string, type: 'function', function: { name: string, arguments: string } }`
  - `interface LlmClient { chat(messages: ChatMessage[], opts?: {tools?: ToolDef[]}): Promise<ChatMessage> }`
  - `class OpenAiCompatClient implements LlmClient` — constructor takes `AppConfig`.
  - `TOOL_DEFS: ToolDef[]` — `financial_agent` + `calendar_agent` function schemas mirroring the frozen contracts.
  - `SYSTEM_PROMPT: string` and `buildSystemPrompt(state: {companyName?: string, lastMetrics?: string}): string` from `persona.ts`.

- [ ] **Step 1: Write failing tests (fetch is injected — no network)**

`test/unit/llm-client.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { OpenAiCompatClient } from '../../src/llm/client'
import type { AppConfig } from '../../src/config'

const cfg: AppConfig = {
  llmBaseUrl: 'https://llm.example/v1', llmApiKey: 'k', llmModel: 'test-model',
  llmTimeoutMs: 1000, toolTimeoutMs: 1000,
  databaseUrl: 'https://db.example', databaseServiceKey: 'x',
}

function okResponse(message: unknown) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

describe('OpenAiCompatClient', () => {
  it('POSTs to {base}/chat/completions with auth header and returns the message', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse({ role: 'assistant', content: 'hi' }))
    const client = new OpenAiCompatClient(cfg, fetchSpy)
    const out = await client.chat([{ role: 'user', content: 'hello' }])
    expect(out.content).toBe('hi')
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://llm.example/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer k')
    expect(JSON.parse(init.body).model).toBe('test-model')
  })

  it('retries once on 500 then succeeds', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValue(okResponse({ role: 'assistant', content: 'recovered' }))
    const client = new OpenAiCompatClient(cfg, fetchSpy, 0)
    const out = await client.chat([{ role: 'user', content: 'hello' }])
    expect(out.content).toBe('recovered')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not retry on 400', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }))
    const client = new OpenAiCompatClient(cfg, fetchSpy, 0)
    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow('HTTP 400')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run test/unit/llm-client.test.ts`
Expected: FAIL — cannot resolve `../../src/llm/client`.

- [ ] **Step 3: Implement client, tools, persona**

`src/llm/client.ts`:
```ts
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
  chat(messages: ChatMessage[], opts?: { tools?: ToolDef[] }): Promise<ChatMessage>
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

  async chat(messages: ChatMessage[], opts: { tools?: ToolDef[] } = {}): Promise<ChatMessage> {
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
            ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
            temperature: 0.2,
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
```

`src/llm/tools.ts`:
```ts
import type { ToolDef } from './client'

/** Function schemas mirror the frozen Section 5 contracts exactly. */
export const TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'financial_agent',
      description:
        'Fetch computed financial due-diligence metrics for a portfolio/prospect company. ' +
        'Use for ANY question involving numbers, metrics, red flags, or financial health.',
      parameters: {
        type: 'object',
        properties: {
          company_name: { type: 'string', description: 'Company name as the user said it' },
          requested_metrics: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['burn_multiple', 'rule_of_40', 'ltv_cac', 'cac_payback', 'runway', 'concentration'],
            },
            description: 'Metrics the user asked about (or all six for a general health check)',
          },
        },
        required: ['company_name', 'requested_metrics'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_agent',
      description:
        'Check availability or book follow-up diligence/reference calls with a company contact. ' +
        'Always check_availability first; book only with a slot_id from a prior availability result.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['check_availability', 'book'] },
          company_name: { type: 'string' },
          contact_role: { type: 'string', enum: ['CFO', 'customer_reference'] },
          preferred_window: { type: 'string', description: 'e.g. "this week", "Thursday afternoon"' },
          slot_id: { type: 'string', description: 'Required for book: the chosen slot UUID' },
        },
        required: ['action', 'company_name', 'contact_role'],
      },
    },
  },
]
```

`src/orchestrator/persona.ts`:
```ts
/** DueBot's persona: a diligence analyst in the VC's pocket. */
export const SYSTEM_PROMPT = `You are DueBot, a financial due-diligence analyst for venture investors. You answer over text and voice, so replies must be tight.

Rules:
- NEVER compute, estimate, or guess any number. Every figure must come verbatim from a tool result. If a tool fails or a metric is unavailable, say so plainly.
- Style: numbers-first, analyst tone, not chatbot tone. Lead with the metric values, then at most ONE red flag, then ONE suggested next diligence question.
- Keep replies under 80 words for text, under 50 for voice (the channel is given per message).
- Benchmarks you may cite: burn multiple <1.5x good / >2x flag; Rule of 40 >=40 healthy; LTV:CAC >3x healthy; runway <12 months flag; top-3 concentration >30% or largest customer >15% of ARR is material risk at Series B+.
- For booking requests: check availability first, present 2-3 options briefly, book only after the user picks one (a bare "book it" after you offered ONE specific slot counts as picking it).
- Resolve references like "them", "that one", "book it" using the conversation state provided.
- Never invent contacts, companies, or slots. If the company is not in the dataset, say you do not cover it yet.`

export function buildSystemPrompt(state: { companyName?: string; lastMetrics?: string }): string {
  const ctx: string[] = []
  if (state.companyName) ctx.push(`Company currently under discussion: ${state.companyName}.`)
  if (state.lastMetrics) ctx.push(`Metrics last discussed: ${state.lastMetrics}.`)
  return ctx.length ? `${SYSTEM_PROMPT}\n\nConversation state:\n${ctx.join('\n')}` : SYSTEM_PROMPT
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run test/unit/llm-client.test.ts && npm run typecheck`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/llm src/orchestrator/persona.ts test/unit/llm-client.test.ts
git commit -m "Add provider-agnostic LLM client, tool schemas, and analyst persona"
```

---

### Task 7: App factory + skeleton `/orchestrate` (canned reply) + `/health` — the Sync 1 deliverable

**Files:**
- Create: `src/app.ts`, `src/index.ts`
- Test: `test/integration/skeleton.test.ts`

**Interfaces:**
- Consumes: `EnvelopeSchema` (Task 2), `Db`/`MemoryDb` (Task 4), `LlmClient` (Task 6), `log` (Task 5).
- Produces:
  - `type Deps = { db: Db, llm: LlmClient, config: AppConfig }`
  - `createApp(deps: Deps): Hono` — the whole app behind injected dependencies; tests and later tasks build on this. **Until Task 10 wires the real loop, `/orchestrate` returns a canned reply** so Part C can integrate at Sync 1.
  - `src/index.ts` default export: Workers fetch handler that builds real `Deps` from `env` (SupabaseDb + OpenAiCompatClient) once per isolate and delegates.

- [ ] **Step 1: Write failing tests**

`test/integration/skeleton.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { MemoryDb } from '../fakes/memory-db'
import type { AppConfig } from '../../src/config'
import type { ChatMessage, LlmClient } from '../../src/llm/client'

export const testConfig: AppConfig = {
  llmBaseUrl: 'https://llm.example/v1', llmApiKey: 'k', llmModel: 'test-model',
  llmTimeoutMs: 1000, toolTimeoutMs: 1000,
  databaseUrl: 'https://db.example', databaseServiceKey: 'x',
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

const envelope = {
  channel: 'text', from_number: '+15551234567', text: 'hello',
  external_id: 'msg_001', timestamp: '2026-07-18T14:00:00Z',
}

describe('skeleton app', () => {
  const app = () => createApp({ db: new MemoryDb(), llm: new ScriptedLlm([]), config: testConfig })

  it('GET /health returns ok with db status', async () => {
    const res = await app().request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, db: true })
  })

  it('POST /orchestrate accepts a valid envelope and returns a reply string', async () => {
    const res = await app().request('/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { reply: string; conversation_id: string }
    expect(typeof body.reply).toBe('string')
    expect(body.reply.length).toBeGreaterThan(0)
    expect(body.conversation_id).toBeTruthy()
  })

  it('rejects a malformed envelope with 400 and error details', async () => {
    const res = await app().request('/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...envelope, channel: 'carrier-pigeon' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('invalid_envelope')
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run test/integration/skeleton.test.ts`
Expected: FAIL — cannot resolve `../../src/app`.

- [ ] **Step 3: Implement app factory + entrypoint**

`src/app.ts`:
```ts
import { Hono } from 'hono'
import type { AppConfig } from './config'
import { EnvelopeSchema } from './contracts'
import type { Db } from './db/types'
import type { LlmClient } from './llm/client'
import { log, redactPhone } from './lib/logger'

export type Deps = { db: Db; llm: LlmClient; config: AppConfig }

export function createApp(deps: Deps): Hono {
  const app = new Hono()

  app.get('/health', async (c) => {
    const dbOk = await deps.db.ping().catch(() => false)
    return c.json({ ok: dbOk, db: dbOk }, dbOk ? 200 : 503)
  })

  app.post('/orchestrate', async (c) => {
    const parsed = EnvelopeSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_envelope', details: parsed.error.flatten() }, 400)
    }
    const envelope = parsed.data
    const requestId = crypto.randomUUID().slice(0, 8)
    log('info', 'orchestrate.received', {
      requestId, channel: envelope.channel, from: redactPhone(envelope.from_number),
    })

    const conversation = await deps.db.getOrCreateConversation(envelope.from_number)

    // Skeleton (Sync 1): canned reply. Task 10 replaces this block with the tool loop.
    const reply =
      "DueBot here - the analyst brain is being wired up. Your channel integration works; ask me again after Sync 2."

    await deps.db.appendMessage({
      conversation_id: conversation.id, channel: envelope.channel,
      direction: 'in', content: envelope.text, external_id: envelope.external_id,
    }).catch((e) => log('error', 'db.append_in_failed', { requestId, error: String(e) }))

    return c.json({ reply, conversation_id: conversation.id })
  })

  return app
}
```

`src/index.ts`:
```ts
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
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run test/integration/skeleton.test.ts && npm run typecheck`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 5: Commit — and tell the team Sync 1 endpoint shape is live**

```bash
git add src/app.ts src/index.ts test/integration/skeleton.test.ts
git commit -m "Add app factory, /health, and skeleton /orchestrate (Sync 1)"
git push origin main
```

---

### Task 8: Financial Agent stub — pure metrics + route

**Files:**
- Create: `src/agents/metrics.ts`, `src/agents/financial.ts`
- Modify: `src/app.ts` (mount route — exact diff below)
- Test: `test/unit/metrics.test.ts`, `test/integration/financial.test.ts`

**Interfaces:**
- Consumes: `FinancialCallSchema`/`FinancialResultSchema` (Task 2), `Db.getCompanyByName` (Task 4), `Deps` (Task 7).
- Produces:
  - `computeMetrics(company: Company, requested: Metric[]): { metrics: Record<string, number|string|null>, flags: string[] }` — the exact spec formulas; Part A replaces internals, keeps this signature.
  - `financialRoutes(deps: Deps): Hono` mounted at `/agents/financial`; POST body = frozen financial tool-call JSON; 200 response validates against `FinancialResultSchema`; unknown company → 404 `{error: 'company_not_found'}`.

- [ ] **Step 1: Write failing metric tests (hand-computed from Acme seed values)**

`test/unit/metrics.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { computeMetrics } from '../../src/agents/metrics'
import { MemoryDb } from '../fakes/memory-db'

// Acme seed: burn 700k, net-new ARR 330k/mo, growth 58, margin 64,
// ltv 210k, cac 48k, cash 7.7M, payback 19 (prior 13), top3 41%, largest 19%.
const acme = new MemoryDb().seedCompany({ name: 'Acme Robotics' })

describe('computeMetrics', () => {
  it('burn_multiple = net_burn / net_new_arr, rounded to 2dp', () => {
    const { metrics } = computeMetrics(acme, ['burn_multiple'])
    expect(metrics.burn_multiple).toBe(2.12)  // 700000/330000
  })

  it('rule_of_40 = growth + margin', () => {
    const { metrics } = computeMetrics(acme, ['rule_of_40'])
    expect(metrics.rule_of_40).toBe(122)  // 58 + 64
  })

  it('ltv_cac and runway', () => {
    const { metrics } = computeMetrics(acme, ['ltv_cac', 'runway'])
    expect(metrics.ltv_cac).toBe(4.38)   // 210000/48000
    expect(metrics.runway_months).toBe(11)  // floor(7700000/700000)
  })

  it('flags: burn multiple >2x, payback stretched, concentration', () => {
    const { flags } = computeMetrics(acme, ['burn_multiple', 'cac_payback', 'concentration'])
    expect(flags.some((f) => f.includes('Burn multiple'))).toBe(true)
    expect(flags.some((f) => f.includes('CAC payback'))).toBe(true)
    expect(flags.some((f) => f.includes('concentration') || f.includes('Top 3'))).toBe(true)
  })

  it('healthy company yields no flags', () => {
    const nimbus = new MemoryDb().seedCompany({
      name: 'Nimbus', net_burn_monthly: 250_000, net_new_arr_monthly: 260_000,
      arr_growth_yoy: 96, gross_margin: 78, cash_on_hand: 6_100_000,
      cac_payback_months: 9, cac_payback_months_prior: 10,
      top3_pct_arr: 22, largest_customer_pct_arr: 9, ltv: 96_000, cac: 21_000,
    })
    const { flags } = computeMetrics(nimbus, ['burn_multiple', 'rule_of_40', 'runway', 'concentration', 'cac_payback', 'ltv_cac'])
    expect(flags).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run test/unit/metrics.test.ts`
Expected: FAIL — cannot resolve `../../src/agents/metrics`.

- [ ] **Step 3: Implement metrics (spec Part A formulas — deterministic, no LLM)**

`src/agents/metrics.ts`:
```ts
import type { Company } from '../db/types'
import type { Metric } from '../contracts'

const round2 = (x: number) => Math.round(x * 100) / 100

/** Spec formulas. The LLM never computes these — this code does.
 * Part A may replace the internals; the signature and flag style stay. */
export function computeMetrics(
  company: Company, requested: Metric[],
): { metrics: Record<string, number | string | null>; flags: string[] } {
  const metrics: Record<string, number | string | null> = {}
  const flags: string[] = []

  for (const m of requested) {
    switch (m) {
      case 'burn_multiple': {
        const v = round2(company.net_burn_monthly / company.net_new_arr_monthly)
        metrics.burn_multiple = v
        if (v > 2) flags.push(`Burn multiple ${v}x (benchmark <1.5x good, >2x flag)`)
        break
      }
      case 'rule_of_40': {
        const v = round2(company.arr_growth_yoy + company.gross_margin)
        metrics.rule_of_40 = v
        if (v < 40) flags.push(`Rule of 40: ${v} (below the 40 threshold)`)
        break
      }
      case 'ltv_cac': {
        const v = round2(company.ltv / company.cac)
        metrics.ltv_cac = v
        if (v < 3) flags.push(`LTV:CAC ${v}x (benchmark >3x healthy)`)
        break
      }
      case 'cac_payback': {
        metrics.cac_payback_months = company.cac_payback_months
        metrics.cac_payback_months_prior = company.cac_payback_months_prior
        if (company.cac_payback_months > company.cac_payback_months_prior) {
          flags.push(
            `CAC payback stretched to ${company.cac_payback_months}mo (was ${company.cac_payback_months_prior}mo)`,
          )
        }
        break
      }
      case 'runway': {
        const v = Math.floor(company.cash_on_hand / company.net_burn_monthly)
        metrics.runway_months = v
        if (v < 12) flags.push(`Runway ${v} months (<12mo flag)`)
        break
      }
      case 'concentration': {
        metrics.top3_pct_arr = company.top3_pct_arr
        metrics.largest_customer_pct_arr = company.largest_customer_pct_arr
        if (company.top3_pct_arr > 30 || company.largest_customer_pct_arr > 15) {
          flags.push(
            `Top 3 customers ${company.top3_pct_arr}% of ARR, largest ${company.largest_customer_pct_arr}% - material concentration risk at ${company.stage}`,
          )
        }
        break
      }
    }
  }
  return { metrics, flags }
}
```

- [ ] **Step 4: Run metric tests, verify pass**

Run: `npx vitest run test/unit/metrics.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write failing route test**

`test/integration/financial.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { MemoryDb } from '../fakes/memory-db'
import { ScriptedLlm, testConfig } from './skeleton.test'
import { FinancialResultSchema } from '../../src/contracts'

function appWithAcme() {
  const db = new MemoryDb()
  db.seedCompany({ name: 'Acme Robotics' })
  return createApp({ db, llm: new ScriptedLlm([]), config: testConfig })
}

describe('POST /agents/financial', () => {
  it('returns contract-valid metrics for a seeded company', async () => {
    const res = await appWithAcme().request('/agents/financial', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: 'financial_agent', company_name: 'acme',
        requested_metrics: ['burn_multiple', 'rule_of_40', 'runway'],
      }),
    })
    expect(res.status).toBe(200)
    const body = FinancialResultSchema.parse(await res.json())
    expect(body.company_name).toBe('Acme Robotics')
    expect(body.metrics.burn_multiple).toBe(2.12)
  })

  it('404s an unknown company', async () => {
    const res = await appWithAcme().request('/agents/financial', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: 'financial_agent', company_name: 'Globex', requested_metrics: ['runway'],
      }),
    })
    expect(res.status).toBe(404)
  })

  it('400s a contract violation', async () => {
    const res = await appWithAcme().request('/agents/financial', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'financial_agent', company_name: 'Acme', requested_metrics: ['ebitda'] }),
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 6: Run route test, verify failure** (`npx vitest run test/integration/financial.test.ts` → 404s because route is unmounted)

- [ ] **Step 7: Implement route and mount it**

`src/agents/financial.ts`:
```ts
import { Hono } from 'hono'
import type { Deps } from '../app'
import { FinancialCallSchema, type FinancialResult } from '../contracts'
import { computeMetrics } from './metrics'

/** Contract-faithful stub. Part A replaces computeMetrics internals;
 * the route, request contract, and response shape must not change. */
export function financialRoutes(deps: Deps): Hono {
  const app = new Hono()

  app.post('/', async (c) => {
    const parsed = FinancialCallSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_tool_call', details: parsed.error.flatten() }, 400)
    }
    const company = await deps.db.getCompanyByName(parsed.data.company_name)
    if (!company) return c.json({ error: 'company_not_found', company_name: parsed.data.company_name }, 404)

    const { metrics, flags } = computeMetrics(company, parsed.data.requested_metrics)
    const result: FinancialResult = {
      company_name: company.name, metrics, flags,
      benchmarks: {
        burn_multiple: '<1.5x good, >2x flag', rule_of_40: '>=40 healthy',
        ltv_cac: '>3x healthy', runway: '<12mo flag',
        concentration: 'top3 >30% or largest >15% is material risk',
      },
    }
    return c.json(result)
  })

  return app
}
```

In `src/app.ts`, add the import and mount (after the `/health` route):
```ts
import { financialRoutes } from './agents/financial'
// ... inside createApp, after app.get('/health', ...):
  app.route('/agents/financial', financialRoutes(deps))
```

- [ ] **Step 8: Run all tests, verify pass**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/agents test/unit/metrics.test.ts test/integration/financial.test.ts src/app.ts
git commit -m "Add financial agent stub with deterministic spec metrics"
```

---

### Task 9: Calendar Agent route

**Files:**
- Create: `src/agents/calendar.ts`
- Modify: `src/app.ts` (mount route)
- Test: `test/integration/calendar.test.ts`

**Interfaces:**
- Consumes: `CalendarCallSchema`/`CalendarResultSchema` (Task 2), `Db.getOpenSlots`/`Db.bookSlot` (Task 4), `Deps` (Task 7).
- Produces: `calendarRoutes(deps: Deps): Hono` mounted at `/agents/calendar`. POST body = frozen calendar tool-call JSON (+ `phone_number` passed by the orchestrator as an additive field for booking attribution). Responses match `CalendarResultSchema` (`status: 'slots' | 'booked' | 'error'`).

- [ ] **Step 1: Write failing tests**

`test/integration/calendar.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { MemoryDb } from '../fakes/memory-db'
import { ScriptedLlm, testConfig } from './skeleton.test'
import { CalendarResultSchema } from '../../src/contracts'
import type { Hono } from 'hono'

let db: MemoryDb
let app: Hono
let slotId: string

beforeEach(() => {
  db = new MemoryDb()
  const acme = db.seedCompany({ name: 'Acme Robotics' })
  slotId = db.seedSlot({ company_id: acme.id, contact_role: 'CFO', contact_name: 'Priya Nair' }).id
  app = createApp({ db, llm: new ScriptedLlm([]), config: testConfig })
})

const post = (body: unknown) => app.request('/agents/calendar', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /agents/calendar', () => {
  it('check_availability returns open slots', async () => {
    const res = await post({
      tool: 'calendar_agent', action: 'check_availability',
      company_name: 'acme', contact_role: 'CFO',
    })
    expect(res.status).toBe(200)
    const body = CalendarResultSchema.parse(await res.json())
    if (body.status !== 'slots') throw new Error('expected slots')
    expect(body.slots).toHaveLength(1)
    expect(body.slots[0]!.contact_name).toBe('Priya Nair')
  })

  it('book wins the slot exactly once', async () => {
    const call = {
      tool: 'calendar_agent', action: 'book', company_name: 'acme',
      contact_role: 'CFO', slot_id: slotId, phone_number: '+15551234567',
    }
    const first = CalendarResultSchema.parse(await (await post(call)).json())
    expect(first.status).toBe('booked')
    const second = CalendarResultSchema.parse(await (await post(call)).json())
    expect(second.status).toBe('error')
  })

  it('book without slot_id errors cleanly', async () => {
    const res = await post({
      tool: 'calendar_agent', action: 'book', company_name: 'acme', contact_role: 'CFO',
    })
    const body = CalendarResultSchema.parse(await res.json())
    expect(body.status).toBe('error')
  })

  it('unknown company errors cleanly', async () => {
    const res = await post({
      tool: 'calendar_agent', action: 'check_availability',
      company_name: 'Globex', contact_role: 'CFO',
    })
    const body = CalendarResultSchema.parse(await res.json())
    expect(body.status).toBe('error')
  })
})
```

- [ ] **Step 2: Run tests, verify failure** (`npx vitest run test/integration/calendar.test.ts` → 404, route unmounted)

- [ ] **Step 3: Implement and mount**

`src/agents/calendar.ts`:
```ts
import { Hono } from 'hono'
import { z } from 'zod'
import type { Deps } from '../app'
import { CalendarCallSchema, type CalendarResult } from '../contracts'

// Orchestrator forwards the caller's phone for booking attribution (additive field).
const RequestSchema = CalendarCallSchema.extend({
  phone_number: z.string().optional(),
  purpose: z.string().optional(),
})

export function calendarRoutes(deps: Deps): Hono {
  const app = new Hono()

  app.post('/', async (c) => {
    const parsed = RequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_tool_call', details: parsed.error.flatten() }, 400)
    }
    const call = parsed.data
    const company = await deps.db.getCompanyByName(call.company_name)
    if (!company) {
      return c.json({ status: 'error', reason: `No company matching "${call.company_name}" in the dataset` } satisfies CalendarResult)
    }

    if (call.action === 'check_availability') {
      const slots = await deps.db.getOpenSlots(company.id, call.contact_role)
      return c.json({
        status: 'slots', company_name: company.name,
        slots: slots.map((s) => ({
          slot_id: s.id, contact_name: s.contact_name, contact_role: s.contact_role,
          slot_start: s.slot_start, slot_end: s.slot_end,
        })),
      } satisfies CalendarResult)
    }

    // action === 'book'
    if (!call.slot_id) {
      return c.json({ status: 'error', reason: 'book requires a slot_id from a prior check_availability' } satisfies CalendarResult)
    }
    const purpose = call.purpose ?? `Follow-up diligence call re ${company.name}`
    const won = await deps.db.bookSlot(call.slot_id, call.phone_number ?? 'unknown', purpose)
    if (!won) {
      return c.json({ status: 'error', reason: 'That slot is no longer available - want me to check remaining times?' } satisfies CalendarResult)
    }
    return c.json({
      status: 'booked', company_name: company.name, purpose,
      slot: {
        slot_id: won.id, contact_name: won.contact_name, contact_role: won.contact_role,
        slot_start: won.slot_start, slot_end: won.slot_end,
      },
    } satisfies CalendarResult)
  })

  return app
}
```

In `src/app.ts`, mount next to the financial route:
```ts
import { calendarRoutes } from './agents/calendar'
// ... inside createApp:
  app.route('/agents/calendar', calendarRoutes(deps))
```

Note: the contract test expects `SlotSchema` field names (`slot_id`, not `id`) — that mapping happens here at the route boundary, and `CalendarResultSchema.parse` in the tests enforces it.

- [ ] **Step 4: Run all tests, verify pass**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/calendar.ts test/integration/calendar.test.ts src/app.ts
git commit -m "Add calendar agent with availability and atomic booking"
```

---

### Task 10: Orchestrator tool loop — replace the canned reply (Sync 2 deliverable)

**Files:**
- Create: `src/orchestrator/loop.ts`
- Modify: `src/app.ts` (replace the skeleton `/orchestrate` body)
- Test: `test/integration/orchestrate.test.ts`

**Interfaces:**
- Consumes: everything prior — `buildSystemPrompt` (Task 6), `TOOL_DEFS` (Task 6), `FinancialCallSchema`/`CalendarCallSchema` (Task 2), `Db` (Task 4), `LlmClient` (Task 6).
- Produces: `runOrchestration(deps: Deps, app: Hono, envelope: Envelope): Promise<{reply: string, conversationId: string}>` — the full lifecycle: idempotency → state load → LLM tool loop (max 3 iterations, in-process dispatch via `app.request`) → state persist. `/orchestrate` becomes a thin wrapper around it.

- [ ] **Step 1: Write failing integration tests (scripted LLM — deterministic)**

`test/integration/orchestrate.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { MemoryDb } from '../fakes/memory-db'
import { ScriptedLlm, testConfig } from './skeleton.test'
import type { ChatMessage } from '../../src/llm/client'

let db: MemoryDb
beforeEach(() => {
  db = new MemoryDb()
  const acme = db.seedCompany({ name: 'Acme Robotics' })
  db.seedSlot({ company_id: acme.id, contact_role: 'CFO', contact_name: 'Priya Nair' })
})

const envelope = (text: string, external_id: string) => ({
  channel: 'text' as const, from_number: '+15551234567', text,
  external_id, timestamp: '2026-07-18T14:00:00Z',
})

const toolCallMsg = (name: string, args: object): ChatMessage => ({
  role: 'assistant', content: null,
  tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})
const finalMsg = (content: string): ChatMessage => ({ role: 'assistant', content })

const post = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request('/orchestrate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

describe('POST /orchestrate with tool loop', () => {
  it('runs financial tool call and composes the reply from tool data', async () => {
    const llm = new ScriptedLlm([
      toolCallMsg('financial_agent', {
        company_name: 'Acme Robotics', requested_metrics: ['burn_multiple', 'runway'],
      }),
      finalMsg('Burn multiple 2.12x (>2x flag). Runway 11 months.'),
    ])
    const app = createApp({ db, llm, config: testConfig })
    const res = await post(app, envelope('burn multiple + runway for Acme?', 'msg_101'))
    expect(res.status).toBe(200)
    const body = await res.json() as { reply: string }
    expect(body.reply).toContain('2.12x')

    // The second LLM call must include the tool result with real computed numbers.
    const secondCallMessages = llm.calls[1]!
    const toolMsg = secondCallMessages.find((m) => m.role === 'tool')!
    expect(toolMsg.content).toContain('2.12')

    // State was persisted for follow-ups.
    const convo = db.conversations[0]!
    expect(convo.last_company_id).toBe(db.companies[0]!.id)
    expect(convo.last_metrics_discussed).toContain('burn_multiple')
  })

  it('replays the stored reply on duplicate external_id without calling the LLM', async () => {
    const llm = new ScriptedLlm([
      toolCallMsg('financial_agent', { company_name: 'Acme', requested_metrics: ['runway'] }),
      finalMsg('Runway 11 months.'),
    ])
    const app = createApp({ db, llm, config: testConfig })
    const first = await (await post(app, envelope('runway?', 'msg_dup'))).json() as { reply: string }
    const second = await (await post(app, envelope('runway?', 'msg_dup'))).json() as { reply: string }
    expect(second.reply).toBe(first.reply)
    expect(llm.calls.length).toBe(2) // no third call for the duplicate
  })

  it('invalid tool args from the LLM become an error tool message, not a crash', async () => {
    const llm = new ScriptedLlm([
      toolCallMsg('financial_agent', { company_name: 'Acme', requested_metrics: ['ebitda'] }),
      finalMsg('I could not pull that metric - I cover burn multiple, Rule of 40, LTV:CAC, CAC payback, runway, and concentration.'),
    ])
    const app = createApp({ db, llm, config: testConfig })
    const res = await post(app, envelope('what is their ebitda?', 'msg_102'))
    expect(res.status).toBe(200)
    const toolMsg = llm.calls[1]!.find((m) => m.role === 'tool')!
    expect(toolMsg.content).toContain('error')
  })

  it('LLM failure yields the graceful fallback reply, still 200', async () => {
    const llm = new ScriptedLlm([]) // script exhausted → chat() throws
    const app = createApp({ db, llm, config: testConfig })
    const res = await post(app, envelope('hello?', 'msg_103'))
    expect(res.status).toBe(200)
    const body = await res.json() as { reply: string }
    expect(body.reply).toContain('trouble')
  })

  it('books a call end-to-end via the calendar tool', async () => {
    const slotId = db.slots[0]!.id
    const llm = new ScriptedLlm([
      toolCallMsg('calendar_agent', {
        action: 'check_availability', company_name: 'Acme Robotics', contact_role: 'CFO',
      }),
      toolCallMsg('calendar_agent', {
        action: 'book', company_name: 'Acme Robotics', contact_role: 'CFO', slot_id: slotId,
      }),
      finalMsg('Booked: Priya Nair (CFO, Acme Robotics), Tuesday 14:00-14:30 UTC.'),
    ])
    const app = createApp({ db, llm, config: testConfig })
    const res = await post(app, envelope('set up a call with their CFO', 'msg_104'))
    const body = await res.json() as { reply: string }
    expect(body.reply).toContain('Booked')
    expect(db.slots[0]!.is_booked).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run test/integration/orchestrate.test.ts`
Expected: FAIL — replies are the canned skeleton string, no tool dispatch.

- [ ] **Step 3: Implement the loop**

`src/orchestrator/loop.ts`:
```ts
import type { Hono } from 'hono'
import type { Deps } from '../app'
import type { Envelope } from '../contracts'
import { CalendarCallSchema, FinancialCallSchema } from '../contracts'
import type { ChatMessage, ToolCall } from '../llm/client'
import { TOOL_DEFS } from '../llm/tools'
import { buildSystemPrompt } from './persona'
import { log, redactPhone } from '../lib/logger'

const MAX_ITERATIONS = 3
export const FALLBACK_REPLY =
  "I'm having trouble pulling that up right now - give me a moment and try again."

/** Validate + dispatch one LLM tool call to its in-process route. */
async function dispatchTool(
  app: Hono, call: ToolCall, envelope: Envelope, toolTimeoutMs: number,
): Promise<string> {
  let args: unknown
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    return JSON.stringify({ error: 'tool arguments were not valid JSON' })
  }

  let path: string
  let body: Record<string, unknown>
  if (call.function.name === 'financial_agent') {
    const parsed = FinancialCallSchema.safeParse({ tool: 'financial_agent', ...(args as object) })
    if (!parsed.success) return JSON.stringify({ error: 'invalid financial_agent args', details: parsed.error.flatten() })
    path = '/agents/financial'
    body = parsed.data
  } else if (call.function.name === 'calendar_agent') {
    const parsed = CalendarCallSchema.safeParse({ tool: 'calendar_agent', ...(args as object) })
    if (!parsed.success) return JSON.stringify({ error: 'invalid calendar_agent args', details: parsed.error.flatten() })
    path = '/agents/calendar'
    body = { ...parsed.data, phone_number: envelope.from_number }
  } else {
    return JSON.stringify({ error: `unknown tool: ${call.function.name}` })
  }

  try {
    const res = await Promise.race([
      app.request(path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('tool timeout')), toolTimeoutMs)),
    ])
    const text = await res.text()
    return res.ok ? text : JSON.stringify({ error: `tool returned ${res.status}`, body: text })
  } catch (e) {
    return JSON.stringify({ error: `tool call failed: ${String(e)}` })
  }
}

export async function runOrchestration(
  deps: Deps, app: Hono, envelope: Envelope,
): Promise<{ reply: string; conversationId: string }> {
  const requestId = crypto.randomUUID().slice(0, 8)
  const t0 = Date.now()

  // 1. Idempotency: webhook retries get the stored reply, no LLM re-run.
  const priorReply = await deps.db.findReplyByExternalId(envelope.external_id).catch(() => null)
  const conversation = await deps.db.getOrCreateConversation(envelope.from_number)
  if (priorReply !== null) {
    log('info', 'orchestrate.replay', { requestId, external_id: envelope.external_id })
    return { reply: priorReply, conversationId: conversation.id }
  }

  // 2. Load state + record inbound.
  const recent = await deps.db.getRecentMessages(conversation.id, 10)
  const company = conversation.last_company_id
    ? await deps.db.getCompanyById(conversation.last_company_id).catch(() => null)
    : null
  await deps.db.appendMessage({
    conversation_id: conversation.id, channel: envelope.channel, direction: 'in',
    content: envelope.text, external_id: envelope.external_id,
  }).catch((e) => log('error', 'db.append_in_failed', { requestId, error: String(e) }))

  // 3. Build the transcript for the LLM.
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt({
      companyName: company?.name,
      lastMetrics: conversation.last_metrics_discussed ?? undefined,
    }) },
    ...recent.map((m): ChatMessage => ({
      role: m.direction === 'in' ? 'user' : 'assistant', content: m.content,
    })),
    { role: 'user', content: `[channel: ${envelope.channel}] ${envelope.text}` },
  ]

  // 4. Tool loop.
  let reply = FALLBACK_REPLY
  const toolsUsed: string[] = []
  let lastCompanyNamed: string | null = null
  let lastMetricsRequested: string | null = null
  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const assistant = await deps.llm.chat(messages, { tools: TOOL_DEFS })
      messages.push(assistant)
      if (!assistant.tool_calls?.length) {
        reply = assistant.content ?? FALLBACK_REPLY
        break
      }
      for (const call of assistant.tool_calls) {
        toolsUsed.push(call.function.name)
        try {
          const args = JSON.parse(call.function.arguments) as Record<string, unknown>
          if (typeof args.company_name === 'string') lastCompanyNamed = args.company_name
          if (Array.isArray(args.requested_metrics)) lastMetricsRequested = args.requested_metrics.join(',')
        } catch { /* dispatchTool reports the parse error to the LLM */ }
        const result = await dispatchTool(app, call, envelope, deps.config.toolTimeoutMs)
        messages.push({ role: 'tool', content: result, tool_call_id: call.id })
      }
      // Loop exhausted without a final answer → ask for composition without tools.
      if (i === MAX_ITERATIONS - 1) {
        const final = await deps.llm.chat(messages)
        reply = final.content ?? FALLBACK_REPLY
      }
    }
  } catch (e) {
    log('error', 'orchestrate.llm_failed', { requestId, error: String(e) })
    reply = FALLBACK_REPLY
  }

  // 5. Persist state + outbound (best-effort — never fail the reply).
  const namedCompany = lastCompanyNamed
    ? await deps.db.getCompanyByName(lastCompanyNamed).catch(() => null)
    : null
  await Promise.all([
    deps.db.updateConversation(conversation.id, {
      channel_last_used: envelope.channel,
      ...(namedCompany ? { last_company_id: namedCompany.id } : {}),
      ...(lastMetricsRequested ? { last_metrics_discussed: lastMetricsRequested } : {}),
    }),
    deps.db.appendMessage({
      conversation_id: conversation.id, channel: envelope.channel, direction: 'out',
      content: reply, external_id: `${envelope.external_id}:reply`,
    }),
  ]).catch((e) => log('error', 'db.persist_failed', { requestId, error: String(e) }))

  log('info', 'orchestrate.done', {
    requestId, channel: envelope.channel, from: redactPhone(envelope.from_number),
    tools: toolsUsed, ms: Date.now() - t0,
  })
  return { reply, conversationId: conversation.id }
}
```

In `src/app.ts`, replace the skeleton `/orchestrate` handler body (everything after the envelope parse + log) with:
```ts
import { runOrchestration } from './orchestrator/loop'
// ... inside app.post('/orchestrate', ...), after validation and logging:
    const { reply, conversationId } = await runOrchestration(deps, app, envelope)
    return c.json({ reply, conversation_id: conversationId })
```
Delete the canned-reply block and the inbound `appendMessage` from `app.ts` (the loop owns both now). Keep the 400 path unchanged. Update `test/integration/skeleton.test.ts`'s second test ("returns a reply string"): give the app a `ScriptedLlm([{ role: 'assistant', content: 'hello from the analyst' }])` so the loop has a script — assertions stay the same.

- [ ] **Step 4: Run all tests, verify pass**

Run: `npm test && npm run typecheck`
Expected: all PASS (including the 5 new orchestrate tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/loop.ts src/app.ts test/integration/orchestrate.test.ts test/integration/skeleton.test.ts
git commit -m "Wire LLM tool loop into /orchestrate with idempotency and fallbacks"
git push origin main
```

---

### Task 11: Local chat CLI + live smoke test

**Files:**
- Create: `scripts/chat.ts`

**Interfaces:**
- Consumes: the deployed `/orchestrate` contract (Task 10). No src imports — it's a pure HTTP client, so it also documents how Part C should call us.

- [ ] **Step 1: Implement the CLI**

`scripts/chat.ts`:
```ts
/** Play VC against a running worker:  npm run chat "burn multiple for Acme Robotics"
 * Env: DUEBOT_URL (default http://localhost:8787), DUEBOT_PHONE (default +15550001111) */
const url = process.env.DUEBOT_URL ?? 'http://localhost:8787'
const phone = process.env.DUEBOT_PHONE ?? '+15550001111'
const text = process.argv.slice(2).join(' ').trim()

if (!text) {
  console.error('usage: npm run chat "your message"')
  process.exit(1)
}

const envelope = {
  channel: 'text',
  from_number: phone,
  text,
  external_id: `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
}

const res = await fetch(`${url}/orchestrate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(envelope),
})

if (!res.ok) {
  console.error(`HTTP ${res.status}:`, await res.text())
  process.exit(1)
}
const body = (await res.json()) as { reply: string; conversation_id: string }
console.log(`\nDueBot> ${body.reply}\n`)
```

- [ ] **Step 2: Live smoke test (requires `.dev.vars` filled in — pause here for infra setup with the user if not done: see `docs/setup.md`)**

Terminal 1: `npm run dev`
Terminal 2, in order:
```bash
npm run chat "give me a burn multiple and runway check on Acme Robotics"
npm run chat "how does their customer concentration look?"
npm run chat "ok set up a reference call with their CFO"
npm run chat "book the first one"
curl -s http://localhost:8787/health
```
Expected: (1) numbers-first reply quoting burn multiple 2.12x and runway 11 months with the >2x flag; (2) concentration figures with the 41%/19% risk flag — resolving "their" from state; (3) 2–3 Priya Nair slots offered; (4) booked confirmation; (5) `{"ok":true,"db":true}`. Verify in Supabase Table Editor: `calendar_bookings` has one row; `messages` shows the full transcript.

- [ ] **Step 3: Commit**

```bash
git add scripts/chat.ts
git commit -m "Add local chat CLI for manual end-to-end testing"
```

---

### Task 12: Team enablement docs + agent context — push everything

**Files:**
- Create: `AGENTS.md`, `docs/contracts.md`, `docs/personas.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–11 (documents it).
- Produces: the context surface for teammates AND their coding agents. `AGENTS.md` is the single agent-context file (cross-tool standard — do NOT add tool-branded context files).

- [ ] **Step 1: Write `AGENTS.md`** — the coding-agent context file. Full content:

```markdown
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
  the response is `{ reply, conversation_id }`. Send each webhook delivery's
  ID as `external_id` — retries are safe (idempotent replay).
```

- [ ] **Step 2: Write `docs/contracts.md`** — the frozen wire contracts, exactly these four sections: (1) Channel → Orchestrator envelope JSON with field notes and the retry/idempotency rule (`external_id` dedupes; replays return the stored reply); (2) Orchestrator → Financial Agent request + response JSON (`FinancialResult` shape with `metrics`, `flags`, `benchmarks`) and the 400/404 error forms; (3) Orchestrator → Calendar Agent request + the three `status` response variants (`slots`/`booked`/`error`); (4) a "who may change what" note: field renames forbidden, additive optional fields allowed, each side's owner. Copy the JSON examples verbatim from `src/contracts/` types — the zod schemas are the source of truth.

- [ ] **Step 3: Write `docs/personas.md`** — team-facing description of the agent personas: DueBot's analyst persona (copy `SYSTEM_PROMPT` from `src/orchestrator/persona.ts` in a code block, with a note that `persona.ts` is the source of truth), what each specialist agent does and does NOT do (Financial: computes, never chats; Calendar: books, never invents slots; Orchestrator: routes and composes, never computes), and the reply-style contract (numbers-first, ≤80 words text / ≤50 voice, one flag + one next question).

- [ ] **Step 4: Rewrite `README.md`** — sections: project one-liner; architecture diagram (ASCII: channels → /orchestrate → agents → Supabase); tech stack table with the swap-path column (mirroring the design doc); quickstart (clone → `npm install` → `.dev.vars` → `npm run dev` → `npm run chat`); route reference table (`/orchestrate`, `/agents/financial`, `/agents/calendar`, `/health` with one-line descriptions); team split table (Part A/B/C ownership and entry points); links to `docs/setup.md`, `docs/contracts.md`, `docs/personas.md`, `AGENTS.md`, the design doc, and the plan.

- [ ] **Step 5: Verify docs render and everything is green**

Run: `npm test && npm run typecheck && ls AGENTS.md docs/contracts.md docs/personas.md docs/setup.md README.md`
Expected: tests pass; all five files listed.

- [ ] **Step 6: Commit and push**

```bash
git add AGENTS.md docs/ README.md
git commit -m "Add team docs: contracts, personas, setup, agent context"
git push origin main
```

---

## Plan Self-Review (completed)

- **Spec coverage:** design-doc sections → tasks: structure/config → 1; contracts → 2; data layer + migrations → 3–4; resilience helpers → 5; LLM client/persona → 6; skeleton + Sync 1 → 7; financial stub → 8; calendar → 9; tool loop + idempotency + fallback + state → 10; manual E2E + live smoke → 11; team docs/enablement → 12. Observability is spread across 5 (logger), 7 (/health), 10 (per-request logs). No gaps found.
- **Placeholder scan:** docs-authoring steps (11–12) intentionally specify content outlines rather than full prose where the source of truth is generated code (`src/contracts/`, `persona.ts`); all code steps carry complete code. No TBDs.
- **Type consistency:** verified `Deps`, `Db`, `ChatMessage`, `ToolCall`, `CalendarResult` names/signatures match across Tasks 4→7→9→10; `ScriptedLlm`/`testConfig` are exported from `test/integration/skeleton.test.ts` and imported by Tasks 8–10 tests; `MemoryDb.seedCompany` defaults match the Acme seed in Task 3 and the hand-computed expectations in Task 8.





