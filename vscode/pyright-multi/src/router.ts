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
