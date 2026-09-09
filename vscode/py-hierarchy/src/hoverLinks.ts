/** pure helpers for codelens commands; no vscode import */

export const NAV_COMMAND = 'overrideNav.nav';

export interface NavArgs {
    /** children = direct subclasses and method overrides; parents = base classes / overridden methods; both = full tree */
    kind: 'children' | 'parents' | 'both';
    /** file uri of the anchor document */
    uri: string;
    /** 0-based line of the anchor symbol */
    line: number;
    /** column of the anchor symbol name */
    col: number;
}

export function childrenTitle(): string {
    return '⇩ children';
}

export function parentTitle(): string {
    return '⇧ parents';
}

export function bothTitle(): string {
    return '⇅';
}

export function parseNavArgs(raw: unknown): NavArgs | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const { kind, uri, line, col } = raw as Record<string, unknown>;
    if (kind !== 'children' && kind !== 'parents' && kind !== 'both') return null;
    if (typeof uri !== 'string' || uri.length === 0) return null;
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 0) return null;
    if (typeof col !== 'number' || !Number.isInteger(col) || col < 0) return null;
    return { kind, uri, line, col };
}
