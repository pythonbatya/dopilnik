from pathlib import Path
import subprocess

path = Path('/Users/l.vinogradov/.vscode/extensions/openai.chatgpt-26.917.62051-darwin-arm64/out/extension.js')
original = path.read_text()
old = 'async createNewPanel(){let e=fM("/extension/panel/new"),r=qe.window.activeTextEditor?.viewColumn??qe.ViewColumn.Active;await qe.commands.executeCommand("vscode.openWith",e,t.customEditorViewType,{viewColumn:r,preserveFocus:!1,preview:!1})}'
new = 'async createNewPanel(){let e=fM("/extension/panel/new"),r=qe.ViewColumn.Two;await qe.commands.executeCommand("vscode.openWith",e,t.customEditorViewType,{viewColumn:r,preserveFocus:!1,preview:!1});await qe.commands.executeCommand("workbench.action.focusSecondEditorGroup");await qe.commands.executeCommand("workbench.action.lockEditorGroup")}'
assert original.count(old) == 1, 'Expected exactly one original method; no files changed.'
patched = original.replace(old, new)
staged = Path('/private/tmp/codex-extension-chat-group-check.js')
staged.write_text(patched)
subprocess.run(['node', '--check', str(staged)], check=True)
backup = path.with_name('extension.js.before-chat-group-patch')
assert not backup.exists(), 'Backup already exists; no files changed.'
backup.write_text(original)
try:
    path.write_text(patched)
    assert path.read_text() == patched
except Exception:
    path.write_text(original)
    raise
print('Patched and syntax-checked: new Codex tabs target group 2, focus it, and lock it. Backup: ' + str(backup))
