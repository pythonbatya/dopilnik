/**
 * License GPL-2.0
 */
import * as vscode from 'vscode';
import { BlamedDocument } from './Blame';
import { prependSpace } from './Date';
import { log } from './Logger';
import BlameManager from './BlameManager';

type BlameDecoration = [vscode.DecorationOptions, vscode.DecorationOptions];

const baseDecorations: vscode.ThemableDecorationRenderOptions = {
    before: {
        color: new vscode.ThemeColor('editor.foreground'),
        height: 'editor.lineHeight',
        fontStyle: 'normal',
        fontWeight: 'normal'
    }
};

export const LEFT_SIDE: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType(baseDecorations);
export const RIGHT_SIDE: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
    before: {
        ...baseDecorations.before,
        margin: '0 3px 0 0',
    }
});

export const DEFAULT_WIDTH = '70px';

export const AUTHOR_CHARS_CAP = 14;

export const displayAuthor = (name: string): string => {
    return name.length > AUTHOR_CHARS_CAP ? `${name.slice(0, AUTHOR_CHARS_CAP - 1)}…` : name;
};

// A monospace glyph advance is ~0.6em of the editor font size.
const annotationCharWidth = (): number => {
    const fontSize = vscode.workspace.getConfiguration('editor').get<number>('fontSize') ?? 12;
    return Math.ceil(fontSize * 0.6);
};

export const calculateDecorationsWidth = (blamed: BlamedDocument[]): string => {
    log.trace('Calculate width started');
    const maxLen = blamed.filter(line => line.hash !== '0')
        .map(line => line.author.displayName.length)
        .reduce((prev, curr) => prev > curr ? prev : curr, 0);
    const width = `${Math.min(maxLen, AUTHOR_CHARS_CAP) * annotationCharWidth() + 4}px`;
    log.trace('Calculated width', width);
    return width;
};

export const getDecorations = (range: vscode.Range, blamedDocument: BlamedDocument, blameManager: BlameManager): BlameDecoration => {
    if (blamedDocument?.hash !== '0') {
        return [
            {
                range,
                renderOptions: {
                    before: {
                        contentText: `${blamedDocument.date.localDate}\u2002`,
                        backgroundColor: blameManager.getBlameColor(blamedDocument.date),
                    }
                },
            },
            {
                range,
                renderOptions: {
                    before: {
                        contentText: displayAuthor(blamedDocument.author.displayName),
                        backgroundColor: blameManager.getBlameColor(blamedDocument.date),
                        width: blameManager.decorationWidth
                    }
                }
            }
        ];
    } else {
        return [
            {
                range,
                renderOptions: {
                    before: {
                        contentText: `${prependSpace('')}\u2002`
                    }
                }
            },
            {
                range,
                renderOptions: {
                    before: {
                        contentText: '\u2002',
                        width: blameManager.decorationWidth
                    }
                }
            }
        ];
    }
};

const trustedMdString = () => {
    const str = new vscode.MarkdownString();
    str.supportThemeIcons = true;
    str.isTrusted = { enabledCommands: ['simply-blame.hashAction', 'simply-blame.showCommitDiff'] };
    return str;
};

const diffCommandUri = (blame: BlamedDocument, sourceFile: string): vscode.Uri =>
    vscode.Uri.parse(`command:simply-blame.showCommitDiff?${JSON.stringify([{ hash: blame.hash, sourceFile, revPath: blame.filename }])}`);

export const createNormalMessage = (blame: BlamedDocument, message?: string, sourceFile?: string): vscode.MarkdownString  => {
    const str = trustedMdString()
        .appendMarkdown(`$(account) &nbsp; ${blame.author.name}`)
        .appendText('\n')
        .appendMarkdown(`$(mail) &nbsp; ${blame.email}`)
        .appendText('\n')
        .appendMarkdown(`$(calendar) &nbsp; ${blame.date.localDate.trim()} ${blame.date.timeString}`)
        .appendText('\n')
        .appendMarkdown('***')
        .appendText('\n')
        .appendMarkdown(`[$(git-compare) &nbsp; Show diff](${diffCommandUri(blame, sourceFile ?? '')}) &nbsp; [$(copy) &nbsp; ${blame.hash}](${vscode.Uri.parse(`command:simply-blame.hashAction?${JSON.stringify([{ hash: blame.hash }])}`)})`)
        .appendText('\n')
        .appendMarkdown(`****\n`);

    if (!message || message === blame.summary) {
        str.appendMarkdown(blame.summary);
        return str;
    }

    const lines = message.split('\n');
    const title = lines.shift();
    const last = lines.pop();

    str.appendMarkdown(`### ${title}\n\n`);

    lines.forEach((l) => {
        if (l.length === 0) {
            str.appendText('\n');
        } else {
            str.appendMarkdown(l);
            str.appendText('\n');
        }
    });

    str.appendMarkdown(`${last}`);

    return str;
};

export const createMinimalMessage = (blame: BlamedDocument, sourceFile?: string): vscode.MarkdownString => {
    return trustedMdString()
        .appendMarkdown(`[$(git-compare)](${diffCommandUri(blame, sourceFile ?? '')}) &nbsp; [${blame.hash}](${vscode.Uri.parse(`command:simply-blame.hashAction?${JSON.stringify([{ hash: blame.hash }])}`)})`)
        .appendText('\n')
        .appendMarkdown(`****\n`)
        .appendMarkdown(`${blame.summary}`);
};
