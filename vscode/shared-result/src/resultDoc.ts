/**
 * shared result-editor machinery: virtual read-only documents in the
 * consumer's own scheme, with no dirty state — hot exit has nothing to back
 * up, so editors can never resurrect as zombies after a restart.
 */
import * as vscode from 'vscode';
import { renderResult, CONTEXT_RADIUS, type ContextLine, type LocationContext, type ResultItem } from './resultRender';
import { parseDocLinks, isContextLine, isHeaderLine } from './resultLinks';

/** per-extension identity: scheme of the virtual documents, the grammar
 * language set on them, and the openAtCursor command id */
export interface ResultDocOptions {
    scheme: string;
    languageId: string;
    commandId: string;
}

/** rendered texts by uri — session memory only */
const docs = new Map<string, string>();
let seq = 0;

const contextDecoration = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor('descriptionForeground'),
});
const headerDecoration = vscode.window.createTextEditorDecorationType({
    fontStyle: 'bold',
});

/** scheme paths must stay one segment without fragment/query separators */
function docName(title: string): string {
    const cleaned = title.replace(/[?#\\/]/g, ' ').trim();
    return cleaned.length > 0 ? cleaned : 'result';
}

function resolveTarget(relPath: string, line: number): vscode.Uri | undefined {
    const uri = relPath.startsWith('/')
        ? vscode.Uri.file(relPath)
        : (vscode.workspace.workspaceFolders?.[0] !== undefined
            ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, relPath)
            : undefined);
    if (uri === undefined) return undefined;
    return uri.with({ fragment: `L${line + 1}` });
}

function decorateResultEditor(editor: vscode.TextEditor, scheme: string): void {
    if (editor.document.uri.scheme !== scheme) return;
    const ctxRanges: vscode.Range[] = [];
    const hdrRanges: vscode.Range[] = [];
    for (let i = 0; i < editor.document.lineCount; i++) {
        const line = editor.document.lineAt(i);
        if (isContextLine(line.text)) {
            // search dims only the context line number, not its code
            const prefix = /^\s*\d+\s{2}/.exec(line.text);
            if (prefix !== null) ctxRanges.push(new vscode.Range(i, 0, i, prefix[0].length));
        } else if (isHeaderLine(line.text)) hdrRanges.push(line.range);
    }
    editor.setDecorations(contextDecoration, ctxRanges);
    editor.setDecorations(headerDecoration, hdrRanges);
}

function docLines(doc: vscode.TextDocument): string[] {
    const lines: string[] = [];
    for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text);
    return lines;
}

function makeReadContext() {
    return async (uriStr: string, line: number): Promise<LocationContext | null> => {
        try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uriStr));
            const all = Buffer.from(bytes).toString('utf8').split('\n');
            const clip = (t: string): string => (t.length > 120 ? t.slice(0, 120) + '…' : t).replace(/\t/g, '  ');
            const mk = (n: number): ContextLine | null =>
                n >= 0 && n < all.length ? { lineno: n + 1, text: clip(all[n]) } : null;
            const around = (from: number, to: number): ContextLine[] => {
                const out: ContextLine[] = [];
                for (let n = from; n <= to; n++) {
                    const c = mk(n);
                    if (c !== null) out.push(c);
                }
                return out;
            };
            return {
                match: mk(line)?.text,
                before: around(line - CONTEXT_RADIUS, line - 1),
                after: around(line + 1, line + CONTEXT_RADIUS),
            };
        } catch {
            return null;
        }
    };
}

export function registerResultDoc(context: vscode.ExtensionContext, opts: ResultDocOptions): void {
    context.subscriptions.push(
        contextDecoration,
        headerDecoration,
        vscode.workspace.registerTextDocumentContentProvider(opts.scheme, {
            provideTextDocumentContent: (uri: vscode.Uri): string => docs.get(uri.toString()) ?? '',
        }),
        // block headers are the clickable lines (the symbol line); the
        // keyboard path works on any line
        vscode.languages.registerDocumentLinkProvider({ scheme: opts.scheme }, {
            provideDocumentLinks(doc: vscode.TextDocument): vscode.DocumentLink[] {
                const links: vscode.DocumentLink[] = [];
                parseDocLinks(docLines(doc)).forEach((target, i) => {
                    if (target === null || !isHeaderLine(doc.lineAt(i).text)) return;
                    const uri = resolveTarget(target.relPath, target.line);
                    if (uri === undefined) return;
                    links.push(new vscode.DocumentLink(doc.lineAt(i).range, uri));
                });
                return links;
            },
        }),
        vscode.commands.registerCommand(opts.commandId, async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor === undefined || editor.document.uri.scheme !== opts.scheme) return;
            const target = parseDocLinks(docLines(editor.document))[editor.selection.active.line] ?? null;
            if (target === null) return;
            const uri = resolveTarget(target.relPath, target.line);
            if (uri === undefined) return;
            await vscode.window.showTextDocument(uri, { preview: true });
        }),
        vscode.window.onDidChangeVisibleTextEditors((editors) => {
            for (const ed of editors) decorateResultEditor(ed, opts.scheme);
        }),
    );
}

export async function openResultEditor(title: string, items: ResultItem[], truncated: boolean, opts: ResultDocOptions): Promise<void> {
    const relate = (uriStr: string): string => {
        try {
            return vscode.workspace.asRelativePath(vscode.Uri.parse(uriStr), false);
        } catch {
            return uriStr;
        }
    };
    const text = await renderResult(
        { title, items, truncatedUnknown: truncated || undefined },
        { relate, readContext: makeReadContext() },
    );
    seq += 1;
    const name = seq === 1 ? docName(title) : `${docName(title)} · ${seq}`;
    const uri = vscode.Uri.parse(`${opts.scheme}:${name}`);
    docs.set(uri.toString(), text);
    const doc = await vscode.workspace.openTextDocument(uri);
    // own stateless grammar: line-local rules only, so a docstring cut by the
    // ±1 window cannot leak string state across the buffer (document-level
    // python did exactly that); the dim decoration still wins on context lines
    await vscode.languages.setTextDocumentLanguage(doc, opts.languageId);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    decorateResultEditor(editor, opts.scheme);
}
