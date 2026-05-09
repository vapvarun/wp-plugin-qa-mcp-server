/**
 * Manifest-driven QA coverage gate (TypeScript port of bin/qa-coverage-check.php).
 *
 * Reads `audit/manifest.json` and asserts every tracked manifest category
 * has corresponding functional test coverage. Writes `audit/qa-coverage.json`
 * with per-item covered/uncovered detail + drift summary.
 *
 * Same baseline-shrink discipline as phpstan-baseline.neon: the uncovered
 * count can drop, never grow. Marks the result as `failed` when uncovered_total
 * regressed vs the previous run.
 *
 * Plugin-agnostic. No child processes used.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CheckerResult, CheckerIssue, Severity } from './types.js';

const TEST_GLOBS = [
  'includes/qa',
  'includes/cli/journeys',
  'includes/cli/scenarios',
  'tests',
];

interface CoverageStats {
  total: number;
  covered: number;
  uncovered: number;
  skipped: number;
  covered_items: Array<Record<string, unknown>>;
  uncovered_items: Array<Record<string, unknown>>;
  _note?: string;
}

interface CoverageOutput {
  schema_version: 'v1';
  plugin: { slug: string; version: string };
  generated: { at: string; manifest_at: string | null; manifest_branch: string | null };
  categories: {
    rest: CoverageStats;
    ajax: CoverageStats;
    hooks_fired: CoverageStats;
    cron: CoverageStats;
    wp_cli: CoverageStats;
  };
  summary: {
    categories_checked: number;
    items_total: number;
    items_covered: number;
    items_uncovered: number;
    items_skipped: number;
    coverage_percent: number;
  };
  drift: {
    previous_uncovered: number | null;
    current_uncovered: number;
    delta: number | null;
  };
}

export interface QaCoverageOptions {
  /** Treat any uncovered as a failure (default false — only regressions fail). */
  strict?: boolean;
  /** Skip writing audit/qa-coverage.json (read-only mode). */
  dryRun?: boolean;
}

