// Heartbeat. Nothing here lives in service worker memory: the worker is terminated
// constantly by design, so every fact the UI needs is written to storage.local.

const STALE_INTERVALS = 2
const BOOKMARK_FLUSH_GRACE_MS = 5 * 60_000

export function stalenessOf(kind, entry = {}, { intervalMinutes, now }) {
  if (entry.lastResult && entry.lastResult.ok === false) {
    return { stale: true, reason: `Last write failed: ${entry.lastResult.reason}` }
  }

  if (kind === 'bookmarks') {
    // Bookmarks are written on change, so age alone means nothing -- a quiet month is
    // normal. What does mean something is a change that was noticed and never written.
    if (entry.dirtySince && now - entry.dirtySince > BOOKMARK_FLUSH_GRACE_MS) {
      return { stale: true, reason: 'Bookmark changes are pending but were never written.' }
    }
    return { stale: false, reason: null }
  }

  if (!entry.lastWriteAt) return { stale: true, reason: 'Never written.' }

  const ageMs = now - entry.lastWriteAt
  if (ageMs > STALE_INTERVALS * intervalMinutes * 60_000) {
    return { stale: true, reason: `Last written ${Math.round(ageMs / 60_000)} min ago.` }
  }

  return { stale: false, reason: null }
}

export async function readState(api) {
  const stored = await api.storage.local.get('state')
  return stored.state ?? {}
}

export async function updateState(api, kind, patch) {
  const state = await readState(api)
  const next = { ...state, [kind]: { ...(state[kind] ?? {}), ...patch } }
  await api.storage.local.set({ state: next })
  return next
}
