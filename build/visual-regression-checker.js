/**
 * WP Plugin QA MCP Server - Visual Regression Checker
 *
 * The 5th systemic-misalignment check from LEARNOMY-LESSONS-LEARNED.md §5.
 *
 * Pattern this catches: grep-based UX checks say "compliant" because design-system
 * tokens are present in OTHER files. But a newer admin edit view quietly ships using
 * `<table class="form-table">` (legacy WP pattern) instead of the plugin's own
 * `.{prefix}-admin-card` / `.{prefix}-settings-section` wrappers. Text-only audits
 * miss it; Playwright screenshot of the rendered DOM catches it in 5 seconds.
 *
 * How it runs:
 *   1. Auto-discover admin URLs by scanning `add_submenu_page` / `add_menu_page` calls.
 *   2. For each URL matching editor|edit|new (the edit-screen heuristic), open it via
 *      Playwright using the site's ?autologin=1 mu-plugin convention.
 *   3. Screenshot to .wppqa-out/visual/{slug}.png.
 *   4. Query the rendered DOM for `.{prefix}-admin-card`, `.{prefix}-page-header`,
 *      and `<table class="form-table">`. Flag the screen if the card/header is missing
 *      or the legacy form-table is present.
 *
 * Graceful degradation: if Playwright is not available, site_url is missing, or the
 * site is unreachable, the tool returns a `skipped` result with an info-level issue
 * explaining the prerequisite — it never crashes the audit.
 */
import { existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { relativePath, generateTestId, detectPluginSlug, } from './shared-utils.js';
import { scanPlugin } from './scanner.js';
export function checkVisualRegression(opts) {
    const startTime = Date.now();
    const issues = [];
    const { pluginPath, siteUrl, autologinParam = '?autologin=1', adminUrls: manualUrls, outputDir, timeoutMs = 30000, } = opts;
    if (!siteUrl) {
        issues.push({
            id: generateTestId('visual-regression'),
            category: 'visual-regression',
            severity: 'low',
            type: 'info',
            title: 'Visual regression skipped — no site_url supplied',
            message: 'wppqa_check_visual_regression requires a running WordPress site with the ?autologin=1 mu-plugin installed. Pass site_url to enable.',
            file: '',
            line: 0,
            code: 'visual-regression-skipped-no-site',
        });
        return {
            category: 'visual-regression',
            issues,
            passed: 0,
            failed: 0,
            skipped: 1,
            duration: Date.now() - startTime,
        };
    }
    // Playwright availability probe. We do NOT require @playwright/test as a
    // dependency of the MCP server itself — we shell out so the plugin under test
    // can bring its own copy, matching the existing browser-runner.ts pattern.
    if (!isPlaywrightAvailable()) {
        issues.push({
            id: generateTestId('visual-regression'),
            category: 'visual-regression',
            severity: 'low',
            type: 'info',
            title: 'Visual regression skipped — Playwright not installed',
            message: 'Install Playwright in the plugin directory: `npx -y playwright@latest install chromium`. Or install globally via `npm i -g playwright`. The check screenshots admin edit screens and flags any that miss the design-system card/page-header wrapper.',
            file: '',
            line: 0,
            code: 'visual-regression-skipped-no-playwright',
        });
        return {
            category: 'visual-regression',
            issues,
            passed: 0,
            failed: 0,
            skipped: 1,
            duration: Date.now() - startTime,
        };
    }
    const prefix = detectCssPrefix(pluginPath);
    const urls = manualUrls && manualUrls.length > 0
        ? manualUrls.map((u) => toAdminUrl(u, siteUrl))
        : discoverAdminUrls(pluginPath, siteUrl);
    if (urls.length === 0) {
        issues.push({
            id: generateTestId('visual-regression'),
            category: 'visual-regression',
            severity: 'low',
            type: 'info',
            title: 'Visual regression skipped — no admin URLs discovered',
            message: 'No add_submenu_page/add_menu_page calls found and no admin_urls list supplied. Pass admin_urls: ["/wp-admin/admin.php?page=..."] to run the check.',
            file: '',
            line: 0,
            code: 'visual-regression-skipped-no-urls',
        });
        return {
            category: 'visual-regression',
            issues,
            passed: 0,
            failed: 0,
            skipped: 1,
            duration: Date.now() - startTime,
        };
    }
    const slug = detectPluginSlug(pluginPath);
    const screenshotsDir = outputDir || join(pluginPath, '.wppqa-out', 'visual');
    try {
        mkdirSync(screenshotsDir, { recursive: true });
    }
    catch {
        // non-fatal
    }
    const probes = runPlaywrightProbe({
        urls,
        siteUrl,
        autologinParam,
        screenshotsDir,
        prefix,
        timeoutMs,
    });
    let passed = 0;
    let failed = 0;
    for (const probe of probes) {
        if (probe.error) {
            issues.push({
                id: generateTestId('visual-regression'),
                category: 'visual-regression',
                severity: 'low',
                type: 'info',
                title: `Could not capture ${probe.adminUrl.slug}`,
                message: `Playwright probe failed: ${probe.error}. URL: ${probe.adminUrl.url}`,
                file: probe.adminUrl.fromFile,
                line: probe.adminUrl.fromLine,
                code: 'visual-regression-probe-failed',
            });
            continue;
        }
        if (!probe.adminUrl.isEditScreen) {
            // Non-edit admin screens (list tables, dashboards) are not required to use the
            // card wrapper — record as pass.
            passed++;
            continue;
        }
        const deviations = [];
        if (!probe.hasAdminCard) {
            deviations.push(`missing .${prefix}-admin-card wrapper`);
        }
        if (!probe.hasPageHeader) {
            deviations.push(`missing .${prefix}-page-header`);
        }
        if (probe.hasLegacyFormTable) {
            deviations.push('uses legacy <table class="form-table"> (design-system regression)');
        }
        if (deviations.length > 0) {
            failed++;
            issues.push({
                id: generateTestId('visual-regression'),
                category: 'visual-regression',
                severity: 'medium',
                type: 'warning',
                title: `Visual-design deviation on ${probe.adminUrl.title || probe.adminUrl.slug}`,
                message: `${probe.adminUrl.url} — ${deviations.join('; ')}. Screenshot: ${probe.screenshotPath ? relativePath(probe.screenshotPath, pluginPath) : '(none)'}.`,
                file: probe.adminUrl.fromFile,
                line: probe.adminUrl.fromLine,
                code: 'visual-design-deviation',
                fix: `Wrap the view in .${prefix}-admin-card with a .${prefix}-page-header at the top. Replace form-table layouts with .${prefix}-settings-section blocks. See docs/UX-GUIDELINES.md for the reference pattern.`,
            });
        }
        else {
            passed++;
        }
    }
    // Include plugin slug in the summary for traceability.
    void slug;
    return {
        category: 'visual-regression',
        issues,
        passed,
        failed,
        skipped: 0,
        duration: Date.now() - startTime,
    };
}
/**
 * Detects the plugin's CSS prefix from `--prefix-*` variable usage in assets/.
 * Mirrors the detection in ux-guidelines-checker.ts so both checkers agree.
 */
/**
 * Plugin-agnostic CSS prefix detection. Delegates to the canonical scanner
 * implementation (`scanPlugin().cssPrefix`) which reads asset CSS files,
 * frequency-counts `--<token>-*` custom properties, and falls back to the
 * plugin slug. Replaces the previous local implementation that hard-coded
 * `'lrn'` as the fallback.
 */
function detectCssPrefix(pluginPath) {
    return scanPlugin(pluginPath).cssPrefix;
}
/**
 * Discover admin URLs from the canonical PluginManifest. The scanner
 * already extracts every add_submenu_page / add_menu_page registration
 * with file + line attribution; this used to re-walk the PHP tree on
 * every visual-regression run.
 */
function discoverAdminUrls(pluginPath, siteUrl) {
    const manifest = scanPlugin(pluginPath);
    const base = siteUrl.replace(/\/$/, '');
    const seen = new Set();
    const urls = [];
    for (const page of manifest.features.adminPages) {
        if (!page.slug)
            continue;
        const u = buildAdminUrl(page.slug, page.title, page.file, page.line, base);
        if (seen.has(u.url))
            continue;
        seen.add(u.url);
        urls.push(u);
    }
    return urls;
}
function buildAdminUrl(slug, title, file, line, base) {
    const editRe = /editor|edit|new|add|form/i;
    return {
        slug,
        title: title || slug,
        fromFile: file,
        fromLine: line,
        url: `${base}/wp-admin/admin.php?page=${slug}`,
        isEditScreen: editRe.test(slug) || editRe.test(title),
    };
}
function toAdminUrl(rawUrl, siteUrl) {
    const base = siteUrl.replace(/\/$/, '');
    const url = rawUrl.startsWith('http') ? rawUrl : `${base}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    const slugMatch = url.match(/[?&]page=([^&]+)/);
    const slug = slugMatch ? slugMatch[1] : url.split('/').pop() || url;
    const editRe = /editor|edit|new|add|form/i;
    return {
        slug,
        title: slug,
        fromFile: '',
        fromLine: 0,
        url,
        isEditScreen: editRe.test(url),
    };
}
/**
 * Detects whether Playwright can be invoked. Checks for a local or global install.
 */
function isPlaywrightAvailable() {
    try {
        const result = spawnSync('npx', ['--no-install', 'playwright', '--version'], {
            encoding: 'utf-8',
            timeout: 5000,
        });
        if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.length > 0) {
            return true;
        }
    }
    catch {
        // fall through
    }
    // Fallback: look for the executable directly
    try {
        const result = spawnSync('playwright', ['--version'], { encoding: 'utf-8', timeout: 5000 });
        return result.status === 0;
    }
    catch {
        return false;
    }
}
/**
 * Runs the Playwright probe via `node -e` so we don't need to pre-install Playwright
 * as a dep of the MCP server itself. The script is self-contained; it emits one
 * JSON line per URL on stdout.
 */
function runPlaywrightProbe(job) {
    const base = job.siteUrl.replace(/\/$/, '');
    const loginUrl = `${base}/${job.autologinParam.replace(/^\?/, '?').replace(/^\/\?/, '?')}`;
    const normalizedLogin = loginUrl.startsWith(`${base}/?`) ? loginUrl : `${base}/${job.autologinParam.replace(/^\//, '')}`;
    // Inline script — kept compact. Each URL is its own JSON line for streaming parse.
    const script = `
    (async () => {
      let chromium;
      try { ({ chromium } = await import('playwright')); }
      catch (e) {
        try { ({ chromium } = await import('@playwright/test')); }
        catch (e2) {
          process.stdout.write(JSON.stringify({ fatal: 'playwright not resolvable: ' + (e2.message || e2) }) + '\\n');
          process.exit(0);
        }
      }
      const urls = JSON.parse(process.argv[2]);
      const loginUrl = process.argv[3];
      const outDir = process.argv[4];
      const prefix = process.argv[5];
      const timeoutMs = parseInt(process.argv[6], 10) || 30000;
      const path = await import('path');
      const browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      try {
        await page.goto(loginUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      } catch (e) {
        process.stdout.write(JSON.stringify({ fatal: 'autologin failed: ' + (e.message || e) }) + '\\n');
        await browser.close();
        process.exit(0);
      }
      for (const u of urls) {
        const safe = u.slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        const shot = path.join(outDir, safe + '.png');
        const out = { slug: u.slug, screenshot: shot, hasAdminCard: false, hasPageHeader: false, hasSettingsSection: false, hasLegacyFormTable: false, error: null };
        try {
          await page.goto(u.url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(500);
          await page.screenshot({ path: shot, fullPage: true });
          out.hasAdminCard = await page.locator('.' + prefix + '-admin-card').count() > 0;
          out.hasPageHeader = await page.locator('.' + prefix + '-page-header').count() > 0;
          out.hasSettingsSection = await page.locator('.' + prefix + '-settings-section').count() > 0;
          out.hasLegacyFormTable = await page.locator('table.form-table').count() > 0;
        } catch (e) {
          out.error = e.message || String(e);
        }
        process.stdout.write(JSON.stringify(out) + '\\n');
      }
      await browser.close();
    })().catch((e) => {
      process.stdout.write(JSON.stringify({ fatal: 'probe crashed: ' + (e.message || e) }) + '\\n');
      process.exit(0);
    });
  `;
    const urlPayload = JSON.stringify(job.urls.map((u) => ({ slug: u.slug, url: u.url })));
    const results = [];
    const byUrl = new Map(job.urls.map((u) => [u.slug, u]));
    let proc;
    try {
        proc = spawnSync('node', [
            '-e',
            script,
            urlPayload,
            normalizedLogin,
            job.screenshotsDir,
            job.prefix,
            String(job.timeoutMs),
        ], {
            encoding: 'utf-8',
            timeout: Math.max(job.timeoutMs * (job.urls.length + 2), 60000),
            maxBuffer: 20 * 1024 * 1024,
        });
    }
    catch (e) {
        const msg = e.message;
        for (const u of job.urls) {
            results.push({
                adminUrl: u,
                hasAdminCard: false,
                hasPageHeader: false,
                hasSettingsSection: false,
                hasLegacyFormTable: false,
                error: `spawn failed: ${msg}`,
            });
        }
        return results;
    }
    const stdout = proc.stdout || '';
    for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed.fatal) {
                for (const u of job.urls) {
                    results.push({
                        adminUrl: u,
                        hasAdminCard: false,
                        hasPageHeader: false,
                        hasSettingsSection: false,
                        hasLegacyFormTable: false,
                        error: parsed.fatal,
                    });
                }
                return results;
            }
            const adminUrl = byUrl.get(parsed.slug);
            if (!adminUrl)
                continue;
            results.push({
                adminUrl,
                screenshotPath: parsed.screenshot && safeIsFile(parsed.screenshot) ? parsed.screenshot : undefined,
                hasAdminCard: !!parsed.hasAdminCard,
                hasPageHeader: !!parsed.hasPageHeader,
                hasSettingsSection: !!parsed.hasSettingsSection,
                hasLegacyFormTable: !!parsed.hasLegacyFormTable,
                error: parsed.error || undefined,
            });
        }
        catch {
            // ignore malformed line
        }
    }
    // Any URL not represented in stdout is reported as an errored probe.
    const handled = new Set(results.map((r) => r.adminUrl.slug));
    for (const u of job.urls) {
        if (!handled.has(u.slug)) {
            results.push({
                adminUrl: u,
                hasAdminCard: false,
                hasPageHeader: false,
                hasSettingsSection: false,
                hasLegacyFormTable: false,
                error: `no result emitted${proc.stderr ? ' — stderr: ' + String(proc.stderr).slice(0, 200) : ''}`,
            });
        }
    }
    return results;
}
function safeIsFile(p) {
    try {
        return statSync(p).isFile();
    }
    catch {
        return false;
    }
}
// Re-export for convenience
export { existsSync };
//# sourceMappingURL=visual-regression-checker.js.map