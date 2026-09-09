// Settings live in storage.local so they survive service worker termination.

export const DEFAULTS = {
  bucket: 'default',
  subfolder: 'dopilnik',
  tabIntervalMinutes: 15,
  syncBookmarks: true,
  syncTabs: true,
}

// downloads.download accepts filename only as a path relative to the browser's download
// directory; absolute paths, .. and ~ are rejected by the browser itself. Catching that
// here turns a silent write failure into an error message in the options page.
export function validateSubfolder(input) {
  const trimmed = String(input ?? '').trim()

  if (!trimmed) return { ok: false, error: 'Subfolder cannot be empty.' }
  if (trimmed.startsWith('/')) return { ok: false, error: 'Must be relative to the Downloads folder, not an absolute path.' }
  if (trimmed.startsWith('~')) return { ok: false, error: 'Must be relative to the Downloads folder; ~ is not supported.' }
  if (/^[A-Za-z]:/.test(trimmed)) return { ok: false, error: 'Must be relative to the Downloads folder, not a drive path.' }
  if (trimmed.includes('\\')) return { ok: false, error: 'Use / to separate folders.' }

  const segments = trimmed.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '..')) return { ok: false, error: 'Cannot point outside the Downloads folder.' }
  if (segments.length === 0) return { ok: false, error: 'Subfolder cannot be empty.' }

  return { ok: true, value: segments.join('/') }
}

export async function loadSettings(api) {
  const stored = await api.storage.local.get('settings')
  return { ...DEFAULTS, ...(stored.settings ?? {}) }
}

export async function saveSettings(api, settings) {
  await api.storage.local.set({ settings: { ...DEFAULTS, ...settings } })
}
