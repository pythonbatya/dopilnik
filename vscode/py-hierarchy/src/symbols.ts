/**
 * Line-scan extraction of python classes (with base list) and defs (with
 * owning class). Positions are anchors for LSP queries: nameCol for
 * implementation queries, base refs for type-definition queries.
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

export interface DefInfo {
    name: string;
    line: number;
    nameCol: number;
    /** owning class name for methods, null for module-level defs */
    ownerClass: string | null;
}

const CLASS_RE = /^(\s*)class\s+([A-Za-z_]\w*)\s*(\()?/;
const DEF_RE = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/;

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
            // for dotted bases the LSP anchor must sit on the class name, not the module
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

export function findDefs(text: string): DefInfo[] {
    const lines = text.split('\n');
    const defs: DefInfo[] = [];
    const stack: Array<{ name: string; indent: number }> = [];
    for (let i = 0; i < lines.length; i++) {
        const m = DEF_RE.exec(lines[i]);
        if (m !== null) {
            const indent = m[1].length;
            while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
            defs.push({
                name: m[2],
                line: i,
                nameCol: lines[i].indexOf(m[2]),
                ownerClass: stack.length > 0 ? stack[stack.length - 1].name : null,
            });
            continue;
        }
        const cls = CLASS_RE.exec(lines[i]);
        if (cls !== null) {
            const indent = cls[1].length;
            while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
            stack.push({ name: cls[2], indent });
        }
    }
    return defs;
}

/** the class whose base list contains the given position, if any — a reference landing there is a subclass */
export function classForBaseAt(classes: ReadonlyArray<ClassInfo>, line: number, char: number): ClassInfo | null {
    return classes.find((c) => c.bases.some((b) => b.line === line && b.col === char)) ?? null;
}

/** the method def whose name sits at the given position — a reference landing there is an override */
export function defForNameAt(defs: ReadonlyArray<DefInfo>, line: number, char: number): DefInfo | null {
    return defs.find((d) => d.line === line && d.nameCol === char && d.ownerClass !== null) ?? null;
}

/** the class declared at the given line */
export function classForLine(classes: ReadonlyArray<ClassInfo>, line: number): ClassInfo | null {
    return classes.find((c) => c.line === line) ?? null;
}

/** the def (method or function) declared at the given line */
export function defForLine(defs: ReadonlyArray<DefInfo>, line: number): DefInfo | null {
    return defs.find((d) => d.line === line) ?? null;
}

/** the method with the given name owned directly by the given class — an override */
export function defOfNameInClass(defs: ReadonlyArray<DefInfo>, className: string, methodName: string): DefInfo | null {
    return defs.find((d) => d.ownerClass === className && d.name === methodName) ?? null;
}
