import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ManifestError, ManifestStore, parseManifest } from './manifest';

const DIR = '/Users/x/projects';

test('parses minimal manifest with venv default', () => {
    const m = parseManifest('{ "modules": [ { "root": "frontik" } ] }', DIR);
    assert.deepEqual(m.modules, [{ root: '/Users/x/projects/frontik', venv: '/Users/x/projects/frontik/.venv' }]);
});

test('jsonc comments and trailing commas allowed', () => {
    const text = '{ // my modules\n "modules": [ { "root": "a", }, ], }';
    const m = parseManifest(text, DIR);
    assert.equal(m.modules.length, 1);
});

test('explicit venv relative and absolute', () => {
    const m = parseManifest('{ "modules": [ { "root": "a", "venv": "venvs/a" }, { "root": "b", "venv": "/tmp/b-venv" } ] }', DIR);
    assert.equal(m.modules[0].venv, '/Users/x/projects/venvs/a');
    assert.equal(m.modules[1].venv, '/tmp/b-venv');
});

test('missing modules array throws ManifestError', () => {
    assert.throws(() => parseManifest('{}', DIR), ManifestError);
});

test('root must be non-empty string', () => {
    assert.throws(() => parseManifest('{ "modules": [ { "venv": "x" } ] }', DIR), ManifestError);
});

test('broken json throws ManifestError', () => {
    assert.throws(() => parseManifest('{ "modules": [', DIR), ManifestError);
});

test('store keeps last good on failed reload', () => {
    const store = new ManifestStore(null);
    const r1 = store.reload('{ "modules": [ { "root": "a" } ] }', DIR);
    assert.equal(r1.ok, true);
    const r2 = store.reload('{ broken', DIR);
    assert.equal(r2.ok, false);
    assert.ok(r2.error);
    assert.equal(store.current()?.modules[0].root, '/Users/x/projects/a');
});
