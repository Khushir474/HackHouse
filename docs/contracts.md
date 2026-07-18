# DueBot — Frozen Wire Contracts

These are the frozen Section 5 contracts for DueBot. The source of truth is
the zod schemas in `src/contracts/` — this document transcribes them for
humans. If this file and the code ever disagree, the code wins; fix this
file to match.

## 1. Channel → Orchestrator envelope

`POST /orchestrate`

```json
{
  "channel": "voice",
  "from_number": "+15551234567",
  "text": "what's the burn multiple for Acme Robotics?",
  "external_id": "wh_01HZX3K9Q2",
  "timestamp": "2026-07-18T14:32:00Z"
}
```

Response:

```json
{
  "reply": "Acme's burn multiple is 1.2x — healthy. One flag: customer concentration is high. Want me to check what's driving it?",
  "conversation_id": "8f2c9e10-...uuid..."
}
```

`conversation_id` is `string | null` — it is only `null` on the total-failure
fallback path (e.g. the database is unreachable), where `reply` is the
generic fallback message and there is no conversation to key off of.

If the team enables the optional shared secret (see below), send
`x-shared-secret: <value>` on every request to this Worker except
`GET /health`; without it every route returns `401 { "error": "unauthorized" }`.
The secret is off by default — only send the header once Part B confirms
`SHARED_SECRET` is set for the shared deployment.

Field notes:

