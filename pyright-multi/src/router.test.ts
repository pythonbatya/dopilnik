import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findModule, isPathUnder } from './router';

const MODULES = [
    { root: '/Users/x/projects' },
    { root: '/Users/x/projects/hh.kardinal' },
    { root: '/Users/x/projects/frontik' },
];

test('file directly under module matches', () => {
    assert.equal(findModule(MODULES, '/Users/x/projects/frontik/app.py'), '/Users/x/projects/frontik');
});

test('file in site-packages inside venv belongs to that module', () => {
    const p = '/Users/x/projects/frontik/.venv/lib/python3.11/site-packages/tornado/web.py';
    assert.equal(findModule(MODULES, p), '/Users/x/projects/frontik');
});

test('deepest module wins', () => {
    const p = '/Users/x/projects/hh.kardinal/subproject/main.py';
    assert.equal(findModule(MODULES, p), '/Users/x/projects/hh.kardinal');
});

test('prefix must be a path boundary: sibling dir does not steal the match', () => {
    assert.equal(findModule([{ root: '/Users/x/projects/frontik' }], '/Users/x/projects/frontik-clone/app.py'), null);
});

test('parent module still matches when no deeper module does', () => {
    assert.equal(findModule(MODULES, '/Users/x/projects/frontik-clone/app.py'), '/Users/x/projects');
});

test('unrelated path returns null', () => {
    assert.equal(findModule(MODULES, '/tmp/x.py'), null);
});

test('isPathUnder basic cases', () => {
    assert.equal(isPathUnder('/a/b', '/a/b/c.py'), true);
    assert.equal(isPathUnder('/a/b', '/a/b'), true);
    assert.equal(isPathUnder('/a/b', '/a/bc/c.py'), false);
});
