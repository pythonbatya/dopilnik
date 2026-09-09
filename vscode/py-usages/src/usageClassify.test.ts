import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyReferences, type RefPos } from './usageClassify';

const SRC = `from kardinal.core import FeatureGroup
import requests
from x import (
    Foo,
    Bar,
)

class RankFeature(FeatureGroup):
    pass

x = FeatureGroup(1, 2)

def f(g: FeatureGroup) -> FeatureGroup:
    return g.attr

y = obj.method(1)
z = helper

counter = 0
counter += 1
for item in items:
    pass
a, b = pair
total = counter + item
if counter == 0:
    pass
with open(p) as fh:
    pass
`;

function at(line: number, startChar: number, len: number): RefPos {
    return { line, startChar, endChar: startChar + len };
}

test('classifies import, multiline import, subclass, call, other', () => {
    const refs = [
        at(0, 26, 'FeatureGroup'.length),   // from ... import FeatureGroup
        at(4, 4, 'Bar'.length),             // multiline import continuation
        at(7, 18, 'FeatureGroup'.length),   // class RankFeature(FeatureGroup)
        at(10, 4, 'FeatureGroup'.length),   // FeatureGroup(1, 2)
        at(12, 9, 'FeatureGroup'.length),   // def f(g: FeatureGroup) annotation
        at(15, 8, 'method'.length),         // y = obj.method(1)
        at(16, 4, 'helper'.length),         // z = helper
    ];
    assert.deepEqual(classifyReferences(SRC, refs), ['import', 'import', 'subclass', 'call', 'other', 'call', 'other']);
});

test('assignment targets are writes, reads are other', () => {
    const refs = [
        at(18, 0, 'counter'.length),        // counter = 0
        at(19, 0, 'counter'.length),        // counter += 1
        at(20, 4, 'item'.length),           // for item in items:
        at(22, 0, 'a'.length),              // a, b = pair
        at(23, 8, 'counter'.length),        // total = counter + item  (read)
        at(24, 4, 'counter'.length),        // if counter == 0:        (read)
        at(22, 7, 'pair'.length),           // a, b = pair             (read)
        at(26, 16, 'fh'.length),            // with open(p) as fh:
    ];
    assert.deepEqual(classifyReferences(SRC, refs), ['write', 'write', 'write', 'write', 'other', 'other', 'other', 'write']);
});
