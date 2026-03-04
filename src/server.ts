/**
 * WP Plugin QA MCP Server - Main Server (v2.1.0)
 * 15 tools focused on product evaluation.
 * Code quality checks are handled by WPCS MCP + Plugin Check PCP.
 * Note: No shell commands used. All checks are static analysis or HTTP-based.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolResult,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';
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
import type { PluginManifest, CheckerResult } from './types.js';
import { resetIdCounter } from './shared-utils.js';

export class WpPluginQaServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'wp-plugin-qa-mcp-server',
        version: '2.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const toolArgs = (args || {}) as Record<string, unknown>;

      resetIdCounter();

      try {
        switch (name) {
          case 'wppqa_scan_plugin':
            return this.handleScanPlugin(toolArgs.plugin_path as string);

          case 'wppqa_check_api':
            return await this.handleCheckApi(
              toolArgs.plugin_path as string,
              toolArgs.site_url as string,
            );

          case 'wppqa_check_database':
            return await this.handleCheckDatabase(
              toolArgs.plugin_path as string,
              toolArgs.site_url as string,
            );

          case 'wppqa_check_browser':
            return this.handleCheckBrowser(
              toolArgs.plugin_path as string,
              toolArgs.site_url as string,
              toolArgs.mode as string | undefined,
            );

          case 'wppqa_check_ux':
            return this.handleCheckUx(toolArgs.plugin_path as string);

          case 'wppqa_check_templates':
            return this.handleCheckTemplates(toolArgs.plugin_path as string);

          case 'wppqa_check_a11y':
            return this.handleCheckA11y(toolArgs.plugin_path as string);

          case 'wppqa_evaluate_admin':
            return this.handleEvaluateAdmin(toolArgs.plugin_path as string);

          case 'wppqa_evaluate_frontend':
            return this.handleEvaluateFrontend(toolArgs.plugin_path as string);

          case 'wppqa_evaluate_marketing':
            return this.handleEvaluateMarketing(toolArgs.plugin_path as string);

          case 'wppqa_analyze_gaps':
            return this.handleAnalyzeGaps(toolArgs.plugin_path as string);

          case 'wppqa_competitive_analysis':
            return await this.handleCompetitiveAnalysis(
              toolArgs.plugin_path as string,
              toolArgs.search_keywords as string | undefined,
              toolArgs.max_competitors as number | undefined,
            );

          case 'wppqa_generate_report':
            return this.handleGenerateReport(
              toolArgs.plugin_path as string,
              toolArgs.results as string,
              toolArgs.format as string | undefined,
            );

          case 'wppqa_run_automated_qa':
            return await this.handleAutomatedQa(
              toolArgs.plugin_path as string,
              toolArgs.site_url as string | undefined,
            );

          case 'wppqa_audit_plugin':
            return await this.handleAuditPlugin(
              toolArgs.plugin_path as string,
              toolArgs.site_url as string | undefined,
              toolArgs.format as string | undefined,
            );

          default:
            return this.errorResult(`Unknown tool: ${name}`);
        }
      } catch (error: unknown) {
        const err = error as { message?: string };
        return this.errorResult(`Tool failed: ${err.message || 'Unknown error'}`);
      }
    });
  }

  private handleScanPlugin(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = scanPlugin(pluginPath);
    return this.successResult(JSON.stringify(manifest, null, 2));
  }

  private async handleCheckApi(pluginPath: string, siteUrl: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    if (!siteUrl) return this.errorResult('site_url is required');
    const manifest = scanPlugin(pluginPath);
    const result = await checkApi(manifest, siteUrl);
    return this.formatCheckerResult(result);
  }

  private async handleCheckDatabase(pluginPath: string, siteUrl: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    if (!siteUrl) return this.errorResult('site_url is required');
    const manifest = scanPlugin(pluginPath);
    const result = await checkDatabase(manifest, siteUrl);
    return this.formatCheckerResult(result);
  }

  private handleCheckBrowser(pluginPath: string, siteUrl: string, mode?: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    if (!siteUrl) return this.errorResult('site_url is required');
    const manifest = scanPlugin(pluginPath);
    const exportDir = mode === 'export' ? `${pluginPath}/../playwright/generated` : undefined;
    const result = checkBrowser(manifest, siteUrl, { exportDir });
    return this.formatCheckerResult(result);
  }

  private handleCheckUx(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkUx(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleCheckTemplates(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkTemplates(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleCheckA11y(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkAccessibility(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleEvaluateAdmin(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = scanPlugin(pluginPath);
    const result = evaluateAdmin(manifest, pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleEvaluateFrontend(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = scanPlugin(pluginPath);
    const result = evaluateFrontend(manifest, pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleEvaluateMarketing(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = scanPlugin(pluginPath);
    const result = evaluateMarketing(manifest, pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleAnalyzeGaps(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = scanPlugin(pluginPath);

    const gapResult = analyzeGaps(manifest);
    let output = formatGapAnalysis(gapResult);

    const categoryResult = analyzeExpectations(manifest);
    output += '\n\n' + formatCategoryAnalysis(categoryResult);

    output += `\n${'='.repeat(50)}\nJSON: ${JSON.stringify({ technicalGaps: gapResult, customerExpectations: categoryResult })}\n`;
    return this.successResult(output);
  }

  private async handleCompetitiveAnalysis(
    pluginPath: string, searchKeywords?: string, maxCompetitors?: number,
  ): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const limit = Math.min(Math.max(maxCompetitors || 10, 3), 15);
    const report = await analyzeCompetitors(pluginPath, searchKeywords, limit);
    const markdown = formatCompetitiveReport(report);
    let output = markdown;
    output += `\n${'='.repeat(60)}\nJSON: ${JSON.stringify(report)}\n`;
    return this.successResult(output);
  }

  private handleGenerateReport(pluginPath: string, resultsJson: string, format?: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    if (!resultsJson) return this.errorResult('results JSON is required');

    try {
      const results: CheckerResult[] = JSON.parse(resultsJson);
      const manifest = scanPlugin(pluginPath);
      const report = buildReport(
        manifest.header.name || manifest.header.slug,
        manifest.header.version,
        results,
      );

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
    } catch (e) {
      return this.errorResult(`Invalid results JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async handleAutomatedQa(pluginPath: string, siteUrl?: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');

    const manifest = scanPlugin(pluginPath);
    const allResults: CheckerResult[] = [];

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

    const report = buildReport(
      manifest.header.name || manifest.header.slug,
      manifest.header.version,
      allResults,
    );

    let output = formatReport(report);
    output += `\n\n## Product Evaluation Summary\n`;
    output += `Automated checks executed: ${allResults.length}\n`;
    output += `Categories: UX, Templates, A11y, Admin Eval, Frontend Eval, Marketing`;
    if (siteUrl) output += `, API, Database, Browser`;
    output += '\n';

    return this.successResult(output);
  }

  private async handleAuditPlugin(pluginPath: string, siteUrl?: string, format?: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');

    // Step 1: Scan plugin
    const manifest = scanPlugin(pluginPath);

    // Step 2: Gap analysis
    const gapResult = analyzeGaps(manifest);

    // Step 3: Run all product evaluation checks
    const allResults: CheckerResult[] = [];
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
    const qaReport = buildReport(
      manifest.header.name || manifest.header.slug,
      manifest.header.version,
      allResults,
    );

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

  private formatCheckerResult(result: CheckerResult): CallToolResult {
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
        if (issue.file) message += `  File: ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
        if (issue.fix) message += `  Fix: ${issue.fix}\n`;
        message += '\n';
      }
    }

    if (warnings.length > 0) {
      message += `WARNINGS (${warnings.length})\n${'-'.repeat(40)}\n`;
      for (const issue of warnings) {
        message += `[${issue.severity}] ${issue.title}\n`;
        message += `  ${issue.message}\n`;
        if (issue.file) message += `  File: ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
        if (issue.fix) message += `  Fix: ${issue.fix}\n`;
        message += '\n';
      }
    }

    if (infos.length > 0) {
      message += `INFO (${infos.length})\n${'-'.repeat(40)}\n`;
      for (const issue of infos) {
        message += `[${issue.severity}] ${issue.title}\n`;
        message += `  ${issue.message}\n`;
        if (issue.file) message += `  File: ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
        message += '\n';
      }
    }

    message += `\n${'='.repeat(50)}\n`;
    message += `JSON: ${JSON.stringify(result)}\n`;

    return {
      content: [{ type: 'text', text: message } as TextContent],
      isError: errors.length > 0,
    };
  }

  private successResult(message: string): CallToolResult {
    return {
      content: [{ type: 'text', text: message } as TextContent],
    };
  }

  private errorResult(message: string): CallToolResult {
    return {
      content: [{ type: 'text', text: `Error: ${message}` } as TextContent],
      isError: true,
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('WP Plugin QA MCP Server v2.1.0 running on stdio');
  }
}
