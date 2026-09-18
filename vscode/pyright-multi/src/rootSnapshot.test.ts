import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRootDirs, changedRoots } from './rootSnapshot';

test('filterRootDirs: keeps directories, drops plain files', () => {
    const entries = [
        { name: 'hire_embeddings', isDir: true },
        { name: 'setup.py', isDir: false },
        { name: 'hire_inference', isDir: true },
    ];
    assert.deepEqual(filterRootDirs(entries), ['hire_embeddings', 'hire_inference']);
});

test('filterRootDirs: drops hidden entries', () => {
    const entries = [
        { name: '.venv', isDir: true },
        { name: '.git', isDir: true },
        { name: 'tests', isDir: true },
    ];
    assert.deepEqual(filterRootDirs(entries), ['tests']);
});

test('filterRootDirs: drops __pycache__', () => {
    const entries = [
        { name: '__pycache__', isDir: true },
        { name: 'tests', isDir: true },
    ];
    assert.deepEqual(filterRootDirs(entries), ['tests']);
});

test('filterRootDirs: result is sorted, so readdir order never looks like a change', () => {
    const entries = [
        { name: 'tests', isDir: true },
        { name: 'hire_embeddings', isDir: true },
    ];
    assert.deepEqual(filterRootDirs(entries), ['hire_embeddings', 'tests']);
});

test('changedRoots: identical snapshots report nothing', () => {
    const previous = new Map([['/p/hire-embeddings', ['hire_embeddings', 'tests']]]);
    const current = new Map([['/p/hire-embeddings', ['hire_embeddings', 'tests']]]);
    assert.deepEqual(changedRoots(previous, current), []);
});

test('changedRoots: a new top-level package is a change', () => {
    const previous = new Map([['/p/hire-embeddings', ['hire_embeddings', 'tests']]]);
    const current = new Map([['/p/hire-embeddings', ['hire_embeddings', 'hire_inference', 'tests']]]);
    assert.deepEqual(changedRoots(previous, current), ['/p/hire-embeddings']);
});

test('changedRoots: a removed top-level package is a change', () => {
    const previous = new Map([['/p/hire-embeddings', ['hire_embeddings', 'hire_inference']]]);
    const current = new Map([['/p/hire-embeddings', ['hire_embeddings']]]);
    assert.deepEqual(changedRoots(previous, current), ['/p/hire-embeddings']);
});

test('changedRoots: a root seen for the first time is not a change', () => {
    const previous = new Map<string, string[]>();
    const current = new Map([['/p/k-meta', ['k_meta']]]);
    assert.deepEqual(changedRoots(previous, current), []);
});

test('changedRoots: a root that disappeared is not reported', () => {
    const previous = new Map([['/p/k-meta', ['k_meta']]]);
    const current = new Map<string, string[]>();
    assert.deepEqual(changedRoots(previous, current), []);
});

test('changedRoots: only the changed root is reported', () => {
    const previous = new Map([
        ['/p/hire-embeddings', ['hire_embeddings']],
        ['/p/k-meta', ['k_meta']],
    ]);
    const current = new Map([
        ['/p/hire-embeddings', ['hire_embeddings', 'hire_inference']],
        ['/p/k-meta', ['k_meta']],
    ]);
    assert.deepEqual(changedRoots(previous, current), ['/p/hire-embeddings']);
});
