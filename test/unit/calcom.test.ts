import { describe, expect, it, vi } from 'vitest'
import { CalcomNotifier } from '../../src/calendar/calcom'

const settings = {
  apiKey: 'cal-key', eventTypeId: 123, attendeeEmail: 'someone@example.com',
}

const req = {
  start: '2026-07-21T15:00:00Z',
  contactName: 'Jane Doe',
  companyName: 'Acme Robotics',
  purpose: 'Follow-up diligence call re Acme Robotics',
}

describe('CalcomNotifier', () => {
  it('POSTs a booking to cal.com and returns true on success', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const notifier = new CalcomNotifier(settings, fetchSpy)
    const result = await notifier.notify(req)
    expect(result).toBe(true)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://api.cal.com/v2/bookings')
    expect(init.headers.Authorization).toBe('Bearer cal-key')
    expect(init.headers['cal-api-version']).toBe('2024-08-13')
    const body = JSON.parse(init.body)
    expect(body.start).toBe(req.start)
    expect(body.eventTypeId).toBe(123)
    expect(body.attendee.email).toBe('someone@example.com')
  })

  it('returns false without throwing on a non-OK response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }))
    const notifier = new CalcomNotifier(settings, fetchSpy)
    const result = await notifier.notify(req)
    expect(result).toBe(false)
  })

  it('returns false without throwing when fetch throws', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'))
    const notifier = new CalcomNotifier(settings, fetchSpy)
    const result = await notifier.notify(req)
    expect(result).toBe(false)
  })
})
