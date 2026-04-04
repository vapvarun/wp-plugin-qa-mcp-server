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
import { buildReport, formatReport, exportJson, exportSarif, exportJunit, buildAuditReport, formatAuditReport } from './report-builder.js';
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
                    case 'wppqa_scan_plugin':
                        return this.handleScanPlugin(toolArgs.plugin_path);
                    case 'wppqa_check_api':
                        return await this.handleCheckApi(toolArgs.plugin_path, toolArgs.site_url);
                    case 'wppqa_check_database':
                        return await this.handleCheckDatabase(toolArgs.plugin_path, toolArgs.site_url);
                    case 'wppqa_check_browser':
                        return this.handleCheckBrowser(toolArgs.plugin_path, toolArgs.site_url, toolArgs.mode);
                    case 'wppqa_check_ux':
                        return this.handleCheckUx(toolArgs.plugin_path);
                    case 'wppqa_check_templates':
                        return this.handleCheckTemplates(toolArgs.plugin_path);
                    case 'wppqa_check_a11y':
                        return this.handleCheckA11y(toolArgs.plugin_path);
                    case 'wppqa_evaluate_admin':
                        return this.handleEvaluateAdmin(toolArgs.plugin_path);
                    case 'wppqa_evaluate_frontend':
                        return this.handleEvaluateFrontend(toolArgs.plugin_path);
                    case 'wppqa_evaluate_marketing':
                        return this.handleEvaluateMarketing(toolArgs.plugin_path);
                    case 'wppqa_analyze_gaps':
                        return this.handleAnalyzeGaps(toolArgs.plugin_path);
                    case 'wppqa_competitive_analysis':
                        return await this.handleCompetitiveAnalysis(toolArgs.plugin_path, toolArgs.search_keywords, toolArgs.max_competitors);
                    case 'wppqa_generate_report':
                        return this.handleGenerateReport(toolArgs.plugin_path, toolArgs.results, toolArgs.format);
                    case 'wppqa_run_automated_qa':
                        return await this.handleAutomatedQa(toolArgs.plugin_path, toolArgs.site_url);
                    case 'wppqa_audit_plugin':
                        return await this.handleAuditPlugin(toolArgs.plugin_path, toolArgs.site_url, toolArgs.format);
                    // ─── Code Quality Tools ───────────────────────────────
                    case 'wppqa_setup_quality':
                        return this.handleSetupQuality(toolArgs.plugin_path, toolArgs.site_url);
                    case 'wppqa_run_code_checks':
                        return this.handleRunCodeChecks(toolArgs.plugin_path);
                    case 'wppqa_check_code_quality':
                        return this.handleCheckCodeQuality(toolArgs.plugin_path, toolArgs.check);
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
        const result = checkAccessibility(pluginPath);
        return this.formatCheckerResult(result);
    }
    handleEvaluateAdmin(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = scanPlugin(pluginPath);
        const result = evaluateAdmin(manifest, pluginPath);
        return this.formatCheckerResult(result);
    }
    handleEvaluateFrontend(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = scanPlugin(pluginPath);
        const result = evaluateFrontend(manifest, pluginPath);
        return this.formatCheckerResult(result);
    }
    handleEvaluateMarketing(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = scanPlugin(pluginPath);
        const result = evaluateMarketing(manifest, pluginPath);
        return this.formatCheckerResult(result);
    }
    handleAnalyzeGaps(pluginPath) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = scanPlugin(pluginPath);
        const gapResult = analyzeGaps(manifest);
        let output = formatGapAnalysis(gapResult);
        const categoryResult = analyzeExpectations(manifest);
        output += '\n\n' + formatCategoryAnalysis(categoryResult);
        output += `\n${'='.repeat(50)}\nJSON: ${JSON.stringify({ technicalGaps: gapResult, customerExpectations: categoryResult })}\n`;
        return this.successResult(output);
    }
    async handleCompetitiveAnalysis(pluginPath, searchKeywords, maxCompetitors) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const limit = Math.min(Math.max(maxCompetitors || 10, 3), 15);
        const report = await analyzeCompetitors(pluginPath, searchKeywords, limit);
        const markdown = formatCompetitiveReport(report);
        let output = markdown;
        output += `\n${'='.repeat(60)}\nJSON: ${JSON.stringify(report)}\n`;
        return this.successResult(output);
    }
    handleGenerateReport(pluginPath, resultsJson, format) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        if (!resultsJson)
            return this.errorResult('results JSON is required');
        try {
            const results = JSON.parse(resultsJson);
            const manifest = scanPlugin(pluginPath);
            const report = buildReport(manifest.header.name || manifest.header.slug, manifest.header.version, results);
            switch (format) {
                case 'json':
                    return this.successResult(exportJson(report));
                case 'sarif':
                    return this.successResult(exportSarif(report));
                case 'junit':
                    return this.successResult(exportJunit(report));
                case 'markdown':
                default:
                    return this.successResult(formatReport(report));
            }
        }
        catch (e) {
            return this.errorResult(`Invalid results JSON: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    async handleAutomatedQa(pluginPath, siteUrl) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        const manifest = scanPlugin(pluginPath);
        const allResults = [];
        // Product quality checks (always run)
        allResults.push(checkUx(pluginPath));
        allResults.push(checkTemplates(pluginPath));
        allResults.push(checkAccessibility(pluginPath));
        allResults.push(evaluateAdmin(manifest, pluginPath));
        allResults.push(evaluateFrontend(manifest, pluginPath));
        allResults.push(evaluateMarketing(manifest, pluginPath));
        // Live site checks (only if site_url provided)
        if (siteUrl) {
            allResults.push(await checkApi(manifest, siteUrl));
            allResults.push(await checkDatabase(manifest, siteUrl));
            allResults.push(checkBrowser(manifest, siteUrl));
        }
        const report = buildReport(manifest.header.name || manifest.header.slug, manifest.header.version, allResults);
        let output = formatReport(report);
        output += `\n\n## Product Evaluation Summary\n`;
        output += `Automated checks executed: ${allResults.length}\n`;
        output += `Categories: UX, Templates, A11y, Admin Eval, Frontend Eval, Marketing`;
        if (siteUrl)
            output += `, API, Database, Browser`;
        output += '\n';
        return this.successResult(output);
    }
    async handleAuditPlugin(pluginPath, siteUrl, format) {
        if (!pluginPath)
            return this.errorResult('plugin_path is required');
        // Step 1: Scan plugin
        const manifest = scanPlugin(pluginPath);
        // Step 2: Gap analysis
        const gapResult = analyzeGaps(manifest);
        // Step 3: Run all product evaluation checks
        const allResults = [];
        allResults.push(checkUx(pluginPath));
        allResults.push(checkTemplates(pluginPath));
        allResults.push(checkAccessibility(pluginPath));
        allResults.push(evaluateAdmin(manifest, pluginPath));
        allResults.push(evaluateFrontend(manifest, pluginPath));
        allResults.push(evaluateMarketing(manifest, pluginPath));
        // Live site checks
        if (siteUrl) {
            allResults.push(await checkApi(manifest, siteUrl));
            allResults.push(await checkDatabase(manifest, siteUrl));
            allResults.push(checkBrowser(manifest, siteUrl));
        }
        // Step 4: Build QA report
        const qaReport = buildReport(manifest.header.name || manifest.header.slug, manifest.header.version, allResults);
        // Step 5: Customer expectation analysis
        const categoryResult = analyzeExpectations(manifest);
        // Step 6: Build unified audit report
        const auditReport = buildAuditReport(gapResult, qaReport);
        // Step 7: Format output
        if (format === 'json') {
            return this.successResult(JSON.stringify({ audit: auditReport, customerExpectations: categoryResult }, null, 2));
        }
        let output = formatAuditReport(auditReport);
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