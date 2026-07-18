export type ContactRole = 'CFO' | 'customer_reference'

export type Conversation = {
  id: string
  phone_number: string
  channel_last_used: string | null
  last_company_id: string | null
  last_metrics_discussed: string | null
}

export type ConversationPatch = Partial<
  Pick<Conversation, 'channel_last_used' | 'last_company_id' | 'last_metrics_discussed'>
>

export type NewMessage = {
  conversation_id: string
  channel: 'voice' | 'text'
  direction: 'in' | 'out'
  content: string
  external_id?: string
}

export type Message = NewMessage & { id: string; created_at: string }

export type Company = {
  id: string
  name: string
  stage: string
  sector: string
  arr: number
  arr_growth_yoy: number
  gross_margin: number
  net_burn_monthly: number
  net_new_arr_monthly: number
  cash_on_hand: number
  cac: number
  ltv: number
  cac_payback_months: number
  cac_payback_months_prior: number
  top3_pct_arr: number
  largest_customer_pct_arr: number
  largest_customer_renewal_months: number | null
  multi_year_contracts: boolean
}

export type SlotRow = {
  id: string
  company_id: string
  contact_name: string
  contact_role: ContactRole
  slot_start: string
  slot_end: string
  is_booked: boolean
}

export interface Db {
  getOrCreateConversation(phone: string): Promise<Conversation>
  updateConversation(id: string, patch: ConversationPatch): Promise<void>
  appendMessage(m: NewMessage): Promise<void>
  findReplyByExternalId(externalId: string): Promise<string | null>
  getRecentMessages(conversationId: string, limit: number): Promise<Message[]>
  getCompanyByName(name: string): Promise<Company | null>
  getCompanyById(id: string): Promise<Company | null>
  getOpenSlots(companyId: string, role: ContactRole): Promise<SlotRow[]>
  bookSlot(slotId: string, phone: string, purpose: string): Promise<SlotRow | null>
  ping(): Promise<boolean>
}
