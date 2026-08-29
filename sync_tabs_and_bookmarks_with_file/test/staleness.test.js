import test from 'node:test'
import assert from 'node:assert/strict'

import { stalenessOf } from '../src/lib/state.js'

const MINUTE = 60_000
const now = 1_000 * MINUTE

test('tab sync is fresh within twice the interval', () => {
  const entry = { lastWriteAt: now - 20 * MINUTE }
  assert.equal(stalenessOf('tabs', entry, { intervalMinutes: 15, now }).stale, false)
})

test('tab sync is stale past twice the interval', () => {
  const entry = { lastWriteAt: now - 40 * MINUTE }
  const result = stalenessOf('tabs', entry, { intervalMinutes: 15, now })

  assert.equal(result.stale, true)
  assert.match(result.reason, /\S/)
})

test('tab sync that never ran is stale', () => {
  assert.equal(stalenessOf('tabs', {}, { intervalMinutes: 15, now }).stale, true)
})

test('bookmarks are not stale merely because nothing changed for a long time', () => {
  // Bookmarks are written on change, so a quiet month is normal, not a failure.
  const entry = { lastWriteAt: now - 30 * 24 * 60 * MINUTE }
  assert.equal(stalenessOf('bookmarks', entry, { intervalMinutes: 15, now }).stale, false)
})

test('bookmarks are stale when a pending change was never flushed', () => {
  const entry = { lastWriteAt: now - 60 * MINUTE, dirtySince: now - 10 * MINUTE }
  const result = stalenessOf('bookmarks', entry, { intervalMinutes: 15, now })

  assert.equal(result.stale, true)
  assert.match(result.reason, /pending|unwritten|flush/i)
})

test('a just-made bookmark change is not stale during the debounce window', () => {
  const entry = { lastWriteAt: now - 60 * MINUTE, dirtySince: now - 10_000 }
  assert.equal(stalenessOf('bookmarks', entry, { intervalMinutes: 15, now }).stale, false)
})

test('a failed last write is stale whatever the timing', () => {
  const entry = { lastWriteAt: now - MINUTE, lastResult: { ok: false, reason: 'interrupted' } }
  const result = stalenessOf('tabs', entry, { intervalMinutes: 15, now })

  assert.equal(result.stale, true)
  assert.match(result.reason, /interrupted/)
})
