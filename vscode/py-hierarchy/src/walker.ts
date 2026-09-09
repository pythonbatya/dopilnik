/** eager tree collection over an injected query layer; no vscode import */

export interface WalkBranch<T> {
    node: T;
    children: WalkBranch<T>[];
}

export interface WalkQueries<T> {
    children(node: T): Promise<T[]>;
    parents(node: T): Promise<T[]>;
}

export interface WalkResult<T> {
    branches: WalkBranch<T>[];
    /** location nodes collected (the root is not counted) */
    count: number;
    truncated: boolean;
}

export async function collectTree<T>(
    q: WalkQueries<T>,
    root: T,
    keyOf: (node: T) => string,
    direction: 'children' | 'parents',
    cap: number,
    visited: Set<string> = new Set<string>(),
): Promise<WalkResult<T>> {
    visited.add(keyOf(root));
    let count = 0;
    let truncated = false;
    const expand = async (node: T): Promise<WalkBranch<T>[]> => {
        const next = direction === 'children' ? await q.children(node) : await q.parents(node);
        const branches: WalkBranch<T>[] = [];
        for (const child of next) {
            const key = keyOf(child);
            if (visited.has(key)) continue;
            visited.add(key);
            if (count >= cap) {
                truncated = true;
                continue;
            }
            count += 1;
            branches.push({ node: child, children: await expand(child) });
        }
        return branches;
    };
    const branches = await expand(root);
    return { branches, count, truncated };
}

/** both directions under one shared cap and visited set */
export async function collectBoth<T>(
    q: WalkQueries<T>,
    root: T,
    keyOf: (node: T) => string,
    cap: number,
): Promise<Omit<WalkResult<T>, 'branches'> & { parents: WalkBranch<T>[]; children: WalkBranch<T>[] }> {
    const visited = new Set<string>([keyOf(root)]);
    const up = await collectTree(q, root, keyOf, 'parents', cap, visited);
    const down = await collectTree(q, root, keyOf, 'children', Math.max(0, cap - up.count), visited);
    return {
        parents: up.branches,
        children: down.branches,
        count: up.count + down.count,
        truncated: up.truncated || down.truncated,
    };
}

export interface DirectionSection<I> {
    label: string;
    contextValue: 'kindRoot';
    uri: '';
    line: 0;
    character: 0;
    children: I[];
}

/**
 * fallback ⇅ shape: the anchor between two direction sections. In the
 * parents walk a branch's "children" are its BASES, so a merged tree renders
 * FastAPI as a child of FrontikApplication — direction-flipped nonsense that
 * only explicit sections can keep readable. Empty sections are dropped
 * (a leaf has no subclasses).
 */
export function splitByDirection<T, I>(
    anchor: WalkBranch<T>,
    parents: WalkBranch<T>[],
    children: WalkBranch<T>[],
    toItem: (b: WalkBranch<T>) => I,
): Array<DirectionSection<I> | I> {
    const out: Array<DirectionSection<I> | I> = [];
    const bases = parents.map(toItem);
    if (bases.length > 0) {
        out.push({ label: '⇧ bases', contextValue: 'kindRoot', uri: '', line: 0, character: 0, children: bases });
    }
    out.push(toItem(anchor));
    const subs = children.map(toItem);
    if (subs.length > 0) {
        out.push({ label: '⇩ subclasses', contextValue: 'kindRoot', uri: '', line: 0, character: 0, children: subs });
    }
    return out;
}
