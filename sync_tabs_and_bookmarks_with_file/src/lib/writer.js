import { payloadHash } from './hash.js'
import { checkWrite } from './guard.js'
import { updateState, readState } from './state.js'

const FILENAMES = { bookmarks: 'bookmarks.html', tabs: 'tabs.json' }
const MIME = { bookmarks: 'text/html', tabs: 'application/json' }

// A bucket name reaches the filesystem, so anything that could escape the subfolder or
// break a path is flattened.
const sanitizeBucket = (bucket) =>
  String(bucket ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default'

export function downloadPath(settings, kind) {
  return `${settings.subfolder}/${sanitizeBucket(settings.bucket)}-${FILENAMES[kind]}`
}

// Chrome MV3 service workers have no URL.createObjectURL, so the payload must travel as a
// data: URL there. Firefox runs an event page and can use a blob URL. This is the only
// place the two builds genuinely differ at runtime.
//
// Kept as a separate exported function because it is the branch Chrome is forced down and
// the one that has to survive a large bookmarks file -- feature detection alone would make
// it untestable outside a service worker.
const CHUNK = 0x8000

export function toDataUrl(text, kind) {
  const bytes = new TextEncoder().encode(text)

  // String.fromCharCode(...bytes) overflows the stack on a real bookmark collection, so
  // the bytes are converted in fixed-size chunks.
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }

  return `data:${MIME[kind]};base64,${btoa(binary)}`
}

export function buildDownloadUrl(text, kind) {
  if (typeof URL.createObjectURL === 'function') {
    return { url: URL.createObjectURL(new Blob([text], { type: MIME[kind] })), revoke: true }
  }
  return { url: toDataUrl(text, kind), revoke: false }
}

export async function writeSnapshot(api, { kind, text, count, settings, force = false }) {
  const now = Date.now()
  await updateState(api, kind, { lastAttemptAt: now })

  const state = await readState(api)
  const entry = state[kind] ?? {}
  const hash = payloadHash(text)

  if (hash === entry.lastHash && !force) {
    return { written: false, reason: 'unchanged' }
  }

  const verdict = checkWrite({ count, previousCount: entry.lastCount, force })
  if (!verdict.ok) {
    await updateState(api, kind, { lastResult: { ok: false, reason: verdict.reason }, vetoed: true })
    return { written: false, reason: verdict.reason, vetoed: true }
  }

  const { url, revoke } = buildDownloadUrl(text, kind)
  try {
    const downloadId = await api.downloads.download({
      url,
      filename: downloadPath(settings, kind),
      conflictAction: 'overwrite',
      saveAs: false,
    })

    await updateState(api, kind, {
      lastWriteAt: Date.now(),
      lastHash: hash,
      lastCount: count,
      lastResult: { ok: true, reason: null },
      vetoed: false,
      dirtySince: null,
      downloadId,
    })

    return { written: true, downloadId }
  } catch (error) {
    await updateState(api, kind, { lastResult: { ok: false, reason: String(error?.message ?? error) } })
    return { written: false, reason: String(error?.message ?? error) }
  } finally {
    if (revoke) URL.revokeObjectURL(url)
  }
}
