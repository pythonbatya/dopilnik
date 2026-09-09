#!/usr/bin/env node
// Copies src/ into dist/<browser>/ with that browser's manifest. No bundler: the source
// is plain ES modules that both browsers load directly.

import { cp, mkdir, rm, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const src = join(root, 'src')

for (const target of ['chrome', 'firefox']) {
  const out = join(root, 'dist', target)

  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  await cp(src, out, { recursive: true })

  await rename(join(out, `manifest.${target}.json`), join(out, 'manifest.json'))
  await rm(join(out, `manifest.${target === 'chrome' ? 'firefox' : 'chrome'}.json`))

  console.log(`built dist/${target}`)
}
