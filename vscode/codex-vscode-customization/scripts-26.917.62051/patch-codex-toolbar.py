import json
from pathlib import Path

path = Path('/Users/l.vinogradov/.vscode/extensions/openai.chatgpt-26.917.62051-darwin-arm64/package.json')
original = path.read_text()
data = json.loads(original)
contrib = data['contributes']
commands = {c['command']: c for c in contrib['commands']}
entries = contrib['menus']['editor/title']
entry = next(e for e in entries if e['command'] == 'chatgpt.openSidebar')
entry['command'] = 'chatgpt.newCodexPanel'
commands['chatgpt.newCodexPanel']['icon'] = commands['chatgpt.openSidebar']['icon'].copy()
backup = path.with_name('package.json.before-toolbar-patch')
if backup.exists():
    raise SystemExit('Backup already exists; stopped to preserve it.')
backup.write_text(original)
try:
    path.write_text(json.dumps(data, indent=2) + '\n')
    verified = json.loads(path.read_text())
    assert verified['contributes']['menus']['editor/title'] == entries
    assert next(c for c in verified['contributes']['commands'] if c['command'] == 'chatgpt.newCodexPanel')['icon'] == commands['chatgpt.openSidebar']['icon']
except Exception:
    path.write_text(original)
    raise
print('Updated Codex editor toolbar button to chatgpt.newCodexPanel. Original manifest backed up at ' + str(backup))
