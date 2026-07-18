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
