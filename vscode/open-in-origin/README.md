# open-in-origin

One command — **Open Line in Origin** (`openInOrigin.openAtLine`): open the current
editor line on the origin remote's web UI as a permalink to HEAD's commit
(IDEA's "Open on GitHub" behaviour). Reachable from the command palette, the
editor title bar (`$(link-external)` button) and the editor context menu.

- Cursor line → `#L42`; a multi-line selection → `#L10-L25` (a selection ending
  at column 0 does not count its last line).
- `github.com` remotes → `/blob/<sha>/…`; any other host → forgejo/gitea
  `/src/commit/<sha>/…`. Remote url shapes handled: `ssh://git@host[:port]/…`,
  `git@host:…`, `https://host/…`.
- Known limits: an unpushed HEAD 404s in the browser (nothing to detect that
  offline), and a dirty buffer's line numbers can differ from the remote.
