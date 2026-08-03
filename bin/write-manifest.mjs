#!/usr/bin/env node
/**
 * Deterministically generate a plugin's manifest v3 and write it to
 * <pluginPath>/audit/manifest.json. This is the onboard step — the scanner is the
 * single deterministic generator for every plugin (no agent prose).
 *
 *   node bin/write-manifest.mjs /abs/path/to/plugin [--out <file>] [--force]
 *
 * Volatile fields (timestamp, absolute path) are stripped so the committed manifest
 * is churn-free and machine-independent.
 *
 * ── Why this refuses to write sometimes ──────────────────────────────────────
 *
 * Not every plugin keeps its manifest where this generator wants to put it, and
 * not every manifest is ours. Two shapes exist in the portfolio today:
 *
 *   audit/manifest.json            — generated, schema v3-functional (18 plugins)
 *   audit/manifests/manifest.json  — hand-curated, schema v2.2 (WPMediaVerse)
 *
 * WPMediaVerse moved to the curated layout deliberately (its `1.2.1: consolidate
 * docs / QA / audit into structured tree` commit) and its release gate reads that
 * curated file. Running this generator there used to silently recreate the retired
 * `audit/manifest.json`, leaving TWO manifests with different schemas: the release
 * gate reading one, portfolio tooling reading the other, neither agreeing. Nothing
 * reported a problem — the failure only showed up later as gates passing on a map
 * that no longer described the plugin.
 *
 * So: writing is refused when the target holds a manifest this generator did not
 * write, or when a curated manifest exists elsewhere in the tree. Both are
 * overridable — `--force` to overwrite, `--out` to target a path deliberately —
 * because the point is to stop SILENT clobbering, not to block a decision someone
 * has actually made.
 */

import { scanPlugin } from '../build/scanner.js';
import { analyzeTemplateContracts, analyzeTemplateHygiene } from '../build/template-contract-checker.js';
import { assessReadiness } from '../build/readiness-checklist.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? '');
};
const has = (name) => argv.includes(name);

const pluginPath = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out');
if (!pluginPath) {
  process.stderr.write('usage: node bin/write-manifest.mjs <pluginPath> [--out <file>] [--force]\n');
  process.exit(1);
}

const SCHEMA = 'v3-functional';

/**
 * Read a manifest's schema tag without throwing on unparseable or foreign files.
 *
 * Returns the schema string when this generator wrote it, 'unknown' when the file
 * exists but carries no recognisable tag (treated as foreign — safer to stop than
 * to guess), or null when there is no file.
 */
const schemaOf = (file) => {
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return j?.generated?.schema || j?.generated?.schema_version || j?.schema_version || j?.$schema || 'unknown';
  } catch {
    return 'unparseable';
  }
};

const outFlag = flag('--out');
const outFile = outFlag
  ? (isAbsolute(outFlag) ? outFlag : resolve(process.cwd(), outFlag))
  : join(pluginPath, 'audit', 'manifest.json');

const bail = (lines) => {
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
};

if (!has('--force') && !outFlag) {
  // Guard A — a curated manifest lives elsewhere in this plugin's tree. Writing
  // our default path would shadow it rather than update it.
  const curated = join(pluginPath, 'audit', 'manifests', 'manifest.json');
  if (existsSync(curated)) {
    bail([
      'REFUSING TO WRITE — this plugin uses the curated manifest layout.',
      '',
      `  curated manifest : ${curated} (schema ${schemaOf(curated)})`,
      `  would have written: ${outFile} (schema ${SCHEMA})`,
      '',
      'Writing here would leave two manifests with different schemas — the release',
      'gate reads the curated one, portfolio tooling reads the generated one, and',
      'they drift apart silently.',
      '',
      'Do one of:',
      '  • reconcile the curated manifest by targeted delta (recommended), or',
      '  • node bin/write-manifest.mjs <plugin> --out <path>   to place it deliberately, or',
      '  • node bin/write-manifest.mjs <plugin> --force        to overwrite anyway',
    ]);
  }

  // Guard B — the target exists but was not written by this generator.
  const found = schemaOf(outFile);
  if (found && found !== SCHEMA) {
    bail([
      'REFUSING TO OVERWRITE — the existing manifest is not ours.',
      '',
      `  file    : ${outFile}`,
      `  schema  : ${found}`,
      `  expected: ${SCHEMA}`,
      '',
      'This is a hand-maintained or foreign-schema manifest. Overwriting it would',
      'discard curated content and can break release gates that read its shape.',
      '',
      'Re-run with --force if replacing it is genuinely what you want.',
    ]);
  }
}

