# dopilnik — personal tooling upgrades

Repo for upgrading the software around the main work. Layout: `vscode/` — VSCode
extensions, `browser/` — browser extensions, `vscode/shared-result/` — source
library (NOT an extension): the result-editor machinery shared by py-hierarchy
and py-usages; esbuild bundles it into each extension's `dist/`, so every vsix
is fully standalone — no runtime dependency, deleting either consumer (or the
folder) cannot break the other.

## Extensions

| Folder | What it is |
|---|---|
| `vscode/pyright-multi` | one pyright-langserver per module from `~/projects/pyright-modules.json`, each with its own venv. Also: run file (terminal per target), debug file (in-memory debugpy config), pytest CodeLens (one terminal per module). **Restarting a server**: `pyrightMulti.restartServer` (palette only, by the owner's choice — quick pick: this module / all running / show log; the status-bar item stays non-clickable) does `stop()` + `ensureStarted()`, which is the only way short of a window reload to make pyright see a *new top-level package*. Automatic path: `rootSnapshot.ts` (pure, tested) keeps the top-level dir names per module root and the existing window-focus hook re-reads them, restarting any module whose set changed — focus is the right moment because the dir is created in a terminal. `readRootDirs` must `stat()` symlinks itself (`isDirectory()` is false for them). Ignores dotfiles and `__pycache__`, else every cache write would restart a server. Note `applyCurrentModules()` alone can never fix this: it diffs the module *set* (`diffManifests` compares parsed `{root, venv}`, not file text), so touching `pyright-modules.json` is a no-op for a running server. |
| `vscode/py-usages` | references of the symbol at cursor → classified sections (`subclasses`/`calls`/`imports`/`writes`/`reads` · N) in its own result editor (scheme `pyusages:`, grammar `pyusages-result` — a copy of py-hierarchy's with its own scopeName). Block headers carry the **enclosing symbol** (`Owner.method` — where in the file the usage lives; module-level falls back to the source line, which the renderer collapses to a bare `path:` header). `cmd+b` (IDEA-style): jump to the definition; standing on the definition → collect usages; several definitions → result editor. Section building: `usageGroups.ts`, enclosing-symbol lookup: `pyParse.ts` (`enclosingSymbol`) — both pure, tested; classification: `usageClassify.ts`. |
| `vscode/git-blame` | IDEA-style git blame column (date + author, heatmap by commit age), `cmd+;` toggles with `when: editorTextFocus` (one user-level press fully shadows the built-in Testing chord family `cmd+; <key>`). Russian layout: plain `cmd+;` does not resolve there (VSCode matches punctuation by produced char, and cyrillic keys like `cmd+ж` are rejected by the parser) — solved with the scan-code notation `cmd+[Semicolon]`, which matches the physical key in any layout (added by the owner via the Keyboard Shortcuts UI; that notation is the general answer for layout-independent punctuation keys). Hotkeys are proposed to the owner first, never installed silently. Fork of Simply Blame (JamiLu, GPL-2.0, upstream v1.11.2) vendored wholesale: publisher rebranded to `lvinogradov` so the marketplace original can never auto-install over it, and the contributed keybinding removed per convention. Hover at a line start → commit card; the hash there runs `simplyblame.hashAction` (`copy`/`remote`/`local` — `local` opens the built-in `git.viewCommit`, the closest thing to IDEA's clickable blame; decorations themselves are not clickable — core-only). The card also has a "Show diff" link (v1.12.0) → `simply-blame.showCommitDiff` → the STANDARD `vscode.diff` editor over `sbrev:` virtual documents (`git show <rev>:<path>` run from the repo root; porcelain `filename` is root-relative — verified), left = `hash^` (empty pane for root commits), right = `hash`, tab title `file @ short-hash`. `cmd+;` inside those diff panes runs revision-aware blame (`git blame --porcelain <rev> -- <path>` from the repo root: right pane blames `hash`, left `hash^`; root-commit left pane / file-not-at-parent → no column silently), and the hover works there too, so Show diff recurses through history IDEA-style — but blame is never auto-enabled in diffs (owner's choice). EditorManager keys blame state by `document.uri.toString()`, NOT fileName: both diff panes share one fsPath and differ only in the query (rev). `sbrev:` documents have no real fileName — hover/git helpers build the in-repo path from the URI (`revUriSourceFile`). `cmd+;` in any other non-`file` document (e.g. the `git:` left pane of a standard working-tree diff) is a silent no-op. git-not-found is detected by `ENOENT|git: not found` — the upstream regex matched ANY message containing the word "git" (a plain "not a git repository" failure reported "Git installion not found"). Known limit: renames between `hash^` and `hash` open the old side by the new path (empty pane + error toast). Vendored from upstream v1.11.2 with fixes: git runs via `spawn(file, args)` without a shell (upstream passed a quoted string to `shell: true` — broke on quote-hostile filenames); dead `BlameLensProvider.ts` removed; `toHex` hex-channel fix (10–15 produced `1a` instead of `0a`); the status-bar item shows only while blame is computing (upstream kept it always visible); the column reads `DD.MM.YYYY␣author` (upstream: author first, em-space padding, wider boxes) — the date part is natural-width with ` ` figure-space padding on empty lines, so column alignment relies on the fixed date format pinned in user settings (`simplyblame.dateFormat: "DD.MM.YYYY"`). Author names truncate at 14 chars with `…` (full name stays in the hover — a 500-char author cannot widen the column); the author box is `min(maxNameLen,14) * ceil(editor.fontSize*0.6) + 4` px — monospace glyph advance ≈0.6em, editor font size unchanged. Tests are upstream's vscode-test-electron suites (not the dopilnik tsx pattern); `command()` takes an args array — Git.test.ts asserts that shape. |
| `vscode/py-hierarchy` | python class/method hierarchy navigation: gutter arrows (up/down/both), `⇅ / ⇩ / ⇧` CodeLens. ⇅ opens the full picture in own **virtual read-only editors** (scheme `pyhierarchy:`, no dirty state → hot exit cannot resurrect them; the old named-untitled approach spawned zombie editors after every reload). Search-editor format: `Symbol — relpath:` clickable headers, real source match lines, ±1 dim context, blank line between all blocks (section labels attach to their content), strict one-level-per-edge nesting. ⇅ with a single chain top is re-rooted there; otherwise `⇧ bases` / anchor / `⇩ subclasses` sections (the parents walk stores bases in the children slot — a merged tree renders direction-flipped). **⇧/⇩ are quick navigation, never an editor**: for a *method*, ⇧ has exactly one target — the MRO-style next definer (bases in declaration order, first class defining the method wins, non-defining bases skipped in favor of their ancestors; declaration-order DFS ≈ C3 outside exotic diamonds) — so it is always an instant jump, no picker. For a *class*, several bases are genuine alternatives → native peek (`editor.action.peekLocations`, the cmd-click-usages widget). ⇩ with several direct children → the same peek. Keyboard: `ctrl+enter` on any result line. Rendering lives in `vscode/shared-result/src/` (`resultRender.ts`/`resultLinks.ts` pure, tested; `resultDoc.ts` vscode layer, parametrized by scheme/languageId/commandId); the grammar is a per-extension copy under `syntaxes/` with its own scopeName. Syntax colors: the buffer's language is set to the extension's own `pyhierarchy-result` grammar (`syntaxes/pyhierarchy-result.tmLanguage.json`) — python-ish but **line-local `match` rules only**; the document language must NOT be plain `python`, because the ±1 window cuts docstrings mid-way and python's stateful tokenizer then swallows everything between two unrelated `"""` fragments as one string. Context lines keep colored code — only their `NN ` prefix is dimmed (a decoration over the prefix range; decorations beat grammar). Header symbol and path take the `string` scope — same as the bundled search-result grammar colors its path lines; scopes that almost no theme defines (e.g. `entity.name.filename.find-in-files`) render default foreground. Line-number prefixes use the search grammar's own `constant.numeric.integer meta.resultLinePrefix…` scope. No literal colors anywhere — scope names and `ThemeColor` only, so switching the color theme restyles results with no extension change. |
| `vscode/open-in-origin` | one command `openInOrigin.openAtLine` ("Open Line in Origin", palette + editor title-bar `$(link-external)` button + editor context menu, `when: resourceScheme == file`): open the current line on origin's web UI as a permalink to HEAD's sha (IDEA's "Open on GitHub"; owner's choice over branch urls). Cursor → `#L42`, multi-line selection → `#L10-L25` (selection ending at col 0 drops its last line). `github.com` → `/blob/<sha>/…`, any other host → forgejo/gitea `/src/commit/<sha>/…` — no settings, the else-branch covers `forgejo.pyn.ru`. Remote shapes: `ssh://git@host[:port]/…` (port dropped — web UI is https), `git@host:…`, `https://host/…`; anything else → warning toast. git runs via `execFile` (no shell) from the file's dir. Pure logic in `remoteUrl.ts` (parse/build/span), tested; known limits: unpushed HEAD 404s (undetectable offline), dirty buffer lines can drift. |
| `vscode/reveal` | one title-bar button on the Explorer file tree (and `cmd+shift+1` from the user's keybindings.json): reveals the active editor file — opens the sidebar if hidden, expands the path, scrolls — the on-demand companion to `explorer.autoReveal: false` set in the user settings. |

## Stack and workflow (same for all extensions)

- TypeScript strict, esbuild → `dist/`. Commands: `npm run compile` / `typecheck` / `test` / `package` (vsce).
- Unit tests run in plain node via `tsx --test` and MUST NOT import `vscode`:
  pure logic (parsing, builders) lives in its own modules and is TDD-ed; the
  vscode layer stays thin and untested.
- Version in package.json is bumped on every change before install.
- Extensions never contribute keybindings (`contributes.keybindings`): they
  expose commands, and every hotkey lives in the user's keybindings.json
- Install: no bare `code` in PATH — use
  `'/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' --install-extension <file>.vsix`.
- Comments in English; small surgical diffs; **git is the human's** — never
  commit unless asked in chat (an uncommitted pile mid-work is normal).

## VSCode API landmines (each cost real time once)

- Peek windows: `editor.action.peekLocations` (undocumented but stable, the
  GitLens path) renders the native peek with a custom location list. Args are
  **positional** — `(uri, position, locations, multiple)` with `multiple` a
  string `'peek' | 'gotoAndPeek' | 'goto'`; the object form fails the URI
  constraint and the command silently does nothing. Buttons
  inside ANY peek and clickable gutter decorations are core-only — extensions
  never get them (the git stage/revert peek is a built-in extension).
- pyright npm 1.1.413: the implementation provider returns nothing in
  practice. Subclasses/overrides are found via the references provider with a
  position filter (reference on a base position = subclass, on a def name =
  override); references do NOT include overriding method declarations, so
  method children are built structurally (owner's subclasses × same-name defs).
- A cold language server answers [] for a while: never cache empty answers
  forever (short TTL), and re-fire CodeLens providers on a retry schedule.
- Multi-root workspaces are rejected by the user; everything is built around
  one opened folder (`~/projects`) + manifest.
- `vscode.workspace.asRelativePath` is the stable API name; `asRelativeUri` does
  not exist (typecheck catches it, but only after you have written it).
- TreeView double-click has no API. `onDidChangeSelection` does NOT refire on a
  repeat click of an already-selected row, and `TreeItem.command` fires on every
  SINGLE click. The only working dblclick: count `TreeItem.command` activations
  per row, act on the second within ~300ms (proven once in a deleted extension).
- An extension gets exactly ONE tab in the bottom panel; "tabs" inside it would
  have to be faked with auto-collapsing group headers. Real tabs are core-only.
- Named untitled documents (`untitled:Some Name`) + hot exit = zombie editors
  after every reload, multiplying and restoring empty. Virtual documents
  (own scheme + TextDocumentContentProvider) have no dirty state and no
  backups — that is the only shape that cannot resurrect.
- **VSCode's file watcher does not descend into symlinked directories**, and
  `Dirent.isDirectory()` is false for a symlink (it reports `isSymbolicLink()`) —
  so `ln -s ../other-repo/pkg pkg` inside a module root is invisible to both the
  watcher and pyright's own `**/*.py` watch, and the import stays unresolved until
  the server process is restarted. Poll with `readdir` + `stat` when a symlinked
  tree must be noticed; a FileSystemWatcher will not do it.
- rg without network: `@vscode/ripgrep` tarball download is the only network
  npm needs on a fresh folder; the VSCode app bundle already ships rg at
  `node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/darwin-arm64/rg` —
  copy it from there when a local rg is needed. For the rest, `npm install
  --prefer-offline` survives flaky
  internet when everything else is already in cache.
