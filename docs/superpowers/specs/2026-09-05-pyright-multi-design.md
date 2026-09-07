# pyright-multi — design

Date: 2026-09-05
Status: draft, awaiting review
Idea origin: the manifest-of-modules approach was proposed by the user (IntelliJ
`.idea` per-module SDK model), not by Claude.

## Problem

The user works in one VSCode window with `~/projects` opened as a single folder (~40
repos, microservice tasks span many of them). Python intelligence must resolve each
repo's own `.venv`, including monorepos with several internal venvs and java services
with an embedded python client.

Current tooling cannot do this:

- stock `ms-pyright` reads exactly ONE `pyrightconfig.json` per window: workspace root
  = the FIRST workspace folder, config search walks UP from that root, never down into
  subfolders; `executionEnvironments` has no `venv` field, so one config file can only
  express one interpreter for the whole tree;
- Pylance was tried and rejected: misbehaved even in multi-root workspaces;
- basedpyright supports per-workspace-ROOT configs in multi-root workspaces only; its
  `configFilePath` is a single override — no subfolder discovery either.

Multi-root workspaces are not an acceptable UX for this user (they also make the
Claude Code extension lose the visible session list).

## Goal

Open any folder as ONE folder in one window; each module listed explicitly in a
manifest gets its own `pyright-langserver` with its own venv; servers start lazily;
no orphan processes, no silent degradation.

## Non-goals

- No auto-discovery of `.venv` / `pyrightconfig.json` (explicit manifest only).
- No custom type-checking: stock pyright engine; each module's own
  `pyrightconfig.json` (if present) governs include/typeCheckingMode.
- No changes to how pyright resolves imports — we only choose interpreter + root per
  server.
- Not now (possible v2): idle timeout for servers of closed tabs, subfolder config
  discovery, publishing to a marketplace.

## Manifest: `pyright-modules.json`

Lives at each workspace folder root (`~/projects/pyright-modules.json` for the main
case). jsonc (comments allowed). Paths relative to the manifest's directory unless
absolute.

```jsonc
{
  "modules": [
    { "root": "frontik" },                                  // venv defaults to <root>/.venv
    { "root": "some-service/python-client" },               // python client inside a java monorepo
    { "root": "hh.kardinal", "venv": "/Users/l.vinogradov/tmp/test_venv" }
  ]
}
```

- `root` (required): module directory; the language server's rootUri; files under it
  (including its `.venv` site-packages) route to its server.
- `venv` (optional): path to the venv dir; default `<root>/.venv`. Absolute paths
  allowed (venv may live outside the repo).
- Broken manifest: keep the last valid one, warn in the Output channel and status bar.
- A `pyrightconfig.json` next to `root` is picked up by the server automatically
  (rootUri = `root`); it is optional.
- Fallback: if a workspace folder has no manifest but its own root contains `.venv`
  or `pyrightconfig.json`, treat the folder itself as a single implicit module (so
  opening one repo directly behaves like stock pyright).

## Components

Standard VSCode TypeScript extension (`src/`, esbuild → `dist/extension.js`,
`vsce package` → `.vsix`, local install; layout follows the official template, not
the sibling browser extension's).

- `src/manifest.ts` — load/parse/validate (jsonc), diff old vs new (added / removed /
  changed venv or root), emit module set. Re-read triggers: activation,
  `onDidChangeWorkspaceFolders`, watcher event on the manifest file,
  `onDidSaveTextDocument` (manifest saved from the editor), python file opened with
  no module matched, window focus. Correctness never depends on the watcher alone.
- `src/router.ts` — absolute file path → module: longest-prefix match on `root`;
  files under a module's `.venv` belong to that module; no match → null.
- `src/serverManager.ts` — one `LanguageClient` per module; server command:
  `node <extension-dir>/node_modules/pyright/langserver.index.js --stdio`; the
  module's venv python is passed to the server as its interpreter setting (same
  channel ms-pyright uses for "pythonPath from Python extension"); middleware drops
  document events/requests for URIs outside the module root, so a server never sees
  foreign files; handles `onDidChangeState` (crashed → lazy restart with backoff on
  next request).
