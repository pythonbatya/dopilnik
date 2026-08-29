// A small in-memory stand-in for the bookmarks API, so restore tests can assert on the
// resulting bookmark tree rather than on which methods were called.

export function fakeBookmarks(roots) {
  const nodes = new Map()
  let nextId = 100

  nodes.set('0', { id: '0', title: '', children: [] })
  for (const root of roots) {
    nodes.set(root.id, { ...root, parentId: '0', children: [] })
    nodes.get('0').children.push(root.id)
  }

  const materialize = (id) => {
    const node = nodes.get(id)
    const copy = { id: node.id, parentId: node.parentId, title: node.title, dateAdded: node.dateAdded }
    if (node.url !== undefined) copy.url = node.url
    if (node.children) copy.children = node.children.map(materialize)
    return copy
  }

  return {
    nodes,
    tree: () => [materialize('0')],
    bookmarks: {
      getTree: async () => [materialize('0')],
      getChildren: async (id) => (nodes.get(id).children ?? []).map(materialize),
      create: async ({ parentId, title, url, dateAdded }) => {
        const id = String((nextId += 1))
        const node = { id, parentId, title, dateAdded }
        if (url !== undefined) node.url = url
        else node.children = []
        nodes.set(id, node)
        nodes.get(parentId).children.push(id)
        return materialize(id)
      },
      removeTree: async (id) => {
        const parent = nodes.get(nodes.get(id).parentId)
        parent.children = parent.children.filter((child) => child !== id)
        nodes.delete(id)
      },
    },
  }
}

export const CHROME_ROOTS = [
  { id: '1', title: 'Bookmarks bar' },
  { id: '2', title: 'Other bookmarks' },
  { id: '3', title: 'Mobile bookmarks' },
]

// Reads a materialized tree back into the simple {title, url|children} shape tests compare.
export function simplify(node) {
  if (node.url !== undefined) return { title: node.title, url: node.url }
  return { title: node.title, children: (node.children ?? []).map(simplify) }
}
