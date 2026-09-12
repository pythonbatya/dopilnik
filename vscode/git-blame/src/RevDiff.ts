/**
 * License GPL-2.0
 */
import * as vscode from 'vscode';
import { command } from './Command';
import Notifications from './Notifications';
import { getFilename, getLocation } from './Utils';

export const REV_SCHEME = 'sbrev';

const revUri = (repoRoot: string, rev: string, relPath: string): vscode.Uri =>
    vscode.Uri.from({
        scheme: REV_SCHEME,
        path: `/${encodeURIComponent(relPath)}`,
        query: `repo=${encodeURIComponent(repoRoot)}&rev=${encodeURIComponent(rev)}`
    });

export interface RevLocation {
    repoRoot: string;
    rev: string;
    relPath: string;
}

export const parseRevUri = (uri: vscode.Uri): RevLocation => {
    const params = new URLSearchParams(uri.query);
    return {
        repoRoot: params.get('repo') ?? '',
        rev: params.get('rev') ?? '',
        relPath: decodeURIComponent(uri.path.slice(1))
    };
};

// A plain filesystem path pointing into the same repo, usable as the
// "sourceFile" argument of showCommitDiff and getLocation-based helpers.
export const revUriSourceFile = (uri: vscode.Uri): string => {
    const { repoRoot, relPath } = parseRevUri(uri);
    return `${repoRoot}/${relPath}`;
};

export const revContentProvider: vscode.TextDocumentContentProvider = {
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const { repoRoot, rev, relPath } = parseRevUri(uri);
        if (!repoRoot || !rev) {
            return '';
        }
        try {
            return await command('git', ['show', `${rev}:${relPath}`], repoRoot) ?? '';
        } catch (e) {
            Notifications.commonErrorNotification(e as Error, false);
            return '';
        }
    }
};

const resolveRepoRoot = async (sourceFile: string): Promise<string> => {
    return (await command('git', ['rev-parse', '--show-toplevel'], getLocation(sourceFile))).trim();
};

const hasParent = async (repoRoot: string, hash: string): Promise<boolean> => {
    try {
        await command('git', ['rev-parse', '--verify', `${hash}^`], repoRoot);
        return true;
    } catch (e) {
        return false;
    }
};

export const showCommitDiff = async (hash: string, sourceFile: string, revPath?: string): Promise<void> => {
    let repoRoot: string;
    try {
        repoRoot = await resolveRepoRoot(sourceFile);
    } catch (e) {
        Notifications.commonErrorNotification(e as Error, true);
        return;
    }

    const relPath = revPath && revPath.length > 0
        ? revPath
        : sourceFile.startsWith(repoRoot) ? sourceFile.substring(repoRoot.length + 1) : getFilename(sourceFile);

    const parentRev = (await hasParent(repoRoot, hash)) ? `${hash}^` : '';

    const left = revUri(repoRoot, parentRev, relPath);
    const right = revUri(repoRoot, hash, relPath);

    await vscode.commands.executeCommand('vscode.diff', left, right, `${getFilename(relPath)} @ ${hash.substring(0, 8)}`, { preview: false });
};
