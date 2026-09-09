import test from 'node:test'
import assert from 'node:assert/strict'

import { payloadHash } from '../src/lib/hash.js'

test('ignores savedAt, so an unchanged snapshot does not trigger a write', () => {
  const a = { schema: 1, savedAt: '2026-08-27T10:00:00.000Z', windows: [{ tabs: [] }] }
  const b = { schema: 1, savedAt: '2026-08-27T15:00:00.000Z', windows: [{ tabs: [] }] }

  assert.equal(payloadHash(a), payloadHash(b))
})

test('changes when the actual content changes', () => {
  const a = { savedAt: 'x', windows: [{ tabs: [{ url: 'https://a/' }] }] }
  const b = { savedAt: 'x', windows: [{ tabs: [{ url: 'https://b/' }] }] }

  assert.notEqual(payloadHash(a), payloadHash(b))
})

test('is stable regardless of key order', () => {
  assert.equal(payloadHash({ a: 1, b: 2 }), payloadHash({ b: 2, a: 1 }))
})

test('hashes a plain string too, for the bookmarks html', () => {
  assert.equal(payloadHash('<DL><p>'), payloadHash('<DL><p>'))
  assert.notEqual(payloadHash('<DL><p>'), payloadHash('<DL><p> '))
})
