# pyright-multi

One pyright language server per module, each with its own venv. Built for opening
`~/projects` (many repos) as a single VSCode folder.

## How it works

- `pyright-modules.json` at the workspace folder root lists modules:

  ```jsonc
  { "modules": [ { "root": "frontik" }, { "root": "hh.kardinal", "venv": "/abs/path/venv" } ] }
  ```

- `venv` defaults to `<root>/.venv`. Paths relative to the manifest unless absolute.
- Each module gets its own `pyright-langserver`, started lazily on the first opened
  python file under it. Each server uses the module's `pyrightconfig.json` if present.
- Files outside any module get no python intelligence.
- Editing the manifest applies live (watcher + re-read on file open / window focus);
  a broken manifest keeps the last valid module list.

## Install / develop

- Dev: open this folder, `npm install`, F5 ("Run Extension").
- Package: `npm run package` → install the vsix:
  `code --install-extension pyright-multi-0.1.0.vsix`

## IMPORTANT: coexistence

Disable the stock `ms-pyright` extension (and Pylance) while using this one — two
servers on the same python files produce duplicate/wrong intelligence.
`ms-python.python` can stay (debugpy only, `python.languageServer: "None"`).

## Diagnostics

- Output channel "pyright-multi" (command: `pyright-multi: Show status`).
- Per-module channels "pyright-multi: <module>" carry the pyright server log.
- Processes: `ps -axo pid=,ppid=,command= | grep langserver.index.js`
  — ours carry the path into this extension's node_modules. Orphaned ones
  (ppid = 1) are swept at the next extension activation.

## Manual test checklist (run before any "done")

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | Reload Window, 2 modules active | exactly 2 new processes, 0 old | |
| 2 | Close window | 0 langserver processes | |
| 3 | Cmd+Q | 0 langserver processes | |
| 4 | `kill -9` extension host | servers exit via stdin EOF | |
| 5 | `kill -9` whole VSCode | next start sweeps orphans | |
| 6 | Add/remove workspace folder | module count follows | |
| 7 | Edit manifest live (add/remove/break) | applied live; broken keeps last valid | |
| 8 | Delete .venv of live module | visible error, no zombie | |
| 9 | Open file outside modules | nothing spawns | |
| 10 | Module with missing venv | warning; works after venv appears | |
| 11 | hover/goto-def per module | resolves from that module's venv | |

## Implementation notes

Pyright's language server only reads its interpreter from the `python` settings
section, pulled via the LSP `workspace/configuration` request; this extension
answers that request per module through `middleware.workspace.configuration`
(`initializationOptions.pythonPath` is ignored by pyright 1.1.413). The server's
project root comes from `clientOptions.workspaceFolder`, which also locks the
client's `workspaceFolders` initialize params to the module root.
