import { findClasses } from './pyParse';

export type UsageKind = 'import' | 'call' | 'subclass' | 'write' | 'other';

export interface RefPos {
    line: number;
    startChar: number;
    endChar: number;
}

const IMPORT_RE = /^\s*(?:from\s+[^\s]+\s+import\b|import\b)/;
/** plausible assignment-target shape: names, dots, commas, brackets, annotations */
const TARGETS_RE = /^[\w\s,.[\]()*:'"]*$/;
/** statements whose inner `=` is a kwarg/default, never an assignment */
const NON_ASSIGN_START = /^\s*(?:def|lambda|class)\b/;
const AUGMENTED_OPS = '+-*/%&|^~@';

/** lines covered by an import statement, including parenthesized multiline ones */
function importLines(lines: string[]): Set<number> {
    const covered = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
        if (!IMPORT_RE.test(lines[i])) continue;
        let buf = lines[i];
        let j = i;
        while ((buf.match(/\(/g) ?? []).length > (buf.match(/\)/g) ?? []).length && j + 1 < lines.length) {
            j += 1;
            buf += lines[j];
            covered.add(j);
        }
        covered.add(i);
    }
    return covered;
}

/** next non-space character on the same line after the reference, null at end of line */
function nextChar(lines: string[], ref: RefPos): string | null {
    const line = lines[ref.line] ?? '';
    for (let i = ref.endChar; i < line.length; i++) {
        if (line[i] !== ' ' && line[i] !== '\t') return line[i];
    }
    return null;
}

/** index of the assignment `=` (plain, augmented, walrus), -1 when none */
function assignmentEq(s: string): number {
    for (let i = 0; i < s.length; i++) {
        if (s[i] !== '=') continue;
        if (s[i + 1] === '=') {
            i += 1;
            continue;
        }
        if ('!<>'.includes(s[i - 1] ?? '')) continue;
        return i;
    }
    return -1;
}

/** line-level write heuristics: assignment target, loop variable, `as` binding */
function isWrite(lines: string[], ref: RefPos): boolean {
    const line = lines[ref.line] ?? '';
    if (NON_ASSIGN_START.test(line)) return false;
    const eq = assignmentEq(line);
    if (eq >= 0 && ref.endChar <= eq) {
        const lhs = AUGMENTED_OPS.includes(line[eq - 1] ?? '') ? line.slice(0, eq - 1) : line.slice(0, eq);
        return TARGETS_RE.test(lhs);
    }
    if (/^\s*(?:async\s+)?for\b/.test(line)) {
        const inPos = line.search(/\bin\b/);
        return inPos >= 0 && ref.endChar <= inPos;
    }
    const asPos = line.search(/\bas\b/);
    return asPos >= 0 && ref.startChar >= asPos + 2;
}

export function classifyReferences(text: string, refs: RefPos[]): UsageKind[] {
    const lines = text.split('\n');
    const imports = importLines(lines);
    const bases = new Set<string>();
    for (const cls of findClasses(text)) {
        for (const base of cls.bases) bases.add(`${base.line}:${base.col}`);
    }
    return refs.map((ref) => {
        if (bases.has(`${ref.line}:${ref.startChar}`)) return 'subclass';
        if (imports.has(ref.line)) return 'import';
        if (isWrite(lines, ref)) return 'write';
        if (nextChar(lines, ref) === '(') return 'call';
        return 'other';
    });
}
