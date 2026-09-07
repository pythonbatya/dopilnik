import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePs, selectOrphans } from './orphanSweep';

const OUR = '/ext/pyright-multi/node_modules/pyright/langserver.index.js';
const OTHER = '/ext/ms-pyright/dist/server.js';

const SAMPLE = [
    '   100 1 node /ext/ms-pyright/dist/server.js --stdio',
    '  101 1 node ' + OUR + ' --stdio',
    '  102 55 node ' + OUR + ' --stdio',
    '  103   1 node ' + OUR + ' --stdio',
    'PID PPID COMMAND',
].join('\n');

test('parsePs splits pid/ppid/command, dropping header lines', () => {
    const lines = parsePs(SAMPLE);
    assert.equal(lines.length, 4);
    assert.deepEqual(lines[1], { pid: '101', ppid: '1', command: 'node ' + OUR + ' --stdio' });
});

test('selectOrphans: only ours with ppid 1', () => {
    const lines = parsePs(SAMPLE);
    assert.deepEqual(selectOrphans(lines, OUR), [101, 103]);
    assert.deepEqual(selectOrphans(lines, OTHER), [100]);
});
