import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { parseRemote, buildWebUrl, selectedLineSpan } from './remoteUrl';

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
    const { stdout } = await run('git', args, { cwd });
    return stdout.trim();
}

export function activate(): void {
    vscode.commands.registerCommand('openInOrigin.openAtLine', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') {
            vscode.window.showWarningMessage('Open in Origin: no file-backed editor is active');
            return;
        }
        const filePath = editor.document.uri.fsPath;
        const dir = path.dirname(filePath);
        try {
            const [root, originUrl, sha] = await Promise.all([
                git(dir, 'rev-parse', '--show-toplevel'),
                git(dir, 'remote', 'get-url', 'origin'),
                git(dir, 'rev-parse', 'HEAD'),
            ]);
            const remote = parseRemote(originUrl);
            if (!remote) {
                vscode.window.showWarningMessage(`Open in Origin: cannot parse remote url "${originUrl}"`);
                return;
            }
            const relPath = path.relative(root, filePath).split(path.sep).join('/');
            const sel = editor.selection;
            const span = selectedLineSpan(sel.start.line, sel.end.line, sel.end.character);
            await vscode.env.openExternal(vscode.Uri.parse(buildWebUrl(remote, sha, relPath, span), true));
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showWarningMessage(`Open in Origin: ${message}`);
        }
    });
}
