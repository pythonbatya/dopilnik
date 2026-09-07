import assert from 'node:assert/strict';
import { test } from 'node:test';
import { langserverScript, shouldRestart, venvPython } from './serverMeta';

test('langserverScript points into bundled pyright', () => {
    assert.equal(
        langserverScript('/ext/dir'),
        '/ext/dir/node_modules/pyright/langserver.index.js',
    );
});

test('venvPython joins bin/python', () => {
    assert.equal(venvPython('/v/.venv'), '/v/.venv/bin/python');
});

test('shouldRestart respects backoff window', () => {
    assert.equal(shouldRestart(1_000, 999), false);
    assert.equal(shouldRestart(1_000, 1_000), true);
    assert.equal(shouldRestart(1_000, 2_000), true);
});
