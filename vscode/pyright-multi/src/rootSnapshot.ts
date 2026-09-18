export interface RootEntry {
    name: string;
    isDir: boolean;
}

/**
 * Top-level package dirs of a module root, in a stable order. Hidden entries and
 * __pycache__ churn on their own and would only cause pointless restarts.
 */
export function filterRootDirs(entries: RootEntry[]): string[] {
    return entries
        .filter((e) => e.isDir && !e.name.startsWith('.') && e.name !== '__pycache__')
        .map((e) => e.name)
        .sort();
}

/** roots present in both snapshots whose top-level dirs differ; a root seen for the first time is not a change */
export function changedRoots(previous: Map<string, string[]>, current: Map<string, string[]>): string[] {
    const changed: string[] = [];
    for (const [root, dirs] of current) {
        const before = previous.get(root);
        if (before === undefined) continue;
        if (before.length !== dirs.length || before.some((name, i) => name !== dirs[i])) changed.push(root);
    }
    return changed;
}
