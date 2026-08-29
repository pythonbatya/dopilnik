import test from 'node:test'
import assert from 'node:assert/strict'

import { restoreBookmarks } from '../src/lib/bookmarks/restore.js'
import { collectBookmarks, countBookmarks } from '../src/lib/bookmarks/collect.js'
import { fakeBookmarks, CHROME_ROOTS, simplify } from './helpers/fake-bookmarks.js'

const FILE_TREE = [
  {
    type: 'folder',
    root: 'toolbar',
    title: 'Bookmarks bar',
    children: [
      { type: 'bookmark', title: 'A', url: 'https://a.example/' },
      {
        type: 'folder',
        title: 'Work',
        children: [{ type: 'bookmark', title: 'B', url: 'https://b.example/' }],
      },
    ],
  },
]

const toolbarOf = (fake) => simplify(fake.tree()[0].children.find((n) => n.id === '1')).children

test('restores into an empty browser', async () => {
  const fake = fakeBookmarks(CHROME_ROOTS)

  const result = await restoreBookmarks(fake, FILE_TREE, { mode: 'merge' })

  assert.deepEqual(toolbarOf(fake), [
    { title: 'A', url: 'https://a.example/' },
    { title: 'Work', children: [{ title: 'B', url: 'https://b.example/' }] },
  ])
  assert.equal(result.created, 2, 'bookmarks created')
  assert.equal(result.folders, 1, 'new folders created, counted separately')
  assert.equal(result.skipped, 0)
})

test('merging the same file twice changes nothing the second time', async () => {
  const fake = fakeBookmarks(CHROME_ROOTS)

  await restoreBookmarks(fake, FILE_TREE, { mode: 'merge' })
  const before = toolbarOf(fake)
  const result = await restoreBookmarks(fake, FILE_TREE, { mode: 'merge' })

  assert.deepEqual(toolbarOf(fake), before, 'idempotent')
  assert.equal(result.created, 0)
  assert.equal(result.skipped, 2, 'both bookmarks already present')
})

test('merge keeps bookmarks that are not in the file', async () => {
  const fake = fakeBookmarks(CHROME_ROOTS)
  await fake.bookmarks.create({ parentId: '1', title: 'Mine', url: 'https://mine.example/' })

  await restoreBookmarks(fake, FILE_TREE, { mode: 'merge' })

  assert.ok(toolbarOf(fake).some((n) => n.url === 'https://mine.example/'), 'merge never deletes')
})

test('replace wipes what was there first', async () => {
  const fake = fakeBookmarks(CHROME_ROOTS)
  await fake.bookmarks.create({ parentId: '1', title: 'Mine', url: 'https://mine.example/' })

  await restoreBookmarks(fake, FILE_TREE, { mode: 'replace' })

  assert.deepEqual(toolbarOf(fake), [
    { title: 'A', url: 'https://a.example/' },
    { title: 'Work', children: [{ title: 'B', url: 'https://b.example/' }] },
  ])
})

test('a firefox menu folder lands in Other bookmarks on chrome', async () => {
  const fake = fakeBookmarks(CHROME_ROOTS)
  const tree = [
    { type: 'folder', root: 'menu', title: 'Bookmarks menu', children: [{ type: 'bookmark', title: 'M', url: 'https://m/' }] },
    { type: 'folder', root: 'other', title: 'Other bookmarks', children: [{ type: 'bookmark', title: 'O', url: 'https://o/' }] },
  ]

  await restoreBookmarks(fake, tree, { mode: 'merge' })

  const other = simplify(fake.tree()[0].children.find((n) => n.id === '2')).children
  assert.deepEqual(other.map((n) => n.url), ['https://m/', 'https://o/'])
})

test('collects the browser tree back into the file shape', async () => {
  const fake = fakeBookmarks(CHROME_ROOTS)
  await restoreBookmarks(fake, FILE_TREE, { mode: 'merge' })

  const tree = await collectBookmarks(fake)

  const toolbar = tree.find((node) => node.root === 'toolbar')
  assert.equal(toolbar.title, 'Bookmarks bar')
  assert.deepEqual(toolbar.children.map((n) => n.title), ['A', 'Work'])
  assert.equal(countBookmarks(tree), 2, 'counts bookmarks, not folders')
})
