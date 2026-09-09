import * as vscode from 'vscode';

export function activate(): void {
    // thin wrapper around core's reveal: exists only to own an icon'd
    // title-bar button. The companion setting explorer.autoReveal=false
    // freezes the tree; this is the only thing that moves it on demand.
    // open first so the keybinding works with a hidden sidebar too
    vscode.commands.registerCommand('reveal.activeFile', async () => {
        await vscode.commands.executeCommand('workbench.view.explorer');
        await vscode.commands.executeCommand('workbench.files.action.showActiveFileInExplorer');
    });
}
