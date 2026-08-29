import test from 'node:test'
import assert from 'node:assert/strict'

import { toDataUrl, buildDownloadUrl } from '../src/lib/writer.js'

// toDataUrl is exercised directly: it is the branch Chrome MV3 service workers are forced
// down, and Node has URL.createObjectURL so feature detection would never reach it here.
test('encodes a small payload as a decodable data url', () => {
  const url = toDataUrl('<DL><p>hello</p></DL>', 'bookmarks')

  assert.match(url, /^data:text\/html;base64,/)
  assert.equal(atob(url.split(',')[1]), '<DL><p>hello</p></DL>')
})

test('encodes a large bookmarks file without blowing the stack', () => {
  // A real bookmark collection reaches this size easily.
  const large = '<DT><A HREF="https://example.com/">Example</A>\n'.repeat(30_000)

  const url = toDataUrl(large, 'bookmarks')

  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0))), large)
})

test('preserves non-ascii titles through the encoding', () => {
  const text = '<DT><A HREF="https://x/">Вакансии — HH</A>'

  const url = toDataUrl(text, 'bookmarks')

  assert.equal(
    new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0))),
    text,
  )
})

test('uses a blob url when the runtime has one, and asks for it to be revoked', () => {
  const result = buildDownloadUrl('x', 'tabs')

  assert.equal(result.revoke, true)
  assert.match(result.url, /^blob:/)
})
