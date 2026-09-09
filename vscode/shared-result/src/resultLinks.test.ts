import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocLinks, parseHeader, isContextLine, isHeaderLine } from './resultLinks';

const N = null;

test('labeled header parses label and path, links to the first match below it', () => {
    const doc = [
        '_TestTelemetryApp.init — k-meta/tests/test_telemetry.py:',
        '  29  class _TestTelemetryApp(KMetaApplication):',
        '  30:     async def init(self) -> None:',
    ];
    assert.deepEqual(parseDocLinks(doc), [
        { relPath: 'k-meta/tests/test_telemetry.py', line: 29 },
        N,
        { relPath: 'k-meta/tests/test_telemetry.py', line: 29 },
    ]);
    assert.deepEqual(parseHeader(doc[0]), { relPath: 'k-meta/tests/test_telemetry.py', label: '_TestTelemetryApp.init' });
});

test('indented child headers keep their own targets', () => {
    const doc = ['Sym — p.py:', '  6: Parent', '  C1 — c1.py:', '    10: Child'];
    assert.deepEqual(parseDocLinks(doc), [
        { relPath: 'p.py', line: 5 },
        { relPath: 'p.py', line: 5 },
        { relPath: 'c1.py', line: 9 },
        { relPath: 'c1.py', line: 9 },
    ]);
});

test('plain label lines, footers and empty lines are not targets', () => {
    assert.deepEqual(parseDocLinks(['⇧ bases', 'plain:', '⋯ обрезано, ещё ≥9', '']), [N, N, N, N]);
    assert.equal(isHeaderLine('plain:'), false);
    assert.equal(isHeaderLine('deploy — Makefile:'), true);
});

test('context/header predicates', () => {
    assert.equal(isContextLine('  21  @decorator'), true);
    assert.equal(isContextLine('  22: match'), false);
    assert.equal(isHeaderLine('a/b/c.py:'), true);
});
