/**
 * WP Plugin QA MCP Server - Main Server
 * 28 tools exposed (33 defined; 5 hidden by EXCLUDED_NON_FUNCTIONAL in tools.ts).
 * Groups: discovery (scan), product-eval (admin/frontend/ux/templates/a11y),
 * systemic-misalignment (wiring, enum, rest-js contract, css contract,
 * editor-layout-bias, ux-guidelines, plugin-dev-rules, qa-coverage,
 * visual-regression, cross-reference-data, scale), live-site (api, db, browser,
 * role-probe, run_checks guards), and audit-workflows (one-shot audit_plugin +
 * parallel journey-audit subsystem + certify + readiness).
 * Ownership boundary: static code standards (php-lint, PHPCompatibility,
 * WPCS/phpcs, PHPStan) belong to the wpcs MCP; market/strategy analysis belongs
 * to the product-strategy skill. Neither is run here.
 * Note: live-site checkers (api, db, browser, role-probe, visual-regression)
 * degrade gracefully when site_url is missing. Several modules shell out via
 * execFileSync/spawnSync (php lint, Playwright, composer, WP-CLI).
 */
import { formatLedger, runChecks } from './live/run.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { tools } from './tools.js';
import { scanPlugin } from './scanner.js';
import { checkApi } from './api-checker.js';
import { checkDatabase } from './db-checker.js';
import { checkBrowser } from './browser-runner.js';
import { checkUx } from './ux-checker.js';
import { checkTemplates } from './template-checker.js';
import { checkTemplateContracts } from './template-contract-checker.js';
import { checkCssContract } from './css-contract-checker.js';
import { assessReadiness, formatReadiness, discoverPlugins, assessReadinessPortfolio, formatPortfolio } from './readiness-checklist.js';
import { checkAccessibility } from './a11y-checker.js';
import { evaluateAdmin } from './admin-evaluator.js';
import { evaluateFrontend } from './frontend-evaluator.js';
import { buildReport, exportSarif, exportJunit } from './report-builder.js';
import { runCertify, formatCertify, runEngine, formatEngine } from './cert-runner.js';
import { probeRoleMatrix } from './role-matrix-prober.js';
import { crossReferenceData } from './data-cross-reference.js';
import { bootstrapPlan } from './plan-bootstrap.js';
import { learnFromBasecamp } from './basecamp-learner.js';
import { checkWiringCompleteness } from './wiring-completeness-checker.js';
import { checkUxGuidelines } from './ux-guidelines-checker.js';
import { checkPluginDevRules } from './plugin-dev-rules-checker.js';
import { checkQaCoverage } from './qa-coverage-checker.js';
import { checkVisualRegression } from './visual-regression-checker.js';
import { checkEnumConsistency } from './enum-consistency-checker.js';
import { checkScale } from './perf-scale-checker.js';
import { checkRestJsContract } from './rest-js-contract-checker.js';
import { checkEditorLayoutBias } from './editor-layout-bias-checker.js';
import { initJourneys, getBriefing as getAuditBriefing, consolidateMatrix as consolidateAuditMatrix, coverageCheck as auditCoverageCheck, } from './journey-audit.js';
import { resetIdCounter } from './shared-utils.js';
export class WpPluginQaServer {
    server;
    /**
     * Per-request manifest cache. Cleared at the start of every tool
     * call so a single tool run can reuse one scan across helpers without
     * leaking stale data into the next call. This eliminates the double-
     * scan when init_journeys + coverage_check (or any pair of tools)
     * are called back-to-back on the same plugin.
     */
    manifestCache = new Map();
    getCachedManifest(pluginPath) {
        const cached = this.manifestCache.get(pluginPath);
        if (cached) {
            return cached;
        }
        const fresh = scanPlugin(pluginPath);
        this.manifestCache.set(pluginPath, fresh);
        return fresh;
    }
    constructor() {
        this.server = new Server({
            name: 'wp-plugin-qa-mcp-server',
            version: '3.2.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools,
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const toolArgs = (args || {});
            resetIdCounter();
            this.manifestCache.clear();
            try {
                switch (name) {
                    // 1. Discovery
                    case 'wppqa_scan_plugin':
                        return this.handleScanPlugin(toolArgs.plugin_path);
                    // 5. Accessibility
                    case 'wppqa_check_a11y':
                        return this.handleCheckA11y(toolArgs.plugin_path);
                    // 6. Product Evaluation (merged admin+frontend+marketing)
                    case 'wppqa_evaluate_product':
                        return this.handleEvaluateProduct(toolArgs.plugin_path, toolArgs.focus);
                    // 7-8. Static checks
                    case 'wppqa_check_ux':
                        return this.handleCheckUx(toolArgs.plugin_path);
                    case 'wppqa_check_templates':
                        return this.handleCheckTemplates(toolArgs.plugin_path);
                    case 'wppqa_check_template_contract':
                        return this.handleCheckTemplateContract(toolArgs.plugin_path);
                    case 'wppqa_check_css_contract':
                        return this.handleCheckCssContract(toolArgs.plugin_path);
                    case 'wppqa_readiness':
                        return this.handleReadiness(toolArgs.plugin_path);
                    case 'wppqa_readiness_portfolio':
                        return this.handleReadinessPortfolio(toolArgs.plugins_root, toolArgs.plugin_paths);
                    // 9-11. Live site checks
                    case 'wppqa_check_api':
                        return await this.handleCheckApi(toolArgs.plugin_path, toolArgs.site_url);
                    case 'wppqa_check_database':
                        return await this.handleCheckDatabase(toolArgs.plugin_path, toolArgs.site_url);
                    case 'wppqa_check_browser':
                        return this.handleCheckBrowser(toolArgs.plugin_path, toolArgs.site_url, toolArgs.mode);
                    // 13. Role-matrix prober
                    case 'wppqa_probe_roles':
                        return await this.handleProbeRoles(toolArgs.plugin_path, toolArgs.site_url, toolArgs.roles);
                    // 14. Write↔Read data cross-reference
                    case 'wppqa_cross_reference_data':
                        return this.handleCrossReferenceData(toolArgs.plugin_path);
                    // 15. Plan bootstrap
                    case 'wppqa_bootstrap_plan':
                        return await this.handleBootstrapPlan(toolArgs.plugin_path, toolArgs.overwrite);
                    // 16. Basecamp ledger
                    case 'wppqa_learn_from_basecamp':
                        return await this.handleLearnFromBasecamp(toolArgs);
                    // 17-18. Systemic Misalignment Checks (from Learnomy v1.3.0 lessons)
                    case 'wppqa_check_wiring_completeness':
                        return this.handleCheckWiringCompleteness(toolArgs.plugin_path);
                    case 'wppqa_check_ux_guidelines':
                        return this.handleCheckUxGuidelines(toolArgs.plugin_path);
                    case 'wppqa_check_plugin_dev_rules':
                        return this.handleCheckPluginDevRules(toolArgs.plugin_path);
                    case 'wppqa_check_qa_coverage':
                        return this.handleCheckQaCoverage(toolArgs.plugin_path, toolArgs.strict, toolArgs.dry_run);
                    case 'wppqa_check_visual_regression':
                        return this.handleCheckVisualRegression(toolArgs.plugin_path, toolArgs.site_url, toolArgs.autologin_param, toolArgs.admin_urls);
                    case 'wppqa_check_enum_consistency':
                        return this.handleCheckEnumConsistency(toolArgs.plugin_path);
                    case 'wppqa_check_rest_js_contract':
                        return this.handleCheckRestJsContract(toolArgs.plugin_path);
                    case 'wppqa_check_editor_layout_bias':
                        return this.handleCheckEditorLayoutBias(toolArgs.plugin_path);
                    case 'wppqa_check_scale':
                        return this.handleCheckScale(toolArgs.plugin_path);
                    // 20. Full Audit (master tool)
                    case 'wppqa_audit_plugin':
                        return await this.handleAuditPlugin(toolArgs.plugin_path, toolArgs.site_url, toolArgs.format);
                    // 21-24. Journey-by-journey customer-experience audit
                    case 'wppqa_audit_init_journeys':
                        return this.handleAuditInitJourneys(toolArgs.plugin_path, toolArgs.force, toolArgs.starter_only);
                    case 'wppqa_audit_coverage_check':
                        return this.handleAuditCoverageCheck(toolArgs.plugin_path);
                    case 'wppqa_audit_get_briefing':
                        return this.handleAuditGetBriefing(toolArgs.plugin_path, toolArgs.site_url, toolArgs.output_dir);
                    case 'wppqa_audit_consolidate_matrix':
                        return this.handleAuditConsolidateMatrix(toolArgs.plugin_path, toolArgs.report_paths, toolArgs.output_path);
                    case 'wppqa_certify':
                        return this.handleCertify(toolArgs.wp_root, toolArgs.cli_namespace, toolArgs.check);
                    case 'wppqa_audit':
                        return this.handleAudit(toolArgs.wp_root, toolArgs.plugin_path, toolArgs.oracles_path);
                    case 'wppqa_run_checks':
                        return this.handleRunChecks(toolArgs);
                    default:
                        return this.errorResult(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
                const err = error;
                return this.errorResult(`Tool failed: ${err.message || 'Unknown error'}`);
            }
        });
    }
    handleScanPlugin(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = this.getCachedManifest(pluginPath);
        return this.successResult(JSON.stringify(manifest, null, 2));
    }
    async handleRunChecks(a) {
        if (!a.plugin_path)
            return this.errorResult('plugin_path is required');
        const ledger = await runChecks({
            pluginPath: a.plugin_path,
            wp: { bin: a.wp_cli || 'wp', root: a.wp_root },
            mode: a.mode === 'full' ? 'full' : 'fast',
            only: a.only,
            freshSiteUrl: a.fresh_site_url,
            artifactsDir: a.artifacts_dir,
        });
        return this.successResult(formatLedger(ledger));
    }
    handleCertify(wpRoot, cliNamespace, check) {
        if (!wpRoot)
            return this.errorResult('wp_root is required');
        if (!cliNamespace)
            return this.errorResult('cli_namespace is required (e.g. "buddynext")');
        const result = runCertify({ wpRoot, cliNamespace, check });
        return this.successResult(formatCertify(result));
    }
    handleAudit(wpRoot, pluginPath, oraclesPath) {
        if (!wpRoot)
            return this.errorResult('wp_root is required');
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = runEngine({ wpRoot, pluginPath, oraclesPath });
        return this.successResult(formatEngine(result));
    }
    async handleCheckApi(pluginPath, siteUrl) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        if (!siteUrl)
            return this.errorResult('site_url is required');
        const manifest = this.getCachedManifest(pluginPath);
        const result = await checkApi(manifest, siteUrl);
        return this.formatCheckerResult(result);
    }
    async handleCheckDatabase(pluginPath, siteUrl) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        if (!siteUrl)
            return this.errorResult('site_url is required');
        const manifest = this.getCachedManifest(pluginPath);
        const result = await checkDatabase(manifest, siteUrl);
        return this.formatCheckerResult(result);
    }
    handleCheckBrowser(pluginPath, siteUrl, mode) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        if (!siteUrl)
            return this.errorResult('site_url is required');
        const manifest = this.getCachedManifest(pluginPath);
        const exportDir = mode === 'export' ? `${pluginPath}/../playwright/generated` : undefined;
        const result = checkBrowser(manifest, siteUrl, { exportDir });
        return this.formatCheckerResult(result);
    }
    handleCheckUx(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkUx(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleCheckTemplates(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkTemplates(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleCheckTemplateContract(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkTemplateContracts(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleCheckCssContract(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkCssContract(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleReadiness(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = scanPlugin(pluginPath);
        const sc = assessReadiness(pluginPath, manifest);
        return this.successResult(formatReadiness(sc, manifest.header?.name ?? 'plugin'));
    }
    handleReadinessPortfolio(root, paths) {
        const list = Array.isArray(paths) && paths.length ? paths : (root ? discoverPlugins(root) : []);
        if (!list.length)
            return this.errorResult('Provide plugins_root (a directory to scan) or plugin_paths (an explicit list).');
        return this.successResult(formatPortfolio(assessReadinessPortfolio(list)));
    }
    handleCheckWiringCompleteness(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkWiringCompleteness(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleCheckUxGuidelines(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkUxGuidelines(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleCheckPluginDevRules(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkPluginDevRules(pluginPath);
        return this.formatCheckerResult(result);
    }
    /**
     * Manifest-driven QA coverage gate. Reads audit/manifest.json + test source,
     * writes audit/qa-coverage.json, returns a CheckerResult that fails when
     * uncovered_total regressed (or any uncovered with strict=true).
     */
    handleCheckQaCoverage(pluginPath, strict, dryRun) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkQaCoverage(pluginPath, { strict, dryRun });
        return this.formatCheckerResult(result);
    }
    handleCheckVisualRegression(pluginPath, siteUrl, autologinParam, adminUrls) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkVisualRegression({
            pluginPath,
            siteUrl,
            autologinParam,
            adminUrls,
        });
        return this.formatCheckerResult(result);
    }
    handleCheckEnumConsistency(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkEnumConsistency(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleCheckRestJsContract(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkRestJsContract(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleCheckScale(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkScale(this.getCachedManifest(pluginPath));
        return this.formatCheckerResult(result);
    }
    handleCheckEditorLayoutBias(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = checkEditorLayoutBias(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleCheckA11y(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        // Static WCAG analysis only. The former "a11y-grep" merge lived in
        // code-quality-checker (now owned by the wpcs MCP) and was removed.
        const result = checkAccessibility(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleEvaluateProduct(pluginPath, focus) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = this.getCachedManifest(pluginPath);
        const results = [];
        const area = focus || 'all';
        if (area === 'all' || area === 'admin')
            results.push(evaluateAdmin(manifest, pluginPath));
        if (area === 'all' || area === 'frontend')
            results.push(evaluateFrontend(manifest, pluginPath));
        // Marketing/strategy evaluation moved to the product-strategy skill.
        // Merge all results
        const allIssues = results.flatMap(r => r.issues);
        let msg = `PRODUCT EVALUATION (${area.toUpperCase()})\n${'='.repeat(50)}\n\n`;
        for (const r of results) {
            const errors = r.issues.filter(i => i.type === 'error').length;
            const warnings = r.issues.filter(i => i.type === 'warning').length;
            msg += `${r.category.toUpperCase()}: ${errors} errors, ${warnings} warnings [${r.duration}ms]\n`;
        }
        msg += `\nTotal: ${allIssues.filter(i => i.type === 'error').length} errors, ${allIssues.filter(i => i.type === 'warning').length} warnings\n\n`;
        for (const issue of allIssues.slice(0, 30)) {
            msg += `[${issue.type}] ${issue.title}\n`;
            if (issue.file)
                msg += `  ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
            if (issue.fix)
                msg += `  Fix: ${issue.fix}\n`;
            msg += '\n';
        }
        if (allIssues.length > 30)
            msg += `... and ${allIssues.length - 30} more\n`;
        return this.successResult(msg);
    }
    async handleAuditPlugin(pluginPath, siteUrl, format) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        // Step 1: Scan plugin
        const manifest = this.getCachedManifest(pluginPath);
        // Ownership boundary: static code standards (php-lint, PHPCompatibility,
        // WPCS/phpcs, PHPStan) are owned by the wpcs MCP, and market/strategy
        // analysis (gaps, category expectations, competitors) by the
        // product-strategy skill. Neither is run here — this audit covers runtime
        // product quality, cross-layer systemic misalignment, and live-site behaviour.
        const STANDARDS_NOTE = 'Standards (php-lint, PHPCompatibility, WPCS/phpcs, PHPStan) are covered by the wpcs MCP. ' +
            'Market/strategy analysis (gaps, category expectations, competitors) is covered by the product-strategy skill. ' +
            'Neither is run by this audit.';
        // Step 2: Product evaluation checks
        const productResults = [];
        productResults.push(checkUx(pluginPath));
        productResults.push(checkTemplates(pluginPath));
        productResults.push(checkAccessibility(pluginPath));
        productResults.push(evaluateAdmin(manifest, pluginPath));
        productResults.push(evaluateFrontend(manifest, pluginPath));
        // Step 3: Systemic misalignment checks
        // These are the cross-layer gates that catch the bugs WPCS/PHPStan miss —
        // half-wired settings, enum drift between PHP/JS, REST envelope mismatches,
        // editor sidebar cram, missing focus rings, qa coverage gaps. Each one
        // dispatches a real implementation that grep/AST-scans the plugin tree;
        // none require a live site.
        const systemicResults = [];
        systemicResults.push(checkWiringCompleteness(pluginPath));
        systemicResults.push(checkEnumConsistency(pluginPath));
        systemicResults.push(checkRestJsContract(pluginPath));
        // A class or custom property the markup names and no stylesheet defines is
        // resolved to nothing and carried on with, so it reaches customers as "the
        // theme decided" - a button with no rule, a token pinned to its light
        // literal in dark mode. Invisible to WPCS, PHPStan and every linter.
        systemicResults.push(checkCssContract(pluginPath));
        systemicResults.push(checkEditorLayoutBias(pluginPath));
        systemicResults.push(checkUxGuidelines(pluginPath));
        systemicResults.push(checkPluginDevRules(pluginPath));
        systemicResults.push(checkQaCoverage(pluginPath));
        // Step 4: Live site checks (only if site_url provided)
        if (siteUrl) {
            productResults.push(await checkApi(manifest, siteUrl));
            productResults.push(await checkDatabase(manifest, siteUrl));
            productResults.push(checkBrowser(manifest, siteUrl));
            systemicResults.push(checkVisualRegression({ pluginPath, siteUrl }));
        }
        // Step 5: Build unified report over product + systemic (+ live) results
        const allResults = [...productResults, ...systemicResults];
        const qaReport = buildReport(manifest.header.name || manifest.header.slug, manifest.header.version, allResults);
        // Step 6: Format output
        if (format === 'json') {
            return this.successResult(JSON.stringify({
                standardsNote: STANDARDS_NOTE,
                grade: qaReport.grade,
                score: qaReport.score,
                summary: qaReport.summary,
                productQuality: productResults,
                systemicMisalignment: systemicResults,
            }, null, 2));
        }
        if (format === 'sarif' || format === 'junit') {
            // Export the product + systemic QaReport. SARIF targets GitHub Code
            // Scanning and VS Code's SARIF viewer; JUnit targets CI consumption.
            return this.successResult(format === 'sarif' ? exportSarif(qaReport) : exportJunit(qaReport));
        }
        let output = `FULL PLUGIN AUDIT\n${'='.repeat(60)}\n\n`;
        output += `${STANDARDS_NOTE}\n\n`;
        const renderGroup = (title, results) => {
            let s = `${title} (${results.length} checks)\n${'-'.repeat(40)}\n`;
            for (const r of results) {
                const errors = r.issues.filter(i => i.type === 'error').length;
                const warnings = r.issues.filter(i => i.type === 'warning').length;
                const infos = r.issues.filter(i => i.type === 'info').length;
                const status = infos > 0 && errors === 0 && warnings === 0 ? 'SKIP' : errors === 0 ? 'PASS' : 'FAIL';
                s += `  ${r.category.toUpperCase().padEnd(20)} ${status.padEnd(6)} ${errors} errors, ${warnings} warnings\n`;
            }
            const totErr = results.reduce((acc, r) => acc + r.issues.filter(i => i.type === 'error').length, 0);
            const totWarn = results.reduce((acc, r) => acc + r.issues.filter(i => i.type === 'warning').length, 0);
            s += `  ${'─'.repeat(40)}\n  TOTAL: ${totErr} errors, ${totWarn} warnings\n\n`;
            return s;
        };
        output += renderGroup('PRODUCT QUALITY', productResults);
        output += renderGroup('SYSTEMIC MISALIGNMENT', systemicResults);
        return this.successResult(output);
    }
    // ─── Role / Data / Plan Handlers ────────────────────────────
    async handleProbeRoles(pluginPath, siteUrl, roles) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        if (!siteUrl)
            return this.errorResult('site_url is required');
        const report = await probeRoleMatrix({ pluginPath, siteUrl, roles });
        return this.successResult(JSON.stringify(report, null, 2));
    }
    handleCrossReferenceData(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        // Pass the cached manifest so crossReferenceData does not re-scan
        // the plugin tree (it accepts a `scanManifestCache` param that was
        // previously dead code because no caller supplied it).
        const report = crossReferenceData({
            pluginPath,
            scanManifestCache: this.getCachedManifest(pluginPath),
        });
        return this.successResult(JSON.stringify(report, null, 2));
    }
    async handleBootstrapPlan(pluginPath, overwrite) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const report = await bootstrapPlan({ pluginPath, overwrite: overwrite === true });
        return this.successResult(JSON.stringify(report, null, 2));
    }
    async handleLearnFromBasecamp(args) {
        const pluginPath = args.plugin_path;
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const fetchedColumns = args.fetched_columns;
        if (!fetchedColumns || typeof fetchedColumns !== 'object' || Array.isArray(fetchedColumns)) {
            return this.errorResult('fetched_columns is required (Record<column_name, CompactCard[]>). Call basecamp_list_card_ids per column first.');
        }
        try {
            const result = await learnFromBasecamp({
                pluginPath,
                fetchedColumns,
                fetchedFullCards: args.fetched_full_cards,
                fetchedComments: args.fetched_comments,
                projectId: typeof args.project_id === 'string' ? args.project_id : undefined,
                projectUrl: typeof args.project_url === 'string' ? args.project_url : undefined,
                forceFull: typeof args.force_full === 'boolean' ? args.force_full : undefined,
                writeLedger: typeof args.write_ledger === 'boolean' ? args.write_ledger : undefined,
            });
            return this.successResult(JSON.stringify(result, null, 2));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return this.errorResult(`wppqa_learn_from_basecamp: ${msg}`);
        }
    }
    formatCheckerResult(result) {
        let message = `${result.category.toUpperCase()} CHECK\n${'='.repeat(50)}\n\n`;
        message += `Passed: ${result.passed} | Failed: ${result.failed} | Skipped: ${result.skipped} | Duration: ${result.duration}ms\n\n`;
        if (result.issues.length === 0) {
            message += `No issues found.\n`;
            return this.successResult(message);
        }
        const errors = result.issues.filter(i => i.type === 'error');
        const warnings = result.issues.filter(i => i.type === 'warning');
        const infos = result.issues.filter(i => i.type === 'info');
        if (errors.length > 0) {
            message += `ERRORS (${errors.length})\n${'-'.repeat(40)}\n`;
            for (const issue of errors) {
                message += `[${issue.severity}] ${issue.title}\n`;
                message += `  ${issue.message}\n`;
                if (issue.file)
                    message += `  File: ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
                if (issue.fix)
                    message += `  Fix: ${issue.fix}\n`;
                message += '\n';
            }
        }
        if (warnings.length > 0) {
            message += `WARNINGS (${warnings.length})\n${'-'.repeat(40)}\n`;
            for (const issue of warnings) {
                message += `[${issue.severity}] ${issue.title}\n`;
                message += `  ${issue.message}\n`;
                if (issue.file)
                    message += `  File: ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
                if (issue.fix)
                    message += `  Fix: ${issue.fix}\n`;
                message += '\n';
            }
        }
        if (infos.length > 0) {
            message += `INFO (${infos.length})\n${'-'.repeat(40)}\n`;
            for (const issue of infos) {
                message += `[${issue.severity}] ${issue.title}\n`;
                message += `  ${issue.message}\n`;
                if (issue.file)
                    message += `  File: ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
                message += '\n';
            }
        }
        message += `\n${'='.repeat(50)}\n`;
        message += `JSON: ${JSON.stringify(result)}\n`;
        return {
            content: [{ type: 'text', text: message }],
            isError: errors.length > 0,
        };
    }
    successResult(message) {
        return {
            content: [{ type: 'text', text: message }],
        };
    }
    errorResult(message) {
        return {
            content: [{ type: 'text', text: `Error: ${message}` }],
            isError: true,
        };
    }
    /* ─── Journey audit handlers ───────────────────────────── */
    handleAuditInitJourneys(pluginPath, force, starterOnly) {
        const result = initJourneys({
            plugin_path: pluginPath,
            force: force ?? false,
            starter_only: starterOnly ?? false,
        });
        const lines = [];
        lines.push(result.created
            ? `Created journeys.json at ${result.path} (source: ${result.source}${typeof result.surfaces_discovered === 'number'
                ? `, ${result.surfaces_discovered} surfaces`
                : ''}).`
            : `journeys.json already exists at ${result.path} (source: ${result.source}).`);
        lines.push('');
        lines.push(result.preview);
        lines.push('');
        lines.push(`JSON: ${JSON.stringify(result)}`);
        return this.successResult(lines.join('\n'));
    }
    handleAuditCoverageCheck(pluginPath) {
        const result = auditCoverageCheck({ plugin_path: pluginPath });
        const lines = [];
        lines.push(`Coverage: ${result.covered}/${result.total_manifest_surfaces} (${result.coverage_percent}%)`);
        lines.push('');
        if (result.missing.length === 0) {
            lines.push('Every surface in the plugin manifest is referenced in journeys.json. 100% coverage.');
        }
        else {
            lines.push(`Missing ${result.missing.length} surfaces:`);
            lines.push('');
            for (const m of result.missing) {
                lines.push(`- **${m.surface_kind}** \`${m.identifier}\` - ${m.suggestion}`);
            }
        }
        lines.push('');
        lines.push(`JSON: ${JSON.stringify(result)}`);
        return this.successResult(lines.join('\n'));
    }
    handleAuditGetBriefing(pluginPath, siteUrl, outputDir) {
        const result = getAuditBriefing({
            plugin_path: pluginPath,
            site_url: siteUrl,
            output_dir: outputDir,
        });
        const lines = [];
        lines.push(`Product: ${result.product_name}`);
        lines.push(`Generated ${result.briefings.length} per-journey briefing prompts.`);
        lines.push('');
        lines.push('Dispatch each prompt to a parallel Sonnet sub-agent (Claude Agent tool with model: "sonnet"). Each sub-agent writes its findings to the output_path. After all complete, call wppqa_audit_consolidate_matrix with the list of output_paths.');
        lines.push('');
        for (const b of result.briefings) {
            lines.push(`### ${b.journey_name} (\`${b.journey_id}\`)`);
            lines.push(`Output: \`${b.output_path}\``);
            lines.push('');
            lines.push('Prompt:');
            lines.push('```');
            lines.push(b.prompt);
            lines.push('```');
            lines.push('');
        }
        lines.push(result.consolidate_hint);
        lines.push('');
        lines.push(`JSON: ${JSON.stringify(result)}`);
        return this.successResult(lines.join('\n'));
    }
    handleAuditConsolidateMatrix(pluginPath, reportPaths, outputPath) {
        const result = consolidateAuditMatrix({
            plugin_path: pluginPath,
            report_paths: reportPaths,
            output_path: outputPath,
        });
        const lines = [];
        lines.push(`Consolidated matrix written to ${result.output_path}`);
        lines.push('');
        lines.push(`Severity totals: 🔴 ${result.totals.red} | 🟡 ${result.totals.yellow} | 🟢 ${result.totals.green} | ⚪ ${result.totals.skipped} (out of ${result.totals.total} surfaces)`);
        lines.push('');
        if (result.reds.length > 0) {
            lines.push('Reds:');
            for (const r of result.reds) {
                lines.push(`- ${r}`);
            }
        }
        else {
            lines.push('No 🔴 findings: plugin matches customer expectation across every audited journey.');
        }
        lines.push('');
        lines.push(`JSON: ${JSON.stringify(result)}`);
        return this.successResult(lines.join('\n'));
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('WP Plugin QA MCP Server v3.2.0 running on stdio');
    }
}
//# sourceMappingURL=server.js.map