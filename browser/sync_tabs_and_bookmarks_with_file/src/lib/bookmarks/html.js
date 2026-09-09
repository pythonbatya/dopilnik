// Netscape bookmark file format (NETSCAPE-Bookmark-file-1) -- the same format the
// browser's own "Export bookmarks" produces, so any browser can import our file.

const HEADER = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
`

// Netscape ADD_DATE is in seconds; browser bookmark dates are in milliseconds.
const seconds = (ms) => Math.floor((ms ?? 0) / 1000)

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

function renderNode(node, depth) {
  const pad = '    '.repeat(depth)

  if (node.type === 'bookmark') {
    return `${pad}<DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${seconds(node.dateAdded)}">${escapeHtml(node.title)}</A>\n`
  }

  const toolbar = node.root === 'toolbar' ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''
  return (
    `${pad}<DT><H3 ADD_DATE="${seconds(node.dateAdded)}"${toolbar}>${escapeHtml(node.title)}</H3>\n` +
    renderList(node.children ?? [], depth)
  )
}

function renderList(nodes, depth) {
  const pad = '    '.repeat(depth)
  const body = nodes.map((node) => renderNode(node, depth + 1)).join('')
  return `${pad}<DL><p>\n${body}${pad}</DL><p>\n`
}

export function toNetscapeHtml(tree) {
  return HEADER + renderList(tree, 0)
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }

const unescapeHtml = (value) =>
  value.replace(/&(#39|amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])

function parseAttrs(source) {
  const attrs = {}
  for (const [, name, value] of source.matchAll(/([A-Za-z_]+)="([^"]*)"/g)) {
    attrs[name.toUpperCase()] = value
  }
  return attrs
}

// ADD_DATE is in seconds; the browser bookmark APIs want milliseconds.
const millis = (attrs) => Number(attrs.ADD_DATE ?? 0) * 1000

// Matches, in document order: a folder heading, a bookmark, or a list open/close.
// Real exports vary in whitespace, attribute order and extra attributes (ICON,
// LAST_MODIFIED, UNFILED_BOOKMARKS_FOLDER), so nothing here depends on layout.
const TOKEN = /<DT>\s*<H3([^>]*)>([\s\S]*?)<\/H3>|<DT>\s*<A([^>]*)>([\s\S]*?)<\/A>|<DL[^>]*>|<\/DL\s*>/gi

export function fromNetscapeHtml(html) {
  const root = []
  const stack = []
  let pendingFolder = null

  const current = () => stack[stack.length - 1] ?? root

  for (const match of html.matchAll(TOKEN)) {
    const [token, folderAttrs, folderTitle, linkAttrs, linkTitle] = match

    if (folderAttrs !== undefined) {
      const attrs = parseAttrs(folderAttrs)
      const folder = { type: 'folder', title: unescapeHtml(folderTitle), dateAdded: millis(attrs), children: [] }
      if (attrs.PERSONAL_TOOLBAR_FOLDER === 'true') folder.root = 'toolbar'
      current().push(folder)
      pendingFolder = folder
      continue
    }

    if (linkAttrs !== undefined) {
      const attrs = parseAttrs(linkAttrs)
      current().push({
        type: 'bookmark',
        title: unescapeHtml(linkTitle),
        url: unescapeHtml(attrs.HREF ?? ''),
        dateAdded: millis(attrs),
      })
      continue
    }

    if (token.startsWith('</')) {
      stack.pop()
      continue
    }

    // A <DL> belongs to the folder heading that preceded it; the first one is the document root.
    stack.push(pendingFolder ? pendingFolder.children : current())
    pendingFolder = null
  }

  return root
}
