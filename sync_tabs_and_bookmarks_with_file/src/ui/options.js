import { api } from '../lib/api.js'
import { loadSettings, saveSettings, validateSubfolder } from '../lib/config.js'
import { downloadPath } from '../lib/writer.js'
import { fromNetscapeHtml } from '../lib/bookmarks/html.js'
import { restoreBookmarks } from '../lib/bookmarks/restore.js'
import { restoreTabs } from '../lib/tabs/restore.js'

const $ = (id) => document.getElementById(id)

function showPaths(settings) {
  $('paths').textContent =
    `Writing Downloads/${downloadPath(settings, 'bookmarks')} and Downloads/${downloadPath(settings, 'tabs')}`
}

async function load() {
  const settings = await loadSettings(api)

  $('bucket').value = settings.bucket
  $('subfolder').value = settings.subfolder
  $('interval').value = settings.tabIntervalMinutes
  $('sync-bookmarks').checked = settings.syncBookmarks
  $('sync-tabs').checked = settings.syncTabs

  showPaths(settings)
}

$('save').addEventListener('click', async () => {
  const subfolder = validateSubfolder($('subfolder').value)
  $('subfolder-error').textContent = subfolder.ok ? '' : subfolder.error
  if (!subfolder.ok) return

  const settings = {
    bucket: $('bucket').value.trim() || 'default',
    subfolder: subfolder.value,
    tabIntervalMinutes: Math.max(1, Number($('interval').value) || 15),
    syncBookmarks: $('sync-bookmarks').checked,
    syncTabs: $('sync-tabs').checked,
  }

  await saveSettings(api, settings)
  // The interval may have changed, so the alarm has to be rebuilt.
  await api.runtime.sendMessage({ type: 'reschedule' })

  await load()
  $('saved').textContent = 'Saved'
  setTimeout(() => { $('saved').textContent = '' }, 2000)
})

const readFile = (input) =>
  new Promise((resolve, reject) => {
    const file = input.files?.[0]
    if (!file) {
      reject(new Error('Pick a file first.'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsText(file)
  })

$('bm-restore').addEventListener('click', async () => {
  const result = $('bm-result')
  result.className = 'result'

  try {
    const mode = document.querySelector('input[name=bm-mode]:checked').value

    // Replace deletes existing bookmarks, so it needs more than a stray click.
    if (mode === 'replace') {
      const typed = prompt('Replace deletes the bookmarks currently in the matching roots.\n\nType REPLACE to confirm:')
      if (typed !== 'REPLACE') {
        result.textContent = 'Cancelled.'
        return
      }
    }

    const tree = fromNetscapeHtml(await readFile($('bm-file')))
    if (tree.length === 0) throw new Error('No bookmarks found in that file.')

    const counts = await restoreBookmarks(api, tree, { mode })
    result.classList.add('ok')
    result.textContent =
      `Added ${counts.created} bookmarks in ${counts.folders} new folders; skipped ${counts.skipped} already present.`
  } catch (error) {
    result.classList.add('error')
    result.textContent = String(error?.message ?? error)
  }
})

$('tabs-restore').addEventListener('click', async () => {
  const result = $('tabs-result')
  result.className = 'result'

  try {
    const snapshot = JSON.parse(await readFile($('tabs-file')))
    if (!Array.isArray(snapshot.windows)) throw new Error('That file has no saved windows.')

    const counts = await restoreTabs(api, snapshot)
    result.classList.add('ok')
    result.textContent =
      `Restored ${counts.restored} tabs in ${counts.windows} windows` +
      (counts.skipped ? `; skipped ${counts.skipped} that cannot be reopened (chrome://, about:).` : '.')
  } catch (error) {
    result.classList.add('error')
    result.textContent = String(error?.message ?? error)
  }
})

load()