- `src/extension.ts` — activation (`onWorkspaceContains:pyright-modules.json`,
  `onLanguage:python` for the implicit-module fallback), wiring, status bar item
  ("pyright-multi: 3 modules, 2 active"), orphan sweep at startup, `deactivate`.

Routing rule: on `didOpen` of a python file, resolve module; if none — do nothing;
if module has no live server — start it, then forward. Deepest module wins.

## Lifecycle triggers

| Event | Action |
|---|---|
| Activation / workspace folders changed | Read manifest(s). No servers started. |
| Manifest changed (watcher or any re-read trigger) | Diff; stop removed modules' servers; remember new ones (lazy). |
| Python file opened | Route to module; start its server if not running. |
| Module removed from manifest / folder removed | Stop its server. |
| Reload window / close window / disable extension | `deactivate()` → `client.stop()` for all. |
| Server process crashed | Mark stopped; restart lazily with backoff. |

## Orphan safety (three layers)

Only OS processes we create are N langservers. The watcher lives in
`context.subscriptions` (VSCode infrastructure, cannot orphan); no temp files are
written by us or pyright-langserver.

1. Normal exit: `deactivate()` → `client.stop()` each (library sends `shutdown` →
   `exit`, escalates SIGTERM → SIGKILL on timeout).
2. Hard death of the extension host (`kill -9`, crash): each server's stdin pipe
   closes → EOF → pyright-langserver exits. Must be verified on the spike, not
   assumed.
3. Startup sweep on activation: kill processes whose command line references OUR
   bundled langserver path AND `ppid == 1` (orphaned). Never touch foreign pyright
   processes.

## Failure modes

| Failure | Behaviour |
|---|---|
| Watcher silently dead | Manifest changes apply at the next re-read trigger (degraded latency, not broken). |
| Manifest broken / missing | Keep last valid; warning in Output + status bar; no servers touched. |
| `venv` dir missing at spawn | Warning; retry on next file open from that module. |
| Server crash | Lazy restart with backoff; visible in status bar. |
| Extension host SIGKILLed | EOF exit + startup sweep. |
| File outside any module | No server, no intellisense (same as today). |

## Testing

Unit (no VSCode, plain node test runner): manifest parse (jsonc, broken → last
valid, venv default, absolute paths), diff decisions, router (nested modules, venv
site-packages, no match).

Scripted manual checklist (macOS, kept in the extension README, run before "done"):

1. Reload Window with 2 active servers → exactly 2 new, 0 old processes.
2. Close window → 0 langserver processes.
3. Cmd+Q → 0 langserver processes.
4. `kill -9` extension host → servers exit via stdin EOF.
5. `kill -9` whole VSCode → leftovers swept at next activation.
6. Add/remove workspace folder → modules appear/disappear.
7. Edit live manifest (add/remove module, break JSON) → applied; broken keeps last
   valid + warning.
8. Delete `.venv` of a live module → visible error, no zombie.
9. Open file outside modules → nothing spawns.
10. Module without venv → warning; works after venv appears.
11. Hover/goto-def into libraries resolves from each module's own venv (frontik ≠
    vecsearch), not system python.

## Packaging / coexistence

- Extension id: `lvinogradov.pyright-multi`; folder `dopilnik/pyright-multi`.
- `pyright` npm package ships inside the `.vsix` (server + typeshed fallback, ~40MB).
- ms-pyright MUST be disabled while pyright-multi is enabled (both would serve python
  files); ms-python.python stays only for debugpy (`python.languageServer: "None"`
  already set). Installation instructions in README.

## Spike (first step of the implementation plan)

Hardcode two modules (frontik, vecsearch). Verify: hover/goto-def resolve from each
module's own venv; checklist items 1, 4, 5 (process hygiene) pass. Only then build
the manifest/router/general path.
