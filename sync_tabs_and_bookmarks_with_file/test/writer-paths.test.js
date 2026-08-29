import test from 'node:test'
import assert from 'node:assert/strict'

import { downloadPath } from '../src/lib/writer.js'

test('builds the download path for each kind', () => {
  const settings = { subfolder: 'dopilnik', bucket: 'work' }

  assert.equal(downloadPath(settings, 'bookmarks'), 'dopilnik/work-bookmarks.html')
  assert.equal(downloadPath(settings, 'tabs'), 'dopilnik/work-tabs.json')
})

test('honours a nested subfolder', () => {
  assert.equal(
    downloadPath({ subfolder: 'sync/browser', bucket: 'home' }, 'tabs'),
    'sync/browser/home-tabs.json',
  )
})

test('sanitises a bucket name so it cannot escape the subfolder', () => {
  assert.equal(downloadPath({ subfolder: 'd', bucket: '../evil' }, 'tabs'), 'd/evil-tabs.json')
  assert.equal(downloadPath({ subfolder: 'd', bucket: 'my work' }, 'tabs'), 'd/my-work-tabs.json')
})