export function checkQaCoverage(
  pluginPath: string,
  options: QaCoverageOptions = {}
): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];

  const manifestPath = path.join(pluginPath, 'audit/manifest.json');
  if (!fs.existsSync(manifestPath)) {
    issues.push({
      id: 'QA-COV-NO-MANIFEST',
      category: 'qa-coverage',
      severity: 'high',
      type: 'error',
      title: 'audit/manifest.json missing',
      message: 'Run /wp-plugin-onboard to scaffold the canonical inventory first.',
      file: 'audit/manifest.json',
      line: 0,
      code: 'no-manifest',
    });
    return {
      category: 'qa-coverage',
      passed: 0,
      failed: 1,
      skipped: 0,
      duration: Date.now() - start,
      issues,
    };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    issues.push({
      id: 'QA-COV-BAD-MANIFEST',
      category: 'qa-coverage',
      severity: 'high',
      type: 'error',
      title: 'audit/manifest.json is not valid JSON',
      message: `JSON parse error: ${(e as Error).message}`,
      file: 'audit/manifest.json',
      line: 0,
      code: 'bad-manifest',
    });
    return {
      category: 'qa-coverage',
      passed: 0,
      failed: 1,
      skipped: 0,
      duration: Date.now() - start,
      issues,
    };
  }

  // Collect test corpus.
  const testFiles: string[] = [];
  for (const glob of TEST_GLOBS) {
    const dir = path.join(pluginPath, glob);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      walkPhp(dir, testFiles);
    }
  }
  let corpus = '';
  for (const f of testFiles) {
    try {
      corpus += '\n' + fs.readFileSync(f, 'utf8');
    } catch {
      // Skip unreadable files.
    }
  }

  // Per-category coverage checks.
  const categories = {
    rest: checkRest(manifest, corpus),
    ajax: checkAjax(manifest, corpus),
    hooks_fired: checkHooksFired(manifest, corpus),
    cron: checkCron(manifest, corpus),
    wp_cli: checkWpCli(manifest, testFiles),
  };

  let total = 0,
    covered = 0,
    uncovered = 0,
    skipped = 0;
  for (const cat of Object.values(categories)) {
    total += cat.total;
    covered += cat.covered;
    uncovered += cat.uncovered;
    skipped += cat.skipped;
  }

  // Drift check.
  const coveragePath = path.join(pluginPath, 'audit/qa-coverage.json');
  let previousUncovered: number | null = null;
  if (fs.existsSync(coveragePath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
      previousUncovered = prev?.summary?.items_uncovered ?? null;
    } catch {
      // ignore
    }
  }

  const pluginMeta = (manifest.plugin as Record<string, unknown>) ?? {};
  const generatedMeta = (manifest.generated as Record<string, unknown>) ?? {};
  const output: CoverageOutput = {
    schema_version: 'v1',
    plugin: {
      slug: String(pluginMeta.slug ?? path.basename(pluginPath)),
      version: String(pluginMeta.version ?? '0.0.0'),
    },
    generated: {
      at: new Date().toISOString(),
      manifest_at: (generatedMeta.at as string | undefined) ?? null,
      manifest_branch: (generatedMeta.branch as string | undefined) ?? null,
    },
    categories,
    summary: {
      categories_checked: Object.keys(categories).length,
      items_total: total,
      items_covered: covered,
      items_uncovered: uncovered,
      items_skipped: skipped,
      coverage_percent: total > 0 ? Math.round((covered / total) * 1000) / 10 : 0,
    },
    drift: {
      previous_uncovered: previousUncovered,
      current_uncovered: uncovered,
      delta: previousUncovered === null ? null : uncovered - previousUncovered,
    },
  };

  // Stable-timestamp behavior: only write when material content changed.
  let shouldWrite = true;
  if (fs.existsSync(coveragePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
      const ex = existing.summary ?? {};
      const cu = output.summary;
      const materialUnchanged =
        ex.items_total === cu.items_total &&
        ex.items_covered === cu.items_covered &&
        ex.items_uncovered === cu.items_uncovered &&
        ex.items_skipped === cu.items_skipped;
      if (materialUnchanged) {
        shouldWrite = false;
        output.generated.at = existing.generated?.at ?? output.generated.at;
        output.drift = existing.drift ?? output.drift;
      }
    } catch {
      // ignore
    }
  }
  if (shouldWrite && !options.dryRun) {
    fs.writeFileSync(coveragePath, JSON.stringify(output, null, 2) + '\n');
  }

  // Drift regression — critical, always fails the gate.
  let regressed = false;
  if (previousUncovered !== null && uncovered > previousUncovered) {
    regressed = true;
    const delta = uncovered - previousUncovered;
    issues.push({
      id: 'QA-COV-REGRESS',
      category: 'qa-coverage',
      severity: 'critical',
      type: 'error',
      title: `Coverage regressed: uncovered_total grew ${previousUncovered} → ${uncovered}`,
      message: `Delta: +${delta}. Each new uncovered manifest entry needs a test stub before this commit lands.`,
      file: 'audit/qa-coverage.json',
      line: 0,
      code: 'coverage-regression',
    });
  }

  // Per-uncovered-item — severity by category.
  const sevByCategory: Record<string, Severity> = {
    rest: 'high',
    ajax: 'high',
    hooks_fired: 'medium',
    cron: 'low',
    wp_cli: 'low',
  };

  for (const [catName, catData] of Object.entries(categories)) {
    if (catData.uncovered === 0) continue;
    const sev = sevByCategory[catName] ?? 'medium';
    const slice = catData.uncovered_items.slice(0, 25);
    for (const item of slice) {
      issues.push({
        id: `QA-COV-${catName.toUpperCase().replace('_', '-')}-${issues.length + 1}`,
        category: 'qa-coverage',
        severity: sev,
        type: 'warning',
        title: formatUncoveredTitle(catName, item),
        message: String(item.stub_command ?? `bin/qa-stub-gen.php ${catName}`),
        file: 'audit/manifest.json',
        line: 0,
        code: `uncovered-${catName.replace('_', '-')}`,
      });
    }
    if (catData.uncovered_items.length > slice.length) {
      issues.push({
        id: `QA-COV-${catName.toUpperCase().replace('_', '-')}-MORE`,
        category: 'qa-coverage',
        severity: 'low',
        type: 'info',
        title: `${catData.uncovered_items.length - slice.length} more uncovered ${catName} entries truncated`,
        message: `See audit/qa-coverage.json for the full list.`,
        file: 'audit/qa-coverage.json',
        line: 0,
        code: 'truncated-listing',
      });
    }
  }

  const failed = options.strict ? (uncovered > 0 ? 1 : 0) : regressed ? 1 : 0;

  return {
    category: 'qa-coverage',
    passed: failed === 0 ? 1 : 0,
    failed,
    skipped: 0,
    duration: Date.now() - start,
    issues,
  };
}

