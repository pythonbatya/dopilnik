import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pyStatusLabel } from './statusLabel';

test('no active module renders None', () => {
    assert.equal(pyStatusLabel(null), 'py: None');
});

test('module root renders basename with py prefix', () => {
    assert.equal(pyStatusLabel('/Users/x/projects/k-meta'), 'py: k-meta');
});
