import * as os from 'node:os';
import * as vscode from 'vscode';
import { breadcrumbText } from './breadcrumb';

export function activate(context: vscode.ExtensionContext): void {
    // just right of the built-in Problems entry (priority 50; higher = further left)
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 48);
    item.name = 'status-path';
    const update = (): void => {
        const doc = vscode.window.activeTextEditor?.document;
        if (doc === undefined || doc.uri.scheme !== 'file') {
            item.hide();
            return;
        }
        // single opened folder by design; anything outside it falls back to a plain path
        const folders = vscode.workspace.workspaceFolders ?? [];
        const root = folders.length > 0 ? folders[0].uri.fsPath : null;
        item.text = breadcrumbText(root, doc.uri.fsPath, os.homedir());
        item.tooltip = doc.uri.fsPath;
        item.show();
    };
    context.subscriptions.push(
        item,
        vscode.window.onDidChangeActiveTextEditor(update),
        vscode.workspace.onDidChangeWorkspaceFolders(update),
    );
    update();
}

export function deactivate(): void {}
