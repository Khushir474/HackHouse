// Deterministic company matching: exact → unique prefix → unique contains.
// The roster is tiny, so we fetch it whole and match in TypeScript instead of
// relying on SQL ILIKE + limit(1), which silently picks an arbitrary row when
// several match.

export type MatchResult<T extends { name: string }> =
  | { status: 'found'; company: T }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: string[] }

const norm = (s: string) => s.toLowerCase().trim()

export function resolveCompany<T extends { name: string }>(
  query: string,
  roster: T[],
): MatchResult<T> {
  const q = norm(query ?? '')
  if (!q) return { status: 'not_found' }

  for (const matcher of [
    (name: string) => name === q,
    (name: string) => name.startsWith(q),
    (name: string) => name.includes(q),
  ]) {
    const hits = roster.filter((r) => matcher(norm(r.name)))
    if (hits.length === 1) return { status: 'found', company: hits[0]! }
    if (hits.length > 1) return { status: 'ambiguous', candidates: hits.map((r) => r.name) }
  }
  return { status: 'not_found' }
}
