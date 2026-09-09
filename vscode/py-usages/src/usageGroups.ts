/** pure mapping of classified usages to result-editor sections; no vscode import */
import type { ResultItem } from '../../shared-result/src/resultRender';
import type { UsageKind } from './usageClassify';

export interface UsageEntry {
    kind: UsageKind;
    label: string;
    uri: string;
    line: number;
    character: number;
}

export interface UsageGroups {
    items: ResultItem[];
    kept: number;
    dropped: number;
}

const KIND_ORDER: UsageKind[] = ['subclass', 'call', 'import', 'write', 'other'];
const KIND_TITLES: Record<UsageKind, string> = {
    subclass: 'subclasses',
    call: 'calls',
    import: 'imports',
    write: 'writes',
    other: 'other',
};

/**
 * bucket entries into `kind · count` sections in KIND_ORDER; the leftover
 * bucket is titled `reads` when writes exist (for a variable with writes the
 * leftovers are reads by definition), `other` otherwise. Empty kinds are
 * omitted; a per-kind cap drops the tail.
 */
export function buildGroups(entries: UsageEntry[], kindCap: number): UsageGroups {
    const byKind = new Map<UsageKind, UsageEntry[]>(KIND_ORDER.map((k) => [k, [] as UsageEntry[]]));
    for (const e of entries) byKind.get(e.kind)!.push(e);
    const hasWrites = (byKind.get('write')?.length ?? 0) > 0;
    const items: ResultItem[] = [];
    let kept = 0;
    let dropped = 0;
    for (const kind of KIND_ORDER) {
        const bucket = byKind.get(kind)!;
        if (bucket.length === 0) continue;
        const keptEntries = bucket.slice(0, kindCap);
        dropped += bucket.length - keptEntries.length;
        kept += keptEntries.length;
        const title = kind === 'other' && hasWrites ? 'reads' : KIND_TITLES[kind];
        items.push({
            label: `${title} · ${keptEntries.length}`,
            contextValue: 'kindRoot',
            uri: '',
            line: 0,
            children: keptEntries.map((e) => ({
                label: e.label,
                uri: e.uri,
                line: e.line,
                character: e.character,
            })),
        });
    }
    return { items, kept, dropped };
}
