import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { assessReadiness, discoverPlugins, assessReadinessPortfolio } from '../readiness-checklist.js';

// Minimal manifest stub — only the fields the readiness checks read.
const manifest: any = { header: { name: 'Fixture' }, features: { activationHooks: [], dbTables: [], restRoutes: [{ route: 'x' }], customRoles: [] } };

function put(root: string, rel: string, content = 'x'): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

describe('assessReadiness — the bar', () => {
  it('flags missing required items → below-bar', () => {
    const root = mkdtempSync(join(tmpdir(), 'wppqa-ready-empty-'));
    try {
      const sc = assessReadiness(root, manifest);
      assert.equal(sc.barVerdict, 'below-bar');
      assert.ok(sc.counts.missing > 0);
      assert.ok(sc.items.find((i) => i.id === 'tests')?.status === 'missing');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('meets-bar when every required item is present', () => {
    const root = mkdtempSync(join(tmpdir(), 'wppqa-ready-full-'));
    try {
      put(root, 'uninstall.php');
      put(root, 'readme.txt', '== Changelog ==\n= 1.0 =');
      put(root, 'languages/p.pot');
      put(root, 'phpcs.xml');
      put(root, 'phpstan.neon');
      put(root, 'tests/phpunit/phpunit.xml');
      put(root, 'tests/test-thing.php');
      put(root, 'bin/local-ci.sh');
      put(root, 'docs/qa/AGENT_SMOKE_RUNBOOK.md');
      put(root, 'docs/qa/qa-config.json');
      put(root, 'audit/manifest.json');
      put(root, '.contract-audit-baseline.json', '{}');
      put(root, 'audit/journeys/01.md');
      const sc = assessReadiness(root, manifest);
      assert.equal(sc.barVerdict, 'meets-bar', JSON.stringify(sc.items.filter((i) => i.required && i.status !== 'pass')));
      assert.ok(sc.score >= 90);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('portfolio: discovers plugin dirs and ranks worst-first', () => {
    const root = mkdtempSync(join(tmpdir(), 'wppqa-portfolio-'));
    try {
      // Plugin A — bare (low score). Plugin B — fuller (higher score).
      put(root, 'plugin-a/a.php', '<?php /* Plugin Name: A\n * Version: 1.0 */');
      put(root, 'plugin-b/b.php', '<?php /* Plugin Name: B\n * Version: 1.0 */');
      put(root, 'plugin-b/phpcs.xml');
      put(root, 'plugin-b/phpstan.neon');
      put(root, 'plugin-b/docs/qa/qa-config.json');
      put(root, 'not-a-plugin/readme.md', 'x'); // no Plugin Name header → skipped
      const found = discoverPlugins(root);
      assert.equal(found.length, 2, 'finds the two plugin dirs, not the non-plugin');
      const rows = assessReadinessPortfolio(found);
      assert.equal(rows.length, 2);
      assert.ok(rows[0].score <= rows[1].score, 'worst-first ordering');
      assert.ok(rows.every((r) => typeof r.barVerdict === 'string'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('respects audit/readiness-bar.json override (disable + required)', () => {
    const root = mkdtempSync(join(tmpdir(), 'wppqa-ready-override-'));
    try {
      put(root, 'audit/readiness-bar.json', JSON.stringify({ disable: ['tests', 'readme', 'i18n', 'uninstall', 'wpcs', 'phpstan', 'ci', 'qa-runbook', 'qa-config', 'manifest', 'template-contract'] }));
      const sc = assessReadiness(root, manifest);
      assert.ok(!sc.items.find((i) => i.id === 'tests'), 'disabled item should be absent');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
