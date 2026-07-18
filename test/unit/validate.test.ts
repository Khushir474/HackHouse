import { describe, expect, it } from 'vitest'
import { validateCompany, type ValidationIssue } from '../../src/agents/validate'
import { MemoryDb } from '../fakes/memory-db'

const acme = new MemoryDb().seedCompany({ name: 'Acme Robotics' })

const errors = (issues: ValidationIssue[]) => issues.filter((i) => i.level === 'error')
const warnings = (issues: ValidationIssue[]) => issues.filter((i) => i.level === 'warning')

describe('validateCompany', () => {
  it('the default (seed-mirroring) company has zero errors', () => {
    expect(errors(validateCompany(acme))).toEqual([])
  })

  it('largest customer % cannot exceed top-3 %', () => {
    const issues = validateCompany({ ...acme, top3_pct_arr: 41, largest_customer_pct_arr: 50 })
    expect(errors(issues).some((i) => i.field === 'largest_customer_pct_arr')).toBe(true)
  })

  it('concentration percentages must be within [0, 100]', () => {
    const issues = validateCompany({ ...acme, top3_pct_arr: 120 })
    expect(errors(issues).some((i) => i.field === 'top3_pct_arr')).toBe(true)
  })

  it('values between 0 and 1 warn (probable decimal) but do not error', () => {
    const issues = validateCompany({ ...acme, arr_growth_yoy: 0.5 })
    expect(errors(issues).some((i) => i.field === 'arr_growth_yoy')).toBe(false)
    expect(warnings(issues).some((i) => i.field === 'arr_growth_yoy')).toBe(true)
  })

  it('non-positive CAC warns (metric layer reports it unavailable)', () => {
    const issues = validateCompany({ ...acme, cac: 0 })
    expect(warnings(issues).some((i) => i.field === 'cac')).toBe(true)
  })

  it('negative cash errors by default, warns when edge cases are intentional', () => {
    const bad = { ...acme, cash_on_hand: -100_000 }
    expect(errors(validateCompany(bad)).some((i) => i.field === 'cash_on_hand')).toBe(true)
    const relaxed = validateCompany(bad, { allowEdgeCases: true })
    expect(errors(relaxed).some((i) => i.field === 'cash_on_hand')).toBe(false)
    expect(warnings(relaxed).some((i) => i.field === 'cash_on_hand')).toBe(true)
  })

  it('NaN/Infinity in any numeric field is an error', () => {
    const issues = validateCompany({ ...acme, arr: Number.NaN })
    expect(errors(issues).some((i) => i.field === 'arr')).toBe(true)
  })
})
