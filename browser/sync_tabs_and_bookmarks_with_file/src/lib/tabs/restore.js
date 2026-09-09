// chrome://, about: and extension pages cannot be recreated by tabs.create, so they are
// skipped -- and counted, so a gap in a restored session is never mistaken for data loss.
const RESTORABLE_SCHEMES = ['http:', 'https:', 'file:']

export function isRestorableUrl(url) {
  if (!url) return false
  return RESTORABLE_SCHEMES.some((scheme) => url.toLowerCase().startsWith(scheme))
}

export async function restoreTabs(api, snapshot) {
  let windowCount = 0
  let restored = 0
  let skipped = 0

  for (const saved of snapshot.windows ?? []) {
    const tabs = [...(saved.tabs ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const usable = tabs.filter((tab) => isRestorableUrl(tab.url))
    skipped += tabs.length - usable.length

    if (usable.length === 0) continue

    const [first, ...rest] = usable
    const created = await api.windows.create({ url: first.url, state: saved.state ?? 'normal' })
    windowCount += 1
    restored += 1

    // windows.create cannot open a tab pinned, so the first tab is pinned afterwards.
    if (first.pinned && created.tabs?.[0]) {
      await api.tabs.update(created.tabs[0].id, { pinned: true })
    }

    for (const tab of rest) {
      await api.tabs.create({ windowId: created.id, url: tab.url, pinned: Boolean(tab.pinned) })
      restored += 1
    }
  }

  return { windows: windowCount, restored, skipped }
}
