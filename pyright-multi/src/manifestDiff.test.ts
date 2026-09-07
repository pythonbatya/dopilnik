import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffManifests } from './manifestDiff';
import type { Manifest, ModuleEntry } from './manifest';

function m(root: string, venv = `${root}/.venv`): ModuleEntry {
    return { root, venv };
}

function man(...modules: ModuleEntry[]): Manifest {
    return { modules };
}

test('null old manifest: everything added', () => {
    const d = diffManifests(null, man(m('/a'), m('/b')));
    assert.deepEqual(d.added.map((x) => x.root), ['/a', '/b']);
    assert.deepEqual(d.removed, []);
});

test('removed and added detected', () => {
    const d = diffManifests(man(m('/a'), m('/b')), man(m('/b'), m('/c')));
    assert.deepEqual(d.added.map((x) => x.root), ['/c']);
    assert.deepEqual(d.removed.map((x) => x.root), ['/a']);
});

test('venv change is remove+add of same root', () => {
    const d = diffManifests(man(m('/a', '/v1')), man(m('/a', '/v2')));
    assert.deepEqual(d.removed.map((x) => x.venv), ['/v1']);
    assert.deepEqual(d.added.map((x) => x.venv), ['/v2']);
});

test('identical manifests produce empty diff', () => {
    const d = diffManifests(man(m('/a')), man(m('/a')));
    assert.deepEqual(d, { added: [], removed: [] });
});
