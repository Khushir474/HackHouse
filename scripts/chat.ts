/** Play VC against a running worker:  npm run chat "burn multiple for Acme Robotics"
 * Env: DUEBOT_URL (default http://localhost:8787), DUEBOT_PHONE (default +15550001111) */
export {}
const url = process.env.DUEBOT_URL ?? 'http://localhost:8787'
const phone = process.env.DUEBOT_PHONE ?? '+15550001111'
const text = process.argv.slice(2).join(' ').trim()

if (!text) {
  console.error('usage: npm run chat "your message"')
  process.exit(1)
}

const envelope = {
  channel: 'text',
  from_number: phone,
  text,
  external_id: `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
}

const res = await fetch(`${url}/orchestrate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(envelope),
})

if (!res.ok) {
  console.error(`HTTP ${res.status}:`, await res.text())
  process.exit(1)
}
const body = (await res.json()) as { reply: string; conversation_id: string }
console.log(`\nDueBot> ${body.reply}\n`)
