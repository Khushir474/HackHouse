import type { Company } from '../db/types'
import type { Metric } from '../contracts'

// Part A metrics engine. The deterministic formulas are the source of truth;
// the LLM never computes these — this code does. Response shape is Part B's
// frozen contract: metrics keyed by their spec names, flags as plain strings.
// Semantics:
//  - Rule of 40 = arr_growth_yoy + ebitda_margin (EBITDA, not gross margin).
//  - Flags are scanned across ALL metrics regardless of which were requested,
//    in a deterministic priority order, so the planted red flag surfaces
//    unprompted (Definition of Done). `metrics` stays scoped to the request.
//  - Guarded divisions: never NaN/Infinity. Missing/invalid inputs yield null
//    without a flag — missing data is not bad performance. The exception is
//    burning cash with no positive net-new ARR, which IS a red flag.

const round2 = (x: number) => Math.round(x * 100) / 100
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

type Outcome = { entries: Record<string, number | string | null>; flag: string | null }

const compute: Record<Metric, (c: Company) => Outcome> = {
  burn_multiple(c) {
    if (!isNum(c.net_burn_monthly) || !isNum(c.net_new_arr_monthly)) {
      return { entries: { burn_multiple: null }, flag: null }
    }
    if (c.net_burn_monthly <= 0) {
      return { entries: { burn_multiple: null }, flag: null }  // cash-flow positive
    }
    if (c.net_new_arr_monthly <= 0) {
      return {
        entries: { burn_multiple: null },
        flag: 'Burning cash with no positive net-new ARR (burn multiple undefined)',
      }
    }
    const v = round2(c.net_burn_monthly / c.net_new_arr_monthly)
    return {
      entries: { burn_multiple: v },
      flag: v > 2 ? `Burn multiple ${v}x (benchmark <1.5x good, >2x flag)` : null,
    }
  },

  rule_of_40(c) {
    if (!isNum(c.arr_growth_yoy) || !isNum(c.ebitda_margin)) {
      return { entries: { rule_of_40: null }, flag: null }
    }
    const v = round2(c.arr_growth_yoy + c.ebitda_margin)
    return {
      entries: { rule_of_40: v },
      flag: v < 40 ? `Rule of 40: ${v} (growth + EBITDA margin, below the 40 threshold)` : null,
    }
  },

  ltv_cac(c) {
    if (!isNum(c.cac) || c.cac <= 0 || !isNum(c.ltv) || c.ltv <= 0) {
      return { entries: { ltv_cac: null }, flag: null }  // unavailable, not bad
    }
    const v = round2(c.ltv / c.cac)
    return {
      entries: { ltv_cac: v },
      flag: v < 3 ? `LTV:CAC ${v}x (benchmark >3x healthy)` : null,
    }
  },

  runway(c) {
    if (!isNum(c.cash_on_hand) || !isNum(c.net_burn_monthly)) {
      return { entries: { runway_months: null }, flag: null }
    }
    if (c.net_burn_monthly <= 0) {
      return { entries: { runway_months: null }, flag: null }  // cash-flow positive
    }
    if (c.cash_on_hand <= 0) {
      return { entries: { runway_months: 0 }, flag: 'No cash on hand' }
    }
    const v = Math.floor(c.cash_on_hand / c.net_burn_monthly)
    return {
      entries: { runway_months: v },
      flag: v < 12 ? `Runway ${v} months (<12mo flag)` : null,
    }
  },

  cac_payback(c) {
    if (!isNum(c.cac_payback_months) || c.cac_payback_months <= 0) {
      return { entries: { cac_payback_months: null, cac_payback_months_prior: null }, flag: null }
    }
    const entries: Record<string, number | null> = {
      cac_payback_months: c.cac_payback_months,
      cac_payback_months_prior: isNum(c.cac_payback_months_prior) ? c.cac_payback_months_prior : null,
    }
    let flag: string | null = null
    if (isNum(c.cac_payback_months_prior) && c.cac_payback_months > c.cac_payback_months_prior) {
      flag = `CAC payback stretched to ${c.cac_payback_months}mo (was ${c.cac_payback_months_prior}mo)`
    } else if (c.cac_payback_months > 18) {
      flag = `CAC payback ${c.cac_payback_months}mo (>18mo flag)`
    }
    return { entries, flag }
  },

  concentration(c) {
    if (!isNum(c.top3_pct_arr) || !isNum(c.largest_customer_pct_arr)) {
      return { entries: { top3_pct_arr: null, largest_customer_pct_arr: null }, flag: null }
    }
    const entries = {
      top3_pct_arr: c.top3_pct_arr,
      largest_customer_pct_arr: c.largest_customer_pct_arr,
    }
    const flagged = c.top3_pct_arr > 30 || c.largest_customer_pct_arr > 15
    return {
      entries,
      flag: flagged
        ? `Top 3 customers ${c.top3_pct_arr}% of ARR, largest ${c.largest_customer_pct_arr}% - material concentration risk at ${c.stage}`
        : null,
    }
  },
}

// Deterministic flag priority: the demo's planted red flag (CAC payback) leads.
const FLAG_PRIORITY: Metric[] = [
  'cac_payback', 'concentration', 'burn_multiple', 'runway', 'rule_of_40', 'ltv_cac',
]

export function computeMetrics(
  company: Company, requested: Metric[],
): { metrics: Record<string, number | string | null>; flags: string[] } {
  const metrics: Record<string, number | string | null> = {}
  for (const m of requested) Object.assign(metrics, compute[m](company).entries)

  const flags: string[] = []
  for (const m of FLAG_PRIORITY) {
    const flag = compute[m](company).flag
    if (flag) flags.push(flag)
  }
  return { metrics, flags }
}
