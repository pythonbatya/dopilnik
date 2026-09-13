import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemote, buildWebUrl, selectedLineSpan } from './remoteUrl';

test('parseRemote: ssh:// form', () => {
    assert.deepEqual(parseRemote('ssh://git@forgejo.pyn.ru/hhru/hire-embeddings.git'), {
        host: 'forgejo.pyn.ru',
        ownerRepo: 'hhru/hire-embeddings',
    });
});

test('parseRemote: scp-like form', () => {
    assert.deepEqual(parseRemote('git@forgejo.pyn.ru:hhru/hh.kardinal.git'), {
        host: 'forgejo.pyn.ru',
        ownerRepo: 'hhru/hh.kardinal',
    });
});

test('parseRemote: https form with .git', () => {
    assert.deepEqual(parseRemote('https://github.com/pythonbatya/dopilnik.git'), {
        host: 'github.com',
        ownerRepo: 'pythonbatya/dopilnik',
    });
});

test('parseRemote: https form without .git', () => {
    assert.deepEqual(parseRemote('https://github.com/pythonbatya/dopilnik'), {
        host: 'github.com',
        ownerRepo: 'pythonbatya/dopilnik',
    });
});

test('parseRemote: ssh port is dropped (web UI lives on https)', () => {
    assert.deepEqual(parseRemote('ssh://git@forgejo.pyn.ru:2222/hhru/logic.git'), {
        host: 'forgejo.pyn.ru',
        ownerRepo: 'hhru/logic',
    });
});

test('parseRemote: unrecognized url gives undefined', () => {
    assert.equal(parseRemote('/srv/git/local-bare-repo.git'), undefined);
});

test('buildWebUrl: github uses /blob/', () => {
    const url = buildWebUrl(
        { host: 'github.com', ownerRepo: 'pythonbatya/dopilnik' },
        'a1b2c3d',
        'vscode/reveal/src/extension.ts',
        { start: 10, end: 10 },
    );
    assert.equal(url, 'https://github.com/pythonbatya/dopilnik/blob/a1b2c3d/vscode/reveal/src/extension.ts#L10');
});

test('buildWebUrl: any other host uses forgejo /src/commit/', () => {
    const url = buildWebUrl(
        { host: 'forgejo.pyn.ru', ownerRepo: 'hhru/logic' },
        'a1b2c3d',
        'logic/search/handler.py',
        { start: 42, end: 42 },
    );
    assert.equal(url, 'https://forgejo.pyn.ru/hhru/logic/src/commit/a1b2c3d/logic/search/handler.py#L42');
});

test('buildWebUrl: multi-line span renders as a range anchor', () => {
    const url = buildWebUrl(
        { host: 'forgejo.pyn.ru', ownerRepo: 'hhru/logic' },
        'a1b2c3d',
        'logic/search/handler.py',
        { start: 10, end: 25 },
    );
    assert.equal(url, 'https://forgejo.pyn.ru/hhru/logic/src/commit/a1b2c3d/logic/search/handler.py#L10-L25');
});

test('buildWebUrl: path segments are url-encoded, slashes kept', () => {
    const url = buildWebUrl(
        { host: 'forgejo.pyn.ru', ownerRepo: 'hhru/logic' },
        'a1b2c3d',
        'docs/про поиск.md',
        { start: 1, end: 1 },
    );
    assert.equal(
        url,
        'https://forgejo.pyn.ru/hhru/logic/src/commit/a1b2c3d/docs/%D0%BF%D1%80%D0%BE%20%D0%BF%D0%BE%D0%B8%D1%81%D0%BA.md#L1',
    );
});

test('selectedLineSpan: bare cursor is a single 1-based line', () => {
    assert.deepEqual(selectedLineSpan(41, 41, 7), { start: 42, end: 42 });
});

test('selectedLineSpan: multi-line selection', () => {
    assert.deepEqual(selectedLineSpan(9, 24, 3), { start: 10, end: 25 });
});

test('selectedLineSpan: selection ending at column 0 excludes its last line', () => {
    assert.deepEqual(selectedLineSpan(9, 25, 0), { start: 10, end: 25 });
});

test('selectedLineSpan: one full line selected to column 0 of the next collapses to one line', () => {
    assert.deepEqual(selectedLineSpan(9, 10, 0), { start: 10, end: 10 });
});
