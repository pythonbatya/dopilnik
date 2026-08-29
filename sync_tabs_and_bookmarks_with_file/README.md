# dopilnik sync

Exports bookmarks and open tabs to files automatically, for Chrome and Firefox, from one
source tree.

- **Bookmarks** are written whenever they change (debounced ~30s), as a
  `NETSCAPE-Bookmark-file-1` HTML file — the same format the browser's own
  "Export bookmarks" produces, so any browser can import it without this extension.
- **Tabs** are snapshotted on a timer (default 15 min) as JSON.
- Files land in `Downloads/<subfolder>/<bucket>-bookmarks.html` and `<bucket>-tabs.json`.
  Set **bucket** per browser profile (`work`, `home`) so profiles never share a file.

## Quick start

    cd sync_tabs_and_bookmarks_with_file
    node build.js

Then in **Chrome**: `chrome://extensions` → enable **Developer mode** (top right) →
**Load unpacked** → select `dist/chrome`.

In **Firefox**: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
select `dist/firefox/manifest.json`.

Finally open the extension's options and set the **bucket** name for that profile
(`work`, `home`, …). Until you do, files are named `default-*`.

Rebuilding after a code change: re-run `node build.js`, then press the reload arrow on the
extension's card in `chrome://extensions`.

## Tests

    npm test             # 57 tests, no dependencies

> Firefox removes a temporary add-on on restart. For permanent installation the extension
> must be signed (an "unlisted" signature from addons.mozilla.org is free), or run in
> Developer Edition / ESR with `xpinstall.signatures.required=false`.

## What the popup shows

Clicking the toolbar icon gives one row per kind:

    Bookmarks   4 min ago ✓    [Sync now]
    Tabs        3 h ago ⚠      [Sync now]  [Write anyway]

- **Sync now** — one per row, a manual write of that kind. Safe to press at any time; it
  only writes a file, and does nothing at all if the data has not changed.
- **Write anyway** — appears *only* after the guard has refused a write, and forces it
  through. Hover it for the reason.
- **Settings and restore** — opens the options page.

Nothing in the popup can touch your bookmarks or tabs. Restoring lives in options, needs a
file picked first, and does nothing until you pick one.

## Restore on a fresh machine

Bookmarks can be restored two ways: through the browser's own bookmark importer (the file
is a standard export), or through the extension's options page, which also offers
*merge* — adds only what is missing, never deletes, and is idempotent.

Tabs restore from the options page: every saved window is reopened with its tabs. URLs that
cannot be recreated (`chrome://`, `about:`, extension pages) are skipped and counted.

## Writing somewhere other than Downloads

The `downloads` API only accepts paths relative to the browser's download directory —
absolute paths, `..` and `~` are rejected by the browser itself. To get files into another
directory, symlink the subfolder:

    ln -s ~/sync/browser ~/Downloads/dopilnik

**Unverified** — see below.

## Still to verify by hand

Neither can be checked without loading the extension into a real browser:

1. **Symlinked subfolder** — does the browser follow `~/Downloads/dopilnik` when it is a
   symlink, or refuse it? Determines whether the section above is true.
2. **Large bookmarks file through a `data:` URL in Chrome.** Chrome MV3 service workers have
   no `URL.createObjectURL`, so `writer.js` encodes the payload as a `data:` URL there
   (Firefox uses a blob URL). Stack-overflow on large input is fixed and tested; what
   remains untested is whether Chrome imposes a *size ceiling* on a `data:` URL download.
   If it does, the fallback is Chrome's offscreen document API, and it is contained in
   `buildDownloadUrl` alone.

## Failure visibility

The service worker is terminated constantly by design — that is not a failure. Nothing is
kept in worker memory: settings and a heartbeat (`lastAttemptAt`, `lastWriteAt`,
`lastResult`, `lastCount`) live in `storage.local`.

- The **popup** computes staleness itself when you open it, so it is correct even with the
  worker dead.
- The **badge** shows `!` when a wake finds the last write stale — weaker by nature, since
  nothing sets it if nothing ever wakes.
- **Alarms are re-asserted on every wake**, because Chrome has been observed to drop them.
- Bookmarks are never called "stale" for being old (a quiet month is normal); they are
  called stale when a change was noticed and never flushed.
- Nothing inside the extension can detect the extension being disabled or the browser not
  running. The only honest signal there is the file's own timestamp on disk.

## Guard

There is no snapshot history, so a bad write is unrecoverable. Writes are refused when the
snapshot is empty, or has lost more than 90% of its entries versus the last one — the
realistic case being the browser still starting up when the interval alarm fires. A veto
shows in the popup with a **Write anyway** button.
