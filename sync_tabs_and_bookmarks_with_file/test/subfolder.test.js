import test from 'node:test'
import assert from 'node:assert/strict'

import { validateSubfolder } from '../src/lib/config.js'

test('accepts a simple folder name', () => {
  assert.deepEqual(validateSubfolder('dopilnik'), { ok: true, value: 'dopilnik' })
})

test('accepts a nested path', () => {
  assert.equal(validateSubfolder('sync/browser/bookmarks').ok, true)
})

test('trims surrounding whitespace and trailing slashes', () => {
  assert.equal(validateSubfolder('  dopilnik/  ').value, 'dopilnik')
})

test('rejects an absolute path, which the downloads api will not accept', () => {
  assert.equal(validateSubfolder('/Users/me/sync').ok, false)
})

test('rejects a home-relative path', () => {
  assert.equal(validateSubfolder('~/sync').ok, false)
})

test('rejects an escape upwards', () => {
  assert.equal(validateSubfolder('../../etc').ok, false)
  assert.equal(validateSubfolder('a/../b').ok, false)
})

test('rejects an empty subfolder', () => {
  assert.equal(validateSubfolder('   ').ok, false)
})

test('explains the reason so the options page can show it', () => {
  assert.match(validateSubfolder('/abs').error, /\S/)
})
