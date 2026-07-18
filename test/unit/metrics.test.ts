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
