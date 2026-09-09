import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import type { ModuleEntry } from './manifest';
import {
    buildDebugLaunch,
    buildPytestDebugLaunch,
    buildPytestSpec,
    buildRunSpec,
    findMainGuardLines,
    pytestTerminalKey,
    type RunSpec,
} from './runMeta';
import { findPytestTargets, isTestFile } from './testMeta';

export const RUN_COMMAND = 'pyrightMulti.runFile';
export const DEBUG_COMMAND = 'pyrightMulti.debugFile';
export const RUN_TEST_COMMAND = 'pyrightMulti.runTest';
export const DEBUG_TEST_COMMAND = 'pyrightMulti.debugTest';

/**
 * Runs python files with their module's venv: one reused terminal per run
 * target (module root + file), busy targets guarded via shell integration
 * events (absent shell integration degrades to no guard).
 */
export class Runner {
    #modules: ModuleEntry[] = [];
    readonly #terminals = new Map<string, vscode.Terminal>();
    readonly #keysByTerminal = new Map<vscode.Terminal, string>();
    readonly #busy = new Set<string>();
    readonly #lensesChanged = new vscode.EventEmitter<void>();
    /** fires when a target's busy state flips, so lenses can re-render */
    readonly onDidChangeBusy: vscode.Event<void> = this.#lensesChanged.event;
    readonly #disposables: vscode.Disposable[] = [this.#lensesChanged];

    constructor() {
        this.#disposables.push(
            vscode.window.onDidStartTerminalShellExecution((e) => this.#setBusy(e.terminal, true)),
            vscode.window.onDidEndTerminalShellExecution((e) => this.#setBusy(e.terminal, false)),
            vscode.window.onDidCloseTerminal((terminal) => {
                const key = this.#keysByTerminal.get(terminal);
                if (key === undefined) return;
                this.#keysByTerminal.delete(terminal);
                this.#terminals.delete(key);
                this.#setBusyKey(key, false);
            }),
        );
    }

    setKnownModules(modules: ModuleEntry[]): void {
        this.#modules = modules;
    }

    runSpecFor(fileFsPath: string): RunSpec {
        return buildRunSpec(this.#modules, fileFsPath);
    }

    isBusy(terminalKey: string): boolean {
        return this.#busy.has(terminalKey);
    }

    dispose(): void {
        for (const d of this.#disposables) d.dispose();
    }

    async run(uri?: vscode.Uri): Promise<void> {
        const target = await this.#prepareTarget(uri);
        if (target === null) return;
        await this.#runInTerminal(buildRunSpec(this.#modules, target.fsPath));
    }

    async runPytest(uri: vscode.Uri, nodeId: string): Promise<void> {
        const target = await this.#prepareTarget(uri);
        if (target === null) return;
        await this.#runInTerminal(buildPytestSpec(this.#modules, target.fsPath, nodeId));
    }

    async debug(uri?: vscode.Uri): Promise<void> {
        const target = await this.#prepareTarget(uri);
        if (target === null) return;
        await this.#debugLaunch(buildDebugLaunch(this.#modules, target.fsPath));
    }

    async debugPytest(uri: vscode.Uri, nodeId: string): Promise<void> {
        const target = await this.#prepareTarget(uri);
        if (target === null) return;
        await this.#debugLaunch(buildPytestDebugLaunch(this.#modules, target.fsPath, nodeId));
    }

    async #runInTerminal(spec: RunSpec): Promise<void> {
        if (!(await this.#venvPythonExists(spec.python, spec.venv))) return;
        if (this.#busy.has(spec.terminalKey)) {
            void vscode.window.showWarningMessage(`pyright-multi: already running in "${spec.terminalName}"`);
            return;
        }

        let terminal = this.#terminals.get(spec.terminalKey);
        if (terminal === undefined) {
            const env = spec.venv === null
                ? {}
                : { VIRTUAL_ENV: spec.venv, PATH: `${spec.venv}/bin:${process.env.PATH ?? ''}` };
            terminal = vscode.window.createTerminal({ name: spec.terminalName, cwd: spec.cwd, env });
            this.#terminals.set(spec.terminalKey, terminal);
            this.#keysByTerminal.set(terminal, spec.terminalKey);
        }
        terminal.show(true);
        terminal.sendText(spec.commandLine);
    }

    async #debugLaunch(launch: { name: string; python: string; env: { VIRTUAL_ENV?: string } } & vscode.DebugConfiguration): Promise<void> {
        if (!(await this.#venvPythonExists(launch.python, launch.env.VIRTUAL_ENV))) return;
        const started = await vscode.debug.startDebugging(undefined, launch);
        if (!started) {
            void vscode.window.showWarningMessage(`pyright-multi: failed to start debug session "${launch.name}"`);
        }
    }

    /** resolves the file to act on (arg or active editor), saving it first if dirty */
    async #prepareTarget(uri?: vscode.Uri): Promise<vscode.Uri | null> {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (target === undefined || target.scheme !== 'file' || !target.path.endsWith('.py')) {
            void vscode.window.showWarningMessage('pyright-multi: no python file (unsaved files must be saved first)');
            return null;
        }
        const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target.toString());
        if (open?.isDirty) await open.save();
        return target;
    }

    async #venvPythonExists(python: string, venv: string | null | undefined): Promise<boolean> {
        if (venv === null || venv === undefined) return true;
        const exists = await fs.stat(python).then(() => true, () => false);
        if (!exists) {
            void vscode.window.showWarningMessage(`pyright-multi: venv python not found: ${python}`);
        }
        return exists;
    }

    #setBusy(terminal: vscode.Terminal, busy: boolean): void {
        const key = this.#keysByTerminal.get(terminal);
        if (key !== undefined) this.#setBusyKey(key, busy);
    }

