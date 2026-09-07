import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    State,
    TransportKind,
    type Middleware,
} from 'vscode-languageclient/node';
import type { ModuleEntry } from './manifest';
import { isPathUnder } from './router';
import { langserverScript, shouldRestart, venvPython } from './serverMeta';

const RESTART_BACKOFF_MS = 30_000;

interface Entry {
    module: ModuleEntry;
    client: LanguageClient | null;
    starting: Promise<void> | null;
    crashedAtMs: number;
    restartAllowedAtMs: number;
}

export class ServerManager {
    readonly #extDir: string;
    readonly #entries = new Map<string, Entry>();
    readonly #changeListeners: Array<() => void> = [];
    #knownModules: ModuleEntry[] = [];
    #disposed = false;

    constructor(context: vscode.ExtensionContext) {
        this.#extDir = context.extensionPath;
    }

    onChange(cb: () => void): void {
        this.#changeListeners.push(cb);
    }

    activeRoots(): string[] {
        return [...this.#entries.values()].filter((e) => e.client !== null).map((e) => e.module.root);
    }

    setKnownModules(modules: ModuleEntry[]): void {
        this.#knownModules = modules;
    }

    knownModules(): ModuleEntry[] {
        return this.#knownModules;
    }

    moduleCount(): number {
        return this.#knownModules.length;
    }

    async ensureStarted(module: ModuleEntry): Promise<void> {
        if (this.#disposed) return;
        const existing = this.#entries.get(module.root);
        if (existing?.starting) {
            return existing.starting;
        }
        if (existing && existing.client !== null && existing.client.state === State.Running) {
            return;
        }
        if (existing && existing.client === null && !shouldRestart(existing.restartAllowedAtMs, Date.now())) {
            return;
        }
        await existing?.client?.stop(2000);

        const entry: Entry = { module, client: null, starting: null, crashedAtMs: 0, restartAllowedAtMs: 0 };
        this.#entries.set(module.root, entry);
        entry.starting = (async () => {
            const client = this.#makeClient(module);
            client.onDidChangeState((event) => {
                if (event.newState === State.Stopped && !this.#disposed) {
                    entry.crashedAtMs = Date.now();
                    entry.restartAllowedAtMs = entry.crashedAtMs + RESTART_BACKOFF_MS;
                    entry.client = null;
                    this.#emitChange();
                }
            });
            await client.start();
            entry.client = client;
            this.#emitChange();
        })();
        try {
            await entry.starting;
        } finally {
            entry.starting = null;
        }
    }

    async stop(root: string): Promise<void> {
        const entry = this.#entries.get(root);
        if (!entry) return;
        this.#entries.delete(root);
        await entry.client?.stop(2000);
        this.#emitChange();
    }

    async stopAll(): Promise<void> {
        this.#disposed = true;
        await Promise.all([...this.#entries.keys()].map((root) => this.stop(root)));
    }

    dispose(): void {
        void this.stopAll();
    }

    #makeClient(module: ModuleEntry): LanguageClient {
        const langserver = langserverScript(this.#extDir);
        // process.execPath inside the extension host is the Electron binary;
        // ELECTRON_RUN_AS_NODE makes it behave as plain node for the server
        const serverEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
        const serverOptions: ServerOptions = {
            run: { command: process.execPath, args: [langserver, '--stdio'], transport: TransportKind.stdio, options: { cwd: module.root, env: serverEnv } },
            debug: { command: process.execPath, args: [langserver, '--stdio'], transport: TransportKind.stdio, options: { cwd: module.root, env: serverEnv } },
        };
        const rootUri = vscode.Uri.file(module.root);
        const inScope = (uri: vscode.Uri): boolean => uri.scheme === 'file' && isPathUnder(module.root, uri.fsPath);
        const scopeMiddleware = {
            didOpen: async (doc: vscode.TextDocument, next: (d: vscode.TextDocument) => void) => {
                if (inScope(doc.uri)) next(doc);
            },
            didChange: async (event: vscode.TextDocumentChangeEvent, next: (e: vscode.TextDocumentChangeEvent) => void) => {
                if (inScope(event.document.uri)) next(event);
            },
            didClose: async (doc: vscode.TextDocument, next: (d: vscode.TextDocument) => void) => {
                if (inScope(doc.uri)) next(doc);
            },
            // the only channel pyright reads its interpreter from: the `python` settings
            // section pulled via workspace/configuration (initializationOptions is ignored)
            workspace: {
                configuration: async (params, token, next) => {
                    const values = await Promise.all(params.items.map(async (item) => {
                        if (item.section === 'python') {
                            return { pythonPath: venvPython(module.venv) };
                        }
                        const single = await next({ items: [item] }, token);
                        return Array.isArray(single) ? single[0] ?? null : null;
                    }));
                    return values;
                },
            },
        } satisfies Middleware;
        // protocol typing for `pattern` is narrower than what the VSCode workbench
        // runtime accepts; RelativePattern scopes the selector to the module root
        const documentSelector = [
            { language: 'python', scheme: 'file', pattern: new vscode.RelativePattern(rootUri, '**/*') },
        ] as unknown as LanguageClientOptions['documentSelector'];
        const clientOptions: LanguageClientOptions = {
            documentSelector,
            workspaceFolder: { uri: rootUri, name: path.basename(module.root), index: 0 },
            middleware: scopeMiddleware,
            outputChannelName: `pyright-multi: ${path.basename(module.root)}`,
        };
        const id = `pyright-multi:${module.root}`;
        return new LanguageClient(id, id, serverOptions, clientOptions);
    }

    #emitChange(): void {
        for (const cb of this.#changeListeners) cb();
    }
}
