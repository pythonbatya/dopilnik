import test from 'node:test';
import assert from 'node:assert/strict';
import { enclosingSymbol } from './pyParse';

const SRC = [
    'import os',
    '',
    'class A:',
    '    attr = 1',
    '',
    '    def f(self):',
    '        usage_inner()',
    '',
    '    usage_body()',
    '',
    'def g():',
    '    usage_module_fn()',
    '',
    'usage_module()',
].join('\n');

test('usage inside a method gets Owner.method', () => {
    assert.deepEqual(enclosingSymbol(SRC, 6), { label: 'A.f' });
});

test('usage in the class body gets the class', () => {
    assert.deepEqual(enclosingSymbol(SRC, 8), { label: 'A' });
});

test('usage inside a module-level function gets the function alone', () => {
    assert.deepEqual(enclosingSymbol(SRC, 11), { label: 'g' });
});

test('module-level usage has no enclosing symbol', () => {
    assert.equal(enclosingSymbol(SRC, 13), null);
});
