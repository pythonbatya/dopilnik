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
| `vscode/pyright-multi` | one pyright-langserver per module from `~/projects/pyright-modules.json`, each with its own venv. Also: run file (terminal per target), debug file (in-memory debugpy config), pytest CodeLens (one terminal per module). |
| `vscode/py-usages` | references of the symbol at cursor → classified sections (`subclasses`/`calls`/`imports`/`writes`/`reads` · N) in its own result editor (scheme `pyusages:`, grammar `pyusages-result` — a copy of py-hierarchy's with its own scopeName). Block headers carry the **enclosing symbol** (`Owner.method` — where in the file the usage lives; module-level falls back to the source line, which the renderer collapses to a bare `path:` header). `cmd+b` (IDEA-style): jump to the definition; standing on the definition → collect usages; several definitions → result editor. Section building: `usageGroups.ts`, enclosing-symbol lookup: `pyParse.ts` (`enclosingSymbol`) — both pure, tested; classification: `usageClassify.ts`. |
| `vscode/status-path` | active file path as breadcrumbs on the left of the status bar (breadcrumbs UI itself is off in settings). |
| `vscode/py-hierarchy` | python class/method hierarchy navigation: gutter arrows (up/down/both), `⇅ / ⇩ / ⇧` CodeLens. ⇅ opens the full picture in own **virtual read-only editors** (scheme `pyhierarchy:`, no dirty state → hot exit cannot resurrect them; the old named-untitled approach spawned zombie editors after every reload). Search-editor format: `Symbol — relpath:` clickable headers, real source match lines, ±1 dim context, blank line between all blocks (section labels attach to their content), strict one-level-per-edge nesting. ⇅ with a single chain top is re-rooted there; otherwise `⇧ bases` / anchor / `⇩ subclasses` sections (the parents walk stores bases in the children slot — a merged tree renders direction-flipped). **⇧/⇩ are quick navigation, never an editor**: for a *method*, ⇧ has exactly one target — the MRO-style next definer (bases in declaration order, first class defining the method wins, non-defining bases skipped in favor of their ancestors; declaration-order DFS ≈ C3 outside exotic diamonds) — so it is always an instant jump, no picker. For a *class*, several bases are genuine alternatives → native peek (`editor.action.peekLocations`, the cmd-click-usages widget). ⇩ with several direct children → the same peek. Keyboard: `ctrl+enter` on any result line. Rendering lives in `vscode/shared-result/src/` (`resultRender.ts`/`resultLinks.ts` pure, tested; `resultDoc.ts` vscode layer, parametrized by scheme/languageId/commandId); the grammar is a per-extension copy under `syntaxes/` with its own scopeName. Syntax colors: the buffer's language is set to the extension's own `pyhierarchy-result` grammar (`syntaxes/pyhierarchy-result.tmLanguage.json`) — python-ish but **line-local `match` rules only**; the document language must NOT be plain `python`, because the ±1 window cuts docstrings mid-way and python's stateful tokenizer then swallows everything between two unrelated `"""` fragments as one string. Context lines keep colored code — only their `NN ` prefix is dimmed (a decoration over the prefix range; decorations beat grammar). Header symbol and path take the `string` scope — same as the bundled search-result grammar colors its path lines; scopes that almost no theme defines (e.g. `entity.name.filename.find-in-files`) render default foreground. Line-number prefixes use the search grammar's own `constant.numeric.integer meta.resultLinePrefix…` scope. No literal colors anywhere — scope names and `ThemeColor` only, so switching the color theme restyles results with no extension change. |
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
- rg without network: `@vscode/ripgrep` tarball download is the only network
  npm needs on a fresh folder; the VSCode app bundle already ships rg at
  `node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/darwin-arm64/rg` —
  copy it from there when a local rg is needed. For the rest, `npm install
  --prefer-offline` survives flaky
  internet when everything else is already in cache.
