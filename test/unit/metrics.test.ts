import { describe, expect, it } from 'vitest'
import { computeMetrics } from '../../src/agents/metrics'
import { MemoryDb } from '../fakes/memory-db'

// The deterministic formulas are the source of truth; the Acme fixture is
// frozen to reproduce the approved demo outputs.
// Acme seed: burn 700k, net-new ARR 330k/mo, growth 58, ebitda -24 (gross 64),
// ltv 210k, cac 48k, cash 7.7M, payback 19 (prior 13), top3 41%, largest 19%.
const acme = new MemoryDb().seedCompany({ name: 'Acme Robotics' })

describe('computeMetrics', () => {
  it('burn_multiple = net_burn / net_new_arr, rounded to 2dp', () => {
    const { metrics } = computeMetrics(acme, ['burn_multiple'])
    expect(metrics.burn_multiple).toBe(2.12)  // 700000/330000
  })

  it('rule_of_40 = growth + EBITDA margin (not gross margin)', () => {
    const { metrics } = computeMetrics(acme, ['rule_of_40'])
    expect(metrics.rule_of_40).toBe(34)  // 58 + (-24)
    expect(metrics.rule_of_40).not.toBe(122)  // the old gross-margin result
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
      arr_growth_yoy: 96, gross_margin: 78, ebitda_margin: -8, cash_on_hand: 6_100_000,
      cac_payback_months: 9, cac_payback_months_prior: 10,
      top3_pct_arr: 22, largest_customer_pct_arr: 9, ltv: 96_000, cac: 21_000,
    })
    const { flags } = computeMetrics(nimbus, ['burn_multiple', 'rule_of_40', 'runway', 'concentration', 'cac_payback', 'ltv_cac'])
    expect(flags).toEqual([])
  })

  it('flags scan ALL metrics even when only one is requested (unprompted red flag)', () => {
    const { metrics, flags } = computeMetrics(acme, ['ltv_cac'])
    expect(Object.keys(metrics)).toEqual(['ltv_cac'])  // metrics stay scoped to the request
    expect(flags.some((f) => f.includes('CAC payback'))).toBe(true)
    expect(flags.some((f) => f.includes('Top 3'))).toBe(true)
  })

  it('CAC payback flag leads the flag list (deterministic priority)', () => {
    const { flags } = computeMetrics(acme, ['burn_multiple'])
    expect(flags[0]).toContain('CAC payback')
  })

  describe('guarded divisions and missing data', () => {
    it('net_new_arr <= 0 → burn_multiple null + flag', () => {
      const c = new MemoryDb().seedCompany({ name: 'Sinking', net_new_arr_monthly: 0 })
      const { metrics, flags } = computeMetrics(c, ['burn_multiple'])
      expect(metrics.burn_multiple).toBeNull()
      expect(flags.some((f) => f.includes('net-new ARR'))).toBe(true)
    })

    it('net_burn <= 0 → runway null, no flag (cash-flow positive is not bad)', () => {
      const c = new MemoryDb().seedCompany({
        name: 'Profitable', net_burn_monthly: -50_000,
        cac_payback_months: 9, cac_payback_months_prior: 10,
        top3_pct_arr: 20, largest_customer_pct_arr: 10, ebitda_margin: 10,
      })
      const { metrics, flags } = computeMetrics(c, ['runway', 'burn_multiple'])
      expect(metrics.runway_months).toBeNull()
      expect(metrics.burn_multiple).toBeNull()
      expect(flags).toEqual([])
    })

    it('cac <= 0 → ltv_cac null, no flag (missing data is not bad performance)', () => {
      const c = new MemoryDb().seedCompany({
        name: 'NoCac', cac: 0,
        net_burn_monthly: 100_000, net_new_arr_monthly: 200_000,
        cac_payback_months: 9, cac_payback_months_prior: 10,
        top3_pct_arr: 20, largest_customer_pct_arr: 10, ebitda_margin: 10,
      })
      const { metrics, flags } = computeMetrics(c, ['ltv_cac'])
      expect(metrics.ltv_cac).toBeNull()
      expect(flags).toEqual([])
    })

    it('never emits NaN or Infinity', () => {
      const c = new MemoryDb().seedCompany({
        name: 'Broken', net_new_arr_monthly: 0, cac: 0, net_burn_monthly: 0,
      })
      const { metrics } = computeMetrics(c, ['burn_multiple', 'rule_of_40', 'ltv_cac', 'runway', 'cac_payback', 'concentration'])
      for (const [k, v] of Object.entries(metrics)) {
        if (typeof v === 'number') expect(Number.isFinite(v), `${k} must be finite`).toBe(true)
      }
    })
  })
})
