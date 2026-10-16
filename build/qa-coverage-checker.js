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
const TEST_GLOBS = [
    'includes/qa',
    'includes/cli/journeys',
    'includes/cli/scenarios',
    'tests',
];
export function checkQaCoverage(pluginPath, options = {}) {
    const start = Date.now();
    const issues = [];
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
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    catch (e) {
        issues.push({
            id: 'QA-COV-BAD-MANIFEST',
            category: 'qa-coverage',
            severity: 'high',
            type: 'error',
            title: 'audit/manifest.json is not valid JSON',
            message: `JSON parse error: ${e.message}`,
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
    const testFiles = [];
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
        }
        catch {
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
    let total = 0, covered = 0, uncovered = 0, skipped = 0;
    for (const cat of Object.values(categories)) {
        total += cat.total;
        covered += cat.covered;
        uncovered += cat.uncovered;
        skipped += cat.skipped;
    }
    // Drift check.
    const coveragePath = path.join(pluginPath, 'audit/qa-coverage.json');
    let previousUncovered = null;
    if (fs.existsSync(coveragePath)) {
        try {
            const prev = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
            previousUncovered = prev?.summary?.items_uncovered ?? null;
        }
        catch {
            // ignore
        }
    }
    const pluginMeta = manifest.plugin ?? {};
    const generatedMeta = manifest.generated ?? {};
    const output = {
        schema_version: 'v1',
        plugin: {
            slug: String(pluginMeta.slug ?? path.basename(pluginPath)),
            version: String(pluginMeta.version ?? '0.0.0'),
        },
        generated: {
            at: new Date().toISOString(),
            manifest_at: generatedMeta.at ?? null,
            manifest_branch: generatedMeta.branch ?? null,
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
            const materialUnchanged = ex.items_total === cu.items_total &&
                ex.items_covered === cu.items_covered &&
                ex.items_uncovered === cu.items_uncovered &&
                ex.items_skipped === cu.items_skipped;
            if (materialUnchanged) {
                shouldWrite = false;
                output.generated.at = existing.generated?.at ?? output.generated.at;
                output.drift = existing.drift ?? output.drift;
            }
        }
        catch {
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
    const sevByCategory = {
        rest: 'high',
        ajax: 'high',
        hooks_fired: 'medium',
        cron: 'low',
        wp_cli: 'low',
    };
    for (const [catName, catData] of Object.entries(categories)) {
        if (catData.uncovered === 0)
            continue;
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
function checkRest(manifest, corpus) {
    const rest = manifest.rest ?? {};
    const endpoints = rest.endpoints ?? [];
    // method -> normalized paths index from test source.
    const testIndex = {};
    // $this->rest( 'METHOD', '/path' )
    const callPattern = /\$this->rest\s*\(\s*['"]([A-Z]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
    for (const match of corpus.matchAll(callPattern)) {
        const method = match[1];
        const route = match[2].replace(/\{\$[^}]+\}/g, '__VAR__');
        (testIndex[method] ??= []).push(route);
    }
    // 'B7: POST /path/{id}' style labels.
    const labelPattern = /['"][A-Z]\d+(?:\.\d+)?\s*:?\s*([A-Z]+)\s+(\/[a-zA-Z0-9_\-/{}\\]+)/g;
    for (const match of corpus.matchAll(labelPattern)) {
        const method = match[1].toUpperCase();
        const route = match[2].replace(/\{[^}]+\}/g, '__VAR__');
        (testIndex[method] ??= []).push(route);
    }
    const covered = [];
    const uncovered = [];
    for (const ep of endpoints) {
        const route = String(ep.route ?? '');
        const methods = ep.methods ?? [];
        for (const method of methods) {
            const isCovered = endpointCovered(route, method, testIndex);
            const record = { method, route };
            if (isCovered) {
                covered.push(record);
            }
            else {
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
function endpointCovered(route, method, testIndex) {
    const paths = testIndex[method];
    if (!paths || paths.length === 0)
        return false;
    const normalized = manifestRouteToPattern(route);
    for (const tp of paths) {
        const tn = tp.replace(/__VAR__/g, ':NUM:');
        if (tn === normalized)
            return true;
        // Stem match: drop trailing segment.
        if (tn.startsWith(normalized.replace(/\/$/, '') + '/'))
            return true;
    }
    return false;
}
function manifestRouteToPattern(route) {
    return route
        .replace(/\(\?P<[^>]+>\\d\+\)/g, ':NUM:')
        .replace(/\(\?P<[^>]+>[^)]+\)/g, ':STR:');
}
function checkAjax(manifest, corpus) {
    const actions = manifest.ajax ?? [];
    const covered = [];
    const uncovered = [];
    for (const a of actions) {
        const action = String(a.action ?? '');
        if (!action)
            continue;
        const isCovered = corpus.includes(`'${action}'`) || corpus.includes(`"${action}"`);
        const record = { action };
        if (isCovered)
            covered.push(record);
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
function checkHooksFired(manifest, corpus) {
    const hooks = manifest.hooks_fired ?? [];
    const covered = [];
    const uncovered = [];
    let skipped = 0;
    for (const h of hooks) {
        const name = String(h.name ?? '');
        if (!name)
            continue;
        const consumedBy = h.consumed_by;
        if (!Array.isArray(consumedBy) || consumedBy.length === 0) {
            skipped++;
            continue;
        }
        const fired = corpus.includes(`do_action( '${name}'`) ||
            corpus.includes(`do_action('${name}'`) ||
            corpus.includes(`apply_filters( '${name}'`) ||
            corpus.includes(`apply_filters('${name}'`);
        const record = {
            name,
            consumer_count: consumedBy.length,
        };
        if (fired)
            covered.push(record);
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
        _note: 'Tracks only hooks with non-empty consumed_by. Skipped hooks are pure extensibility surface.',
    };
}
function checkCron(manifest, corpus) {
    // The manifest writer emits `cron` as a flat list of hook NAMES
    // (write-manifest.mjs: `m.cron = (f.cronJobs || []).map((c) => c.hook)`), the
    // same way it flattens blocks, shortcodes and tables. Reading each entry as an
    // object therefore left both `name` and `hook` undefined, the `if (!name)
    // continue` below skipped every row, and the category reported total 0 —
    // indistinguishable from "this plugin schedules nothing".
    //
    // BuddyNext Pro has 21 cron entries and this reported 0 of them, in a report
    // whose entire job is to say what is untested. Accept both shapes: a bare
    // string, or an object keyed name/hook should a future writer enrich it.
    const cron = manifest.cron ?? [];
    const covered = [];
    const uncovered = [];
    for (const c of cron) {
        const name = typeof c === 'string' ? c : String(c?.name ?? c?.hook ?? '');
        if (!name)
            continue;
        const isCovered = corpus.includes(`'${name}'`) || corpus.includes(`"${name}"`);
        const record = { hook: name };
        if (isCovered)
            covered.push(record);
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
function checkWpCli(manifest, testFiles) {
    const commands = manifest.wp_cli ?? [];
    const basenames = testFiles
        .map((f) => path.basename(f).toLowerCase())
        .join(' ');
    const covered = [];
    const uncovered = [];
    for (const c of commands) {
        const cmd = String(c.command ?? c.name ?? '');
        if (!cmd)
            continue;
        const slug = cmd
            .toLowerCase()
            .replace(/^[^ ]+ /, '')
            .replace(/ /g, '-')
            .replace(/[^a-z0-9-]/g, '');
        const isCovered = basenames.includes(`class-${slug}-journey.php`) ||
            basenames.includes(`class-${slug}-journey-test.php`);
        const record = { command: cmd };
        if (isCovered)
            covered.push(record);
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
function walkPhp(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkPhp(full, out);
        }
        else if (entry.isFile() && entry.name.endsWith('.php')) {
            out.push(full);
        }
    }
}
function formatUncoveredTitle(category, item) {
    switch (category) {
        case 'rest':
            return `Uncovered REST: ${item.method} ${item.route}`;
        case 'ajax':
            return `Uncovered AJAX: wp_ajax_${item.action}`;
        case 'hooks_fired':
            return `Uncovered hook: ${item.name} (${item.consumer_count} consumer${item.consumer_count === 1 ? '' : 's'})`;
        case 'cron':
            return `Uncovered cron: ${item.hook}`;
        case 'wp_cli':
            return `Uncovered wp-cli: ${item.command}`;
        default:
            return `Uncovered ${category}: ${JSON.stringify(item)}`;
    }
}
//# sourceMappingURL=qa-coverage-checker.js.map