// src/__tests__/canonical-usage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_RULES } from '../flow/canonical-rules.js';
import { scanForRule } from '../canonical-usage-checker.js';

test('detects raw $wpdb usage in a template string', () => {
  const rule = CANONICAL_RULES.find(r => r.id === 'wpdb-in-template')!;
  const hits = scanForRule('global $wpdb; $rows = $wpdb->get_results("SELECT 1");', rule);
  assert.ok(hits.length >= 1, 'flags $wpdb in template');
});

test('clean template yields no hits', () => {
  const rule = CANONICAL_RULES.find(r => r.id === 'wpdb-in-template')!;
  assert.equal(scanForRule('<?php echo esc_html($title); ?>', rule).length, 0);
});