    #setBusyKey(key: string, busy: boolean): void {
        const changed = busy !== this.#busy.has(key);
        if (!changed) return;
        if (busy) this.#busy.add(key);
        else this.#busy.delete(key);
        this.#lensesChanged.fire();
    }
}

export class MainGuardCodeLensProvider implements vscode.CodeLensProvider {
    readonly #runner: Runner;
    readonly onDidChangeCodeLenses: vscode.Event<void>;

    constructor(runner: Runner) {
        this.#runner = runner;
        this.onDidChangeCodeLenses = runner.onDidChangeBusy;
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (document.languageId !== 'python' || document.uri.scheme !== 'file') return [];
        const spec = this.#runner.runSpecFor(document.uri.fsPath);
        const busy = this.#runner.isBusy(spec.terminalKey);
        return findMainGuardLines(document.getText()).flatMap((line) => {
            const range = new vscode.Range(line, 0, line, 0);
            // busy lens keeps the command: the click lands in the busy guard, showing the warning toast
            const run = new vscode.CodeLens(range, {
                title: busy ? '● running…' : '▶ Run',
                command: RUN_COMMAND,
                arguments: [document.uri],
            });
            const debug = new vscode.CodeLens(range, {
                title: '🐞 Debug',
                command: DEBUG_COMMAND,
                arguments: [document.uri],
            });
            return [run, debug];
        });
    }
}

export class PytestCodeLensProvider implements vscode.CodeLensProvider {
    readonly #runner: Runner;
    readonly onDidChangeCodeLenses: vscode.Event<void>;

    constructor(runner: Runner) {
        this.#runner = runner;
        this.onDidChangeCodeLenses = runner.onDidChangeBusy;
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (document.languageId !== 'python' || document.uri.scheme !== 'file' || !isTestFile(document.uri.fsPath)) return [];
        const base = this.#runner.runSpecFor(document.uri.fsPath);
        const busy = this.#runner.isBusy(pytestTerminalKey(base.cwd));
        return findPytestTargets(document.getText(), base.fileArg).flatMap((target) => {
            const range = new vscode.Range(target.line, 0, target.line, 0);
            const run = new vscode.CodeLens(range, {
                title: busy ? '● running…' : '▶ Run',
                command: RUN_TEST_COMMAND,
                arguments: [document.uri, target.nodeId],
            });
            const debug = new vscode.CodeLens(range, {
                title: '🐞 Debug',
                command: DEBUG_TEST_COMMAND,
                arguments: [document.uri, target.nodeId],
            });
            return [run, debug];
        });
    }
}
