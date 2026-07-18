import { log } from '../lib/logger'

export type BookingNotification = {
  start: string // ISO slot_start from the won seeded slot
  contactName: string
  companyName: string
  purpose: string
}

export interface BookingNotifier {
  notify(req: BookingNotification): Promise<boolean>
}

export type CalcomSettings = {
  apiKey: string
  eventTypeId: number
  attendeeEmail: string
  attendeeName?: string
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** Creates a real cal.com booking so a confirmation email lands in the attendee's inbox.
 * Best-effort: any failure logs and returns false — it never blocks the core booking. */
export class CalcomNotifier implements BookingNotifier {
  constructor(
    private settings: CalcomSettings,
    private fetchImpl: FetchLike = (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
  ) {}

  async notify(req: BookingNotification): Promise<boolean> {
    try {
      const res = await this.fetchImpl('https://api.cal.com/v2/bookings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          'cal-api-version': '2024-08-13',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          start: req.start,
          eventTypeId: this.settings.eventTypeId,
          attendee: {
            name: this.settings.attendeeName ?? 'DueBot user',
            email: this.settings.attendeeEmail,
            timeZone: 'America/New_York',
            language: 'en',
          },
          metadata: { company: req.companyName, contact: req.contactName, purpose: req.purpose },
        }),
      })
      if (!res.ok) {
        log('warn', 'calcom.notify_failed', { status: res.status, body: (await res.text()).slice(0, 200) })
        return false
      }
      log('info', 'calcom.notify_sent', { company: req.companyName, start: req.start })
      return true
    } catch (e) {
      log('warn', 'calcom.notify_failed', { error: String(e) })
      return false
    }
  }
}
