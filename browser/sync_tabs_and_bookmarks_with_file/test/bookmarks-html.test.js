import test from 'node:test'
import assert from 'node:assert/strict'

import { toNetscapeHtml } from '../src/lib/bookmarks/html.js'

test('serializes a bookmark inside the toolbar folder', () => {
  const tree = [
    {
      type: 'folder',
      root: 'toolbar',
      title: 'Bookmarks bar',
      dateAdded: 1000,
      children: [
        { type: 'bookmark', title: 'Example', url: 'https://example.com/', dateAdded: 2000 },
      ],
    },
  ]

  const html = toNetscapeHtml(tree)

  assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/)
  assert.match(html, /<H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar<\/H3>/)
  assert.match(html, /<DT><A HREF="https:\/\/example\.com\/" ADD_DATE="2">Example<\/A>/)
})

test('escapes HTML-significant characters in titles and urls', () => {
  const tree = [
    {
      type: 'folder',
      root: 'other',
      title: 'R&D <notes>',
      children: [
        { type: 'bookmark', title: 'Tom & "Jerry"', url: 'https://e.com/?a=1&b=<2>' },
      ],
    },
  ]

  const html = toNetscapeHtml(tree)

  assert.match(html, /<H3 ADD_DATE="0">R&amp;D &lt;notes&gt;<\/H3>/)
  assert.match(html, /HREF="https:\/\/e\.com\/\?a=1&amp;b=&lt;2&gt;"/)
  assert.match(html, />Tom &amp; &quot;Jerry&quot;<\/A>/)
  assert.ok(!html.includes('PERSONAL_TOOLBAR_FOLDER'), 'only the toolbar root is flagged')
})
