# pyright-multi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VSCode extension that runs one pyright language server per explicitly-listed python module under a single opened folder (`~/projects`), each with its own venv.

**Architecture:** Thin extension client spawning N `pyright-langserver` processes (one per module from `pyright-modules.json`), lazily started on first opened python file, routed by longest-prefix path match; manifest is the single source of truth, re-read on cheap triggers; three-layer orphan protection.

**Tech Stack:** TypeScript, vscode-languageclient 9, `pyright` npm (bundled in vsix), `jsonc-parser`, esbuild, `node --test` via tsx for unit tests, `@vscode/vsce` for packaging.

**Spec:** `docs/superpowers/specs/2026-09-05-pyright-multi-design.md` (in this repo)

## Global Constraints

- Repo policy: **git is the human's** — do NOT commit/push unless the user asks in chat. Plan has no commit steps; at the end ask the user.
- Comments (if any) in English. Prefer self-explanatory names over comments.
- TypeScript `strict: true`. No `any` in exported signatures.
- Extension dir: `/Users/l.vinogradov/projects/dopilnik/pyright-multi/`. All paths below are relative to it unless absolute.
- Pyright pinned to `1.1.413` (the version behaviour was verified against).
- Unit tests must not import `vscode` (they run in plain node). Anything needing `vscode` is exercised by the manual steps.
- Manual verification commands assume macOS zsh/bash.

## File Structure

```
pyright-multi/
├── .vscode/
│   └── launch.json          # F5 → Extension Development Host
├── src/
│   ├── extension.ts         # activation, triggers wiring, status bar, deactivate
│   ├── manifest.ts          # ModuleEntry/Manifest types, jsonc parse, validate
│   ├── manifest.test.ts
│   ├── manifestDiff.ts      # diff two manifests → added/removed modules
│   ├── manifestDiff.test.ts
│   ├── router.ts            # isPathUnder / findModule (pure path logic)
│   ├── router.test.ts
│   ├── serverManager.ts     # LanguageClient per module: lazy start/stop, backoff, interpreter
│   ├── orphanSweep.ts       # ps parse + select + kill orphaned langservers
│   └── orphanSweep.test.ts
├── esbuild.js
├── package.json
├── tsconfig.json
├── .vscodeignore
└── README.md                # install, coexistence with ms-pyright, manual checklist
```

Responsibilities: `manifest*` = what modules exist; `router` = which module a path belongs to; `serverManager` = process lifecycle; `orphanSweep` = crash hygiene; `extension.ts` = glue + triggers.

---

