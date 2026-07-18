import { Hono } from 'hono'
import type { Deps } from '../app'
import { FinancialCallSchema, type FinancialResult } from '../contracts'
import { log } from '../lib/logger'
import { resolveCompany } from './matching'
import { computeMetrics } from './metrics'
import { validateCompany } from './validate'

/** Part A financial agent. Request contract and response shape are Part B's
 * frozen Section 5 contract; error statuses stay 400/404 (extra fields on the
 * 404 bodies are additive, for the orchestrator LLM to recover with). */
export function financialRoutes(deps: Deps): Hono {
  const app = new Hono()

  app.post('/', async (c) => {
    const parsed = FinancialCallSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid_tool_call', details: parsed.error.flatten() }, 400)
    }

    const roster = await deps.db.listCompanies()
    const match = resolveCompany(parsed.data.company_name, roster)
    if (match.status === 'not_found') {
      return c.json({
        error: 'company_not_found', company_name: parsed.data.company_name,
        known_companies: roster.map((r) => r.name),
      }, 404)
    }
    if (match.status === 'ambiguous') {
      return c.json({
        error: 'company_ambiguous', company_name: parsed.data.company_name,
        candidates: match.candidates,
      }, 404)
    }
    const company = match.company

    for (const issue of validateCompany(company)) {
      if (issue.level === 'error') {
        log('warn', 'financial.company_data_invalid', { company: company.name, message: issue.message })
      }
    }

    const { metrics, flags } = computeMetrics(company, parsed.data.requested_metrics)
    const result: FinancialResult = {
      company_name: company.name, metrics, flags,
      benchmarks: {
        burn_multiple: '<1.5x good, >2x flag',
        rule_of_40: '>=40 healthy (YoY growth % + EBITDA margin %)',
        ltv_cac: '>3x healthy', runway: '<12mo flag',
        concentration: 'top3 >30% or largest >15% is material risk',
      },
    }
    return c.json(result)
  })

  return app
}
