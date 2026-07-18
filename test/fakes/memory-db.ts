import type {
  Company, ContactRole, Conversation, ConversationPatch, Db, Message, NewMessage, SlotRow,
} from '../../src/db/types'
import { OPEN_SLOTS_LIMIT } from '../../src/db/types'

let n = 0
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

const COMPANY_DEFAULTS: Omit<Company, 'id' | 'name'> = {
  stage: 'Series B', sector: 'Industrial automation',
  arr: 12_000_000, arr_growth_yoy: 58, gross_margin: 64,
  net_burn_monthly: 700_000, net_new_arr_monthly: 330_000, cash_on_hand: 7_700_000,
  cac: 48_000, ltv: 210_000, cac_payback_months: 19, cac_payback_months_prior: 13,
  top3_pct_arr: 41, largest_customer_pct_arr: 19,
  largest_customer_renewal_months: 4, multi_year_contracts: false,
}

export class MemoryDb implements Db {
  conversations: Conversation[] = []
  messages: Message[] = []
  companies: Company[] = []
  slots: SlotRow[] = []

  seedCompany(partial: Partial<Company> & { name: string }): Company {
    const c: Company = { id: uid(), ...COMPANY_DEFAULTS, ...partial }
    this.companies.push(c)
    return c
  }

  seedSlot(partial: Partial<SlotRow> & { company_id: string; contact_role: ContactRole; contact_name: string }): SlotRow {
    const s: SlotRow = {
      id: uid(), slot_start: '2026-07-21T14:00:00Z', slot_end: '2026-07-21T14:30:00Z',
      is_booked: false, ...partial,
    }
    this.slots.push(s)
    return s
  }

  async getOrCreateConversation(phone: string): Promise<Conversation> {
    const found = this.conversations.find((c) => c.phone_number === phone)
    if (found) return found
    const c: Conversation = {
      id: uid(), phone_number: phone, channel_last_used: null,
      last_company_id: null, last_metrics_discussed: null,
    }
    this.conversations.push(c)
    return c
  }

  async updateConversation(id: string, patch: ConversationPatch): Promise<void> {
    const c = this.conversations.find((x) => x.id === id)
    if (c) Object.assign(c, patch)
  }

  async appendMessage(m: NewMessage): Promise<void> {
    if (m.external_id && this.messages.some((x) => x.external_id === m.external_id)) {
      throw new Error(`duplicate external_id: ${m.external_id}`)
    }
    this.messages.push({ ...m, id: uid(), created_at: new Date().toISOString() })
  }

  async findReplyByExternalId(externalId: string): Promise<string | null> {
    return this.messages.find((x) => x.direction === 'out' && x.external_id === `${externalId}:reply`)?.content ?? null
  }

  async getRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
    return this.messages.filter((m) => m.conversation_id === conversationId).slice(-limit)
  }

  async getCompanyByName(name: string): Promise<Company | null> {
    const q = name.toLowerCase()
    return this.companies.find((c) => c.name.toLowerCase().includes(q)) ?? null
  }

  async getCompanyById(id: string): Promise<Company | null> {
    return this.companies.find((c) => c.id === id) ?? null
  }

  async getOpenSlots(companyId: string, role: ContactRole): Promise<SlotRow[]> {
    return this.slots.filter((s) => s.company_id === companyId && s.contact_role === role && !s.is_booked).slice(0, OPEN_SLOTS_LIMIT)
  }

  async bookSlot(slotId: string, _phone: string, _purpose: string): Promise<SlotRow | null> {
    const s = this.slots.find((x) => x.id === slotId && !x.is_booked)
    if (!s) return null
    s.is_booked = true
    return s
  }

  async ping(): Promise<boolean> { return true }
}
