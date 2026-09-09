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
- Servers live until the window closes or reloads (deactivate → shutdown/exit);
  closing tabs does not stop them. If VSCode is hard-killed, servers die on stdin
  EOF; any leftover is swept at the next activation.

## Running and debugging files

- Command `pyright-multi: Run python file`: play button in the editor title bar,
  `▶ Run` CodeLens above `if __name__ == '__main__':`, editor context menu, palette.
- Command `pyright-multi: Debug python file`: bug button beside the play button,
  `🐞 Debug` lens beside `▶ Run`, editor context menu, palette.
- Run: `<venv>/bin/python <relpath>` in a terminal with cwd = module root and the
  venv activated in the terminal env (`VIRTUAL_ENV`, `PATH`). Files outside any
  module run with system `python3` from the file's directory.
- Debug: in-memory debugpy launch config (nothing written to launch.json) with
  the module's venv python and module root; the installed ms-python.debugpy
  adapter runs it, so venvs don't need debugpy installed. F5 and existing
  launch.json configs are untouched.
- One terminal per run target (`pm: <module>/<relpath>`), reused across runs; the
  dirty file is saved first. While a target's process is running (detected via
  shell integration), re-invoking it shows a warning instead of typing into the
  running process's stdin, and the lens shows `● running…`.
- Any command can get a hotkey via Keyboard Shortcuts (both run and debug).
- pytest: `▶ Run | 🐞 Debug` lenses over every collected target in `test_*.py` /
  `*_test.py` files — test functions, `Test*` class methods (nested classes too,
  `file::TestOuter::TestInner::test_x`) and whole `Test*` classes. Runs
  `<venv>/bin/python -m pytest <nodeid>` from the module root; **one terminal
  per module** (`pm: pytest <module>`), shared by all its tests. Debug launches
  pytest as a debugpy module with the node id. Plain helpers, non-`Test`
  classes and defs nested inside functions get no lens (pytest would not
  collect them either).
- The native ms-python play button keeps using the single workspace interpreter —
  don't click it; it can be hidden via right-click on the editor toolbar.

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

## Roadmap (not implemented yet)

- nothing concrete; candidates: run-configurations panel, Test Explorer integration.

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
| 12 | Run button / lens on a module file | terminal `pm: <module>/<rel>`, cwd = module root, venv python runs it | |
| 13 | Repeat run of same file | same terminal reused, command re-sent | |
| 14 | Two files of one module | two separate terminals, both can run | |
| 15 | Run while target still busy | warning toast, no text injected into the process; lens shows `● running…` | |
| 16 | Edit + run without saving | file saved automatically before run | |
| 17 | Run file outside modules | system `python3`, cwd = file dir | |
| 18 | Module venv deleted | warning toast with the missing python path | |
| 19 | Debug button / lens on a module file | session `pm debug: <module>/<rel>` starts, breakpoint hits, debug console python = module venv | |
| 20 | Debug file outside modules | runs under system `python3` | |
| 21 | Test function / class / method lens run | `pm: pytest <module>` terminal, `python -m pytest file::…`, only that target runs | |
| 22 | Two different tests of one module | same `pm: pytest <module>` terminal, commands queue sequentially | |
| 23 | Test debug lens | breakpoint inside the test is hit; session named `pm debug: pytest …` | |
| 24 | Lenses absent for helpers / non-Test classes / nested defs | only collectable targets get lenses | |

## Implementation notes

Pyright's language server only reads its interpreter from the `python` settings
section, pulled via the LSP `workspace/configuration` request; this extension
answers that request per module through `middleware.workspace.configuration`
(`initializationOptions.pythonPath` is ignored by pyright 1.1.413). The server's
project root comes from `clientOptions.workspaceFolder`, which also locks the
client's `workspaceFolders` initialize params to the module root.
