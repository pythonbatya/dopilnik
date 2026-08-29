import test from 'node:test'
import assert from 'node:assert/strict'

import { fromNetscapeHtml, toNetscapeHtml } from '../src/lib/bookmarks/html.js'

// Shaped like a real Chrome export: attributes in varying order, extra attributes we
// do not use, inconsistent indentation, and an ICON blob we must ignore.
const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1600000000" LAST_MODIFIED="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://a.example/" ADD_DATE="1600000001" ICON="data:image/png;base64,iVBOR">A &amp; B</A>
        <DT><H3 ADD_DATE="1600000002">Nested</H3>
        <DL><p>
            <DT><A HREF="https://b.example/?x=1&amp;y=2" ADD_DATE="1600000003">Deep</A>
        </DL><p>
    </DL><p>
    <DT><H3 ADD_DATE="1600000004">Other bookmarks</H3>
    <DL><p>
        <DT><A ADD_DATE="1600000005" HREF="https://c.example/">Attrs reversed</A>
    </DL><p>
</DL><p>`

test('parses a real-shaped Chrome export into a tree', () => {
  const tree = fromNetscapeHtml(CHROME_EXPORT)

  assert.equal(tree.length, 2)

  const [toolbar, other] = tree
  assert.equal(toolbar.title, 'Bookmarks bar')
  assert.equal(toolbar.root, 'toolbar')
  assert.equal(toolbar.dateAdded, 1600000000000)

  assert.deepEqual(
    toolbar.children.map((n) => n.title),
    ['A & B', 'Nested'],
  )
  assert.equal(toolbar.children[0].url, 'https://a.example/')

  const nested = toolbar.children[1]
  assert.equal(nested.type, 'folder')
  assert.equal(nested.children[0].url, 'https://b.example/?x=1&y=2')

  assert.equal(other.root, undefined)
  assert.equal(other.children[0].url, 'https://c.example/')
})

test('round-trips a tree through serialize and parse', () => {
  const tree = [
    {
      type: 'folder',
      root: 'toolbar',
      title: 'Bookmarks bar',
      dateAdded: 1600000000000,
      children: [
        { type: 'bookmark', title: 'Tom & "Jerry"', url: 'https://e.com/?a=1&b=2', dateAdded: 1600000001000 },
        { type: 'folder', title: 'Empty', dateAdded: 1600000002000, children: [] },
      ],
    },
  ]

  assert.deepEqual(fromNetscapeHtml(toNetscapeHtml(tree)), tree)
})
