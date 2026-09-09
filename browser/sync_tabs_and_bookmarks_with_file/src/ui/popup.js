import { api } from '../lib/api.js'
import { loadSettings } from '../lib/config.js'
import { readState, stalenessOf } from '../lib/state.js'

const KINDS = [
  { kind: 'bookmarks', label: 'Bookmarks' },
  { kind: 'tabs', label: 'Tabs' },
]

function describeAge(timestamp) {
  if (!timestamp) return 'never written'

  const minutes = Math.round((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

async function render() {
  // Computed here, live, in the popup's own context -- this is the one status that does
  // not depend on the background worker being alive.
  const settings = await loadSettings(api)
  const state = await readState(api)
  const rows = document.getElementById('rows')

  document.getElementById('bucket').textContent =
    `bucket "${settings.bucket}" · Downloads/${settings.subfolder}/`

  rows.replaceChildren(
    ...KINDS.map(({ kind, label }) => {
      const entry = state[kind] ?? {}
      const status = stalenessOf(kind, entry, { intervalMinutes: settings.tabIntervalMinutes, now: Date.now() })

      const item = document.createElement('li')

      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = label

      const age = document.createElement('span')
      age.className = `age ${status.stale ? 'warn' : 'ok'}`
      age.textContent = `${describeAge(entry.lastWriteAt)}${status.stale ? ' ⚠' : ' ✓'}`
      age.title = status.reason ?? ''

      const sync = document.createElement('button')
      sync.textContent = 'Sync now'
      sync.addEventListener('click', () => run(kind, false))

      item.append(name, age, sync)

      // Only offered when the guard actually blocked a write, so it cannot be used by
      // accident.
      if (entry.vetoed) {
        const force = document.createElement('button')
        force.className = 'primary'
        force.textContent = 'Write anyway'
        force.title = entry.lastResult?.reason ?? ''
        force.addEventListener('click', () => run(kind, true))
        item.append(force)
      }

      return item
    }),
  )

  const failures = KINDS.map(({ kind }) => state[kind]?.lastResult)
    .filter((result) => result && result.ok === false)
    .map((result) => result.reason)

  const error = document.getElementById('error')
  error.hidden = failures.length === 0
  error.textContent = failures.join(' · ')
}

async function run(kind, force) {
  await api.runtime.sendMessage({ type: 'sync', kind, force })
  await render()
}

document.getElementById('open-options').addEventListener('click', (event) => {
  event.preventDefault()
  api.runtime.openOptionsPage()
})

render()
