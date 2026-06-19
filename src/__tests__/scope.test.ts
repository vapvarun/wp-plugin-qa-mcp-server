// src/__tests__/scope.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScanScope } from '../flow/scope.js';

test('resolves BN free distribution allowlist, excludes tests/docs, isolates third-party', () => {
  const { includeDirs, thirdParty } = resolveScanScope('/Users/vapvarun/dev/repos/buddynext');
  const base = (p: string) => p.split('/').pop();
  const names = includeDirs.map(base);
  assert.ok(names.includes('includes') && names.includes('templates'), 'includes runtime dirs');
  assert.ok(!names.includes('tests') && !names.includes('docs') && !names.includes('plan'), 'excludes non-shipped');
  assert.ok(thirdParty.map(base).includes('libs'), 'libs is third-party');
  assert.ok(!names.includes('libs') && !names.includes('vendor'), 'third-party not in includeDirs');
});
