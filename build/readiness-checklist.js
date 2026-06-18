/**
 * WP Plugin QA MCP Server - Readiness Scorecard ("the bar")
 *
 * Autonomous: point it at any plugin and it reports what's PRESENT, what's
 * MISSING, and what's FAILING against one portfolio standard — no need to know
 * which individual check to run. It folds the cross-layer checks (template
 * contract / zero-logic) and manifest signals together with a presence-based
 * standards bar (CI, tests, docs, QA artifacts), grouped, with an overall
 * score and a meets/below-bar verdict.
 *
 * The bar is config-driven: a plugin (or the portfolio) can override which
 * items are REQUIRED via audit/readiness-bar.json, so the team can "set the
 * bar" once and hold every plugin to it.
 */
import { join } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { fileExists, dirExists, findFilesByExt, findPhpFiles, safeReadFile } from './shared-utils.js';
import { analyzeTemplateContracts, analyzeTemplateHygiene } from './template-contract-checker.js';
import { scanPlugin } from './scanner.js';
function loadBarOverride(pluginPath) {
    const p = join(pluginPath, 'audit', 'readiness-bar.json');
    if (!fileExists(p))
        return {};
    try {
        const o = JSON.parse(readFileSync(p, 'utf-8'));
        return o && typeof o === 'object' ? o : {};
    }
    catch {
        return {};
    }
}
const anyExists = (pluginPath, ...rel) => rel.some((r) => existsSync(join(pluginPath, r)));
function defineBar() {
    return [
        // ── Standards ────────────────────────────────────────────────
        { id: 'uninstall', group: 'Standards', label: 'uninstall.php / uninstall hook', required: true,
            check: (p, m) => anyExists(p, 'uninstall.php') || m.features.activationHooks?.some((h) => h.type === 'uninstall')
                ? { status: 'pass', detail: 'cleanup on delete present' }
                : (m.features.dbTables?.length ? { status: 'fail', detail: 'custom tables but no uninstall cleanup' } : { status: 'missing', detail: 'no uninstall.php' }) },
        { id: 'readme', group: 'Standards', label: 'readme.txt with changelog', required: true,
            check: (p) => {
                const r = ['readme.txt', 'README.txt'].map((f) => join(p, f)).find(existsSync);
                if (!r)
                    return { status: 'missing', detail: 'no readme.txt' };
                return /==\s*changelog\s*==/i.test(safeReadFile(r)) ? { status: 'pass', detail: 'changelog present' } : { status: 'fail', detail: 'readme.txt has no == Changelog ==' };
            } },
        { id: 'i18n', group: 'Standards', label: 'i18n: .pot file', required: true,
            check: (p) => findFilesByExt(p, 'pot').length ? { status: 'pass', detail: 'translation template present' } : { status: 'missing', detail: 'no languages/*.pot' } },
        // ── CI & Quality gates ───────────────────────────────────────
        { id: 'wpcs', group: 'CI & Quality', label: 'WPCS config (phpcs.xml)', required: true,
            check: (p) => anyExists(p, 'phpcs.xml', '.phpcs.xml.dist', 'phpcs.xml.dist') ? { status: 'pass', detail: 'phpcs config present' } : { status: 'missing', detail: 'no phpcs config' } },
        { id: 'phpstan', group: 'CI & Quality', label: 'PHPStan config', required: true,
            check: (p) => anyExists(p, 'phpstan.neon', 'phpstan.neon.dist') ? { status: 'pass', detail: 'phpstan config present' } : { status: 'missing', detail: 'no phpstan.neon' } },
        { id: 'tests', group: 'CI & Quality', label: 'PHPUnit tests', required: true,
            check: (p) => {
                // phpunit config lives at the root OR under tests/ (tests/phpunit/phpunit.xml is common).
                const hasConfig = anyExists(p, 'phpunit.xml', 'phpunit.xml.dist', 'tests/phpunit.xml', 'tests/phpunit.xml.dist', 'tests/phpunit/phpunit.xml', 'tests/phpunit/phpunit.xml.dist');
                const testFiles = dirExists(join(p, 'tests')) ? findPhpFiles(join(p, 'tests')).filter((f) => /test/i.test(f)) : [];
                if (hasConfig && testFiles.length)
                    return { status: 'pass', detail: `${testFiles.length} test files + phpunit config` };
                if (testFiles.length)
                    return { status: 'fail', detail: `${testFiles.length} test files but no phpunit config` };
                return { status: 'missing', detail: 'no tests/ with phpunit config' };
            } },
        { id: 'ci', group: 'CI & Quality', label: 'CI pipeline (workflow or local-ci)', required: true,
            check: (p) => (dirExists(join(p, '.github', 'workflows')) || anyExists(p, 'bin/local-ci.sh')) ? { status: 'pass', detail: 'CI gate present' } : { status: 'missing', detail: 'no CI workflow / bin/local-ci.sh' } },
        // ── Architecture surfaces ────────────────────────────────────
        { id: 'rest', group: 'Architecture', label: 'REST API (app/integration surface)', required: false,
            check: (p, m) => m.features.restRoutes?.length ? { status: 'pass', detail: `${m.features.restRoutes.length} routes` } : { status: 'missing', detail: 'no REST routes' } },
        { id: 'caps', group: 'Architecture', label: 'Custom capabilities registered', required: false,
            check: (p, m) => m.features.customRoles?.length ? { status: 'pass', detail: 'roles/caps present' } : { status: 'n/a', detail: 'no custom roles' } },
        // ── Cross-layer contracts ────────────────────────────────────
        { id: 'template-contract', group: 'Contracts', label: 'Template contract (TC2) clean', required: true,
            check: (p) => {
                const a = analyzeTemplateContracts(p);
                if (a.mode === 'none')
                    return { status: 'n/a', detail: 'no detectable template loader' };
                return a.result.failed === 0 ? { status: 'pass', detail: `${a.checked} templates, 0 drift` } : { status: 'fail', detail: `${a.result.failed} contract drift` };
            } },
        { id: 'template-zero-logic', group: 'Contracts', label: 'Templates are logic-free (TC1)', required: false,
            check: (p) => {
                const h = analyzeTemplateHygiene(p);
                return h.zeroLogic.findings.length === 0 ? { status: 'pass', detail: 'no data fetching in templates' } : { status: 'fail', detail: `${h.zeroLogic.findings.length} data-fetch sites` };
            } },
        // ── QA system (Wbcom standard) ───────────────────────────────
        { id: 'qa-runbook', group: 'QA system', label: 'docs/qa smoke runbook', required: true,
            check: (p) => anyExists(p, 'docs/qa/AGENT_SMOKE_RUNBOOK.md') ? { status: 'pass', detail: 'runbook present' } : { status: 'missing', detail: 'no docs/qa/AGENT_SMOKE_RUNBOOK.md' } },
        { id: 'qa-config', group: 'QA system', label: 'docs/qa/qa-config.json', required: true,
            check: (p) => anyExists(p, 'docs/qa/qa-config.json') ? { status: 'pass', detail: 'qa-config present' } : { status: 'missing', detail: 'no docs/qa/qa-config.json' } },
        { id: 'manifest', group: 'QA system', label: 'audit/manifest.json', required: true,
            check: (p) => anyExists(p, 'audit/manifest.json') ? { status: 'pass', detail: 'manifest present' } : { status: 'missing', detail: 'no audit/manifest.json' } },
        { id: 'contract-baseline', group: 'QA system', label: 'contract-audit baseline', required: false,
            check: (p) => anyExists(p, '.contract-audit-baseline.json') ? { status: 'pass', detail: 'baseline present' } : { status: 'missing', detail: 'no .contract-audit-baseline.json' } },
        { id: 'journeys', group: 'QA system', label: 'audit/journeys catalogue', required: false,
            check: (p) => (dirExists(join(p, 'audit', 'journeys')) || anyExists(p, 'docs/audit/journeys.json')) ? { status: 'pass', detail: 'journeys present' } : { status: 'missing', detail: 'no audit/journeys' } },
        // ── Docs ─────────────────────────────────────────────────────
        { id: 'docs', group: 'Docs', label: 'docs/ tree', required: false,
            check: (p) => dirExists(join(p, 'docs')) ? { status: 'pass', detail: 'docs/ present' } : { status: 'missing', detail: 'no docs/' } },
    ];
}
export function assessReadiness(pluginPath, manifest) {
    const override = loadBarOverride(pluginPath);
    const disabled = new Set(override.disable ?? []);
    const items = [];
    for (const def of defineBar()) {
        if (disabled.has(def.id))
            continue;
        const required = override.required?.[def.id] ?? def.required;
        const { status, detail } = def.check(pluginPath, manifest);
        items.push({ id: def.id, group: def.group, label: def.label, required, status, detail });
    }
    const counts = { pass: 0, missing: 0, fail: 0, na: 0 };
    const groups = {};
    let applicable = 0;
    let passed = 0;
    let requiredMet = true;
    for (const it of items) {
        counts[it.status === 'n/a' ? 'na' : it.status]++;
        if (it.status !== 'n/a') {
            applicable++;
            groups[it.group] = groups[it.group] ?? { pass: 0, total: 0 };
            groups[it.group].total++;
            if (it.status === 'pass') {
                passed++;
                groups[it.group].pass++;
            }
            if (it.required && it.status !== 'pass')
                requiredMet = false;
        }
    }
    const score = applicable ? Math.round((passed / applicable) * 100) : 100;
    return {
        score,
        requiredMet,
        barVerdict: requiredMet ? 'meets-bar' : 'below-bar',
        counts,
        groups,
        items,
    };
}
// ─── Cross-portfolio monitor ───────────────────────────────────────
/** Is dir a WordPress plugin? A root-level .php with a `Plugin Name:` header. */
function isPluginDir(dir) {
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return false;
    }
    for (const e of entries) {
        if (!e.endsWith('.php'))
            continue;
        try {
            if (/^[\s\S]{0,8000}?Plugin Name:/i.test(readFileSync(join(dir, e), 'utf-8').slice(0, 8000)))
                return true;
        }
        catch { /* ignore */ }
    }
    return false;
}
/** Find plugin dirs: the root itself if it's a plugin, else its immediate subdirs. */
export function discoverPlugins(root) {
    if (isPluginDir(root))
        return [root];
    let entries;
    try {
        entries = readdirSync(root);
    }
    catch {
        return [];
    }
    const out = [];
    for (const e of entries) {
        if (e.startsWith('.'))
            continue;
        const p = join(root, e);
        try {
            if (statSync(p).isDirectory() && isPluginDir(p))
                out.push(p);
        }
        catch { /* ignore */ }
    }
    return out.sort();
}
/** Score every plugin under the given paths/roots; worst-first. */
export function assessReadinessPortfolio(pluginPaths) {
    const rows = [];
    for (const p of pluginPaths) {
        let manifest;
        try {
            manifest = scanPlugin(p);
        }
        catch {
            continue;
        }
        const sc = assessReadiness(p, manifest);
        rows.push({
            name: manifest.header?.name ?? p.split('/').pop() ?? p,
            path: p,
            score: sc.score,
            barVerdict: sc.barVerdict,
            requiredGaps: sc.items.filter((i) => i.required && i.status !== 'pass' && i.status !== 'n/a').map((i) => i.id),
        });
    }
    return rows.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}