// ════════════════════════════════════════════════════════════
// Per-category coverage checks
// ════════════════════════════════════════════════════════════

function checkRest(
  manifest: Record<string, unknown>,
  corpus: string
): CoverageStats {
  const rest = (manifest.rest as Record<string, unknown>) ?? {};
  const endpoints = (rest.endpoints as Array<Record<string, unknown>>) ?? [];

  // method -> normalized paths index from test source.
  const testIndex: Record<string, string[]> = {};

  // $this->rest( 'METHOD', '/path' )
  const callPattern = /\$this->rest\s*\(\s*['"]([A-Z]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
  for (const match of corpus.matchAll(callPattern)) {
    const method = match[1];
    const route = match[2].replace(/\{\$[^}]+\}/g, '__VAR__');
    (testIndex[method] ??= []).push(route);
  }

  // 'B7: POST /path/{id}' style labels.
  const labelPattern =
    /['"][A-Z]\d+(?:\.\d+)?\s*:?\s*([A-Z]+)\s+(\/[a-zA-Z0-9_\-/{}\\]+)/g;
  for (const match of corpus.matchAll(labelPattern)) {
    const method = match[1].toUpperCase();
    const route = match[2].replace(/\{[^}]+\}/g, '__VAR__');
    (testIndex[method] ??= []).push(route);
  }

  const covered: Array<Record<string, unknown>> = [];
  const uncovered: Array<Record<string, unknown>> = [];

  for (const ep of endpoints) {
    const route = String(ep.route ?? '');
    const methods = (ep.methods as string[] | undefined) ?? [];
    for (const method of methods) {
      const isCovered = endpointCovered(route, method, testIndex);
      const record: Record<string, unknown> = { method, route };
      if (isCovered) {
        covered.push(record);
      } else {
        record.stub_command = `bin/qa-stub-gen.php rest ${method} "${route}"`;
        uncovered.push(record);
      }
    }
  }

  return {
    total: covered.length + uncovered.length,
    covered: covered.length,
    uncovered: uncovered.length,
    skipped: 0,
    covered_items: covered,
    uncovered_items: uncovered,
  };
}

function endpointCovered(
  route: string,
  method: string,
  testIndex: Record<string, string[]>
): boolean {
  const paths = testIndex[method];
  if (!paths || paths.length === 0) return false;
  const normalized = manifestRouteToPattern(route);
  for (const tp of paths) {
    const tn = tp.replace(/__VAR__/g, ':NUM:');
    if (tn === normalized) return true;
    // Stem match: drop trailing segment.
    if (tn.startsWith(normalized.replace(/\/$/, '') + '/')) return true;
  }
  return false;
}

function manifestRouteToPattern(route: string): string {
  return route
    .replace(/\(\?P<[^>]+>\\d\+\)/g, ':NUM:')
    .replace(/\(\?P<[^>]+>[^)]+\)/g, ':STR:');
}

function checkAjax(
  manifest: Record<string, unknown>,
  corpus: string
): CoverageStats {
  const actions = (manifest.ajax as Array<Record<string, unknown>>) ?? [];
  const covered: Array<Record<string, unknown>> = [];
  const uncovered: Array<Record<string, unknown>> = [];

  for (const a of actions) {
    const action = String(a.action ?? '');
    if (!action) continue;
    const isCovered =
      corpus.includes(`'${action}'`) || corpus.includes(`"${action}"`);
    const record: Record<string, unknown> = { action };
    if (isCovered) covered.push(record);
    else {
      record.stub_command = `bin/qa-stub-gen.php ajax ${action}`;
      uncovered.push(record);
    }
  }

  return {
    total: covered.length + uncovered.length,
    covered: covered.length,
    uncovered: uncovered.length,
    skipped: 0,
    covered_items: covered,
    uncovered_items: uncovered,
  };
}

