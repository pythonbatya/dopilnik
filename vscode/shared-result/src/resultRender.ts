/** pure renderer of a navigation result into editor text; no vscode import */

export interface ResultItem {
    label: string;
    detail?: string;
    uri: string;
    line: number;
    character?: number;
    children?: ResultItem[];
    /** section headers (⇧ bases / ⇩ subclasses) — not locations */
    contextValue?: string;
}

export interface ResultPayload {
    title: string;
    items: ResultItem[];
    truncatedCount?: number;
    truncatedUnknown?: boolean;
}

const HARD_CAP = 1000;
export const CONTEXT_RADIUS = 1;

export interface ContextLine {
    lineno: number;
    text: string;
}

export interface LocationContext {
    before: ContextLine[];
    after: ContextLine[];
    /** the source line at the location itself, when readable */
    match?: string;
}

export interface RenderDeps {
    relate: (uri: string) => string;
    readContext: (uri: string, line: number) => Promise<LocationContext | null>;
}

/**
 * render a navigation result in the search-editor format:
 *
 *     SymbolName — rel/path/to/file.py:
 *       21  context line (dim, no colon)
 *       22:     the real source line of the match
 *       23  context line (dim)
 *
 * The match line shows the actual code; the block header leads with the
 * label. Headers indent strictly one level per tree edge (in a bases section
 * that depth is provenance depth); sibling blocks are separated by a blank
 * line; sections (⇧/⇩) render as bare label lines.
 */
export async function renderResult(payload: ResultPayload, deps: RenderDeps): Promise<string> {
    const out: string[] = [];
    const state = { currentFile: '', left: HARD_CAP };
    const dropped = await renderItems(payload.items, 0, out, state, deps);
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    const truncated = (payload.truncatedCount ?? 0) + dropped;
    if (truncated > 0) out.push(`⋯ обрезано, ещё ≥${truncated}`);
    else if (payload.truncatedUnknown) out.push('⋯ обрезано');
    return out.join('\n');
}

async function renderItems(
    items: ResultItem[],
    depth: number,
    out: string[],
    state: { currentFile: string; left: number },
    deps: RenderDeps,
    /** section labels attach to their first child; everything else is blank-separated */
    attachFirst = false,
): Promise<number> {
    let dropped = 0;
    let first = true;
    for (const it of items) {
        const block: string[] = [];
        dropped += await renderItem(it, depth, block, state, deps);
        if (block.length === 0) continue;
        if (out.length > 0 && !(first && attachFirst)) out.push('');
        out.push(...block);
        first = false;
    }
    return dropped;
}

async function renderItem(
    it: ResultItem,
    depth: number,
    out: string[],
    state: { currentFile: string; left: number },
    deps: RenderDeps,
): Promise<number> {
    const indent = '  '.repeat(depth);
    const pad = '  '.repeat(depth + 1);
    if (it.contextValue !== undefined) {
        out.push(indent + it.label);
    } else {
        if (state.left <= 0) return 1;
        state.left -= 1;
        const rel = deps.relate(it.uri);
        const ctx = await deps.readContext(it.uri, it.line);
        const label = it.label.trim();
        const matchText = ctx?.match ?? label;
        // compare trimmed forms: a usages entry's label IS the (trimmed)
        // source line, and the raw match keeps its indentation — that must
        // still collapse to a bare `path:` header, not a `code — path:` one
        // (which the grammar cannot parse anyway: symbols hold no colons)
        if (matchText.trim() !== label) out.push(`${indent}${label} — ${rel}:`);
        else if (rel !== state.currentFile) out.push(`${indent}${rel}:`);
        state.currentFile = rel;
        for (const b of ctx?.before ?? []) out.push(`${pad}${b.lineno}  ${b.text}`);
        out.push(`${pad}${it.line + 1}: ${matchText}`);
        for (const a of ctx?.after ?? []) out.push(`${pad}${a.lineno}  ${a.text}`);
    }
    if (it.children !== undefined) {
        return await renderItems(it.children, depth + 1, out, state, deps, it.contextValue !== undefined);
    }
    return 0;
}