const m = scanPlugin(pluginPath);
delete m.scannedAt;                                  // timestamp → churn
m.pluginPath = m.header?.slug || 'plugin';           // absolute path → machine-specific
m.generated = { generator: 'wp-plugin-qa scanner', schema: 'v3-functional' };

// ── Back-compat: also emit the legacy top-level keys the onboard ecosystem
// (graph.html, derivation checks, summaries) and older consumers read, derived
// from the same deterministic scan. One file satisfies both worlds.
const f = m.features || {};
const fullRoute = (r) => '/' + String(r.namespace || '').replace(/^\/+|\/+$/g, '') + '/' + String(r.route || '').replace(/^\/+/, '');
m.rest = {
  namespace: f.restRoutes?.[0]?.namespace || '',
  endpoints: (f.restRoutes || []).map((r) => ({
    route: fullRoute(r), methods: r.methods || [], permission: r.permissionCallback || 'unknown',
    gated_by: r.gatedBy || null, file: `${r.file}:${r.line}`,
  })),
};
m.ajax = f.ajaxHandlers || [];
m.admin_pages = (f.adminPages || []).map((a) => ({
  page: a.slug, type: a.parentSlug ? 'submenu' : 'menu', capability: a.capability,
  title: a.title, file: `${a.file}:${a.line}`,
}));
m.tables = (f.dbTables || []).map((t) => t.tableSuffix);
m.hooks_fired = (f.hooks?.provided || []).map((h) => ({ hook: h.hookName, type: h.type, file: `${h.file}:${h.line}` }));
m.cron = (f.cronJobs || []).map((c) => c.hook);
m.blocks = (f.blocks || []).map((b) => b.name);
m.shortcodes = (f.shortcodes || []).map((s) => s.tag);
m.frontend_assets = { js: (f.frontendJs || []).map((j) => j.module), css: [] };

// ── v3 functional layer: template contract. Cross-layer loader<->template
// drift, auto-detecting the WooCommerce-style helper AND the view-data
// resolver convention (+ optional audit/template-contracts.json override).
// Deterministic + churn-free: no duration, findings sorted by file:line.
const tc = analyzeTemplateContracts(pluginPath);
m.template_contract = {
  mode: tc.mode,                  // wc-loader | resolver | config | mixed | none
  checked: tc.checked,
  pass: tc.result.passed,
  fail: tc.result.failed,
  skipped: tc.result.skipped,
  findings: tc.result.issues
    .map((i) => ({ file: i.file, line: i.line, code: i.code, title: i.title }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.title.localeCompare(b.title)),
};

// ── v3 functional layers: TC1 zero-logic templates + TC3 shared-component
// usage. Config-driven (audit/template-contracts.json); deterministic sort.
const hy = analyzeTemplateHygiene(pluginPath);
const sortFindings = (arr) => arr.slice().sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
m.template_zero_logic = {
  checked_files: hy.zeroLogic.checkedFiles,
  fail: hy.zeroLogic.findings.length,
  findings: sortFindings(hy.zeroLogic.findings),
};
m.template_components = {
  checked_files: hy.components.checkedFiles,
  fail: hy.components.findings.length,
  findings: sortFindings(hy.components.findings),
};

// ── v3 readiness scorecard ("the bar"): autonomous present/missing/failing
// checklist over the portfolio standard, with a meets/below-bar verdict.
m.readiness = assessReadiness(pluginPath, m);

// outFile was resolved up top (default, or --out) so the write-guards above could
// inspect the target before the scan cost was paid.
mkdirSync(dirname(outFile), { recursive: true });
const json = JSON.stringify(m, null, 2) + '\n';
writeFileSync(outFile, json);
process.stdout.write(`wrote ${(json.length / 1024).toFixed(0)}KB → ${outFile}\n`);
