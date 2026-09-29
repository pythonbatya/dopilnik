import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classForBaseAt, classForLine, defForLine, defOfNameInClass, defForNameAt, findClasses, findDefs, hierarchyAnchorLine } from './symbols';

test('class without bases', () => {
    const text = ['class Foo:', '    pass'].join('\n');
    assert.deepEqual(findClasses(text), [{ name: 'Foo', line: 0, nameCol: 6, bases: [] }]);
});

test('class with single base: name and base positions', () => {
    const text = ['class KmetaApplication(FrontikApplication):', '    pass'].join('\n');
    assert.deepEqual(findClasses(text), [{
        name: 'KmetaApplication',
        line: 0,
        nameCol: 6,
        bases: [{ name: 'FrontikApplication', line: 0, col: 23 }],
    }]);
});

test('multiple bases with columns', () => {
    const text = ['class X(Base1, Base2):', '    pass'].join('\n');
    assert.deepEqual(findClasses(text)[0].bases, [
        { name: 'Base1', line: 0, col: 8 },
        { name: 'Base2', line: 0, col: 15 },
    ]);
});

test('metaclass keyword argument is not a base', () => {
    const text = ['class Repo(Base, metaclass=ABCMeta):', '    pass'].join('\n');
    assert.deepEqual(findClasses(text)[0].bases.map((b) => b.name), ['Base']);
});

test('dotted base position points at the class name after the last dot', () => {
    const text = ['class App(frontik.app.App):', '    pass'].join('\n');
    assert.deepEqual(findClasses(text)[0].bases, [{ name: 'frontik.app.App', line: 0, col: 22 }]);
});

test('dotted base with a single dot points after it', () => {
    const text = ['class FrontikApplication(FastAPI, httputil.HTTPServerConnectionDelegate):', '    pass'].join('\n');
    assert.deepEqual(findClasses(text)[0].bases, [
        { name: 'FastAPI', line: 0, col: 25 },
        { name: 'httputil.HTTPServerConnectionDelegate', line: 0, col: 43 },
    ]);
});

test('multi-line base list resolved with own line and column', () => {
    const text = [
        'class X(',
        '    Base1,',
        '    Base2,',
        '):',
        '    pass',
    ].join('\n');
    assert.deepEqual(findClasses(text)[0].bases, [
        { name: 'Base1', line: 1, col: 4 },
        { name: 'Base2', line: 2, col: 4 },
    ]);
});

test('defs get owning class, async supported, module-level def has none', () => {
    const text = [
        'class Foo:',
        '    def bar(self):',
        '        pass',
        '    async def baz(self):',
        '        pass',
        '',
        'def standalone():',
        '    pass',
    ].join('\n');
    assert.deepEqual(findDefs(text), [
        { name: 'bar', line: 1, nameCol: 8, ownerClass: 'Foo' },
        { name: 'baz', line: 3, nameCol: 14, ownerClass: 'Foo' },
        { name: 'standalone', line: 6, nameCol: 4, ownerClass: null },
    ]);
});

test('nested class methods belong to the inner class', () => {
    const text = [
        'class Outer:',
        '    class Inner:',
        '        def deep(self):',
        '            pass',
        '    def outer_method(self):',
        '        pass',
    ].join('\n');
    assert.deepEqual(findDefs(text), [
        { name: 'deep', line: 2, nameCol: 12, ownerClass: 'Inner' },
        { name: 'outer_method', line: 4, nameCol: 8, ownerClass: 'Outer' },
    ]);
});

test('class name column points at the identifier', () => {
    const text = ['class   Spaced(Base):', '    pass'].join('\n');
    const cls = findClasses(text)[0];
    assert.equal(cls.name, 'Spaced');
    assert.equal(cls.nameCol, 8);
});

test('classForBaseAt matches a reference landing on a base name position', () => {
    const text = [
        'class KMetaApplication(FrontikApplication):',
        '    pass',
        '',
        'other = FrontikApplication',
    ].join('\n');
    const classes = findClasses(text);
    // reference at line 0 col 23 = the base name → subclass found
    assert.equal(classForBaseAt(classes, 0, 23)?.name, 'KMetaApplication');
    // plain usage on line 3 is not a base position
    assert.equal(classForBaseAt(classes, 3, 8), null);
});

