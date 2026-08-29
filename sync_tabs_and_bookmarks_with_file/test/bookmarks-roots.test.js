import test from 'node:test'
import assert from 'node:assert/strict'

import { canonicalRoot, rootTitle, resolveRootId } from '../src/lib/bookmarks/roots.js'

// Top-level nodes as the two browsers actually report them from bookmarks.getTree().
const CHROME_ROOTS = [
  { id: '1', title: 'Bookmarks bar' },
  { id: '2', title: 'Other bookmarks' },
  { id: '3', title: 'Mobile bookmarks' },
]

const FIREFOX_ROOTS = [
  { id: 'toolbar_____', title: 'Bookmarks Toolbar' },
  { id: 'menu________', title: 'Bookmarks Menu' },
  { id: 'unfiled_____', title: 'Other Bookmarks' },
  { id: 'mobile______', title: 'Mobile Bookmarks' },
]

test('identifies canonical roots by id in both browsers', () => {
  assert.deepEqual(CHROME_ROOTS.map(canonicalRoot), ['toolbar', 'other', 'mobile'])
  assert.deepEqual(FIREFOX_ROOTS.map(canonicalRoot), ['toolbar', 'menu', 'other', 'mobile'])
})

test('gives each canonical root a browser-independent title in the file', () => {
  assert.equal(rootTitle('toolbar'), 'Bookmarks bar')
  assert.equal(rootTitle('menu'), 'Bookmarks menu')
  assert.equal(rootTitle('other'), 'Other bookmarks')
  assert.equal(rootTitle('mobile'), 'Mobile bookmarks')
})

test('resolves every canonical root to a real id in the current browser', () => {
  assert.equal(resolveRootId('toolbar', FIREFOX_ROOTS), 'toolbar_____')
  assert.equal(resolveRootId('menu', FIREFOX_ROOTS), 'menu________')
  assert.equal(resolveRootId('other', FIREFOX_ROOTS), 'unfiled_____')
})

test('folds the Firefox-only menu root into Other bookmarks when restoring into Chrome', () => {
  assert.equal(resolveRootId('menu', CHROME_ROOTS), '2')
  assert.equal(resolveRootId('other', CHROME_ROOTS), '2')
})

test('falls back to Other bookmarks for an unknown root name', () => {
  assert.equal(resolveRootId('nonsense', CHROME_ROOTS), '2')
})
