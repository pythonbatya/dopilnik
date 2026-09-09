/** parsing of rendered result documents back into link targets; no vscode import */

export interface LinkTarget {
    relPath: string;
    line: number;
}

export interface HeaderInfo {
    relPath: string;
    label?: string;
}

/** block header, depth-indented: `Symbol — rel/path.py:` or `rel/path.py:`;
 * the first non-space char is not a digit, keeping `NN:` lines separate */
const HEADER = /^\s*(?!\d)(\S.*):\s*$/;
const LABEL_SEP = ' — ';
/** match line: `  22: code` — digits, colon, then space or end */
const MATCH = /^\s*(\d+):(?: |$)/;
/** context line: `  21  text` — digits then two spaces, never linked */
const CONTEXT = /^\s*\d+\s{2}/;

export function parseHeader(text: string): HeaderInfo | null {
    const h = HEADER.exec(text);
    if (h === null) return null;
    const content = h[1];
    const sep = content.lastIndexOf(LABEL_SEP);
    const relPath = sep === -1 ? content : content.slice(sep + LABEL_SEP.length);
    // dotless paths (Makefile, Dockerfile) are fine when a label marks the tail as a path
    if (sep === -1 && !relPath.includes('.')) return null;
    return { relPath, label: sep === -1 ? undefined : content.slice(0, sep) };
}

export function isHeaderLine(text: string): boolean {
    return parseHeader(text) !== null;
}

export function isContextLine(text: string): boolean {
    return CONTEXT.test(text);
}

/**
 * per-line link targets. A match line links to the file of the nearest header
 * above it; a header links to the first match below it.
 */
export function parseDocLinks(lines: string[]): Array<LinkTarget | null> {
    const res: Array<LinkTarget | null> = new Array(lines.length).fill(null);
    let file: string | null = null;
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const hdr = parseHeader(lines[i]);
        if (hdr !== null) {
            file = hdr.relPath;
            headerIdx = i;
            continue;
        }
        const m = MATCH.exec(lines[i]);
        if (m !== null && file !== null && !CONTEXT.test(lines[i])) {
            const target: LinkTarget = { relPath: file, line: Number(m[1]) - 1 };
            res[i] = target;
            if (headerIdx >= 0) {
                res[headerIdx] = target;
                headerIdx = -1;
            }
        }
    }
    return res;
}
