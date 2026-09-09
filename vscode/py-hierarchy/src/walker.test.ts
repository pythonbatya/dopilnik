import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBoth, collectTree, splitByDirection, type WalkQueries } from './walker';

interface N { name: string }
const keyOf = (n: N): string => n.name;

function queries(edges: Record<string, string[]>): WalkQueries<N> {
    const children = (n: N): Promise<N[]> => Promise.resolve((edges[n.name] ?? []).map((name) => ({ name })));
    return { children, parents: children };
}

test('walks a chain, counts nodes, no truncation', async () => {
    const res = await collectTree(queries({ a: ['b'], b: ['c'], c: [] }), { name: 'a' }, keyOf, 'children', 100);
    assert.equal(res.count, 2);
    assert.equal(res.truncated, false);
    assert.equal(res.branches[0].node.name, 'b');
    assert.equal(res.branches[0].children[0].node.name, 'c');
});

test('dedupes diamond descendants', async () => {
    const res = await collectTree(queries({ a: ['b', 'c'], b: ['d'], c: ['d'], d: [] }), { name: 'a' }, keyOf, 'children', 100);
    assert.equal(res.count, 3);
    const names = res.branches.flatMap((br) => [br.node.name, ...br.children.map((c) => c.node.name)]);
    assert.deepEqual(names.sort(), ['b', 'c', 'd']);
});

test('survives cycles', async () => {
    const res = await collectTree(queries({ a: ['b'], b: ['a'] }), { name: 'a' }, keyOf, 'children', 100);
    assert.equal(res.count, 1);
});

test('cap stops the walk and marks truncated', async () => {
    const res = await collectTree(queries({ a: ['b', 'c', 'd'], b: [], c: [], d: [] }), { name: 'a' }, keyOf, 'children', 2);
    assert.equal(res.count, 2);
    assert.equal(res.truncated, true);
});

test('collectBoth shares the visited set and the cap across directions', async () => {
    // symmetric edges: parents(a) = children(a) = [b, c]
    const res = await collectBoth(queries({ a: ['b', 'c'] }), { name: 'a' }, keyOf, 1);
    assert.equal(res.count, 1);
    assert.equal(res.truncated, true);
    assert.equal(res.parents.length, 1);
    assert.equal(res.children.length, 0);
});

test('⇅ fallback: k-meta-shaped graph splits into bases and subclasses sections', async () => {
    const parentEdges: Record<string, string[]> = {
        KMetaApplication: ['FrontikApplication'],
        FrontikApplication: ['FastAPI', 'HTTPServerConnectionDelegate'],
        FastAPI: ['Starlette'],
        Starlette: [],
        HTTPServerConnectionDelegate: [],
    };
    const childEdges: Record<string, string[]> = {
        KMetaApplication: ['KMetaTestApplication', '_TestSentryApp', '_TestTelemetryApp'],
    };
    const q: WalkQueries<N> = {
        parents: (n) => Promise.resolve((parentEdges[n.name] ?? []).map((name) => ({ name }))),
        children: (n) => Promise.resolve((childEdges[n.name] ?? []).map((name) => ({ name }))),
    };
    const both = await collectBoth(q, { name: 'KMetaApplication' }, keyOf, 100);
    // two root bases → no single chain top → the fallback shape must apply
    const tops = both.parents.filter((p) => p.children.length === 0);
    assert.notEqual(tops.length, 1);
    const items = splitByDirection({ node: { name: 'KMetaApplication' }, children: [] }, both.parents, both.children, (b) => b.node.name);
    assert.deepEqual(items.map((x) => typeof x === 'string' ? x : x.label), ['⇧ bases', 'KMetaApplication', '⇩ subclasses']);
    const bases = items[0] as { children: string[] };
    assert.deepEqual(bases.children, ['FrontikApplication']);
    const subs = items[2] as { children: string[] };
    assert.deepEqual([...subs.children].sort(), ['KMetaTestApplication', '_TestSentryApp', '_TestTelemetryApp']);
});

test('⇅ fallback on a method: the anchor method sits between the sections', () => {
    const p = (n: string): { node: N; children: [] } => ({ node: { name: n }, children: [] });
    const items = splitByDirection(p('A.init'), [p('Base.init')], [p('Sub.init'), p('Sub2.init')], (b) => b.node.name);
    assert.deepEqual(items.map((x) => typeof x === 'string' ? x : x.label), ['⇧ bases', 'A.init', '⇩ subclasses']);
    assert.deepEqual((items[2] as { children: string[] }).children, ['Sub.init', 'Sub2.init']);
});

test('leaf class: bases section plus the anchor, no empty subclasses section', () => {
    const p = (n: string): { node: N; children: [] } => ({ node: { name: n }, children: [] });
    const items = splitByDirection(p('Leaf'), [p('Base')], [], (b) => b.node.name);
    assert.deepEqual(items.map((x) => typeof x === 'string' ? x : x.label), ['⇧ bases', 'Leaf']);
});
