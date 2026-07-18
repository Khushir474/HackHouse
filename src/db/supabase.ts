import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from '../config'
import type {
  Company, ContactRole, Conversation, ConversationPatch, Db, Message, NewMessage, SlotRow,
} from './types'
import { OPEN_SLOTS_LIMIT } from './types'

const NUMERIC_COMPANY_FIELDS = [
  'arr', 'arr_growth_yoy', 'gross_margin', 'ebitda_margin', 'net_burn_monthly', 'net_new_arr_monthly',
  'cash_on_hand', 'cac', 'ltv', 'cac_payback_months', 'cac_payback_months_prior',
  'top3_pct_arr', 'largest_customer_pct_arr', 'largest_customer_renewal_months',
] as const

function toCompany(row: Record<string, unknown>): Company {
  const out = { ...row } as Record<string, unknown>
  for (const f of NUMERIC_COMPANY_FIELDS) {
    if (out[f] !== null && out[f] !== undefined) out[f] = Number(out[f])
  }
  return out as unknown as Company
}

export class SupabaseDb implements Db {
  private client: SupabaseClient

  constructor(cfg: AppConfig) {
    this.client = createClient(cfg.databaseUrl, cfg.databaseServiceKey, {
      auth: { persistSession: false },
    })
  }

  async getOrCreateConversation(phone: string): Promise<Conversation> {
    const { data, error } = await this.client
      .from('conversations')
      .upsert({ phone_number: phone }, { onConflict: 'phone_number', ignoreDuplicates: false })
      .select()
      .single()
    if (error) throw new Error(`conversations upsert: ${error.message}`)
    return data as Conversation
  }

  async updateConversation(id: string, patch: ConversationPatch): Promise<void> {
    const { error } = await this.client
      .from('conversations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error(`conversations update: ${error.message}`)
  }

  async appendMessage(m: NewMessage): Promise<void> {
    const { error } = await this.client.from('messages').insert(m)
    if (error) throw new Error(`messages insert: ${error.message}`)
  }

  async findReplyByExternalId(externalId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('messages')
      .select('content')
      .eq('external_id', `${externalId}:reply`)
      .eq('direction', 'out')
      .maybeSingle()
    if (error) throw new Error(`messages lookup: ${error.message}`)
    return data?.content ?? null
  }

  async getRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(`messages select: ${error.message}`)
    return (data as Message[]).reverse()
  }

  async getCompanyByName(name: string): Promise<Company | null> {
    const { data, error } = await this.client
      .from('companies')
      .select('*')
      .ilike('name', `%${name}%`)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`companies select: ${error.message}`)
    return data ? toCompany(data as Record<string, unknown>) : null
  }

  async getCompanyById(id: string): Promise<Company | null> {
    const { data, error } = await this.client
      .from('companies').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(`companies select: ${error.message}`)
    return data ? toCompany(data as Record<string, unknown>) : null
  }

  async listCompanies(): Promise<Company[]> {
    const { data, error } = await this.client.from('companies').select('*')
    if (error) throw new Error(`companies select: ${error.message}`)
    return (data as Record<string, unknown>[]).map(toCompany)
  }

  async getOpenSlots(companyId: string, role: ContactRole): Promise<SlotRow[]> {
    const { data, error } = await this.client
      .from('calendar_slots')
      .select('*')
      .eq('company_id', companyId)
      .eq('contact_role', role)
      .eq('is_booked', false)
      .order('slot_start', { ascending: true })
      .limit(OPEN_SLOTS_LIMIT)
    if (error) throw new Error(`calendar_slots select: ${error.message}`)
    return data as SlotRow[]
  }

  async bookSlot(slotId: string, phone: string, purpose: string): Promise<SlotRow | null> {
    const { data, error } = await this.client
      .rpc('book_slot', { p_slot_id: slotId, p_phone: phone, p_purpose: purpose })
    if (error) throw new Error(`book_slot rpc: ${error.message}`)
    const rows = data as SlotRow[] | null
    return rows && rows.length > 0 ? rows[0]! : null
  }

  async ping(): Promise<boolean> {
    const { error } = await this.client.from('companies').select('id').limit(1)
    return !error
  }
}
