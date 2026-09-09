import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bothTitle, childrenTitle, parentTitle, parseNavArgs, type NavArgs } from './hoverLinks';

test('children title has no count', () => {
    assert.equal(childrenTitle(), '⇩ children');
});

test('parents title has no count', () => {
    assert.equal(parentTitle(), '⇧ parents');
});

test('both title', () => {
    assert.equal(bothTitle(), '⇅');
});

test('parseNavArgs accepts the both kind', () => {
    const args: NavArgs = { kind: 'both', uri: 'file:///a.py', line: 1, col: 2 };
    assert.deepEqual(parseNavArgs(args), args);
});

test('parseNavArgs accepts a well-formed argument', () => {
    const args: NavArgs = { kind: 'parents', uri: 'file:///c.py', line: 0, col: 6 };
    assert.deepEqual(parseNavArgs(args), args);
});

test('parseNavArgs accepts children kind', () => {
    const args: NavArgs = { kind: 'children', uri: 'file:///c.py', line: 4, col: 8 };
    assert.deepEqual(parseNavArgs(args), args);
});

test('parseNavArgs rejects garbage', () => {
    assert.equal(parseNavArgs(undefined), null);
    assert.equal(parseNavArgs('x'), null);
    assert.equal(parseNavArgs({ kind: 'nope', uri: 'u', line: 1, col: 1 }), null);
    assert.equal(parseNavArgs({ kind: 'parent', uri: 'u', line: 1, col: 1 }), null);
    assert.equal(parseNavArgs({ kind: 'children', uri: 5, line: 1, col: 1 }), null);
    assert.equal(parseNavArgs({ kind: 'children', uri: 'u', line: -1, col: 1 }), null);
});
