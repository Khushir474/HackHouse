import { describe, expect, it } from 'vitest'
import { resolveCompany } from '../../src/agents/matching'

const roster = [
  { name: 'Acme Robotics' },
  { name: 'Nimbus Analytics' },
  { name: 'Voltway' },
]

describe('resolveCompany', () => {
  it('exact match, case- and whitespace-insensitive', () => {
    const r = resolveCompany('  ACME robotics ', roster)
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.company.name).toBe('Acme Robotics')
  })

  it('exact match beats contains match', () => {
    const tricky = [{ name: 'Acme' }, { name: 'Acme Robotics' }]
    const r = resolveCompany('acme', tricky)
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.company.name).toBe('Acme')
  })

  it('unique prefix match ("acme" → Acme Robotics)', () => {
    const r = resolveCompany('acme', roster)
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.company.name).toBe('Acme Robotics')
  })

  it('unique contains match ("way" → Voltway)', () => {
    const r = resolveCompany('way', roster)
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.company.name).toBe('Voltway')
  })

  it('unique prefix beats multiple contains ("a" → Acme Robotics, not ambiguous)', () => {
    const r = resolveCompany('a', roster)  // all three contain "a", only one starts with it
    expect(r.status).toBe('found')
    if (r.status === 'found') expect(r.company.name).toBe('Acme Robotics')
  })

  it('multiple matches at the same tier → ambiguous with candidates', () => {
    const r = resolveCompany('ti', roster)  // roboTIcs, analyTIcs; no prefix hits
    expect(r.status).toBe('ambiguous')
    if (r.status === 'ambiguous') expect(r.candidates).toEqual(['Acme Robotics', 'Nimbus Analytics'])
  })

  it('zero matches → not_found', () => {
    expect(resolveCompany('Globex', roster).status).toBe('not_found')
  })

  it('empty query → not_found', () => {
    expect(resolveCompany('   ', roster).status).toBe('not_found')
  })
})
