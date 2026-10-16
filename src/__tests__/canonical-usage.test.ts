// src/__tests__/canonical-usage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_RULES } from '../flow/canonical-rules.js';
import { scanForRule, stripPhpComments } from '../canonical-usage-checker.js';

test('detects raw $wpdb usage in a template string', () => {
  const rule = CANONICAL_RULES.find(r => r.id === 'wpdb-in-template')!;
  const hits = scanForRule('global $wpdb; $rows = $wpdb->get_results("SELECT 1");', rule);
  assert.ok(hits.length >= 1, 'flags $wpdb in template');
});

test('clean template yields no hits', () => {
  const rule = CANONICAL_RULES.find(r => r.id === 'wpdb-in-template')!;
  assert.equal(scanForRule('<?php echo esc_html($title); ?>', rule).length, 0);
});

// --- comment stripping ---
test('stripPhpComments: removes // line comment content', () => {
  const stripped = stripPhpComments('$a = 1; // $wpdb->get_results()\n$b = 2;');
  assert.ok(!stripped.includes('get_results'), 'comment content removed');
  assert.ok(stripped.includes('$a = 1;'), 'code before comment preserved');
  assert.ok(stripped.includes('\n'), 'newline preserved');
});

test('stripPhpComments: removes /* */ block comment content', () => {
  const stripped = stripPhpComments('$a = 1; /* $wpdb->update */ $b = 2;');
  assert.ok(!stripped.includes('update'), 'block comment content removed');
  assert.ok(stripped.includes('$a = 1;'), 'code preserved');
  assert.ok(stripped.includes('$b = 2;'), 'code after block comment preserved');
});

test('stripPhpComments: removes # line comment content', () => {
  const stripped = stripPhpComments('$a = 1; # $wpdb->get_var()\n$b = 2;');
  assert.ok(!stripped.includes('get_var'), '# comment content removed');
  assert.ok(stripped.includes('\n'), 'newline preserved');
});

test('stripPhpComments: preserves $wpdb inside a string literal', () => {
  const stripped = stripPhpComments('$msg = "use $wpdb->get_results()"; // comment');
  // The string content must still be present since it is not a comment
  assert.ok(stripped.includes('get_results'), 'string literal content preserved');
});

// --- rawsql-in-template: only $wpdb receiver ---
test('rawsql-in-template: $user_query->get_results() does NOT flag (no $wpdb)', () => {
  const rule = CANONICAL_RULES.find(r => r.id === 'rawsql-in-template')!;
  const hits = scanForRule('$user_query = new WP_User_Query($args); $users = $user_query->get_results();', rule);
  assert.equal(hits.length, 0, 'non-wpdb get_results must not flag rawsql-in-template');
});

test('rawsql-in-template: $wpdb->get_results() still flags', () => {
  const rule = CANONICAL_RULES.find(r => r.id === 'rawsql-in-template')!;
  const hits = scanForRule('$rows = $wpdb->get_results("SELECT * FROM t");', rule);
  assert.ok(hits.length >= 1, '$wpdb->get_results must still flag');
});

// --- comment stripping removes false positives ---
test('$wpdb->get_results( in // comment yields no hit after strip', () => {
  const rawsqlRule = CANONICAL_RULES.find(r => r.id === 'rawsql-in-template')!;
  const raw = '// $wpdb->get_results("SELECT 1")\n$safe = true;';
  const stripped = stripPhpComments(raw);
  const hits = scanForRule(stripped, rawsqlRule);
  assert.equal(hits.length, 0, 'commented $wpdb must not flag after stripping');
});

test('real $wpdb->get_results( in code still flags after strip', () => {
  const rawsqlRule = CANONICAL_RULES.find(r => r.id === 'rawsql-in-template')!;
  const raw = '$rows = $wpdb->get_results("SELECT 1");';
  const stripped = stripPhpComments(raw);
  const hits = scanForRule(stripped, rawsqlRule);
  assert.ok(hits.length >= 1, 'real $wpdb hit must survive strip');
});
