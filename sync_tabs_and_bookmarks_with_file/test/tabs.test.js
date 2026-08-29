import test from 'node:test'
import assert from 'node:assert/strict'

import { collectTabs, countTabs } from '../src/lib/tabs/collect.js'
import { restoreTabs, isRestorableUrl } from '../src/lib/tabs/restore.js'

function fakeApi(windows = []) {
  const log = { windows: [], tabs: [], updates: [] }
  return {
    log,
    windows: {
      getAll: async () => windows,
      create: async (props) => {
        const id = log.windows.length + 1
        log.windows.push(props)
        return { id, tabs: [{ id: id * 100 }] }
      },
    },
    tabs: {
      create: async (props) => {
        log.tabs.push(props)
        return { id: log.tabs.length }
      },
      update: async (id, props) => {
        log.updates.push([id, props])
      },
    },
  }
}

test('collects windows and tabs into the file shape', async () => {
  const api = fakeApi([
    {
      type: 'normal',
      state: 'normal',
      incognito: false,
      tabs: [
        { url: 'https://a.example/', title: 'A', pinned: true, active: false, index: 0, favIconUrl: 'x' },
        { url: 'https://b.example/', title: 'B', pinned: false, active: true, index: 1 },
      ],
    },
  ])

  const snapshot = await collectTabs(api, { bucket: 'work', browser: 'chrome' })

  assert.equal(snapshot.schema, 1)
  assert.equal(snapshot.bucket, 'work')
  assert.equal(snapshot.browser, 'chrome')
  assert.ok(snapshot.savedAt, 'stamps a time')
  assert.deepEqual(snapshot.windows, [
    {
      state: 'normal',
      type: 'normal',
      tabs: [
        { url: 'https://a.example/', title: 'A', pinned: true, active: false, index: 0 },
        { url: 'https://b.example/', title: 'B', pinned: false, active: true, index: 1 },
      ],
    },
  ])
})

test('never records incognito windows', async () => {
  const api = fakeApi([
    { type: 'normal', incognito: true, tabs: [{ url: 'https://secret/', index: 0 }] },
    { type: 'normal', incognito: false, tabs: [{ url: 'https://ok/', index: 0 }] },
  ])

  const snapshot = await collectTabs(api, { bucket: 'x', browser: 'firefox' })

  assert.equal(snapshot.windows.length, 1)
  assert.equal(snapshot.windows[0].tabs[0].url, 'https://ok/')
})

test('counts tabs across windows for the guard', () => {
  const snapshot = { windows: [{ tabs: [1, 2, 3] }, { tabs: [4] }] }
  assert.equal(countTabs(snapshot), 4)
})

test('only http, https and file urls can be recreated', () => {
  assert.equal(isRestorableUrl('https://a/'), true)
  assert.equal(isRestorableUrl('http://a/'), true)
  assert.equal(isRestorableUrl('file:///Users/me/x.html'), true)
  assert.equal(isRestorableUrl('chrome://settings'), false)
  assert.equal(isRestorableUrl('about:config'), false)
  assert.equal(isRestorableUrl('chrome-extension://abc/page.html'), false)
  assert.equal(isRestorableUrl(undefined), false)
})

test('recreates one window per saved window, in order, preserving pinned', async () => {
  const api = fakeApi()
  const snapshot = {
    windows: [
      {
        state: 'normal',
        tabs: [
          { url: 'https://first/', pinned: true, index: 0 },
          { url: 'https://second/', pinned: false, index: 1 },
        ],
      },
      { state: 'normal', tabs: [{ url: 'https://other-window/', pinned: false, index: 0 }] },
    ],
  }

  const result = await restoreTabs(api, snapshot)

  assert.equal(api.log.windows.length, 2)
  assert.equal(api.log.windows[0].url, 'https://first/')
  assert.deepEqual(api.log.tabs.map((t) => t.url), ['https://second/'])
  assert.deepEqual(api.log.updates, [[100, { pinned: true }]], 'pins the window-opening tab')
  assert.deepEqual(result, { windows: 2, restored: 3, skipped: 0 })
})

test('skips unrestorable urls and reports how many', async () => {
  const api = fakeApi()
  const snapshot = {
    windows: [
      {
        tabs: [
          { url: 'chrome://settings', index: 0 },
          { url: 'https://real/', index: 1 },
          { url: 'about:blank', index: 2 },
        ],
      },
    ],
  }

  const result = await restoreTabs(api, snapshot)

  assert.equal(api.log.windows[0].url, 'https://real/')
  assert.deepEqual(result, { windows: 1, restored: 1, skipped: 2 })
})

test('a window with nothing restorable opens no window at all', async () => {
  const api = fakeApi()

  const result = await restoreTabs(api, { windows: [{ tabs: [{ url: 'about:blank', index: 0 }] }] })

  assert.equal(api.log.windows.length, 0)
  assert.deepEqual(result, { windows: 0, restored: 0, skipped: 1 })
})
