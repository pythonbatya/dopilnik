import * as path from 'node:path';

/** pure helpers, no vscode import — unit-testable in plain node */
export function langserverScript(extDir: string): string {
    return path.join(extDir, 'node_modules', 'pyright', 'langserver.index.js');
}

export function venvPython(venv: string): string {
    return path.join(venv, 'bin', 'python');
}

export function shouldRestart(restartAllowedAtMs: number, nowMs: number): boolean {
    return nowMs >= restartAllowedAtMs;
}
