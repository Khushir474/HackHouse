import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryDb } from '../fakes/memory-db'
import { OPEN_SLOTS_LIMIT } from '../../src/db/types'

describe('MemoryDb (reference behavior for the Db port)', () => {
  let db: MemoryDb
  beforeEach(() => {
    db = new MemoryDb()
    db.seedCompany({ name: 'Acme Robotics' })
  })

  it('getOrCreateConversation is idempotent per phone', async () => {
    const a = await db.getOrCreateConversation('+15551234567')
    const b = await db.getOrCreateConversation('+15551234567')
    expect(a.id).toBe(b.id)
  })

  it('stores and retrieves the reply by external_id convention', async () => {
    const c = await db.getOrCreateConversation('+15551234567')
    await db.appendMessage({ conversation_id: c.id, channel: 'text', direction: 'in', content: 'hi', external_id: 'msg_1' })
    await db.appendMessage({ conversation_id: c.id, channel: 'text', direction: 'out', content: 'hello!', external_id: 'msg_1:reply' })
    expect(await db.findReplyByExternalId('msg_1')).toBe('hello!')
    expect(await db.findReplyByExternalId('msg_2')).toBeNull()
  })

  it('does not return an inbound message crafted with a reply-shaped external_id', async () => {
    const c = await db.getOrCreateConversation('+15551234567')
    await db.appendMessage({
      conversation_id: c.id, channel: 'text', direction: 'in',
      content: 'spoofed reply', external_id: 'msg_9:reply',
    })
    expect(await db.findReplyByExternalId('msg_9')).toBeNull()
  })

  it('fuzzy-matches company names case-insensitively on substring', async () => {
    expect((await db.getCompanyByName('acme'))?.name).toBe('Acme Robotics')
    expect(await db.getCompanyByName('globex')).toBeNull()
  })

  it('bookSlot wins once and only once', async () => {
    const co = (await db.getCompanyByName('Acme'))!
    const slot = db.seedSlot({ company_id: co.id, contact_role: 'CFO', contact_name: 'Priya Nair' })
    expect(await db.bookSlot(slot.id, '+1555', 'diligence call')).not.toBeNull()
    expect(await db.bookSlot(slot.id, '+1666', 'second try')).toBeNull()
  })

  it('getOpenSlots excludes booked slots and other roles', async () => {
    const co = (await db.getCompanyByName('Acme'))!
    const s1 = db.seedSlot({ company_id: co.id, contact_role: 'CFO', contact_name: 'Priya Nair' })
    db.seedSlot({ company_id: co.id, contact_role: 'customer_reference', contact_name: 'Jordan Malik' })
    await db.bookSlot(s1.id, '+1555', 'x')
    expect(await db.getOpenSlots(co.id, 'CFO')).toHaveLength(0)
  })

  it('getOpenSlots caps results at OPEN_SLOTS_LIMIT', async () => {
    const co = (await db.getCompanyByName('Acme'))!
    for (let i = 0; i < 10; i++) {
      db.seedSlot({ company_id: co.id, contact_role: 'CFO', contact_name: 'Priya Nair' })
    }
    expect(await db.getOpenSlots(co.id, 'CFO')).toHaveLength(OPEN_SLOTS_LIMIT)
  })
})
