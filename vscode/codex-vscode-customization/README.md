# Codex VS Code chat placement customization

## Desired behavior

- The Codex icon in the editor title toolbar opens a new Codex tab.
- New Codex tabs open in editor group 2, creating that group if necessary.
- Group 2 is focused and locked, and shared with Claude Code chat tabs.
- Selecting an existing chat from Codex history also opens in group 2.
- Ordinary history navigation preserves the history launcher; navigation explicitly requesting replacement disposes the old launcher.
- Chat tabs open with preview disabled so subsequent chats do not replace them.

Confirmed by the user to work after the final patch on 2026-09-29.

## Environment

Installed extension patched: `openai.chatgpt-26.917.62051-darwin-arm64`.
Extension directory: `/Users/l.vinogradov/.vscode/extensions/openai.chatgpt-26.917.62051-darwin-arm64`.
VS Code settings are symlinked to `/Users/l.vinogradov/Yandex.Disk.localized/configs/vscode/settings.json`.
The original group-placement patches made no settings changes. The later selection patch updates the linked VS Code keybindings.json; Codex config.toml remains unchanged.

## Changes

1. In `package.json`, change the `contributes.menus["editor/title"]` entry from `chatgpt.openSidebar` to `chatgpt.newCodexPanel`. Copy the original sidebar command's light/dark Codex icons to the new-panel command, replacing its plus icon.
2. In `out/extension.js`, change `createNewPanel()` to pass `ViewColumn.Two` to `vscode.openWith` instead of the active code editor's view column. Keep `preview: false` and `preserveFocus: false`. After opening, execute `workbench.action.focusSecondEditorGroup`, then `workbench.action.lockEditorGroup`.
3. In the `navigate-in-new-editor-tab` message handler, open the target using `vscode.openWith`, the Codex custom editor view type, and `{preview: false, viewColumn: ViewColumn.Two, preserveFocus: false}`. Preserve existing `replaceCurrentEditor` semantics: dispose the source panel only when replacement is requested and the panel is alive. Then focus group 2 and lock it.

The minified identifiers (`qe`, `t`, `fM`, etc.) are specific to this version. They must be rechecked after updates.

## Backups in the installed extension directory

- `package.json.before-toolbar-patch`: original manifest.
- `out/extension.js.before-chat-group-patch`: original JavaScript before either JavaScript patch.
- `out/extension.js.before-history-group-patch`: JavaScript after the new-panel patch, before the history patch.

## Reapply after an update

Ask Codex:

> Read /Users/l.vinogradov/projects/dopilnik/vscode/codex-vscode-customization/README.md. Restore the described toolbar and locked second-group chat behavior for my currently installed Codex VS Code extension. First check whether supported settings now provide it. If not, adapt the archived patches to the installed version, preserve backups, validate, and apply. Do not replace the new extension with old extension files.

The scripts in `scripts-26.917.62051/` are historical patch recipes, not a universal installer. They contain absolute paths to the old version; two apply immediately when run. Do not blindly run them against an updated extension. Each requires exact matching source and refuses to overwrite its backup.

Validation performed: JavaScript syntax checks, mocked checks of both history navigation branches, and user confirmation in VS Code. After reapplying, reload the window and verify: toolbar opens group 2; selecting history opens the chat in group 2; multiple chats remain separate; Claude shares the group; ordinary files stay in the code group.

## Potential companion extension

A companion extension could own a stable toolbar command and potentially relocate Codex custom-editor tabs using public VS Code APIs. This has not been implemented or validated. It would need to handle history navigation, existing tabs, locking, focus, and the original toolbar button. Simply wrapping the new-chat command would not fix history navigation. Investigate public API feasibility before promising an update-proof replacement. Avoid automatic edits to a vendor bundle on activation.


## Selection references and shared Claude group (2026-09-29)

Recipe: `patch-selection-and-claude-group.py` (dry run by default, `--apply` writes changes). Specific to Codex 26.917.62051 and Claude Code 2.1.284; inspect installed versions before adapting it.

- In the real linked VS Code `keybindings.json`, replace Cmd+L's `claude-vscode.insertAtMention` with `chatgpt.addToThread`, limited to `editorTextFocus`. Keep other shortcuts unchanged. This shortcut now always targets Codex, not whichever provider was last active.
- Codex's selection command already captures file path and selected line range. Its helper originally calls `Ia()` to open the sidebar before adding context. Replace that call with a new `addContextToChat` method.
- The new method chooses a visible Codex panel in group 2, then a live last-focused Codex panel, then another Codex panel in group 2. If none exists, create a Codex panel. Reveal the chosen panel in group 2, record it as focused, send the existing `add-context-file` message, and lock the group. The link is added to the composer; no prompt is automatically submitted.
- Claude's default panel-group selector `Fu1` now returns `{viewColumn:2,startsClaudeGroup:true}` so new panels share group 2 and invoke its existing group-lock behavior. Explicit caller-provided placement and already-open/restored Claude sessions retain their original behavior; existing Claude tabs in a third group may need to be moved manually once.
- Backups are next to each changed file with suffix `.before-selection-routing-patch`: Codex `out/extension.js`, Claude `extension.js`, and the real settings directory's `keybindings.json`.
- Checked JavaScript syntax for both extensions and mocked Codex routing for visible-chat, last-used-chat, and no-chat cases. User UI verification is still required: reload VS Code, select code, press Cmd+L, verify a file/line chip appears in the intended Codex chat; open a new Claude tab and verify group 2.
- Extension updates can remove the JavaScript changes independently. The user keybinding persists across extension updates, but stock Codex may then route its attachment back to the sidebar. Reapply/adapt the patches together when restoring this behavior.
