import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPytestTargets, isTestFile } from './testMeta';

test('isTestFile accepts pytest default patterns', () => {
    assert.equal(isTestFile('/Users/x/p/tests/test_search.py'), true);
    assert.equal(isTestFile('/Users/x/p/tests/search_test.py'), true);
    assert.equal(isTestFile('/Users/x/p/tests/helpers.py'), false);
    assert.equal(isTestFile('/Users/x/p/tests/test.py'), false);
});

const SAMPLE = [
    'import pytest',
    '',
    'def helper():',
    '    pass',
    '',
    'def test_plain():',
    '    pass',
    '',
    'async def test_async():',
    '    pass',
    '',
    'class NotATest:',
    '    def test_hidden(self):',
    '        pass',
    '',
    'class TestOuter:',
    '    def setup(self):',
    '        pass',
    '',
    '    def test_method(self):',
    '        pass',
    '',
    '    class TestInner:',
    '        def test_nested(self):',
    '            pass',
    '',
    '    def test_nested_def_inside(self):',
    '        def test_inner_helper():',
    '            pass',
    '',
    '@pytest.mark.parametrize("x", [1])',
    'def test_param(x):',
    '    pass',
].join('\n');

test('test functions, methods and classes get lenses with node ids', () => {
    const rel = 'tests/test_x.py';
    assert.deepEqual(findPytestTargets(SAMPLE, rel), [
        { line: 5, nodeId: `${rel}::test_plain`, kind: 'function' },
        { line: 8, nodeId: `${rel}::test_async`, kind: 'function' },
        { line: 15, nodeId: `${rel}::TestOuter`, kind: 'class' },
        { line: 19, nodeId: `${rel}::TestOuter::test_method`, kind: 'method' },
        { line: 22, nodeId: `${rel}::TestOuter::TestInner`, kind: 'class' },
        { line: 23, nodeId: `${rel}::TestOuter::TestInner::test_nested`, kind: 'method' },
        { line: 26, nodeId: `${rel}::TestOuter::test_nested_def_inside`, kind: 'method' },
        { line: 31, nodeId: `${rel}::test_param`, kind: 'function' },
    ]);
});

test('plain helper def and non-Test class produce no lenses', () => {
    const targets = findPytestTargets(SAMPLE, 'tests/test_x.py').map((t) => t.line);
    assert.equal(targets.includes(2), false);
    assert.equal(targets.includes(11), false);
    assert.equal(targets.includes(12), false);
});

test('def nested inside another def is not a test', () => {
    const targets = findPytestTargets(SAMPLE, 'tests/test_x.py').map((t) => t.line);
    assert.equal(targets.includes(27), false);
});

test('class with inheritance base still gets class and method lenses', () => {
    const text = [
        'import unittest',
        '',
        'class TestWithBase(unittest.TestCase):',
        '    def test_it(self):',
        '        pass',
    ].join('\n');
    const rel = 'tests/test_base.py';
    assert.deepEqual(findPytestTargets(text, rel), [
        { line: 2, nodeId: `${rel}::TestWithBase`, kind: 'class' },
        { line: 3, nodeId: `${rel}::TestWithBase::test_it`, kind: 'method' },
    ]);
});

test('Test class nested inside non-Test class is not collected', () => {
    const text = [
        'class Wrapper:',
        '    class TestInside:',
        '        def test_it(self):',
        '            pass',
    ].join('\n');
    assert.deepEqual(findPytestTargets(text, 'tests/test_x.py'), []);
});

test('empty text yields no targets', () => {
    assert.deepEqual(findPytestTargets('', 'tests/test_x.py'), []);
});
