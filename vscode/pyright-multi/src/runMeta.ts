import * as path from 'node:path';
import { findModule } from './router';
import { venvPython } from './serverMeta';

export interface RunSpec {
    /** terminal cwd */
    cwd: string;
    /** interpreter path (module venv) or command name (system) */
    python: string;
    /** file argument as passed on the command line, relative to cwd */
    fileArg: string;
    /** full command line for terminal sendText */
    commandLine: string;
    /** reuse key: same target → same terminal */
    terminalKey: string;
    /** terminal display name */
    terminalName: string;
    /** venv dir to activate in the terminal env, null for system python */
    venv: string | null;
}

/** posix single-quote wrapping; safe for zsh/bash regardless of content */
export function shellQuote(s: string): string {
    if (/^[\w./@=:-]+$/.test(s)) return s;
    return `'${s.replaceAll("'", "'\\''")}'`;
}

const MAIN_GUARD = /^\s*if\s+__name__\s*==\s*(['"])__main__\1\s*:\s*(?:#.*)?$/;

/** 0-based line numbers of `if __name__ == '__main__':` guards */
export function findMainGuardLines(text: string): number[] {
    const lines: number[] = [];
    text.split('\n').forEach((line, i) => {
        if (MAIN_GUARD.test(line)) lines.push(i);
    });
    return lines;
}

interface ResolvedTarget {
    python: string;
    cwd: string;
    /** file path relative to cwd (basename when outside any module) */
    fileArg: string;
    venv: string | null;
}

function resolveTarget(modules: ReadonlyArray<{ root: string; venv: string }>, fileFsPath: string): ResolvedTarget {
    const root = findModule(modules, fileFsPath);
    if (root === null) {
        return { python: 'python3', cwd: path.dirname(fileFsPath), fileArg: path.basename(fileFsPath), venv: null };
    }
    const module = modules.find((m) => m.root === root)!;
    return { python: venvPython(module.venv), cwd: root, fileArg: path.relative(root, fileFsPath), venv: module.venv };
}

function targetLabel(target: ResolvedTarget): string {
    return target.venv === null ? target.fileArg : `${path.basename(target.cwd)}/${target.fileArg}`;
}

export function buildRunSpec(modules: ReadonlyArray<{ root: string; venv: string }>, fileFsPath: string): RunSpec {
    const target = resolveTarget(modules, fileFsPath);
    const commandLine = target.venv === null
        ? `cd ${shellQuote(target.cwd)} && python3 ${shellQuote(target.fileArg)}`
        : `cd ${shellQuote(target.cwd)} && ${shellQuote(target.python)} ${shellQuote(target.fileArg)}`;
    return {
        cwd: target.cwd,
        python: target.python,
        fileArg: target.fileArg,
        commandLine,
        terminalKey: target.venv === null ? fileFsPath : `${target.cwd}:${target.fileArg}`,
        terminalName: `pm: ${targetLabel(target)}`,
        venv: target.venv,
    };
}

/** in-memory debugpy launch config for vscode.debug.startDebugging; nothing is written to launch.json */
export interface DebugLaunch {
    type: 'debugpy';
    request: 'launch';
    name: string;
    program: string;
    cwd: string;
    python: string;
    console: 'integratedTerminal';
    env: { VIRTUAL_ENV?: string; PATH?: string };
}

export function buildDebugLaunch(modules: ReadonlyArray<{ root: string; venv: string }>, fileFsPath: string): DebugLaunch {
    const target = resolveTarget(modules, fileFsPath);
    return {
        type: 'debugpy',
        request: 'launch',
        name: `pm debug: ${targetLabel(target)}`,
        program: fileFsPath,
        cwd: target.cwd,
        python: target.python,
        console: 'integratedTerminal',
        env: venvEnv(target.venv),
    };
}

/** single pytest terminal per cwd (module root, or file dir outside modules) */
export function pytestTerminalKey(cwd: string): string {
    return `${cwd}:pytest`;
}

/**
 * pytest run: all targets of one module share a single terminal, so the key is
 * scoped to the module (or to the file's directory outside any module)
 */
export function buildPytestSpec(
    modules: ReadonlyArray<{ root: string; venv: string }>,
    fileFsPath: string,
    nodeId: string,
): RunSpec {
    const target = resolveTarget(modules, fileFsPath);
    // the reused terminal may have been cd'ed away by the user: return it to
    // the spec cwd every run, the paths are relative to it
    const commandLine = target.venv === null
        ? `cd ${shellQuote(target.cwd)} && python3 -m pytest ${shellQuote(nodeId)}`
        : `cd ${shellQuote(target.cwd)} && ${shellQuote(target.python)} -m pytest ${shellQuote(nodeId)}`;
    return {
        cwd: target.cwd,
        python: target.python,
        fileArg: nodeId,
        commandLine,
        terminalKey: pytestTerminalKey(target.cwd),
        terminalName: `pm: pytest ${path.basename(target.cwd)}`,
        venv: target.venv,
    };
}

/** debugpy launch of pytest as a module; breakpoints inside tests are hit */
export interface PytestDebugLaunch {
    type: 'debugpy';
    request: 'launch';
    name: string;
    module: 'pytest';
    args: string[];
    cwd: string;
    python: string;
    console: 'integratedTerminal';
    env: { VIRTUAL_ENV?: string; PATH?: string };
}

export function buildPytestDebugLaunch(
    modules: ReadonlyArray<{ root: string; venv: string }>,
    fileFsPath: string,
    nodeId: string,
): PytestDebugLaunch {
    const target = resolveTarget(modules, fileFsPath);
    return {
        type: 'debugpy',
        request: 'launch',
        name: `pm debug: pytest ${nodeId}`,
        module: 'pytest',
        args: [nodeId],
        cwd: target.cwd,
        python: target.python,
        console: 'integratedTerminal',
        env: venvEnv(target.venv),
    };
}

function venvEnv(venv: string | null): { VIRTUAL_ENV?: string; PATH?: string } {
    return venv === null ? {} : { VIRTUAL_ENV: venv, PATH: `${venv}/bin:${process.env.PATH ?? ''}` };
}