test('defForNameAt matches a reference landing on a def name, module defs ignored', () => {
    const text = [
        'class Child(Parent):',
        '    async def init(self):',
        '        pass',
        '',
        'async def init():',
        '    pass',
        '',
        'x = child.init',
    ].join('\n');
    const defs = findDefs(text);
    assert.equal(defForNameAt(defs, 1, 14)?.name, 'init');
    assert.equal(defForNameAt(defs, 1, 14)?.ownerClass, 'Child');
    assert.equal(defForNameAt(defs, 4, 10), null);
    assert.equal(defForNameAt(defs, 7, 10), null);
});

test('classForLine and defForLine resolve symbols declared at a line', () => {
    const text = [
        'class Outer(Base):',
        '    def method(self):',
        '        pass',
        '',
        'def module_fn():',
        '    pass',
    ].join('\n');
    const classes = findClasses(text);
    const defs = findDefs(text);
    assert.equal(classForLine(classes, 0)?.name, 'Outer');
    assert.equal(classForLine(classes, 3), null);
    assert.equal(defForLine(defs, 1)?.name, 'method');
    assert.equal(defForLine(defs, 1)?.ownerClass, 'Outer');
    assert.equal(defForLine(defs, 4)?.ownerClass, null);
});

test('defOfNameInClass finds the def with the given name owned by the given class', () => {
    const text = [
        'class Parent:',
        '    def init(self):',
        '        pass',
        '',
        'class Child(Parent):',
        '    async def init(self):',
        '        pass',
        '',
        'class Other(Child):',
        '    def helper(self):',
        '        pass',
    ].join('\n');
    const defs = findDefs(text);
    const inChild = defOfNameInClass(defs, 'Child', 'init');
    assert.equal(inChild?.line, 5);
    assert.equal(defOfNameInClass(defs, 'Other', 'init'), null);
    assert.equal(defOfNameInClass(defs, 'Nope', 'init'), null);
});

const HIERARCHY_SAMPLE = [
    'import os',                       // 0
    '',                                // 1
    'class Base:',                     // 2
    '    """doc"""',                   // 3
    '    def run(self):',              // 4
    '        x = 1',                   // 5
    '',                                // 6
    '        def inner():',            // 7
    '            return x',            // 8
    '        return inner',            // 9
    '',                                // 10
    '    limit = 5',                   // 11
    '',                                // 12
    'def helper():',                   // 13
    '    return 2',                    // 14
].join('\n');

function anchorAt(line: number): number | null {
    return hierarchyAnchorLine(HIERARCHY_SAMPLE, findClasses(HIERARCHY_SAMPLE), findDefs(HIERARCHY_SAMPLE), line);
}

test('hierarchyAnchorLine: on a class header -> that class', () => {
    assert.equal(anchorAt(2), 2);
});

test('hierarchyAnchorLine: on a method header -> that method', () => {
    assert.equal(anchorAt(4), 4);
});

test('hierarchyAnchorLine: inside a method body -> the method', () => {
    assert.equal(anchorAt(5), 4);
});

test('hierarchyAnchorLine: blank line inside a method -> the method', () => {
    assert.equal(anchorAt(6), 4);
});

test('hierarchyAnchorLine: inside a nested function -> the enclosing method', () => {
    assert.equal(anchorAt(8), 4);
});

test('hierarchyAnchorLine: class body after a method ended -> the class', () => {
    assert.equal(anchorAt(11), 2);
});

test('hierarchyAnchorLine: class docstring -> the class', () => {
    assert.equal(anchorAt(3), 2);
});

test('hierarchyAnchorLine: module-level function has no hierarchy', () => {
    assert.equal(anchorAt(14), null);
});

test('hierarchyAnchorLine: module level code has no hierarchy', () => {
    assert.equal(anchorAt(0), null);
});

test('hierarchyAnchorLine: black-style multi-line signature keeps the body inside the method', () => {
    const text = [
        'class A:',                  // 0
        '    def run(',              // 1
        '        self,',             // 2
        '    ) -> None:',            // 3
        '        pass',              // 4
    ].join('\n');
    assert.equal(hierarchyAnchorLine(text, findClasses(text), findDefs(text), 4), 1);
});
