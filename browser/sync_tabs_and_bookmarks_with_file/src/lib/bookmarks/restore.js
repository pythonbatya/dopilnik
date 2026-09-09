import { canonicalRoot, resolveRootId } from './roots.js'

// merge  -- find-or-create folders by title, add a bookmark only when its url is not
//           already in that folder. Never deletes; restoring twice changes nothing.
// replace -- wipe the children of every root the file touches, then recreate.

async function mergeInto(api, parentId, nodes, counts) {
  const existing = await api.bookmarks.getChildren(parentId)

  for (const node of nodes) {
    if (node.type === 'bookmark') {
      if (existing.some((child) => child.url === node.url)) {
        counts.skipped += 1
        continue
      }
      await api.bookmarks.create({ parentId, title: node.title, url: node.url })
      counts.created += 1
      continue
    }

    const match = existing.find((child) => child.url === undefined && child.title === node.title)
    const folder = match ?? (await api.bookmarks.create({ parentId, title: node.title }))
    if (!match) counts.folders += 1

    await mergeInto(api, folder.id, node.children ?? [], counts)
  }
}

export async function restoreBookmarks(api, tree, { mode = 'merge' } = {}) {
  const [root] = await api.bookmarks.getTree()
  const topLevel = root.children ?? []
  const counts = { created: 0, skipped: 0, folders: 0 }

  for (const fileRoot of tree) {
    const canonical = fileRoot.root ?? canonicalRoot(fileRoot) ?? 'other'
    const targetId = resolveRootId(canonical, topLevel)
    if (!targetId) continue

    if (mode === 'replace') {
      for (const child of await api.bookmarks.getChildren(targetId)) {
        await api.bookmarks.removeTree(child.id)
      }
    }

    await mergeInto(api, targetId, fileRoot.children ?? [], counts)
  }

  return counts
}
