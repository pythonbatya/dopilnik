// Change detection only -- not security. Every write costs a visible download in the
// browser UI, so a snapshot identical to the last one must not be written at all.

// savedAt is stamped fresh on every snapshot, so hashing it would make every snapshot
// differ from the previous one and produce a download every interval forever.
const IGNORED_KEYS = new Set(['savedAt'])

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.keys(value)
    .filter((key) => !IGNORED_KEYS.has(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)

  return `{${entries.join(',')}}`
}

export function payloadHash(payload) {
  const text = typeof payload === 'string' ? payload : stableStringify(payload)

  // FNV-1a, 32 bit.
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}
