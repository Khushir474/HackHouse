import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { MemoryDb } from '../fakes/memory-db'
import { ScriptedLlm, testConfig } from '../helpers'
import { FinancialResultSchema } from '../../src/contracts'

function appWithAcme() {
  const db = new MemoryDb()
  db.seedCompany({ name: 'Acme Robotics' })
  return createApp({ db, llm: new ScriptedLlm([]), config: testConfig })
}

describe('POST /agents/financial', () => {
  it('returns contract-valid metrics for a seeded company', async () => {
    const res = await appWithAcme().request('/agents/financial', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: 'financial_agent', company_name: 'acme',
        requested_metrics: ['burn_multiple', 'rule_of_40', 'runway'],
      }),
    })
    expect(res.status).toBe(200)
    const body = FinancialResultSchema.parse(await res.json())
    expect(body.company_name).toBe('Acme Robotics')
    expect(body.metrics.burn_multiple).toBe(2.12)
  })

  it('404s an unknown company', async () => {
    const res = await appWithAcme().request('/agents/financial', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: 'financial_agent', company_name: 'Globex', requested_metrics: ['runway'],
      }),
    })
    expect(res.status).toBe(404)
  })

  it('400s a contract violation', async () => {
    const res = await appWithAcme().request('/agents/financial', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'financial_agent', company_name: 'Acme', requested_metrics: ['ebitda'] }),
    })
    expect(res.status).toBe(400)
  })
})
