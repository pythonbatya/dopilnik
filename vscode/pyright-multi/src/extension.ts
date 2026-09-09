import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ManifestStore, type ModuleEntry } from './manifest';
import { diffManifests } from './manifestDiff';
import { findModule } from './router';
import { ServerManager } from './serverManager';
import { pyStatusLabel } from './statusLabel';
import { langserverScript } from './serverMeta';
import { sweepOrphans } from './orphanSweep';
import {
    DEBUG_COMMAND,
    DEBUG_TEST_COMMAND,
    MainGuardCodeLensProvider,
    PytestCodeLensProvider,
    Runner,
    RUN_COMMAND,
    RUN_TEST_COMMAND,
} from './runner';

const MANIFEST_NAME = 'pyright-modules.json';

let manager: ServerManager | null = null;
let runner: Runner | null = null;
let statusItem: vscode.StatusBarItem | null = null;
let output: vscode.OutputChannel | null = null;
/** last-good manifest store per workspace folder uri */
const stores = new Map<string, ManifestStore>();
let watchers: vscode.FileSystemWatcher[] = [];

function log(message: string): void {
    output?.appendLine(`[pyright-multi] ${message}`);
}

/** manifest modules if present; otherwise implicit single module when the folder root itself looks like a python project */
async function modulesForFolder(folder: vscode.WorkspaceFolder): Promise<ModuleEntry[]> {
    const dir = folder.uri.fsPath;
    let text: string | null = null;
    try {
        text = await fs.readFile(path.join(dir, MANIFEST_NAME), 'utf8');
    } catch {
        text = null;
    }
    if (text !== null) {
        let store = stores.get(folder.uri.toString());
        if (!store) {
            store = new ManifestStore(null);
            stores.set(folder.uri.toString(), store);
        }
        const res = store.reload(text, dir);
        if (!res.ok) log(`bad manifest in ${dir}: ${res.error} (keeping last valid)`);
        return store.current()?.modules ?? [];
    }
    const hasVenv = await fs.stat(path.join(dir, '.venv')).then(() => true, () => false);
    const hasConfig = await fs.stat(path.join(dir, 'pyrightconfig.json')).then(() => true, () => false);
    return hasVenv || hasConfig ? [{ root: dir, venv: path.join(dir, '.venv') }] : [];
}

async function applyCurrentModules(): Promise<void> {
    if (!manager) return;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const modules = (await Promise.all(folders.map((f) => modulesForFolder(f)))).flatMap((m) => m);
    const diff = diffManifests({ modules: manager.knownModules() }, { modules });
    for (const removed of diff.removed) await manager.stop(removed.root);
    manager.setKnownModules(modules);
    runner?.setKnownModules(modules);
    if (diff.added.length > 0) log(`modules added: ${diff.added.map((m) => m.root).join(', ')} (servers start lazily)`);
    updateStatus();
}

function updateStatus(): void {
    if (!statusItem || !manager) return;
    const activePath = vscode.window.activeTextEditor?.document.uri.fsPath ?? null;
    const root = activePath === null ? null : findModule(manager.knownModules(), activePath);
    statusItem.text = pyStatusLabel(root);
    const lines = [`pyright-multi: ${manager.moduleCount()} modules, ${manager.activeRoots().length} active`];
    const module = root === null ? undefined : manager.knownModules().find((m) => m.root === root);
    if (module) lines.push(`venv: ${module.venv}`);
    statusItem.tooltip = new vscode.MarkdownString(lines.join('  \n'));
}

function setupWatchers(): void {
    for (const w of watchers) w.dispose();
    watchers = (vscode.workspace.workspaceFolders ?? []).map((folder) => {
        const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, MANIFEST_NAME));
        w.onDidChange(() => void applyCurrentModules());
        w.onDidCreate(() => void applyCurrentModules());
        w.onDidDelete(() => void applyCurrentModules());
        return w;
    });
}

async function onPythonFileOpened(doc: vscode.TextDocument): Promise<void> {
    if (!manager) return;
    let root = findModule(manager.knownModules(), doc.uri.fsPath);
    if (root === null) {
        // safety net in case watcher events were missed: re-read manifests, then retry
        await applyCurrentModules();
        root = findModule(manager.knownModules(), doc.uri.fsPath);
        if (root === null) return;
    }
    const module = manager.knownModules().find((m) => m.root === root);
    if (module) await manager.ensureStarted(module);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    output = vscode.window.createOutputChannel('pyright-multi');
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    manager = new ServerManager(context);
    runner = new Runner();
    manager.onChange(updateStatus);

    const swept = await sweepOrphans(langserverScript(context.extensionPath));
    if (swept.length > 0) log(`swept ${swept.length} orphaned langserver process(es)`);

    await applyCurrentModules();
    setupWatchers();

    context.subscriptions.push(
        output,
        statusItem,
        manager,
        runner,
        vscode.commands.registerCommand(RUN_COMMAND, (uri?: vscode.Uri) => runner?.run(uri)),
        vscode.commands.registerCommand(DEBUG_COMMAND, (uri?: vscode.Uri) => runner?.debug(uri)),
        vscode.commands.registerCommand(
            RUN_TEST_COMMAND,
            (uri?: vscode.Uri, nodeId?: string) => {
                if (uri === undefined || nodeId === undefined) {
                    void vscode.window.showWarningMessage('pyright-multi: pytest run is available via the ▶ Run CodeLens');
                    return;
                }
                void runner?.runPytest(uri, nodeId);
            },
        ),
        vscode.commands.registerCommand(
            DEBUG_TEST_COMMAND,
            (uri?: vscode.Uri, nodeId?: string) => {
                if (uri === undefined || nodeId === undefined) {
                    void vscode.window.showWarningMessage('pyright-multi: pytest debug is available via the 🐞 Debug CodeLens');
                    return;
                }
                void runner?.debugPytest(uri, nodeId);
            },
        ),
        vscode.languages.registerCodeLensProvider(
            { language: 'python', scheme: 'file' },
            new MainGuardCodeLensProvider(runner),
        ),
        vscode.languages.registerCodeLensProvider(
            { language: 'python', scheme: 'file' },
            new PytestCodeLensProvider(runner),
        ),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            stores.clear();
            void applyCurrentModules();
            setupWatchers();
        }),
        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (doc.languageId === 'python') void onPythonFileOpened(doc);
        }),
        // tabs restored by window reload opened their documents before we activated;
        // focus changes cover clicking into a restored tab
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            updateStatus();
            if (editor?.document.languageId === 'python') void onPythonFileOpened(editor.document);
        }),
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.uri.path.endsWith(MANIFEST_NAME)) void applyCurrentModules();
        }),
        vscode.window.onDidChangeWindowState((state) => {
            if (state.focused) void applyCurrentModules();
        }),
        vscode.commands.registerCommand('pyrightMulti.showStatus', () => {
            output?.show();
        }),
    );
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === 'python') void onPythonFileOpened(doc);
    }
    statusItem.show();
}

export async function deactivate(): Promise<void> {
    for (const w of watchers) w.dispose();
    await manager?.stopAll();
}
