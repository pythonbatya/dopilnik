/**
 * Line-scan extraction of python classes (with base list). Trimmed copy of
 * py-hierarchy's symbols.ts — extensions do not share code. Positions anchor
 * the `base` usage classification.
 */

export interface BaseRef {
    /** base name as written, dotted paths preserved */
    name: string;
    line: number;
    col: number;
}

export interface ClassInfo {
    name: string;
    line: number;
    nameCol: number;
    bases: BaseRef[];
}

const CLASS_RE = /^(\s*)class\s+([A-Za-z_]\w*)\s*(\()?/;

/** true for `metaclass=X` style keyword arguments — not inheritance bases */
function isKeywordArg(token: string): boolean {
    return /^\s*\w+\s*=/.test(token);
}

function stripGeneric(token: string): string {
    return token.split('[')[0].trim();
}

/** base list may span lines until the closing paren; buf starts at the class line */
function collectBaseList(lines: string[], startLine: number): string {
    let buf = '';
    for (let i = startLine; i < lines.length; i++) {
        buf += lines[i];
        if ((buf.match(/\(/g) ?? []).length <= (buf.match(/\)/g) ?? []).length) break;
        buf += '\n';
    }
    return buf;
}

function parseBases(buf: string, classLine: number): BaseRef[] {
    const parenStart = buf.indexOf('(');
    const inner = buf.slice(parenStart + 1, buf.lastIndexOf(')'));
    const bases: BaseRef[] = [];
    let offset = 0;
    for (const part of inner.split(',')) {
        const name = stripGeneric(part);
        if (name.length > 0 && !isKeywordArg(part)) {
            const leading = part.length - part.trimStart().length;
            // for dotted bases the anchor must sit on the class name, not the module
            const classSegment = name.lastIndexOf('.') + 1;
            const abs = parenStart + 1 + offset + leading + classSegment;
            const before = buf.slice(0, abs);
            const lineIdx = (before.match(/\n/g) ?? []).length;
            const lineStart = before.lastIndexOf('\n') + 1;
            bases.push({ name, line: classLine + lineIdx, col: abs - lineStart });
        }
        offset += part.length + 1;
    }
    return bases;
}

export function findClasses(text: string): ClassInfo[] {
    const lines = text.split('\n');
    const classes: ClassInfo[] = [];
    for (let i = 0; i < lines.length; i++) {
        const m = CLASS_RE.exec(lines[i]);
        if (m === null) continue;
        const nameCol = lines[i].indexOf(m[2]);
        const bases = m[3] === undefined ? [] : parseBases(collectBaseList(lines, i), i);
        classes.push({ name: m[2], line: i, nameCol, bases });
    }
    return classes;
}

const HEADER_RE = /^(\s*)(class|async\s+def|def)\s+([A-Za-z_]\w*)/;

interface Header {
    line: number;
    indent: number;
    kind: 'class' | 'def';
    name: string;
}

function headersUpTo(lines: string[], usageLine: number): Header[] {
    const out: Header[] = [];
    for (let i = 0; i <= usageLine && i < lines.length; i++) {
        const m = HEADER_RE.exec(lines[i]);
        if (m === null) continue;
        out.push({ line: i, indent: m[1].length, kind: m[2] === 'class' ? 'class' : 'def', name: m[3] });
    }
    return out;
}

/**
 * the innermost def/class whose body the usage line sits in: a header
 * encloses the line when its indent is smaller than the line's own indent.
 * A def gets `Owner.name` from the nearest enclosing class. Module level →
 * null. Backing for result-editor headers: tells WHERE in the file the
 * usage lives, which the code snippet does not show.
 */
export function enclosingSymbol(text: string, usageLine: number): { label: string } | null {
    const lines = text.split('\n');
    const usage = lines[usageLine];
    if (usage === undefined) return null;
    const usageIndent = usage.length - usage.trimStart().length;
    const headers = headersUpTo(lines, usageLine);
    for (let i = headers.length - 1; i >= 0; i--) {
        const h = headers[i];
        if (h.indent >= usageIndent || h.line === usageLine) continue;
        if (h.kind === 'def') {
            for (let j = i - 1; j >= 0; j--) {
                const owner = headers[j];
                if (owner.indent < h.indent && owner.kind === 'class') return { label: `${owner.name}.${h.name}` };
                if (owner.indent < h.indent) break;
            }
            return { label: h.name };
        }
        return { label: h.name };
    }
    return null;
}
