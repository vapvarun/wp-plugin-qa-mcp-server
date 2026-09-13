/**
 * Tests for the journey-audit module.
 *
 * Uses node:test (built-in, zero deps). Run with `npm test` after
 * adding the script to package.json.
 *
 * Targets the parts of journey-audit that the pass-2 audit flagged
 * as having edge cases:
 *
 *   - parseReport handles 3-column tables, 4-column tables (with index
 *     column), severity emoji vs word labels, missing files
 *   - consolidateMatrix tolerates a missing report path without
 *     crashing the whole call
 *   - coverageCheck recognises blanket-coverage group features
 *
 * The shape of these tests is deliberately small. They exist so a
 * future refactor (e.g. checker-signature normalisation) does not
 * silently break the parser. Add more fixtures here as new edge
 * cases surface.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { consolidateMatrix, initJourneys, coverageCheck, } from '../journey-audit.js';
/* ─── Fixtures ──────────────────────────────────────────────── */
const REPORT_3_COLUMN = `# A1: First-run + setup audit

Run date: 2026-04-26T06:00:00Z

## Summary

| Feature | Severity | One-line gap |
|---|---|---|
| Plugin activation | 🟡 | Re-activation is silent |
| Setup wizard | 🟢 | Works correctly |
| First space creation | 🔴 | wp-admin only |
| Demo seeder | 🟢 | Realistic |
`;
const REPORT_4_COLUMN_INDEX = `# A4 Audit - Owner / Moderator

## Summary Table

| # | Feature | Severity | 1.4.0 plan item |
|---|---------|----------|-----------------|
| 1 | Spaces CRUD | 🟡 | G5 |
| 2 | Categories | 🟢 | - |
| 3 | Access rules | 🔴 | G5, G6 |
| 4 | Permission engine | 🔴 | G4 |
`;
const REPORT_WORD_SEVERITIES = `# A3 Member Journey Audit

## Summary

| Feature | Severity | Key finding |
|---|---|---|
| Profile view | YELLOW | Confusing CTA |
| Trust levels | YELLOW | Number only |
| Notifications | RED | Auto-mark-read |
| Email delivery | GREEN | Branded |
`;
/* ─── Helpers ───────────────────────────────────────────────── */
function writeTmpReport(name, body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wppqa-test-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, body, 'utf8');
    return file;
}
function consolidateAndRead(reportPaths) {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wppqa-out-')), 'matrix.md');
    const result = consolidateMatrix({
        plugin_path: '/tmp',
        report_paths: reportPaths,
        output_path: out,
    });
    return {
        matrix: fs.readFileSync(out, 'utf8'),
        totals: result.totals,
    };
}
/* ─── parseReport via consolidateMatrix ─────────────────────── */
describe('parseReport (via consolidateMatrix)', () => {
    it('parses a 3-column table (Feature | Severity | Gap)', () => {
        const file = writeTmpReport('a1.md', REPORT_3_COLUMN);
        const { totals } = consolidateAndRead([file]);
        assert.equal(totals.red, 1, 'one red row');
        assert.equal(totals.yellow, 1, 'one yellow row');
        assert.equal(totals.green, 2, 'two green rows');
        assert.equal(totals.total, 4, 'four data rows total');
    });
    it('parses a 4-column table with index column (# | Feature | Severity | Notes)', () => {
        const file = writeTmpReport('a4.md', REPORT_4_COLUMN_INDEX);
        const { totals } = consolidateAndRead([file]);
        assert.equal(totals.red, 2, 'two red rows');
        assert.equal(totals.yellow, 1, 'one yellow row');
        assert.equal(totals.green, 1, 'one green row');
        assert.equal(totals.total, 4, 'four data rows total');
    });
    it('parses word-severity labels (RED / YELLOW / GREEN)', () => {
        const file = writeTmpReport('a3.md', REPORT_WORD_SEVERITIES);
        const { totals } = consolidateAndRead([file]);
        assert.equal(totals.red, 1, 'one red row');
        assert.equal(totals.yellow, 2, 'two yellow rows');
        assert.equal(totals.green, 1, 'one green row');
        assert.equal(totals.total, 4, 'four data rows total');
    });
    it('returns sentinel for a missing report file without crashing', () => {
        // Pair one valid report with a missing path; consolidate should
        // succeed and return the totals from the valid report.
        const valid = writeTmpReport('a1.md', REPORT_3_COLUMN);
        const missing = path.join(os.tmpdir(), 'this-file-does-not-exist.md');
        const { totals, matrix } = consolidateAndRead([valid, missing]);
        assert.equal(totals.red, 1);
        assert.equal(totals.yellow, 1);
        assert.equal(totals.green, 2);
        assert.match(matrix, /MISSING:/, 'matrix surfaces the missing-file sentinel as a journey name');
    });
    it('captures full title when the H1 ends in "audit"', () => {
        // Regression for M6.2: greedy capture should keep "QA Audit" intact.
        const body = `# Scope A2: Daily Community Life - QA Audit

## Summary

| Feature | Severity | Notes |
|---|---|---|
| Foo | 🔴 | bar |
`;
        const file = writeTmpReport('a2.md', body);
        const { matrix } = consolidateAndRead([file]);
        // The journey name in the consolidated matrix is the captured title;
        // greedy regex should preserve "QA" before "Audit".
        assert.match(matrix, /Scope A2: Daily Community Life - QA/);
    });
    it('does not bleed column offsets across consecutive tables', () => {
        // Regression for M6.3: column reset on non-table rows should
        // recompute featureCol / gapCol when the next table has a
        // different shape.
        const body = `# Mixed audit

| Feature | Severity | Gap |
|---|---|---|
| First | 🔴 | initial |

(some prose between tables)

| # | Feature | Severity | Gap |
|---|---|---|---|
| 1 | Second | 🟡 | follow-up |
`;
        const file = writeTmpReport('mixed.md', body);
        const { totals } = consolidateAndRead([file]);
        assert.equal(totals.red, 1, 'first table contributes one red');
        assert.equal(totals.yellow, 1, 'second table (different shape) parses cleanly');
    });
});
/* ─── initJourneys + coverageCheck round-trip ───────────────── */
describe('initJourneys + coverageCheck on a minimal fixture plugin', () => {
    /**
     * Build a tiny synthetic plugin tree on disk so the scanner has
     * something realistic to walk. One plugin file with a header, one
     * REST route registration, one shortcode.
     */
    function buildFixturePlugin() {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wppqa-plugin-'));
        fs.writeFileSync(path.join(dir, 'fixture-plugin.php'), `<?php
/**
 * Plugin Name: Fixture Plugin
 * Description: Minimal plugin for journey-audit testing.
 * Version: 1.0.0
 * Author: Test Vendor
 * Text Domain: fixture-plugin
 */
defined( 'ABSPATH' ) || exit;

add_action( 'rest_api_init', function () {
    register_rest_route( 'fixture/v1', '/items', array(
        'methods' => 'GET',
        'callback' => 'fixture_list_items',
        'permission_callback' => '__return_true',
    ) );
} );

add_shortcode( 'fixture_widget', 'fixture_render_widget' );
function fixture_list_items() {}
function fixture_render_widget() {}
`, 'utf8');
        return dir;
    }
    it('initJourneys auto-discovers every customer-facing surface', () => {
        const plugin = buildFixturePlugin();
        const result = initJourneys({ plugin_path: plugin, force: true });
        assert.equal(result.created, true);
        assert.equal(result.source, 'auto-discovery');
        assert.ok((result.surfaces_discovered ?? 0) >= 3, 'expected at least one surface for activation + REST namespace + shortcode');
    });
    it('coverageCheck reports 100% on the auto-discovered journeys.json', () => {
        const plugin = buildFixturePlugin();
        initJourneys({ plugin_path: plugin, force: true });
        const cov = coverageCheck({ plugin_path: plugin });
        assert.equal(cov.coverage_percent, 100, 'auto-discovery covers everything');
        assert.equal(cov.missing.length, 0);
    });
    it('coverageCheck flags a manifest surface that the journeys.json drops', () => {
        const plugin = buildFixturePlugin();
        initJourneys({ plugin_path: plugin, force: true });
        // Mutate the journeys.json to remove the api-contract journey.
        const journeysPath = path.join(plugin, 'docs', 'audit', 'journeys.json');
        const journeys = JSON.parse(fs.readFileSync(journeysPath, 'utf8'));
        journeys.journeys = journeys.journeys.filter((j) => j.id !== 'api-contract');
        fs.writeFileSync(journeysPath, JSON.stringify(journeys, null, 2));
        const cov = coverageCheck({ plugin_path: plugin });
        assert.ok(cov.missing.length > 0, 'dropped journey leaves at least one surface uncovered');
        assert.ok(cov.missing.some((m) => m.surface_kind === 'REST namespace'), 'the REST namespace from the fixture surfaces as missing');
    });
});
//# sourceMappingURL=journey-audit.test.js.map