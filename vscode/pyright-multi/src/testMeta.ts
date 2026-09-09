/**
 * Line-scan detection of pytest collectables (default patterns only:
 * files test_*.py / *_test.py, functions test_*, classes Test*).
 * Indentation stack tells module-level defs from methods and excludes
 * anything nested inside a def or a non-Test class — pytest would not
 * collect those either.
 */

export interface PytestTarget {
    /** 0-based line of the def/class */
    line: number;
    /** pytest node id: relPath::Name::name */
    nodeId: string;
    kind: 'function' | 'method' | 'class';
}

const CLASS_RE = /^(\s*)class\s+([A-Za-z_]\w*)\s*[(:]/;
const TEST_DEF_RE = /^(\s*)(?:async\s+)?def\s+(test_\w+)\s*\(/;

export function isTestFile(fsPath: string): boolean {
    const base = fsPath.split('/').pop() ?? fsPath;
    return /^test_.+\.py$/.test(base) || base.endsWith('_test.py');
}

interface ScopeEntry {
    kind: 'class' | 'def';
    name: string;
    indent: number;
}

function collectedChain(stack: ScopeEntry[]): ScopeEntry[] | null {
    const chain = stack.filter((e) => e.kind === 'class');
    if (chain.length !== stack.length) return null;
    return chain.every((c) => c.name.startsWith('Test')) ? chain : null;
}

export function findPytestTargets(text: string, relPath: string): PytestTarget[] {
    const targets: PytestTarget[] = [];
    const stack: ScopeEntry[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const cls = CLASS_RE.exec(line);
        if (cls !== null) {
            const indent = cls[1].length;
            while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
            const enclosing = collectedChain(stack);
            if (enclosing !== null && cls[2].startsWith('Test')) {
                const nodeId = [relPath, ...enclosing.map((c) => c.name), cls[2]].join('::');
                targets.push({ line: i, nodeId, kind: 'class' });
            }
            stack.push({ kind: 'class', name: cls[2], indent });
            continue;
        }
        const def = TEST_DEF_RE.exec(line);
        if (def !== null) {
            const indent = def[1].length;
            while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
            const chain = collectedChain(stack);
            if (chain !== null) {
                const nodeId = [relPath, ...chain.map((c) => c.name), def[2]].join('::');
                targets.push({ line: i, nodeId, kind: chain.length === 0 ? 'function' : 'method' });
            }
            stack.push({ kind: 'def', name: def[2], indent });
        }
    }
    return targets;
}
