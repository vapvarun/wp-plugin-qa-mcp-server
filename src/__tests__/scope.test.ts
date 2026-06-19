// src/__tests__/scope.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScanScope, parseArray } from '../flow/scope.js';

test('resolves BN free distribution allowlist, excludes tests/docs, isolates third-party', () => {
  const { includeDirs, thirdParty } = resolveScanScope('/Users/vapvarun/dev/repos/buddynext');
  const base = (p: string) => p.split('/').pop();
  const names = includeDirs.map(base);
  assert.ok(names.includes('includes') && names.includes('templates'), 'includes runtime dirs');
  assert.ok(!names.includes('tests') && !names.includes('docs') && !names.includes('plan'), 'excludes non-shipped');
  assert.ok(thirdParty.map(base).includes('libs'), 'libs is third-party');
  assert.ok(!names.includes('libs') && !names.includes('vendor'), 'third-party not in includeDirs');
});

test('parseArray ignores commented-out array definitions', () => {
  const script = [
    '# RUNTIME=( old_dir )',
    'RUNTIME=( includes templates )',
  ].join('\n');
  const result = parseArray(script, 'RUNTIME');
  assert.deepEqual(result, ['includes', 'templates'], 'live definition parsed');
  assert.ok(!result.includes('old_dir'), 'commented definition ignored');
});

test('parseArray strips matched surrounding quotes only', () => {
  const script = 'ENTRIES=( "foo" \'bar\' \'baz" )';
  const result = parseArray(script, 'ENTRIES');
  assert.equal(result[0], 'foo', 'double-quoted entry strips to foo');
  assert.equal(result[1], 'bar', 'single-quoted entry strips to bar');
  // mismatched quotes: 'baz" — should be left as-is (no strip)
  assert.equal(result[2], "'baz\"", 'mismatched quotes left untouched');
});