### Task 1: Scaffold the extension

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.js`, `.vscodeignore`, `.vscode/launch.json`, `src/extension.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `activate(context: vscode.ExtensionContext): Promise<void>` and `deactivate(): Promise<void>` in `src/extension.ts` (Task 2 builds on both); `npm run compile` producing `dist/extension.js`; `npm test` runnable.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pyright-multi",
  "displayName": "pyright-multi",
  "description": "One pyright language server per module, each with its own venv",
  "version": "0.1.0",
  "publisher": "lvinogradov",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Programming Languages"],
  "activationEvents": ["onWorkspaceContains:pyright-modules.json", "onLanguage:python"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "pyrightMulti.showStatus", "title": "pyright-multi: Show status" }
    ]
  },
  "scripts": {
    "compile": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "typecheck": "tsc --noEmit",
    "test": "tsx --test src/manifest.test.ts src/router.test.ts src/manifestDiff.test.ts src/orphanSweep.test.ts",
    "package": "vsce package"
  },
  "dependencies": {
    "jsonc-parser": "^3.3.1",
    "pyright": "1.1.413",
    "vscode-languageclient": "^9.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.2.0",
    "esbuild": "^0.24.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `esbuild.js`** (standard VSCode template)

```js
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
```

- [ ] **Step 4: Create `.vscodeignore`**

```
.vscode/**
src/**
node_modules/@types/**
node_modules/.bin/**
node_modules/typescript/**
node_modules/esbuild/**
node_modules/tsx/**
**/*.map
**/*.ts
```

(Keeps `node_modules/pyright`, `jsonc-parser`, `vscode-languageclient` in the vsix — the server must ship as real files, esbuild does not bundle it.)

- [ ] **Step 5: Create `.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "${defaultBuildTask}"
    }
  ]
}
```

- [ ] **Step 6: Create `src/extension.ts` stub**

```ts
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    void context;
    vscode.window.showInformationMessage('pyright-multi activated');
}

export function deactivate(): void {}
```

- [ ] **Step 7: Install, compile, typecheck**

Run: `cd /Users/l.vinogradov/projects/dopilnik/pyright-multi && npm install && npm run compile && npm run typecheck`
Expected: exit 0, `dist/extension.js` exists.

- [ ] **Step 8: Manual smoke**

Open this folder in VSCode → F5 ("Run Extension") → in the Extension Development Host window open any folder → notification "pyright-multi activated" appears when a python file is opened (activation `onLanguage:python`). Close the host window.

---

### Task 2: Spike — two hardcoded modules, verify the risky assumptions

This task validates what the design depends on but cannot assume: (a) rootUri control makes each server pick up its module's config; (b) `pythonPath` really selects the venv; (c) two servers coexist; (d) stdin-EOF kills servers when the extension host dies. Everything here gets generalized in Tasks 3–8; write it as throwaway-shaped code in `src/spike.ts` called from `activate`.

**Files:**
- Create: `src/spike.ts`
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: verified facts recorded in `src/spike.ts` top comment (rootUri mechanism, pythonPath channel, EOF behaviour) that Task 6 relies on.

- [ ] **Step 1: Write `src/spike.ts`**

```ts
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';

interface SpikeModule {
    root: string;
    venv: string;
}

const SPIKE_MODULES: SpikeModule[] = [
    { root: '/Users/l.vinogradov/projects/frontik', venv: '/Users/l.vinogradov/projects/frontik/.venv' },
    { root: '/Users/l.vinogradov/projects/vecsearch', venv: '/Users/l.vinogradov/projects/vecsearch/.venv' },
];

function makeClient(extDir: string, m: SpikeModule): LanguageClient {
    const langserver = path.join(extDir, 'node_modules', 'pyright', 'langserver.index.js');
    const serverOptions: ServerOptions = {
        run: { command: process.execPath, args: [langserver, '--stdio'], transport: TransportKind.stdio, options: { cwd: m.root } },
        debug: { command: process.execPath, args: [langserver, '--stdio'], transport: TransportKind.stdio, options: { cwd: m.root } },
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'python', scheme: 'file', pattern: new vscode.RelativePattern(vscode.Uri.file(m.root), '**/*') }],
        workspaceFolder: { uri: vscode.Uri.file(m.root), name: path.basename(m.root), index: 0 },
        initializationOptions: { pythonPath: path.join(m.venv, 'bin', 'python') },
        outputChannel: vscode.window.createOutputChannel(`pyright-multi spike: ${path.basename(m.root)}`),
    };
    return new LanguageClient(`pyright-multi-spike:${path.basename(m.root)}`, path.basename(m.root), serverOptions, clientOptions);
}

export async function runSpike(context: vscode.ExtensionContext): Promise<LanguageClient[]> {
    const clients = SPIKE_MODULES.map((m) => makeClient(context.extensionPath, m));
    await Promise.all(clients.map((c) => c.start()));
    return clients;
}
```

- [ ] **Step 2: Wire it in `src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { runSpike } from './spike';
import type { LanguageClient } from 'vscode-languageclient/node';

let clients: LanguageClient[] = [];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    clients = await runSpike(context);
}

export async function deactivate(): Promise<void> {
    await Promise.all(clients.map((c) => c.stop(2000)));
}
```

- [ ] **Step 3: Compile and run**

Run: `npm run compile && npm run typecheck`
Expected: exit 0. If `LanguageClientOptions` field names differ (e.g. `initializationOptions` typing), fix to compile — record any deviation in the spike comment.

- [ ] **Step 4: Manual — intelligence from correct venvs**

F5 → host window opens `~/projects` (or open it there) → open `frontik/frontik/app.py` → hover `FastAPI` / go-to-definition on `from tornado import ...`: must land in `frontik/.venv/lib/.../tornado`, NOT system python. Open a vecsearch python file: its imports resolve from `vecsearch/.venv`. Check both output channels show no config errors.

- [ ] **Step 5: Manual — processes and hygiene**

In host window with both files open, run:

```bash
ps -axo pid,ppid,command | grep langserver.index.js | grep -v grep
```

Expected: exactly 2 lines, both with `langserver.index.js` path pointing into `pyright-multi/node_modules/pyright`, PPID = extension host (not 1).

Then, checklist items 1/4/5 from the spec:
- Reload Window in host → after reload, open both files again → still exactly 2 processes (new PIDs), 0 leftovers.
- `kill -9 <extension host pid>` → both langserver processes exit within ~5s (stdin EOF). Verify by re-running ps.
- Full VSCode host quit (Cmd+Q) → 0 leftovers.

If EOF does NOT kill them: record it — the startup sweep (Task 7) becomes mandatory, and we add explicit `options: { detached: false }` and consider `process-group` kill. Do not silently continue.

- [ ] **Step 6: Record findings**

Prepend to `src/spike.ts` a comment block: which interpreter channel worked (initializationOptions vs none), whether rootUri was respected (evidenced by frontik's pyrightconfig.json being used), EOF kill result.

---

### Task 3: Router (pure path logic)

**Files:**
- Create: `src/router.ts`
- Test: `src/router.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isPathUnder(root: string, filePath: string): boolean`
  - `findModule(modules: ReadonlyArray<{ root: string }>, filePath: string): string | null` — returns the matching module's `root` (longest prefix wins) or `null`

- [ ] **Step 1: Write the failing test `src/router.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findModule, isPathUnder } from './router';

const MODULES = [
    { root: '/Users/x/projects' },
    { root: '/Users/x/projects/hh.kardinal' },
    { root: '/Users/x/projects/frontik' },
];

test('file directly under module matches', () => {
    assert.equal(findModule(MODULES, '/Users/x/projects/frontik/app.py'), '/Users/x/projects/frontik');
});

test('file in site-packages inside venv belongs to that module', () => {
    const p = '/Users/x/projects/frontik/.venv/lib/python3.11/site-packages/tornado/web.py';
    assert.equal(findModule(MODULES, p), '/Users/x/projects/frontik');
});

test('deepest module wins', () => {
    const p = '/Users/x/projects/hh.kardinal/subproject/main.py';
    assert.equal(findModule(MODULES, p), '/Users/x/projects/hh.kardinal');
});

test('prefix must be a path boundary: sibling dir does not steal the match', () => {
    assert.equal(findModule([{ root: '/Users/x/projects/frontik' }], '/Users/x/projects/frontik-clone/app.py'), null);
});

test('parent module still matches when no deeper module does', () => {
    assert.equal(findModule(MODULES, '/Users/x/projects/frontik-clone/app.py'), '/Users/x/projects');
});

test('unrelated path returns null', () => {
    assert.equal(findModule(MODULES, '/tmp/x.py'), null);
});

test('isPathUnder basic cases', () => {
    assert.equal(isPathUnder('/a/b', '/a/b/c.py'), true);
    assert.equal(isPathUnder('/a/b', '/a/b'), true);
    assert.equal(isPathUnder('/a/b', '/a/bc/c.py'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/router.test.ts`
Expected: FAIL — cannot resolve module './router'.

- [ ] **Step 3: Implement `src/router.ts`**

```ts
import * as path from 'node:path';

export function isPathUnder(root: string, filePath: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(filePath));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function findModule(modules: ReadonlyArray<{ root: string }>, filePath: string): string | null {
    let best: string | null = null;
    for (const m of modules) {
        if (isPathUnder(m.root, filePath) && (best === null || m.root.length > best.length)) {
            best = m.root;
        }
    }
    return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/router.test.ts`
Expected: PASS (all).

---

### Task 4: Manifest — types, jsonc parse, validation, last-good store

**Files:**
- Create: `src/manifest.ts`
- Test: `src/manifest.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ModuleEntry { root: string; venv: string }` — both absolute
  - `interface Manifest { modules: ModuleEntry[] }`
  - `class ManifestError extends Error`
  - `parseManifest(text: string, manifestDir: string): Manifest` — throws `ManifestError` on bad input; `venv` defaults to `<root>/.venv`; relative paths resolved against `manifestDir`
  - `class ManifestStore` — `constructor(initial: Manifest | null)`, `current(): Manifest | null`, `reload(text: string, manifestDir: string): { ok: boolean; error: string | null; diffInput: Manifest | null }` — keeps last good on failure

- [ ] **Step 1: Write the failing test `src/manifest.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ManifestError, ManifestStore, parseManifest } from './manifest';

const DIR = '/Users/x/projects';

test('parses minimal manifest with venv default', () => {
    const m = parseManifest('{ "modules": [ { "root": "frontik" } ] }', DIR);
    assert.deepEqual(m.modules, [{ root: '/Users/x/projects/frontik', venv: '/Users/x/projects/frontik/.venv' }]);
});

test('jsonc comments and trailing commas allowed', () => {
    const text = '{ // my modules\n "modules": [ { "root": "a", }, ], }';
    const m = parseManifest(text, DIR);
    assert.equal(m.modules.length, 1);
});

test('explicit venv relative and absolute', () => {
    const m = parseManifest('{ "modules": [ { "root": "a", "venv": "venvs/a" }, { "root": "b", "venv": "/tmp/b-venv" } ] }', DIR);
    assert.equal(m.modules[0].venv, '/Users/x/projects/venvs/a');
    assert.equal(m.modules[1].venv, '/tmp/b-venv');
});

test('missing modules array throws ManifestError', () => {
    assert.throws(() => parseManifest('{}', DIR), ManifestError);
});

test('root must be non-empty string', () => {
    assert.throws(() => parseManifest('{ "modules": [ { "venv": "x" } ] }', DIR), ManifestError);
});

test('broken json throws ManifestError', () => {
    assert.throws(() => parseManifest('{ "modules": [', DIR), ManifestError);
});

test('store keeps last good on failed reload', () => {
    const store = new ManifestStore(null);
    const r1 = store.reload('{ "modules": [ { "root": "a" } ] }', DIR);
    assert.equal(r1.ok, true);
    const r2 = store.reload('{ broken', DIR);
    assert.equal(r2.ok, false);
    assert.ok(r2.error);
    assert.equal(store.current()?.modules[0].root, '/Users/x/projects/a');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/manifest.test.ts`
Expected: FAIL — cannot resolve './manifest'.

- [ ] **Step 3: Implement `src/manifest.ts`**

```ts
import * as path from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';

export interface ModuleEntry {
    /** absolute module root dir */
    root: string;
    /** absolute venv dir */
    venv: string;
}

export interface Manifest {
    modules: ModuleEntry[];
}

export class ManifestError extends Error {}

interface RawEntry {
    root?: unknown;
    venv?: unknown;
}

interface RawManifest {
    modules?: unknown;
}

export function parseManifest(text: string, manifestDir: string): Manifest {
    const errors: ParseError[] = [];
    const raw = parseJsonc(text, errors, { allowTrailingComma: true }) as RawManifest | null;
    if (errors.length > 0 || raw === null || typeof raw !== 'object') {
        throw new ManifestError('pyright-modules.json is not valid json');
    }
    if (!Array.isArray(raw.modules)) {
        throw new ManifestError('pyright-modules.json: "modules" must be an array');
    }
    const modules = raw.modules.map((item, i) => {
        const entry = item as RawEntry;
        if (typeof entry?.root !== 'string' || entry.root.length === 0) {
            throw new ManifestError(`modules[${i}]: "root" must be a non-empty string`);
        }
        if (entry.venv !== undefined && typeof entry.venv !== 'string') {
            throw new ManifestError(`modules[${i}]: "venv" must be a string`);
        }
        const root = path.resolve(manifestDir, entry.root);
        const venv = entry.venv === undefined ? path.join(root, '.venv') : path.resolve(manifestDir, entry.venv);
        return { root, venv };
    });
    return { modules };
}

export interface ReloadResult {
    ok: boolean;
    error: string | null;
    /** new manifest when ok, null otherwise */
    diffInput: Manifest | null;
}

export class ManifestStore {
    #manifest: Manifest | null;

    constructor(initial: Manifest | null) {
        this.#manifest = initial;
    }

    current(): Manifest | null {
        return this.#manifest;
    }

    reload(text: string, manifestDir: string): ReloadResult {
        try {
            this.#manifest = parseManifest(text, manifestDir);
            return { ok: true, error: null, diffInput: this.#manifest };
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            return { ok: false, error, diffInput: null };
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/manifest.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Run the manifest tests**

The `"test"` script (Task 1) lists all five test files up front; files from later tasks don't exist yet, so until Task 7 run per-file: `npx tsx --test src/manifest.test.ts`. From Task 8 on, `npm test` must pass as-is.

---

### Task 5: Manifest diff

**Files:**
- Create: `src/manifestDiff.ts`
- Test: `src/manifestDiff.test.ts`

**Interfaces:**
- Consumes: `ModuleEntry`, `Manifest` from `./manifest`.
- Produces: `interface ManifestDiff { added: ModuleEntry[]; removed: ModuleEntry[] }` and `diffManifests(old: Manifest | null, current: Manifest): ManifestDiff` — a module is identified by `root`; a `venv` change is expressed as removed+added of the same root.

- [ ] **Step 1: Write the failing test `src/manifestDiff.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffManifests } from './manifestDiff';
import type { Manifest, ModuleEntry } from './manifest';

function m(root: string, venv = `${root}/.venv`): ModuleEntry {
    return { root, venv };
}

function man(...modules: ModuleEntry[]): Manifest {
    return { modules };
}

test('null old manifest: everything added', () => {
    const d = diffManifests(null, man(m('/a'), m('/b')));
    assert.deepEqual(d.added.map((x) => x.root), ['/a', '/b']);
    assert.deepEqual(d.removed, []);
});

test('removed and added detected', () => {
    const d = diffManifests(man(m('/a'), m('/b')), man(m('/b'), m('/c')));
    assert.deepEqual(d.added.map((x) => x.root), ['/c']);
    assert.deepEqual(d.removed.map((x) => x.root), ['/a']);
});

test('venv change is remove+add of same root', () => {
    const d = diffManifests(man(m('/a', '/v1')), man(m('/a', '/v2')));
    assert.deepEqual(d.removed.map((x) => x.venv), ['/v1']);
    assert.deepEqual(d.added.map((x) => x.venv), ['/v2']);
});

test('identical manifests produce empty diff', () => {
    const d = diffManifests(man(m('/a')), man(m('/a')));
    assert.deepEqual(d, { added: [], removed: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/manifestDiff.test.ts`
Expected: FAIL — cannot resolve './manifestDiff'.

- [ ] **Step 3: Implement `src/manifestDiff.ts`**

```ts
import type { Manifest, ModuleEntry } from './manifest';

export interface ManifestDiff {
    added: ModuleEntry[];
    removed: ModuleEntry[];
}

function sameModule(a: ModuleEntry, b: ModuleEntry): boolean {
    return a.root === b.root && a.venv === b.venv;
}

export function diffManifests(old: Manifest | null, current: Manifest): ManifestDiff {
    const oldModules = old?.modules ?? [];
    return {
        added: current.modules.filter((m) => !oldModules.some((o) => sameModule(o, m))),
        removed: oldModules.filter((m) => !current.modules.some((o) => sameModule(o, m))),
    };
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test` (with `src/manifestDiff.test.ts` added to the script)
Expected: PASS.

---

### Task 6: ServerManager — generalized per-module lifecycle

Generalizes the spike: lazy start, stop, crash → backoff restart, per-module interpreter, scope filtering (documentSelector pattern primary, middleware backstop). Unit-testable parts are extracted as pure functions; LSP wiring is verified manually via F5.

**Files:**
- Create: `src/serverManager.ts`
- Test: `src/serverManager.test.ts` (pure helpers only)

**Interfaces:**
- Consumes: `ModuleEntry` from `./manifest`; `isPathUnder` from `./router`.
- Produces:
  - `langserverScript(extDir: string): string`
  - `venvPython(venv: string): string` — `<venv>/bin/python`
  - `shouldRestart(restartAllowedAtMs: number, nowMs: number): boolean`
  - `class ServerManager` — `constructor(context: vscode.ExtensionContext)`, `ensureStarted(module: ModuleEntry): Promise<void>`, `stop(root: string): Promise<void>`, `stopAll(): Promise<void>`, `activeRoots(): string[]`, `onChange(cb: () => void): void` (fired on start/stop for the status bar)

- [ ] **Step 1: Write the failing test `src/serverManager.test.ts`** (pure helpers only)

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { langserverScript, shouldRestart, venvPython } from './serverManager';

test('langserverScript points into bundled pyright', () => {
    assert.equal(
        langserverScript('/ext/dir'),
        '/ext/dir/node_modules/pyright/langserver.index.js',
    );
});

test('venvPython joins bin/python', () => {
    assert.equal(venvPython('/v/.venv'), '/v/.venv/bin/python');
});

test('shouldRestart respects backoff window', () => {
    assert.equal(shouldRestart(1_000, 999), false);
    assert.equal(shouldRestart(1_000, 1_000), true);
    assert.equal(shouldRestart(1_000, 2_000), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/serverManager.test.ts`
Expected: FAIL — cannot resolve './serverManager'.

- [ ] **Step 3: Implement `src/serverManager.ts`**

```ts
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    StateKind,
    TransportKind,
    type Middleware,
} from 'vscode-languageclient/node';
import type { ModuleEntry } from './manifest';
import { isPathUnder } from './router';

const RESTART_BACKOFF_MS = 30_000;

export function langserverScript(extDir: string): string {
    return path.join(extDir, 'node_modules', 'pyright', 'langserver.index.js');
}

export function venvPython(venv: string): string {
    return path.join(venv, 'bin', 'python');
}

export function shouldRestart(restartAllowedAtMs: number, nowMs: number): boolean {
    return nowMs >= restartAllowedAtMs;
}

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

    roots(): string[] {
        return [...this.#entries.keys()];
    }

    async ensureStarted(module: ModuleEntry): Promise<void> {
        if (this.#disposed) return;
        const existing = this.#entries.get(module.root);
        if (existing?.starting) {
            return existing.starting;
        }
        if (existing && existing.client !== null && existing.client.state === StateKind.Running) {
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
                if (event.newState === StateKind.Stopped && !this.#disposed) {
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

    #makeClient(module: ModuleEntry): LanguageClient {
        const langserver = langserverScript(this.#extDir);
        const serverOptions: ServerOptions = {
            run: { command: process.execPath, args: [langserver, '--stdio'], transport: TransportKind.stdio, options: { cwd: module.root } },
            debug: { command: process.execPath, args: [langserver, '--stdio'], transport: TransportKind.stdio, options: { cwd: module.root } },
        };
        const rootUri = vscode.Uri.file(module.root);
        const inScope = (uri: vscode.Uri): boolean => uri.scheme === 'file' && isPathUnder(module.root, uri.fsPath);
        const scopeMiddleware = {
            didOpen: (doc: vscode.TextDocument, next: (d: vscode.TextDocument) => void) => {
                if (inScope(doc.uri)) next(doc);
            },
            didChange: (event: vscode.TextDocumentChangeEvent, next: (e: vscode.TextDocumentChangeEvent) => void) => {
                if (inScope(event.document.uri)) next(event);
            },
            didClose: (doc: vscode.TextDocument, next: (d: vscode.TextDocument) => void) => {
                if (inScope(doc.uri)) next(doc);
            },
        } satisfies Middleware;
        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ language: 'python', scheme: 'file', pattern: new vscode.RelativePattern(rootUri, '**/*') }],
            workspaceFolder: { uri: rootUri, name: path.basename(module.root), index: 0 },
            initializationOptions: { pythonPath: venvPython(module.venv) },
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
```

Notes: `outputChannelName` (v9) instead of creating channels manually. If `Middleware` hook names mismatch at compile time (`tsc --noEmit` catches), align with the installed `vscode-languageclient` typings and keep the three did* filters.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (router, manifest, manifestDiff, serverManager helper tests).

---

### Task 7: Orphan sweep

**Files:**
- Create: `src/orphanSweep.ts`
- Test: `src/orphanSweep.test.ts`

**Interfaces:**
- Consumes: nothing (pure parsing + node APIs).
- Produces:
  - `interface PsLine { pid: string; ppid: string; command: string }`
  - `parsePs(output: string): PsLine[]`
  - `selectOrphans(lines: ReadonlyArray<PsLine>, ourLangserverPath: string): number[]` — pid numbers where `command` contains our path AND `ppid === '1'`
  - `sweepOrphans(ourLangserverPath: string): Promise<number[]>` — runs ps, selects, SIGKILLs, returns killed pids

- [ ] **Step 1: Write the failing test `src/orphanSweep.test.ts`**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePs, selectOrphans } from './orphanSweep';

const OUR = '/ext/pyright-multi/node_modules/pyright/langserver.index.js';
const OTHER = '/ext/ms-pyright/dist/server.js';

const SAMPLE = [
    '   100 1 node /ext/ms-pyright/dist/server.js --stdio',
    '  101 1 node ' + OUR + ' --stdio',
    '  102 55 node ' + OUR + ' --stdio',
    '  103   1 node ' + OUR + ' --stdio',
    'PID PPID COMMAND',
].join('\n');

test('parsePs splits pid/ppid/command with messy whitespace', () => {
    const lines = parsePs(SAMPLE);
    assert.equal(lines.length, 5);
    assert.deepEqual(lines[2], { pid: '101', ppid: '1', command: 'node ' + OUR + ' --stdio' });
});

test('selectOrphans: only ours with ppid 1', () => {
    const lines = parsePs(SAMPLE);
    assert.deepEqual(selectOrphans(lines, OUR), [101, 103]);
    assert.deepEqual(selectOrphans(lines, OTHER), [100]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/orphanSweep.test.ts`
Expected: FAIL — cannot resolve './orphanSweep'.

- [ ] **Step 3: Implement `src/orphanSweep.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface PsLine {
    pid: string;
    ppid: string;
    command: string;
}

export function parsePs(output: string): PsLine[] {
    return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('PID'))
        .map((line) => {
            const parts = line.split(/\s+/);
            return { pid: parts[0], ppid: parts[1], command: parts.slice(2).join(' ') };
        });
}

export function selectOrphans(lines: ReadonlyArray<PsLine>, ourLangserverPath: string): number[] {
    return lines
        .filter((l) => l.command.includes(ourLangserverPath) && l.ppid === '1')
        .map((l) => Number(l.pid))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
}

export async function sweepOrphans(ourLangserverPath: string): Promise<number[]> {
    const { stdout } = await execFileP('ps', ['-axo', 'pid=,ppid=,command=']);
    const victims = selectOrphans(parsePs(stdout), ourLangserverPath);
    for (const pid of victims) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already gone — nothing to do
        }
    }
    return victims;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

---

### Task 8: Wiring — triggers, fallback module, status bar, deactivate

Replaces the spike: `src/spike.ts` is deleted, `src/extension.ts` becomes the real orchestrator.

**Files:**
- Create: nothing new
- Modify: `src/extension.ts` (full rewrite); delete `src/spike.ts`
- Modify: `package.json` (ensure `"test"` lists all five test files)

**Interfaces:**
- Consumes: `ManifestStore`, `ModuleEntry` from `./manifest`; `diffManifests` from `./manifestDiff`; `findModule` from `./router`; `ServerManager` (incl. `setKnownModules`/`knownModules`/`moduleCount`/`dispose` added in this task), `langserverScript` from `./serverManager`; `sweepOrphans` from `./orphanSweep`.
- Produces: the shipped `activate`/`deactivate` behavior defined by the spec's lifecycle table.

- [ ] **Step 1: Implement `src/extension.ts`**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ManifestStore, type ModuleEntry } from './manifest';
import { diffManifests } from './manifestDiff';
import { findModule } from './router';
import { ServerManager, langserverScript } from './serverManager';
import { sweepOrphans } from './orphanSweep';

const MANIFEST_NAME = 'pyright-modules.json';

let manager: ServerManager | null = null;
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
    if (diff.added.length > 0) log(`modules added: ${diff.added.map((m) => m.root).join(', ')} (servers start lazily)`);
    updateStatus();
}

function updateStatus(): void {
    if (!statusItem || !manager) return;
    statusItem.text = `pyright-multi: ${manager.moduleCount()} modules, ${manager.activeRoots().length} active`;
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
    manager.onChange(updateStatus);

    const swept = await sweepOrphans(langserverScript(context.extensionPath));
    if (swept.length > 0) log(`swept ${swept.length} orphaned langserver process(es)`);

    await applyCurrentModules();
    setupWatchers();

    context.subscriptions.push(
        output,
        statusItem,
        manager,
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            stores.clear();
            void applyCurrentModules();
            setupWatchers();
        }),
        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (doc.languageId === 'python') void onPythonFileOpened(doc);
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
    statusItem.show();
}

export async function deactivate(): Promise<void> {
    for (const w of watchers) w.dispose();
    await manager?.stopAll();
}
```

Additions this step requires in `src/serverManager.ts`:

```ts
// inside ServerManager
#knownModules: ModuleEntry[] = [];

setKnownModules(modules: ModuleEntry[]): void {
    this.#knownModules = modules;
}

knownModules(): ModuleEntry[] {
    return this.#knownModules;
}

moduleCount(): number {
    return this.#knownModules.length;
}

dispose(): void {
    void this.stopAll();
}
```

(`dispose` is needed because the manager is pushed into `context.subscriptions`. The `ModuleEntry` import already exists from Task 6.)

- [ ] **Step 2: Typecheck and compile**

Run: `npm run typecheck && npm run compile`
Expected: exit 0.

- [ ] **Step 3: Unit tests still green**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manual — full checklist (spec §Testing, items 1–11)**

Create `~/projects/pyright-modules.json`:

```jsonc
{ "modules": [ { "root": "frontik" }, { "root": "vecsearch" } ] }
```

Temporarily disable the `ms-pyright` extension (Extensions view → ms-pyright → Disable). F5, host window opens `~/projects`. Run through:

1. Reload Window with frontik+vecsearch files open → exactly 2 langserver processes, new PIDs.
2. Close host window → 0 langserver processes.
3. Cmd+Q → 0 langserver processes.
4. `kill -9 <ext host pid>` → servers exit via EOF.
5. `kill -9` whole VSCode (test in a disposable window) → next activation sweeps.
6. Add/remove a workspace folder → modules appear/disappear (status bar count).
7. Edit manifest live: remove vecsearch → its server stops; add `hire-embeddings` → lazy server on next file open; write broken JSON → warning in output, last valid kept.
8. Delete `.venv` of a live module (use a scratch module, e.g. a tmp dir with a fake module entry) → error visible in its output channel, no zombie process.
9. Open `CLAUDE.md` / a java file → nothing spawns.
10. Module with missing venv (fake entry) → warning on open attempt; create the venv → works after retry.
11. Hover/goto-def in frontik lands in `frontik/.venv/...`, in vecsearch lands in `vecsearch/.venv/...` — verify paths in the definition popup.

Record results next to each item in the README checklist (Task 9).

---

### Task 9: README, packaging, install

**Files:**
- Create: `README.md`
- Modify: none (packaging only)

**Interfaces:**
- Consumes: everything built.
- Produces: `pyright-multi-0.1.0.vsix` installable via `code --install-extension`.

- [ ] **Step 1: Write `README.md`**

```markdown
# pyright-multi

One pyright language server per module, each with its own venv. Built for opening
`~/projects` (many repos) as a single VSCode folder.

## How it works

- `pyright-modules.json` at the workspace folder root lists modules:

  ```jsonc
  { "modules": [ { "root": "frontik" }, { "root": "hh.kardinal", "venv": "/abs/path/venv" } ] }
  ```

- `venv` defaults to `<root>/.venv`. Paths relative to the manifest unless absolute.
- Each module gets its own `pyright-langserver`, started lazily on the first opened
  python file under it. Each server uses the module's `pyrightconfig.json` if present.
- Files outside any module get no python intelligence.

## Install / develop

- Dev: open this folder, `npm install`, F5 ("Run Extension").
- Package: `npm run package` → install the vsix:
  `code --install-extension pyright-multi-0.1.0.vsix`

## IMPORTANT: coexistence

Disable the stock `ms-pyright` extension (and Pylance) while using this one — two
servers on the same python files produce duplicate/wrong intelligence.

## Diagnostics

- Output channel "pyright-multi" (command: pyright-multi: Show status).
- Processes: `ps -axo pid,ppid,command | grep langserver.index.js | grep pyright-multi`
  — ours carry the path into this extension's node_modules.

## Manual test checklist (run before any "done")

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | Reload Window, 2 modules active | exactly 2 new processes, 0 old | |
| 2 | Close window | 0 langserver processes | |
| 3 | Cmd+Q | 0 langserver processes | |
| 4 | `kill -9` extension host | servers exit via stdin EOF | |
| 5 | `kill -9` whole VSCode | next start sweeps orphans | |
| 6 | Add/remove workspace folder | module count follows | |
| 7 | Edit manifest live (add/remove/break) | applied live; broken keeps last valid | |
| 8 | Delete .venv of live module | visible error, no zombie | |
| 9 | Open file outside modules | nothing spawns | |
| 10 | Module with missing venv | warning; works after venv appears | |
| 11 | hover/goto-def per module | resolves from that module's venv | |
```

- [ ] **Step 2: Package**

Run: `npm run package`
Expected: `pyright-multi-0.1.0.vsix` created (~40MB, pyright bundled). If vsce warns about repository/license — answer prompts or add `"repository"` field as `dopilnik` subdirectory note; do not invent a remote.

- [ ] **Step 3: Install and final verification**

Run: `code --install-extension pyright-multi-0.1.0.vsix`
Then in the REAL (non-dev) VSCode: disable ms-pyright, reload, open `~/projects`, open `frontik/frontik/app.py`, verify hover from `frontik/.venv` and status bar "pyright-multi: 2 modules, 1 active".

- [ ] **Step 4: Ask the user about committing**

Plan policy: git is the human's. Ask: "Всё готово и проверено — закоммитить в dopilnik?"
