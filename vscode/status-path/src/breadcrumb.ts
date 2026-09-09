import * as path from 'node:path';

function isPathUnder(root: string, filePath: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(filePath));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Status-bar text for the active file: workspace-relative segments joined
 * with ` > `; outside the workspace a plain path, home shortened to `~`.
 */
export function breadcrumbText(workspaceRoot: string | null, filePath: string, home: string | null = null): string {
    if (workspaceRoot !== null && isPathUnder(workspaceRoot, filePath)) {
        return path.relative(workspaceRoot, filePath).split(path.sep).join(' > ');
    }
    if (home !== null && isPathUnder(home, filePath)) {
        return `~/${path.relative(home, filePath)}`;
    }
    return filePath;
}
