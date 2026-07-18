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
