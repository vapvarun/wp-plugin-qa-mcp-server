import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffFingerprints } from '../flow/fingerprint.js';

test('diff reports added, modified, deleted', () => {
  const prev = { 'a.php': 'h1', 'b.php': 'h2' };
  const next = { 'a.php': 'h1', 'b.php': 'h2-mod', 'c.php': 'h3' };
  const { changed, deleted } = diffFingerprints(prev, next);
  assert.deepEqual(changed.sort(), ['b.php', 'c.php']);
  assert.deepEqual(deleted, ['a.php'].filter(() => false)); // a unchanged, none deleted
  assert.deepEqual(deleted, []);
});

test('diff reports deletion', () => {
  const { deleted } = diffFingerprints({ 'x.php': 'h' }, {});
  assert.deepEqual(deleted, ['x.php']);
});
