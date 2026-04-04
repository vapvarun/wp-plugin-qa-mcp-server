/**
 * WP Plugin QA MCP Server - Main Server (v2.1.0)
 * 15 tools focused on product evaluation.
 * Code quality checks are handled by WPCS MCP + Plugin Check PCP.
 * Note: No shell commands used. All checks are static analysis or HTTP-based.
 */
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
import { checkAccessibility } from './a11y-checker.js';
import { evaluateAdmin } from './admin-evaluator.js';
import { evaluateFrontend } from './frontend-evaluator.js';
import { evaluateMarketing } from './marketing-evaluator.js';
import { buildReport, buildAuditReport, formatAuditReport } from './report-builder.js';
import { analyzeCompetitors, formatCompetitiveReport } from './competitive-analyzer.js';
import { analyzeGaps, formatGapAnalysis } from './gap-analyzer.js';
import { analyzeExpectations, formatCategoryAnalysis } from './category-expectations.js';
import { scaffoldQualityConfigs } from './quality-scaffolder.js';
import { runAllCodeChecks, runSingleCheck } from './code-quality-checker.js';
import { resetIdCounter } from './shared-utils.js';
export class WpPluginQaServer {
    server;
    constructor() {
        this.server = new Server({
            name: 'wp-plugin-qa-mcp-server',
            version: '2.1.0',
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
            try {
                switch (name) {
                    // 1. Discovery
                    case 'wppqa_scan_plugin':
                        return this.handleScanPlugin(toolArgs.plugin_path);
                    // 2-4. Code Quality
                    case 'wppqa_setup_quality':
                        return this.handleSetupQuality(toolArgs.plugin_path, toolArgs.site_url);
                    case 'wppqa_run_code_checks':
                        return this.handleRunCodeChecks(toolArgs.plugin_path);
                    case 'wppqa_check_code_quality':
                        return this.handleCheckCodeQuality(toolArgs.plugin_path, toolArgs.check);
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
                    // 9-11. Live site checks
                    case 'wppqa_check_api':
                        return await this.handleCheckApi(toolArgs.plugin_path, toolArgs.site_url);
                    case 'wppqa_check_database':
                        return await this.handleCheckDatabase(toolArgs.plugin_path, toolArgs.site_url);
                    case 'wppqa_check_browser':
                        return this.handleCheckBrowser(toolArgs.plugin_path, toolArgs.site_url, toolArgs.mode);
                    // 12. Market Analysis (merged gaps + competitive)
                    case 'wppqa_analyze_market':
                        return await this.handleAnalyzeMarket(toolArgs.plugin_path, toolArgs.search_keywords);
                    // 13. Full Audit (master tool)
                    case 'wppqa_audit_plugin':
                        return await this.handleAuditPlugin(toolArgs.plugin_path, toolArgs.site_url, toolArgs.format);
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
        const manifest = scanPlugin(pluginPath);
        return this.successResult(JSON.stringify(manifest, null, 2));
    }
    async handleCheckApi(pluginPath, siteUrl) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        if (!siteUrl)
            return this.errorResult('site_url is required');
        const manifest = scanPlugin(pluginPath);
        const result = await checkApi(manifest, siteUrl);
        return this.formatCheckerResult(result);
    }
    async handleCheckDatabase(pluginPath, siteUrl) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        if (!siteUrl)
            return this.errorResult('site_url is required');
        const manifest = scanPlugin(pluginPath);
        const result = await checkDatabase(manifest, siteUrl);
        return this.formatCheckerResult(result);
    }
    handleCheckBrowser(pluginPath, siteUrl, mode) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        if (!siteUrl)
            return this.errorResult('site_url is required');
        const manifest = scanPlugin(pluginPath);
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
    handleCheckA11y(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        // Run both static a11y analysis AND grep-based checks
        const staticResult = checkAccessibility(pluginPath);
        const grepResult = runSingleCheck(pluginPath, 'a11y-grep');
        // Merge issues from both
        const mergedIssues = [...staticResult.issues, ...grepResult.issues];
        const mergedResult = {
            category: 'a11y',
            issues: mergedIssues,
            passed: staticResult.passed + grepResult.passed,
            failed: staticResult.failed + grepResult.failed,
            skipped: staticResult.skipped + grepResult.skipped,
            duration: staticResult.duration + grepResult.duration,
        };
        return this.formatCheckerResult(mergedResult);
    }
    handleEvaluateProduct(pluginPath, focus) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = scanPlugin(pluginPath);
        const results = [];
        const area = focus || 'all';
        if (area === 'all' || area === 'admin')
            results.push(evaluateAdmin(manifest, pluginPath));
        if (area === 'all' || area === 'frontend')
            results.push(evaluateFrontend(manifest, pluginPath));
        if (area === 'all' || area === 'marketing')
            results.push(evaluateMarketing(manifest, pluginPath));
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
    async handleAnalyzeMarket(pluginPath, searchKeywords) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = scanPlugin(pluginPath);
        // Gap analysis
        const gapResult = analyzeGaps(manifest);
        let output = formatGapAnalysis(gapResult);
        // Category expectations
        const categoryResult = analyzeExpectations(manifest);
        output += '\n\n' + formatCategoryAnalysis(categoryResult);
        // Competitive analysis
        try {
            const report = await analyzeCompetitors(pluginPath, searchKeywords, 10);
            output += '\n\n' + formatCompetitiveReport(report);
        }
        catch {
            output += '\n\nCompetitive analysis: skipped (network error or no results)';
        }
        return this.successResult(output);
    }
    async handleAuditPlugin(pluginPath, siteUrl, format) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        // Step 1: Scan plugin
        const manifest = scanPlugin(pluginPath);
        // Step 2: Code quality checks (11 checks)
        const codeResults = runAllCodeChecks(pluginPath);
        // Step 3: Product evaluation checks
        const productResults = [];
        productResults.push(checkUx(pluginPath));
        productResults.push(checkTemplates(pluginPath));
        productResults.push(checkAccessibility(pluginPath));
        productResults.push(evaluateAdmin(manifest, pluginPath));
        productResults.push(evaluateFrontend(manifest, pluginPath));
        productResults.push(evaluateMarketing(manifest, pluginPath));
        // Step 4: Live site checks (only if site_url provided)
        if (siteUrl) {
            productResults.push(await checkApi(manifest, siteUrl));
            productResults.push(await checkDatabase(manifest, siteUrl));
            productResults.push(checkBrowser(manifest, siteUrl));
        }
        // Step 5: Gap analysis
        const gapResult = analyzeGaps(manifest);
        const categoryResult = analyzeExpectations(manifest);
        // Step 6: Build unified report
        const allResults = [...codeResults, ...productResults];
        const qaReport = buildReport(manifest.header.name || manifest.header.slug, manifest.header.version, allResults);
        const auditReport = buildAuditReport(gapResult, qaReport);
        // Step 7: Format output
        if (format === 'json') {
            return this.successResult(JSON.stringify({ audit: auditReport, customerExpectations: categoryResult, codeQuality: codeResults }, null, 2));
        }
        let output = `FULL PLUGIN AUDIT\n${'='.repeat(60)}\n\n`;
        // Code quality summary
        output += `CODE QUALITY (11 checks)\n${'-'.repeat(40)}\n`;
        for (const r of codeResults) {
            const errors = r.issues.filter(i => i.type === 'error').length;
            const warnings = r.issues.filter(i => i.type === 'warning').length;
            const infos = r.issues.filter(i => i.type === 'info').length;
            const status = infos > 0 && errors === 0 && warnings === 0 ? 'SKIP' : errors === 0 ? 'PASS' : 'FAIL';
            output += `  ${r.category.toUpperCase().padEnd(16)} ${status.padEnd(6)} ${errors} errors, ${warnings} warnings\n`;
        }
        const codeTotalErr = codeResults.reduce((s, r) => s + r.issues.filter(i => i.type === 'error').length, 0);
        const codeTotalWarn = codeResults.reduce((s, r) => s + r.issues.filter(i => i.type === 'warning').length, 0);
        output += `  ${'─'.repeat(40)}\n  CODE TOTAL: ${codeTotalErr} errors, ${codeTotalWarn} warnings\n\n`;
        // Product quality summary
        output += `PRODUCT QUALITY (${productResults.length} checks)\n${'-'.repeat(40)}\n`;
        for (const r of productResults) {
            const errors = r.issues.filter(i => i.type === 'error').length;
            const warnings = r.issues.filter(i => i.type === 'warning').length;
            output += `  ${r.category.toUpperCase().padEnd(16)} ${errors} errors, ${warnings} warnings\n`;
        }
        output += '\n';
        // Audit report + category analysis
        output += formatAuditReport(auditReport);
        output += '\n\n' + formatCategoryAnalysis(categoryResult);
        return this.successResult(output);
    }
    // ─── Code Quality Handlers ──────────────────────────────────
    handleSetupQuality(pluginPath, siteUrl) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const result = scaffoldQualityConfigs(pluginPath, siteUrl);
        let msg = `QUALITY CONFIG SETUP\n${'='.repeat(50)}\n\n`;
        if (result.created.length > 0) {
            msg += `CREATED (${result.created.length}):\n`;
            for (const f of result.created)
                msg += `  + ${f}\n`;
            msg += '\n';
        }
        if (result.updated.length > 0) {
            msg += `UPDATED (${result.updated.length}):\n`;
            for (const f of result.updated)
                msg += `  ~ ${f}\n`;
            msg += '\n';
        }
        if (result.skipped.length > 0) {
            msg += `SKIPPED (already exist) (${result.skipped.length}):\n`;
            for (const f of result.skipped)
                msg += `  - ${f}\n`;
            msg += '\n';
        }
        if (result.errors.length > 0) {
            msg += `ERRORS (${result.errors.length}):\n`;
            for (const f of result.errors)
                msg += `  ! ${f}\n`;
            msg += '\n';
        }
        msg += `\nNext steps:\n`;
        msg += `  1. composer install     (install phpstan)\n`;
        msg += `  2. npm install --include=dev  (install stylelint if in package.json)\n`;
        msg += `  3. Run: wppqa_run_code_checks to see all issues\n`;
        return this.successResult(msg);
    }
    handleRunCodeChecks(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const results = runAllCodeChecks(pluginPath);
        let msg = `CODE QUALITY REPORT\n${'='.repeat(50)}\n\n`;
        msg += `SUMMARY\n${'-'.repeat(40)}\n`;
        let totalErrors = 0;
        let totalWarnings = 0;
        for (const r of results) {
            const errors = r.issues.filter(i => i.type === 'error').length;
            const warnings = r.issues.filter(i => i.type === 'warning').length;
            const infos = r.issues.filter(i => i.type === 'info').length;
            totalErrors += errors;
            totalWarnings += warnings;
            const status = r.skipped > 0 && r.failed === 0 && infos > 0
                ? 'SKIPPED'
                : errors === 0 ? 'PASS' : 'FAIL';
            msg += `  ${r.category.toUpperCase().padEnd(12)} ${status.padEnd(8)} ${errors} errors, ${warnings} warnings`;
            if (infos > 0 && r.skipped > 0)
                msg += ` (${r.issues[0]?.message || ''})`;
            msg += ` [${r.duration}ms]\n`;
        }
        msg += `${'-'.repeat(40)}\n`;
        msg += `  TOTAL: ${totalErrors} errors, ${totalWarnings} warnings\n\n`;
        // Detailed issues per tool
        for (const r of results) {
            const issues = r.issues.filter(i => i.type !== 'info');
            if (issues.length === 0)
                continue;
            msg += `\n${r.category.toUpperCase()} DETAILS (${issues.length} issues)\n${'-'.repeat(40)}\n`;
            for (const issue of issues.slice(0, 20)) {
                msg += `  [${issue.type}] ${issue.file}:${issue.line} — ${issue.title}\n`;
                if (issue.code)
                    msg += `    Code: ${issue.code}\n`;
            }
            if (issues.length > 20) {
                msg += `  ... and ${issues.length - 20} more\n`;
            }
        }
        msg += `\n${'='.repeat(50)}\n`;
        return {
            content: [{ type: 'text', text: msg }],
            isError: totalErrors > 0,
        };
    }
    handleCheckCodeQuality(pluginPath, check) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        if (!check)
            return this.errorResult('check is required (phpcs, phpstan, eslint, stylelint, phpcompat, a11y-grep)');
        const validChecks = ['phpcs', 'phpstan', 'eslint', 'stylelint', 'phpcompat', 'a11y-grep'];
        if (!validChecks.includes(check)) {
            return this.errorResult(`Invalid check: ${check}. Must be one of: ${validChecks.join(', ')}`);
        }
        const result = runSingleCheck(pluginPath, check);
        return this.formatCheckerResult(result);
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
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('WP Plugin QA MCP Server v2.1.0 running on stdio');
    }
}
//# sourceMappingURL=server.js.map