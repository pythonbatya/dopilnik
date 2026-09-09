import test from 'node:test'
import assert from 'node:assert/strict'

import { checkWrite } from '../src/lib/guard.js'

test('allows the very first write, with nothing to compare against', () => {
  assert.equal(checkWrite({ count: 42, previousCount: undefined }).ok, true)
})

test('allows a normal write', () => {
  assert.equal(checkWrite({ count: 300, previousCount: 310 }).ok, true)
})

test('allows growth', () => {
  assert.equal(checkWrite({ count: 900, previousCount: 100 }).ok, true)
})

test('vetoes an empty snapshot when there was something before', () => {
  const result = checkWrite({ count: 0, previousCount: 250 })

  assert.equal(result.ok, false)
  assert.match(result.reason, /empty/i)
})

test('vetoes a snapshot that lost more than 90% of its entries', () => {
  // The realistic failure: browser still starting, one blank window, alarm fires.
  const result = checkWrite({ count: 9, previousCount: 250 })

  assert.equal(result.ok, false)
  assert.match(result.reason, /9.*250|90%/)
})

test('allows exactly 10% of the previous count', () => {
  assert.equal(checkWrite({ count: 25, previousCount: 250 }).ok, true)
})

test('allows an empty snapshot when the previous one was empty too', () => {
  assert.equal(checkWrite({ count: 0, previousCount: 0 }).ok, true)
})

test('force overrides any veto', () => {
  assert.equal(checkWrite({ count: 0, previousCount: 250, force: true }).ok, true)
})