export function formatPortfolio(rows) {
    if (!rows.length)
        return 'No plugins found under the given path.';
    const below = rows.filter((r) => r.barVerdict === 'below-bar').length;
    const lines = [];
    lines.push('READINESS — PORTFOLIO');
    lines.push('='.repeat(60));
    lines.push(`${rows.length} plugins · ${below} below bar · ${rows.length - below} meet bar`);
    lines.push('');
    for (const r of rows) {
        const flag = r.barVerdict === 'below-bar' ? '✗' : '✓';
        const gaps = r.requiredGaps.length ? `  gaps: ${r.requiredGaps.join(', ')}` : '';
        lines.push(`  ${flag} ${String(r.score).padStart(3)}/100  ${r.name}${gaps}`);
    }
    return lines.join('\n');
}
/** Human-readable checklist for the wppqa_readiness tool. */
export function formatReadiness(sc, name) {
    const icon = { pass: '✓', missing: '✗', fail: '⚠', 'n/a': '·' };
    const lines = [];
    lines.push(`READINESS — ${name}`);
    lines.push('='.repeat(50));
    lines.push(`Score: ${sc.score}/100   Verdict: ${sc.barVerdict.toUpperCase()}`);
    lines.push(`pass=${sc.counts.pass}  missing=${sc.counts.missing}  fail=${sc.counts.fail}  n/a=${sc.counts.na}`);
    lines.push('');
    let group = '';
    for (const it of sc.items) {
        if (it.group !== group) {
            group = it.group;
            lines.push(`${group}`);
        }
        lines.push(`  ${icon[it.status]} ${it.label}${it.required ? '' : '  (recommended)'} — ${it.detail}`);
    }
    lines.push('');
    const gaps = sc.items.filter((i) => i.required && i.status !== 'pass' && i.status !== 'n/a');
    if (gaps.length) {
        lines.push('Below the bar — required gaps:');
        for (const g of gaps)
            lines.push(`  • ${g.label}: ${g.detail}`);
    }
    else {
        lines.push('Meets the bar (all required items pass). Recommended items may remain.');
    }
    return lines.join('\n');
}
//# sourceMappingURL=readiness-checklist.js.map