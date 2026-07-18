// Sanity checks on a company row (seed-time / route-time).
// Units convention: percentage fields are percentage points (82 = 82%).
import type { Company } from '../db/types'

export interface ValidationIssue {
  level: 'error' | 'warning'
  field: string
  message: string
}

// [lower, upper] sensible bounds in percentage points.
const PCT_BOUNDS: Partial<Record<keyof Company, [number, number]>> = {
  arr_growth_yoy: [-100, 1000],
  gross_margin: [-100, 100],
  ebitda_margin: [-400, 100],
  top3_pct_arr: [0, 100],
  largest_customer_pct_arr: [0, 100],
}

export function validateCompany(
  company: Company,
  opts: { allowEdgeCases?: boolean } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const push = (level: ValidationIssue['level'], field: string, message: string) =>
    issues.push({ level, field, message })

  for (const [field, v] of Object.entries(company)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      push('error', field, `${field} is NaN or infinite.`)
    }
  }

  for (const [field, bounds] of Object.entries(PCT_BOUNDS) as [keyof Company, [number, number]][]) {
    const v = company[field]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const [lo, hi] = bounds
    if (v < lo || v > hi) {
      push('error', field, `${field}=${v} is outside sensible percentage-point bounds [${lo}, ${hi}].`)
    } else if (v > 0 && v < 1) {
      // A value like 0.5 percentage points can be legitimate, so warn, don't reject.
      push('warning', field, `${field}=${v} looks like a decimal fraction; convention is percentage points (82 = 82%).`)
    }
  }

  const { top3_pct_arr: top3, largest_customer_pct_arr: largest } = company
  if (Number.isFinite(top3) && Number.isFinite(largest) && largest > top3) {
    push('error', 'largest_customer_pct_arr', `largest_customer_pct_arr (${largest}) exceeds top3_pct_arr (${top3}).`)
  }

  if (typeof company.cac === 'number' && Number.isFinite(company.cac) && company.cac <= 0) {
    push('warning', 'cac', 'cac is non-positive; LTV:CAC will be reported as null.')
  }

  if (typeof company.cash_on_hand === 'number' && Number.isFinite(company.cash_on_hand) && company.cash_on_hand < 0) {
    push(
      opts.allowEdgeCases ? 'warning' : 'error',
      'cash_on_hand',
      'cash_on_hand is negative; only allowed when intentionally testing an edge case.',
    )
  }

  return issues
}
