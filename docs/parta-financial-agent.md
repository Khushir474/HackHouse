# Part A — Financial Agent: integration notes

Part A's engine now lives inside the team structure, replacing the
`computeMetrics` stub internals as the stub invited, while keeping Part B's
frozen wire contract (request schema, `FinancialResult` shape, 400/404 error
statuses). The deterministic formulas are the source of truth; the Acme seed
row is frozen to reproduce the approved demo outputs (burn 2.12x,
Rule of 40 = 34, runway 11mo, CAC payback 19mo from 13mo, top-3 41%).

## What changed vs. the stub

| Area | Change |
|---|---|
| Rule of 40 | `arr_growth_yoy + ebitda_margin` (was gross margin, which made Acme score 122 and contradicted the spec demo's "34"). Migration `0004_ebitda_margin.sql` adds and backfills the column; gross margin stays for other uses. |
| Flags | Scanned across ALL metrics regardless of `requested_metrics`, deterministic priority (cac_payback, concentration, burn_multiple, runway, rule_of_40, ltv_cac) — the planted red flag surfaces unprompted (Definition of Done). `metrics` stays scoped to the request. |
| Guards | No division ever emits NaN/Infinity. `net_new_arr ≤ 0` → burn multiple null + flag ("burning cash with no positive net-new ARR"); `net_burn ≤ 0` → runway null, NO flag (cash-flow positive); `cac ≤ 0` → ltv_cac null, NO flag (missing data ≠ bad performance). CAC payback also flags on >18mo even without a prior-period worsening. |
| Matching | `src/agents/matching.ts`: exact → unique prefix → unique contains over the full roster (new `Db.listCompanies()`), replacing `ilike %q% limit 1` which silently picked an arbitrary row on multiple hits. 404 bodies now carry `known_companies` (not found) or `candidates` (ambiguous) for the LLM to recover with. |
| Validation | `src/agents/validate.ts`: bounds/consistency checks (largest ≤ top3 ≤ 100, percentage-point convention, negative cash, NaN). Route logs errors; fixtures must validate clean (unit-tested). |

## Units convention

All percentage fields are percentage points (82 = 82%), never decimal
fractions. Values in (0, 1) trigger a validation warning as probable decimals.

## Deliberately NOT ported (would change Part B's frozen contract — Sync 2 topics)

- Rich per-metric shape (verdicts `good/warn/flag/unavailable`, machine
  benchmarks, calculation provenance, metadata) — the flat
  `metrics`/`flags`/`benchmarks` shape stays.
- `cohort_retention` as a seventh metric (needs a `MetricSchema` enum change).
- Full-snapshot semantics for omitted `requested_metrics` (schema requires
  min 1) and HTTP-200 structured tool errors.
- Part A's standalone 5-company seed — the team's 3-company seed
  (`0003_seed.sql`) is canonical; its Acme numbers are the frozen demo values.

See `docs/financial-tone.md` for the reply-tone handoff to the orchestrator
persona.