function checkHooksFired(
  manifest: Record<string, unknown>,
  corpus: string
): CoverageStats {
  const hooks = (manifest.hooks_fired as Array<Record<string, unknown>>) ?? [];
  const covered: Array<Record<string, unknown>> = [];
  const uncovered: Array<Record<string, unknown>> = [];
  let skipped = 0;

  for (const h of hooks) {
    const name = String(h.name ?? '');
    if (!name) continue;
    const consumedBy = h.consumed_by;
    if (!Array.isArray(consumedBy) || consumedBy.length === 0) {
      skipped++;
      continue;
    }
    const fired =
      corpus.includes(`do_action( '${name}'`) ||
      corpus.includes(`do_action('${name}'`) ||
      corpus.includes(`apply_filters( '${name}'`) ||
      corpus.includes(`apply_filters('${name}'`);
    const record: Record<string, unknown> = {
      name,
      consumer_count: consumedBy.length,
    };
    if (fired) covered.push(record);
    else {
      record.stub_command = `bin/qa-stub-gen.php hook ${name}`;
      uncovered.push(record);
    }
  }

  return {
    total: covered.length + uncovered.length,
    covered: covered.length,
    uncovered: uncovered.length,
    skipped,
    covered_items: covered,
    uncovered_items: uncovered,
    _note:
      'Tracks only hooks with non-empty consumed_by. Skipped hooks are pure extensibility surface.',
  };
}

function checkCron(
  manifest: Record<string, unknown>,
  corpus: string
): CoverageStats {
  const cron = (manifest.cron as Array<Record<string, unknown>>) ?? [];
  const covered: Array<Record<string, unknown>> = [];
  const uncovered: Array<Record<string, unknown>> = [];

  for (const c of cron) {
    const name = String(c.name ?? c.hook ?? '');
    if (!name) continue;
    const isCovered =
      corpus.includes(`'${name}'`) || corpus.includes(`"${name}"`);
    const record: Record<string, unknown> = { hook: name };
    if (isCovered) covered.push(record);
    else {
      record.stub_command = `bin/qa-stub-gen.php cron ${name}`;
      uncovered.push(record);
    }
  }

  return {
    total: covered.length + uncovered.length,
    covered: covered.length,
    uncovered: uncovered.length,
    skipped: 0,
    covered_items: covered,
    uncovered_items: uncovered,
  };
}

function checkWpCli(
  manifest: Record<string, unknown>,
  testFiles: string[]
): CoverageStats {
  const commands = (manifest.wp_cli as Array<Record<string, unknown>>) ?? [];
  const basenames = testFiles
    .map((f) => path.basename(f).toLowerCase())
    .join(' ');

  const covered: Array<Record<string, unknown>> = [];
  const uncovered: Array<Record<string, unknown>> = [];

  for (const c of commands) {
    const cmd = String(c.command ?? c.name ?? '');
    if (!cmd) continue;
    const slug = cmd
      .toLowerCase()
      .replace(/^[^ ]+ /, '')
      .replace(/ /g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const isCovered =
      basenames.includes(`class-${slug}-journey.php`) ||
      basenames.includes(`class-${slug}-journey-test.php`);
    const record: Record<string, unknown> = { command: cmd };
    if (isCovered) covered.push(record);
    else {
      record.stub_command = `bin/qa-stub-gen.php wp_cli ${cmd}`;
      uncovered.push(record);
    }
  }

  return {
    total: covered.length + uncovered.length,
    covered: covered.length,
    uncovered: uncovered.length,
    skipped: 0,
    covered_items: covered,
    uncovered_items: uncovered,
  };
}

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════

function walkPhp(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkPhp(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.php')) {
      out.push(full);
    }
  }
}

function formatUncoveredTitle(
  category: string,
  item: Record<string, unknown>
): string {
  switch (category) {
    case 'rest':
      return `Uncovered REST: ${item.method} ${item.route}`;
    case 'ajax':
      return `Uncovered AJAX: wp_ajax_${item.action}`;
    case 'hooks_fired':
      return `Uncovered hook: ${item.name} (${item.consumer_count} consumer${
        item.consumer_count === 1 ? '' : 's'
      })`;
    case 'cron':
      return `Uncovered cron: ${item.hook}`;
    case 'wp_cli':
      return `Uncovered wp-cli: ${item.command}`;
    default:
      return `Uncovered ${category}: ${JSON.stringify(item)}`;
  }
}
