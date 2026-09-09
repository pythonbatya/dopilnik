import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breadcrumbText } from './breadcrumb';

const ROOT = '/Users/x/projects';
const HOME = '/Users/x';

test('file under workspace root becomes breadcrumb segments', () => {
    assert.equal(breadcrumbText(ROOT, `${ROOT}/k-meta/.qqq/scratch_1.py`), 'k-meta > .qqq > scratch_1.py');
});

test('file directly in workspace root is its own name', () => {
    assert.equal(breadcrumbText(ROOT, `${ROOT}/README.md`), 'README.md');
});

test('deeper nesting keeps every segment', () => {
    assert.equal(breadcrumbText(ROOT, `${ROOT}/kardinal/hhkardinal/features/x.py`), 'kardinal > hhkardinal > features > x.py');
});

test('file outside workspace falls back to home-tilde plain path', () => {
    assert.equal(breadcrumbText(ROOT, `${HOME}/tmp/notes.md`, HOME), '~/tmp/notes.md');
});

test('file outside workspace and home falls back to absolute path', () => {
    assert.equal(breadcrumbText(ROOT, '/etc/hosts', HOME), '/etc/hosts');
});

test('no workspace folder falls back to plain path', () => {
    assert.equal(breadcrumbText(null, `${HOME}/tmp/notes.md`, HOME), '~/tmp/notes.md');
});
