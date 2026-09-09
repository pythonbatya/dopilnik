import * as vscode from 'vscode';
import { classifyReferences } from './usageClassify';
import { enclosingSymbol } from './pyParse';
import { buildGroups, type UsageEntry } from './usageGroups';
import { openResultEditor, registerResultDoc, type ResultDocOptions } from '../../shared-result/src/resultDoc';

const KIND_CAP = 100;

const RESULT_DOC: ResultDocOptions = {
    scheme: 'pyusages',
    languageId: 'pyusages-result',
    commandId: 'pyUsages.openAtCursor',
};

async function queryLocations(command: string, uri: vscode.Uri, line: number, col: number): Promise<vscode.Location[]> {
    try {
        const res = await vscode.commands.executeCommand(command, uri, new vscode.Position(line, col));
        if (!Array.isArray(res)) return [];
        return (res as unknown[]).flatMap((r) => {
            if (r instanceof vscode.Location) return [r];
            return [];
        });
    } catch {
        return [];
    }
}

async function definitionSites(uri: vscode.Uri, line: number, col: number): Promise<vscode.Location[]> {
    try {
        const res = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, new vscode.Position(line, col));
        if (!Array.isArray(res)) return [];
        return (res as unknown[]).flatMap((r) => {
            if (r instanceof vscode.Location) return [r];
            const link = r as { targetUri?: vscode.Uri; targetRange?: vscode.Range };
            if (link.targetUri instanceof vscode.Uri && link.targetRange !== undefined) {
                return [new vscode.Location(link.targetUri, link.targetRange)];
            }
            return [];
        });
    } catch {
        return [];
    }
}

async function collect(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
        void vscode.window.showWarningMessage('py-usages: no active editor');
        return;
    }
    const doc = editor.document;
    const anchor = editor.selection.active;
    const word = doc.getWordRangeAtPosition(anchor);
    if (word === undefined) {
        void vscode.window.showWarningMessage('py-usages: no symbol under cursor');
        return;
    }
    const symbol = doc.getText(word);

    const refs = await queryLocations('vscode.executeReferenceProvider', doc.uri, word.start.line, word.start.character);
    const defs = await definitionSites(doc.uri, word.start.line, word.start.character);
    const seen = new Set<string>();
    const defKeys = new Set(defs.map((d) => `${d.uri.toString()}:${d.range.start.line}:${d.range.start.character}`));
    const unique: vscode.Location[] = [];
    for (const ref of refs) {
        const key = `${ref.uri.toString()}:${ref.range.start.line}:${ref.range.start.character}`;
        if (seen.has(key) || defKeys.has(key)) continue;
        seen.add(key);
        unique.push(ref);
    }
    if (unique.length === 0) {
        void vscode.window.showInformationMessage('py-usages: no usages found (a cold language server also answers empty — retry in a moment)');
        return;
    }

    // classify per document, reading each referenced file once
    const texts = new Map<string, string>();
    const textFor = async (uri: vscode.Uri): Promise<string> => {
        const key = uri.toString();
        const hit = texts.get(key);
        if (hit !== undefined) return hit;
        const text = (await vscode.workspace.openTextDocument(uri)).getText();
        texts.set(key, text);
        return text;
    };
    const entries: UsageEntry[] = [];
    for (const ref of unique) {
        const text = await textFor(ref.uri);
        const lines = text.split('\n');
        const line = Math.min(ref.range.start.line, lines.length - 1);
        const kinds = classifyReferences(text, [{
            line,
            startChar: ref.range.start.character,
            endChar: ref.range.end.character,
        }]);
        entries.push({
            kind: kinds[0],
            // the enclosing symbol names the block header (WHERE in the file
            // the usage lives — the one thing the snippet does not show);
            // module-level usages fall back to the source line, which the
            // renderer collapses into a bare `path:` header, search-style
            label: enclosingSymbol(text, line)?.label ?? (lines[line] ?? '').trim().slice(0, 120),
            uri: ref.uri.toString(),
            line,
            character: ref.range.start.character,
        });
    }

    const { items, kept, dropped } = buildGroups(entries, KIND_CAP);
    await openResultEditor(`usages: ${symbol} · ${kept}`, items, dropped > 0, RESULT_DOC);
}

/** IDEA-style cmd+b: go to the definition, or — when already standing on it —
 * collect usages into places */
async function cmdB(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) return;
    if (editor.document.languageId !== 'python') {
        // preserve the default go-to-definition outside python
        await vscode.commands.executeCommand('editor.action.revealDefinition');
        return;
    }
    const doc = editor.document;
    const word = doc.getWordRangeAtPosition(editor.selection.active);
    if (word === undefined) return;
    const wordStart = word.start;
    const defs = await definitionSites(doc.uri, wordStart.line, wordStart.character);
    const onDefinition = defs.some((d) =>
        d.uri.toString() === doc.uri.toString()
        && d.range.start.line === wordStart.line
        && d.range.start.character === wordStart.character);
    if (onDefinition) {
        await collect();
        return;
    }
    if (defs.length === 1) {
        const target = await vscode.workspace.openTextDocument(defs[0].uri);
        await vscode.window.showTextDocument(target, { selection: defs[0].range });
        return;
    }
    if (defs.length === 0) {
        void vscode.window.showInformationMessage('py-usages: no definition found');
        return;
    }
    const items = defs.map((d) => ({
        label: doc.getText(word),
        uri: d.uri.toString(),
        line: d.range.start.line,
        character: d.range.start.character,
    }));
    await openResultEditor(`definitions: ${doc.getText(word)} · ${items.length}`, items, false, RESULT_DOC);
}

export function activate(context: vscode.ExtensionContext): void {
    registerResultDoc(context, RESULT_DOC);
    context.subscriptions.push(vscode.commands.registerCommand('pyUsages.collect', () => void collect()));
    context.subscriptions.push(vscode.commands.registerCommand('pyUsages.cmdB', () => void cmdB()));
}
