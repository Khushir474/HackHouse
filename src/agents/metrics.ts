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
