import { canonicalRoot, rootTitle } from './roots.js'

export function countBookmarks(tree) {
  return tree.reduce(
    (total, node) => total + (node.type === 'bookmark' ? 1 : countBookmarks(node.children ?? [])),
    0,
  )
}

function convert(node) {
  if (node.url !== undefined) {
    return { type: 'bookmark', title: node.title ?? '', url: node.url, dateAdded: node.dateAdded }
  }
  return {
    type: 'folder',
    title: node.title ?? '',
    dateAdded: node.dateAdded,
    children: (node.children ?? []).map(convert),
  }
}

export async function collectBookmarks(api) {
  const [root] = await api.bookmarks.getTree()

  return (root.children ?? []).map((node) => {
    const canonical = canonicalRoot(node) ?? 'other'
    return {
      type: 'folder',
      root: canonical,
      // Written under a browser-independent name so the file restores into either browser.
      title: rootTitle(canonical),
      dateAdded: node.dateAdded,
      children: (node.children ?? []).map(convert),
    }
  })
}
