export function countTabs(snapshot) {
  return (snapshot.windows ?? []).reduce((total, window) => total + (window.tabs?.length ?? 0), 0)
}

export async function collectTabs(api, { bucket, browser }) {
  const windows = await api.windows.getAll({ populate: true })

  return {
    schema: 1,
    bucket,
    browser,
    savedAt: new Date().toISOString(),
    windows: windows
      // Incognito windows are deliberately never recorded, even if the extension is
      // allowed to see them.
      .filter((window) => !window.incognito && (window.type ?? 'normal') === 'normal')
      .map((window) => ({
        state: window.state ?? 'normal',
        type: window.type ?? 'normal',
        tabs: (window.tabs ?? []).map((tab) => ({
          url: tab.url,
          title: tab.title,
          pinned: Boolean(tab.pinned),
          active: Boolean(tab.active),
          index: tab.index,
        })),
      })),
  }
}
