// src/__tests__/template-usage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEntrypoint } from '../template-usage-checker.js';

test('parts are not entrypoints; top-level page templates are', () => {
  assert.equal(isEntrypoint('templates/parts/post-card.php'), false);
  assert.equal(isEntrypoint('templates/feed/home.php'), true);
  assert.equal(isEntrypoint('templates/members.php'), true);
});
