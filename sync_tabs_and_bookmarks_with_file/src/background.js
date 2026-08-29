import { api, browserKind } from './lib/api.js'
import { loadSettings } from './lib/config.js'
import { readState, updateState, stalenessOf } from './lib/state.js'
import { writeSnapshot } from './lib/writer.js'
import { collectBookmarks, countBookmarks } from './lib/bookmarks/collect.js'
import { toNetscapeHtml } from './lib/bookmarks/html.js'
import { collectTabs, countTabs } from './lib/tabs/collect.js'

const BOOKMARK_FLUSH_ALARM = 'bm-flush'
const TABS_ALARM = 'tabs-snapshot'
const BOOKMARK_DEBOUNCE_MINUTES = 0.5

async function syncBookmarks({ force = false } = {}) {
  const settings = await loadSettings(api)
  if (!settings.syncBookmarks && !force) return { written: false, reason: 'disabled' }

  const tree = await collectBookmarks(api)
  return writeSnapshot(api, {
    kind: 'bookmarks',
    text: toNetscapeHtml(tree),
    count: countBookmarks(tree),
    settings,
    force,
  })
}

async function syncTabs({ force = false } = {}) {
  const settings = await loadSettings(api)
  if (!settings.syncTabs && !force) return { written: false, reason: 'disabled' }

  const snapshot = await collectTabs(api, { bucket: settings.bucket, browser: browserKind })
  return writeSnapshot(api, {
    kind: 'tabs',
    text: JSON.stringify(snapshot, null, 2),
    count: countTabs(snapshot),
    settings,
    force,
  })
}

// Alarms have been observed to go missing in Chrome, and a lost alarm means silent death
// for the whole feature. Re-assert them on every wake rather than trusting creation once.
async function ensureAlarms() {
  const settings = await loadSettings(api)

  if (settings.syncTabs && !(await api.alarms.get(TABS_ALARM))) {
    api.alarms.create(TABS_ALARM, { periodInMinutes: settings.tabIntervalMinutes })
  }
  if (!settings.syncTabs) {
    await api.alarms.clear(TABS_ALARM)
  }
}

async function refreshBadge() {
  const settings = await loadSettings(api)
  const state = await readState(api)
  const now = Date.now()

  const stale = ['bookmarks', 'tabs'].some(
    (kind) => stalenessOf(kind, state[kind], { intervalMinutes: settings.tabIntervalMinutes, now }).stale,
  )

  await api.action.setBadgeText({ text: stale ? '!' : '' })
  if (stale) await api.action.setBadgeBackgroundColor({ color: '#c0392b' })
}

// A plain setTimeout debounce would die with the service worker, which Chrome terminates
// after ~30s idle. An alarm survives that; 30s is also the shortest delay Chrome allows.
function scheduleBookmarkFlush() {
  api.alarms.create(BOOKMARK_FLUSH_ALARM, { delayInMinutes: BOOKMARK_DEBOUNCE_MINUTES })
}

async function onBookmarkChanged() {
  const state = await readState(api)
  if (!state.bookmarks?.dirtySince) {
    await updateState(api, 'bookmarks', { dirtySince: Date.now() })
  }
  scheduleBookmarkFlush()
}

for (const event of ['onCreated', 'onChanged', 'onRemoved', 'onMoved', 'onChildrenReordered']) {
  api.bookmarks[event]?.addListener(() => {
    onBookmarkChanged().catch(() => {})
  })
}

api.alarms.onAlarm.addListener((alarm) => {
  const run = async () => {
    if (alarm.name === BOOKMARK_FLUSH_ALARM) await syncBookmarks()
    if (alarm.name === TABS_ALARM) await syncTabs()
    await ensureAlarms()
    await refreshBadge()
  }
  run().catch(() => {})
})

// A download that starts fine can still be interrupted; without this the failure would
// never be recorded anywhere.
api.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current !== 'interrupted') return

  const run = async () => {
    const state = await readState(api)
    for (const kind of ['bookmarks', 'tabs']) {
      if (state[kind]?.downloadId === delta.id) {
        await updateState(api, kind, {
          lastResult: { ok: false, reason: delta.error?.current ?? 'download interrupted' },
        })
      }
    }
    await refreshBadge()
  }
  run().catch(() => {})
})

// Keep the download history clean; erase removes the history row, not the file.
api.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === 'complete') api.downloads.erase({ id: delta.id }).catch(() => {})
})

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    if (message.type === 'sync') {
      return message.kind === 'bookmarks'
        ? syncBookmarks({ force: message.force })
        : syncTabs({ force: message.force })
    }
    if (message.type === 'reschedule') {
      await api.alarms.clear(TABS_ALARM)
      await ensureAlarms()
      return { ok: true }
    }
    return { ok: false, reason: 'unknown message' }
  }

  run()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, reason: String(error?.message ?? error) }))
    .finally(() => refreshBadge().catch(() => {}))

  return true
})

api.runtime.onStartup.addListener(() => {
  ensureAlarms().then(refreshBadge).catch(() => {})
})

api.runtime.onInstalled.addListener(() => {
  ensureAlarms()
    .then(() => Promise.all([syncBookmarks(), syncTabs()]))
    .then(refreshBadge)
    .catch(() => {})
})
