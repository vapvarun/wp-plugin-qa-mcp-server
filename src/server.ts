/**
 * WP Plugin QA MCP Server - Main Server (v1.0.0)
 * 15 tools for comprehensive WordPress plugin quality assurance.
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
import { generateTestPlan } from './plan-generator.js';
import { checkStatic } from './static-checker.js';
import { checkApi } from './api-checker.js';
import { checkDatabase } from './db-checker.js';
import { checkBrowser } from './browser-runner.js';
import { checkUx } from './ux-checker.js';
import { checkTemplates } from './template-checker.js';
import { checkCompat } from './compat-checker.js';
import { checkI18n } from './i18n-checker.js';
import { checkPerformance } from './perf-checker.js';
import { buildReport, formatReport } from './report-builder.js';
import type { PluginManifest, CheckerResult } from './types.js';

export class WpPluginQaServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'wp-plugin-qa-mcp-server',
        version: '1.0.0',
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

      try {
        switch (name) {
          case 'wppqa_scan_plugin':
            return this.handleScanPlugin(toolArgs.plugin_path as string);

          case 'wppqa_generate_plan':
            return this.handleGeneratePlan(toolArgs.manifest as string);

          case 'wppqa_run_full_scan':
            return this.handleFullScan(toolArgs.plugin_path as string);

          case 'wppqa_check_static':
            return this.handleCheckStatic(toolArgs.plugin_path as string);

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

          case 'wppqa_check_compat':
            return this.handleCheckCompat(toolArgs.plugin_path as string);

          case 'wppqa_check_i18n':
            return this.handleCheckI18n(toolArgs.plugin_path as string);

          case 'wppqa_check_performance':
            return this.handleCheckPerformance(toolArgs.plugin_path as string);

          case 'wppqa_execute_item':
            return this.handleExecuteItem(
              toolArgs.test_item as string,
              toolArgs.plugin_path as string,
              toolArgs.site_url as string | undefined,
            );

          case 'wppqa_generate_report':
            return this.handleGenerateReport(
              toolArgs.plugin_path as string,
              toolArgs.results as string,
            );

          case 'wppqa_run_automated_qa':
            return await this.handleAutomatedQa(
              toolArgs.plugin_path as string,
              toolArgs.site_url as string | undefined,
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

  private handleGeneratePlan(manifestJson: string): CallToolResult {
    if (!manifestJson) return this.errorResult('manifest JSON is required');
    try {
      const manifest: PluginManifest = JSON.parse(manifestJson);
      const plan = generateTestPlan(manifest);
      return this.successResult(JSON.stringify(plan, null, 2));
    } catch (e) {
      return this.errorResult(`Invalid manifest JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private handleFullScan(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = scanPlugin(pluginPath);
    const plan = generateTestPlan(manifest);
    return this.successResult(JSON.stringify({ manifest, plan }, null, 2));
  }

  private handleCheckStatic(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkStatic(pluginPath);
    return this.formatCheckerResult(result);
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

  private handleCheckCompat(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkCompat(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleCheckI18n(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkI18n(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleCheckPerformance(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkPerformance(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleExecuteItem(testItemJson: string, pluginPath: string, siteUrl?: string): CallToolResult {
    if (!testItemJson) return this.errorResult('test_item is required');
    if (!pluginPath) return this.errorResult('plugin_path is required');

    try {
      const item = JSON.parse(testItemJson);

      if (!item.automated) {
        let message = `MANUAL TEST: ${item.title}\n\n`;
        message += `Category: ${item.category}\n`;
        message += `Priority: ${item.priority}\n\n`;
        if (item.steps) {
          message += 'Steps:\n';
          item.steps.forEach((step: string, i: number) => {
            message += `  ${i + 1}. ${step}\n`;
          });
        }
        if (item.expected) {
          message += `\nExpected: ${item.expected}\n`;
        }
        return this.successResult(message);
      }

      return this.successResult(`Test item "${item.title}" queued. Use the appropriate checker tool for automated execution.`);
    } catch (e) {
      return this.errorResult(`Invalid test_item JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private handleGenerateReport(pluginPath: string, resultsJson: string): CallToolResult {
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
      return this.successResult(formatReport(report));
    } catch (e) {
      return this.errorResult(`Invalid results JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async handleAutomatedQa(pluginPath: string, siteUrl?: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');

    const manifest = scanPlugin(pluginPath);
    const plan = generateTestPlan(manifest);
    const allResults: CheckerResult[] = [];

    // Group A: Static checks (always run)
    allResults.push(checkStatic(pluginPath));
    allResults.push(checkTemplates(pluginPath));
    allResults.push(checkI18n(pluginPath));
    allResults.push(checkCompat(pluginPath));
    allResults.push(checkUx(pluginPath));
    allResults.push(checkPerformance(pluginPath));

    // Group B: Live site checks (only if site_url provided)
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
    output += `\n\n## Test Plan Summary\n`;
    output += `Total planned tests: ${plan.totalItems}\n`;
    output += `Automated checks executed: ${allResults.length}\n`;

    const manualItems = plan.items.filter(i => !i.automated);
    if (manualItems.length > 0) {
      output += `\n## Manual Tests Remaining (${manualItems.length})\n`;
      for (const item of manualItems.slice(0, 20)) {
        output += `- [${item.priority}] ${item.title}\n`;
      }
      if (manualItems.length > 20) {
        output += `  ... and ${manualItems.length - 20} more\n`;
      }
    }

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

    // Return JSON result appended for machine consumption
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
    console.error('WP Plugin QA MCP Server v1.0.0 running on stdio');
  }
}
