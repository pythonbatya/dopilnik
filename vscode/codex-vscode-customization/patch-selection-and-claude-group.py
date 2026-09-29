"""Version-specific patch recipe. Dry run by default; --apply writes backups and changes."""
from pathlib import Path
import subprocess
import sys

base=Path('/Users/l.vinogradov/.vscode/extensions')
codex=base/'openai.chatgpt-26.917.62051-darwin-arm64/out/extension.js'
claude=base/'anthropic.claude-code-2.1.284-darwin-arm64/extension.js'
keys=Path('/Users/l.vinogradov/Yandex.Disk.localized/configs/vscode/keybindings.json')
originals={p:p.read_text() for p in (codex,claude,keys)}
updated=dict(originals)
def replace(path,old,new):
    assert updated[path].count(old)==1, f'Expected one matching source in {path}; stopped'
    updated[path]=updated[path].replace(old,new)

method='async addContextToChat(e){let r=Array.from(this.editorPanels.keys()).filter(n=>this.isPanelAlive(n)),n=r.find(n=>n.visible&&n.viewColumn===qe.ViewColumn.Two)??(this.focusedView?.kind==="panel"&&this.isPanelAlive(this.focusedView.panel)?this.focusedView.panel:void 0)??r.find(n=>n.viewColumn===qe.ViewColumn.Two);if(!n){await this.createNewPanel();n=Array.from(this.editorPanels.keys()).find(n=>this.isPanelAlive(n)&&n.viewColumn===qe.ViewColumn.Two)}if(!n)throw new Error("Could not open a Codex chat tab for the selection");n.reveal(qe.ViewColumn.Two,!1);this.focusedView={kind:"panel",panel:n};this.sendMessageToPanel(n,{type:"add-context-file",file:e});await qe.commands.executeCommand("workbench.action.lockEditorGroup")}'
replace(codex,'await Ia(),t.addContextFile(s)}','await t.addContextToChat(s)}')
replace(codex,'addContextFile(e){',method+'addContextFile(e){')
replace(claude,'function Fu1($){let J=gu0($);if(J!==void 0)return{viewColumn:J,startsClaudeGroup:!1};let[Q]=$;return $.length===1&&Q&&Ls(Q)?{viewColumn:Q.viewColumn,startsClaudeGroup:!0}:void 0}', 'function Fu1($){return{viewColumn:2,startsClaudeGroup:!0}}')
replace(keys,'// Claude Code: insert an @-mention (file/selection) into the chat input.\n  // Extension default is alt+k, moved to cmd+l (not taken by core or any extension).','// Codex: attach the selected code as a file/line reference to the chat.\n  // Patched Codex targets the visible / last-used chat tab in LLM group 2.')
replace(keys,'"command": "claude-vscode.insertAtMention"','"command": "chatgpt.addToThread",\n    "when": "editorTextFocus"')
for path in (codex,claude):
    staged=Path('/private/tmp')/('selection-check-'+path.parent.name+'.js')
    staged.write_text(updated[path])
    subprocess.run(['node','--check',str(staged)],check=True)

test='''
const assert=require('node:assert/strict');
const qe={ViewColumn:{Two:2},commands:{executeCommand:async()=>{}}};
const C=class { METHOD };
function panel(visible,column) {return {visible,viewColumn:column,reveal(column){this.viewColumn=column;this.visible=true;}};}
(async()=>{
 for(const scenario of ['visible','lastUsed','create']) {
  const c=new C(), old=panel(false,2), current=panel(true,2);
  c.editorPanels=new Map(scenario==='create'?[]:[[old,{}],[current,{}]]);
  c.isPanelAlive=p=>c.editorPanels.has(p);
  c.focusedView={kind:'panel',panel:old};
  if(scenario==='lastUsed')current.visible=false;
  let created=0;
  c.createNewPanel=async()=>{created++;c.editorPanels.set(current,{});};
  let received;
  c.sendMessageToPanel=(p,m)=>{received={p,m};};
  const file={path:'/test.py',startLine:2,endLine:7};
  await c.addContextToChat(file);
  assert.equal(received.p,scenario==='lastUsed'?old:current);
  assert.deepEqual(received.m,{type:'add-context-file',file});
  assert.equal(created,scenario==='create'?1:0);
  assert.equal(c.focusedView.panel,received.p);
 }
 console.log('PASS: visible chat, last-used chat, and no-chat fallback; selection reference preserved.');
})().catch(e=>{console.error(e);process.exit(1)});
'''.replace('METHOD',method)
subprocess.run(['node','-'],input=test,text=True,check=True)
if '--apply' in sys.argv:
    backups={p:p.with_name(p.name+'.before-selection-routing-patch') for p in originals}
    assert all(not p.exists() for p in backups.values()), 'Backup exists; stopped'
    assert all(p.read_text()==s for p,s in originals.items()), 'Source changed; stopped'
    for p,b in backups.items(): b.write_text(originals[p])
    try:
        for p,s in updated.items():
            p.write_text(s)
            assert p.read_text()==s
    except Exception:
        for p,s in originals.items():p.write_text(s)
        raise
    print('Applied Codex selection routing, Cmd+L binding, and Claude group-2 placement. Backups saved.')
else: print('Dry run passed; installed files unchanged.')
