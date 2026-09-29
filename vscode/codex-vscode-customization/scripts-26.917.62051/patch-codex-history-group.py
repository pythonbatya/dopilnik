from pathlib import Path
import subprocess
import sys

path = Path('/Users/l.vinogradov/.vscode/extensions/openai.chatgpt-26.917.62051-darwin-arm64/out/extension.js')
original = path.read_text()
old = 'case"navigate-in-new-editor-tab":{let n=fM(r.path);if(!r.replaceCurrentEditor){qe.commands.executeCommand("vscode.open",n);break}let o=this.findPanelByWebview(e);await qe.commands.executeCommand("vscode.open",n,{preview:!1,viewColumn:this.getPanelViewColumn(o)}),o!=null&&this.isPanelAlive(o)&&o.dispose();break}'
new = 'case"navigate-in-new-editor-tab":{let n=fM(r.path),o=r.replaceCurrentEditor?this.findPanelByWebview(e):null;await qe.commands.executeCommand("vscode.openWith",n,t.customEditorViewType,{preview:!1,viewColumn:qe.ViewColumn.Two,preserveFocus:!1});o!=null&&this.isPanelAlive(o)&&o.dispose();await qe.commands.executeCommand("workbench.action.focusSecondEditorGroup");await qe.commands.executeCommand("workbench.action.lockEditorGroup");break}'
assert original.count(old) == 1, 'Expected exactly one original history handler; stopped.'
patched = original.replace(old, new)
staged = Path('/private/tmp/codex-history-group-check.js')
staged.write_text(patched)
subprocess.run(['node', '--check', str(staged)], check=True)
test = '''
const assert = require('node:assert/strict');
const t = { customEditorViewType: 'chatgpt.conversationEditor' };
const fM = path => 'openai-codex:' + path;
let calls = [];
const qe = { ViewColumn: { Two: 2 }, commands: { executeCommand: async (...args) => { calls.push(args); } } };
const handler = async function(e,r) { switch(r.type) { HANDLER } };
(async () => {
 for (const replace of [false, true]) {
  calls = [];
  let disposed = false;
  const panel = { dispose() { disposed = true; } };
  await handler.call({ findPanelByWebview() { return panel; }, isPanelAlive() { return true; } }, {}, { type: 'navigate-in-new-editor-tab', path: '/local/test', replaceCurrentEditor: replace });
  assert.deepEqual(calls, [
   ['vscode.openWith','openai-codex:/local/test','chatgpt.conversationEditor',{preview:false,viewColumn:2,preserveFocus:false}],
   ['workbench.action.focusSecondEditorGroup'],
   ['workbench.action.lockEditorGroup']
  ]);
  assert.equal(disposed, replace);
 }
 console.log('PASS: history and replacement navigation explicitly target group 2; tabs are pinned; existing launcher is preserved unless replacement was requested.');
})().catch(error => { console.error(error); process.exit(1); });
'''.replace('HANDLER',new)
subprocess.run(['node', '-'], input=test, text=True, check=True)
if '--apply' in sys.argv:
 backup = path.with_name('extension.js.before-history-group-patch')
 assert not backup.exists(), 'Backup already exists; stopped.'
 backup.write_text(original)
 try:
  path.write_text(patched)
  assert path.read_text() == patched
 except Exception:
  path.write_text(original)
  raise
 print('Applied history navigation patch. Backup: ' + str(backup))
else:
 print('Validated patch; installed extension unchanged.')
