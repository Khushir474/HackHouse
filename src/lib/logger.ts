export function log(
  level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {},
): void {
  // One JSON line per event — readable in `wrangler tail` / Workers Logs.
  console[level](JSON.stringify({ level, event, ...fields }))
}

/** Last 4 digits only — phone numbers never appear whole in logs. */
export function redactPhone(phone: string): string {
  return `***${phone.slice(-4)}`
}
