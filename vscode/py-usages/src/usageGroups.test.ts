import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroups, type UsageEntry } from './usageGroups';
import type { UsageKind } from './usageClassify';

function entry(kind: UsageKind, n: number): UsageEntry {
    return { kind, label: `use ${n}`, uri: `file:///root/m${n}.py`, line: n, character: 0 };
}

test('sections appear in kind order, empty kinds omitted, counts in titles', () => {
    const { items } = buildGroups([
        entry('other', 1),
        entry('subclass', 2),
        entry('call', 3),
        entry('subclass', 4),
    ], 100);
    assert.deepEqual(items.map((s) => s.label), ['subclasses · 2', 'calls · 1', 'other · 1']);
    assert.deepEqual(items.map((s) => s.contextValue), ['kindRoot', 'kindRoot', 'kindRoot']);
    assert.deepEqual(items[0].children?.map((c) => c.uri), ['file:///root/m2.py', 'file:///root/m4.py']);
});

test('leftover bucket is reads when writes exist, other when not', () => {
    const withWrites = buildGroups([entry('write', 1), entry('other', 2)], 100);
    assert.equal(withWrites.items.map((s) => s.label).find((l) => l.startsWith('reads')), 'reads · 1');
    const withoutWrites = buildGroups([entry('other', 2)], 100);
    assert.deepEqual(withoutWrites.items.map((s) => s.label), ['other · 1']);
});

test('per-kind cap drops the tail and counts it', () => {
    const { items, kept, dropped } = buildGroups([
        entry('call', 1), entry('call', 2), entry('call', 3),
        entry('import', 4),
    ], 2);
    assert.deepEqual(items.map((s) => s.label), ['calls · 2', 'imports · 1']);
    assert.equal(kept, 3);
    assert.equal(dropped, 1);
});

test('no entries — no sections', () => {
    assert.deepEqual(buildGroups([], 100).items, []);
});
