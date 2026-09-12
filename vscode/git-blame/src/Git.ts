/**
 * License GPL-2.0
 */
import * as vscode from 'vscode';
import { command } from './Command';
import Notifications from './Notifications';
import { getFilename, getLocation } from './Utils';
import Settings from './Settings';
import WorkspaceStateHolder from './WorkspaceStateHolder';

export const getCommitMessage = async (fileName: string, commit: string) => {
    const location = getLocation(fileName);

    try {
        const body = await command('git', ['show', commit], location);
        const message = body?.substring(body.indexOf('\n\n'), body.search('diff --git'));
        return message?.replace(/^ {2,}/gm, '').trim();
    } catch (e) {
        Notifications.commonErrorNotification(e as Error, true);
    }
};

export const blameFile = async (fileName: string): Promise<string> => {
    const name = getFilename(fileName);
    const location = fileName.replace(name, '');
    const ignoreWhitespace = WorkspaceStateHolder.state.ignoreWhiteSpaceToggle || Settings.getBlameIgnoreWhitespace();
    const args = ['blame', ...(ignoreWhitespace ? ['-w'] : []), '--porcelain', name];

    try {
        return await command('git', args, location) ?? '';
    } catch (e) {
        if ((e as Error).message.match(/no such path .* in HEAD/)) {
            vscode.window.showWarningMessage(`File: ${name} is not in HEAD`);
        } else if ((e as Error).message.match(/ENOENT|^git:? (command )?not found/)) {
            Notifications.gitNotFoundNotification();
        } else {
            Notifications.commonErrorNotification(e as Error, true);
        }
    }
    return '';
};

// Blame of a file as of a specific revision (used inside commit diff panes).
export const blameRevFile = async (repoRoot: string, rev: string, relPath: string): Promise<string> => {
    const ignoreWhitespace = WorkspaceStateHolder.state.ignoreWhiteSpaceToggle || Settings.getBlameIgnoreWhitespace();
    const args = ['blame', ...(ignoreWhitespace ? ['-w'] : []), '--porcelain', rev, '--', relPath];

    try {
        return await command('git', args, repoRoot) ?? '';
    } catch (e) {
        Notifications.commonErrorNotification(e as Error, false);
    }
    return '';
};