| Field | Type | Notes |
|---|---|---|
| `channel` | `"voice" \| "text"` | Determines reply length (≤50 words voice / ≤80 text) — see `docs/personas.md`. |
| `from_number` | string | E.164-ish phone number (`+` optional, 7–15 digits). This is the cross-channel identity key. |
| `text` | string | Non-empty. The caller's message, already transcribed if voice. |
| `external_id` | string | Non-empty. A stable ID for this specific delivery attempt (e.g. the webhook provider's message/event ID). |
| `timestamp` | string | ISO 8601 datetime, must include a timezone offset. |

The envelope object is `.strict()` — unknown fields are rejected. A
malformed envelope returns `400 { "error": "invalid_envelope", "details": {...zod flatten...} }`.

**Retry / idempotency rule:** `external_id` dedupes deliveries. If
`/orchestrate` is called again with an `external_id` that was already
processed, the orchestrator does not re-run the LLM or re-dispatch tools —
it returns the previously stored reply for that `external_id`, with the
same `conversation_id`. This makes it safe for Part C to retry webhook
deliveries on timeout or network failure.

## 2. Orchestrator → Financial Agent

`POST /agents/financial`

Request:

```json
{
  "tool": "financial_agent",
  "company_name": "Acme Robotics",
  "requested_metrics": ["burn_multiple", "rule_of_40"]
}
```

`requested_metrics` is a non-empty array drawn from the frozen metric enum:
`burn_multiple`, `rule_of_40`, `ltv_cac`, `cac_payback`, `runway`,
`concentration`.

Response (`FinancialResult`):

```json
{
  "company_name": "Acme Robotics",
  "metrics": {
    "burn_multiple": 1.2,
    "rule_of_40": 38
  },
  "flags": ["Customer concentration is elevated"],
  "benchmarks": {
    "burn_multiple": "<1.5x good, >2x flag",
    "rule_of_40": ">=40 healthy (YoY growth % + EBITDA margin %)",
    "ltv_cac": ">3x healthy",
    "runway": "<12mo flag",
    "concentration": "top3 >30% or largest >15% is material risk"
  }
}
```

- `metrics` is a record keyed by metric name; each value is a `number`,
  `string`, or `null` (`null` when a metric can't be computed for that
  company).
- `flags` is an array of plain-language risk flags (may be empty).
- `benchmarks` is optional — when present it's a record of metric name →
  benchmark description string.

Semantics (Part A implementation notes):

- Rule of 40 = `arr_growth_yoy + ebitda_margin` (EBITDA margin, not gross
  margin — migration `0004_ebitda_margin.sql`). Gross margin stays in the
  schema but is not a Rule of 40 input.
- `flags` are scanned across ALL metrics regardless of `requested_metrics`
  (deterministic priority, CAC payback first), so planted red flags surface
  unprompted; `metrics` stays scoped to the request.
- Guarded divisions: a metric that can't be evaluated is `null`, never
  `NaN`/`Infinity`. Missing data is not flagged as bad performance (e.g.
  cash-flow positive → `runway_months: null`, no flag).
- Company matching is exact → unique prefix → unique contains
  (case/whitespace-insensitive), resolved in code over the full roster.

Error forms:

- `400 { "error": "invalid_tool_call", "details": {...zod flatten...} }` —
  request failed schema validation.
- `404 { "error": "company_not_found", "company_name": "<name>",
  "known_companies": [...] }` — no company matches; the roster is included so
  the orchestrator LLM can offer alternatives.
- `404 { "error": "company_ambiguous", "company_name": "<name>",
  "candidates": [...] }` — more than one company matches; the LLM should ask
  the VC to pick.

## 3. Orchestrator → Calendar Agent

`POST /agents/calendar`

Request:

```json
{
  "tool": "calendar_agent",
  "action": "check_availability",
  "company_name": "Acme Robotics",
  "contact_role": "CFO",
  "preferred_window": "next week"
}
```

- `action` is `"check_availability"` or `"book"`.
- `contact_role` is `"CFO"` or `"customer_reference"`.
- `preferred_window` is optional free text.
- `slot_id` (a UUID) is required for `action: "book"` — it's an additive
  optional field on the request, populated from a prior `check_availability`
  response's `slot_id`.
- The orchestrator additionally forwards `phone_number` (the caller's
  number, for booking attribution) and, for `book`, an optional `purpose`
  string. Both are additive fields on top of the frozen `CalendarCall`
  contract — the route accepts them but neither is required.

Response (`CalendarResult`) is a discriminated union on `status`:

**`slots`** — response to `check_availability`:

```json
{
  "status": "slots",
  "company_name": "Acme Robotics",
  "slots": [
    {
      "slot_id": "3f9a1e2b-...uuid...",
      "contact_name": "Jane Doe",
      "contact_role": "CFO",
      "slot_start": "2026-07-21T15:00:00Z",
      "slot_end": "2026-07-21T15:30:00Z"
    }
  ]
}
```

**`booked`** — response to a successful `book`:

```json
{
  "status": "booked",
  "company_name": "Acme Robotics",
  "purpose": "Follow-up diligence call re Acme Robotics",
  "slot": {
    "slot_id": "3f9a1e2b-...uuid...",
    "contact_name": "Jane Doe",
    "contact_role": "CFO",
    "slot_start": "2026-07-21T15:00:00Z",
    "slot_end": "2026-07-21T15:30:00Z"
  }
}
```

`email_sent` is an additive optional boolean on the `booked` variant. It is
only present when the optional cal.com booking notifier is enabled
(`CALENDAR_PROVIDER=calcom`) — in that case a successful seeded-slot booking
also best-effort creates a real cal.com booking so a real confirmation email
is sent, and `email_sent` reports whether that notification succeeded. When
the notifier is disabled (the default), the field is omitted entirely and
the response shape is unchanged.

**`error`** — company not found, slot already taken, or a `book` call
missing `slot_id`:

```json
{
  "status": "error",
  "reason": "That slot is no longer available - want me to check remaining times?"
}
```

Note the calendar agent reports domain errors (unknown company, lost race
on a slot, missing `slot_id`) as a `status: "error"` payload in the response
body (HTTP 200), not as an HTTP error status — this lets the orchestrator
hand the reason straight to the LLM to relay to the user. A malformed
request (fails schema validation) still returns HTTP
`400 { "error": "invalid_tool_call", "details": {...zod flatten...} }`.

## 4. Who may change what

- **Field renames are forbidden** on any schema in `src/contracts/`. Once
  shipped, a field name is permanent.
- **Additive optional fields are allowed** — a new optional field on a
  request or response is a non-breaking change (e.g. `slot_id` on
  `CalendarCall`, `benchmarks` on `FinancialResult`).
- **Owners:**
  - Envelope (`src/contracts/envelope.ts`) — Part B, in coordination with
    Part C (the envelope's consumer contract).
  - Financial contract (`src/contracts/financial.ts`) — Part B defines it;
    Part A's real agent must keep producing it (Part A may not change field
    names or shapes without Part B's sign-off).
  - Calendar contract (`src/contracts/calendar.ts`) — Part B owns it fully.
  - Any contract change that isn't purely additive requires agreement from
    every workstream that consumes it.
