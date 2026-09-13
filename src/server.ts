/**
 * WP Plugin QA MCP Server - Main Server
 * 31 tools across 5 groups: discovery (scan), code-quality (delegates to phpcs/
 * phpstan/eslint/etc.), product-eval (admin/frontend/marketing/ux/templates/a11y),
 * systemic-misalignment (wiring, enum, rest-js contract, editor-layout-bias,
 * ux-guidelines, plugin-dev-rules, qa-coverage, visual-regression), and
 * audit-workflows (one-shot audit_plugin + parallel journey-audit subsystem).
 * Note: live-site checkers (api, db, browser, role-probe, visual-regression)
 * degrade gracefully when site_url is missing.
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
import { checkTemplateContracts } from './template-contract-checker.js';
import { assessReadiness, formatReadiness, discoverPlugins, assessReadinessPortfolio, formatPortfolio } from './readiness-checklist.js';
import { checkAccessibility } from './a11y-checker.js';
import { evaluateAdmin } from './admin-evaluator.js';
import { evaluateFrontend } from './frontend-evaluator.js';
import { evaluateMarketing } from './marketing-evaluator.js';
import { buildReport, exportSarif, exportJunit, buildAuditReport, formatAuditReport } from './report-builder.js';
import { analyzeCompetitors, formatCompetitiveReport } from './competitive-analyzer.js';
import { analyzeGaps, formatGapAnalysis } from './gap-analyzer.js';
import { analyzeExpectations, formatCategoryAnalysis } from './category-expectations.js';
import { scaffoldQualityConfigs } from './quality-scaffolder.js';
import { runAllCodeChecks, runSingleCheck } from './code-quality-checker.js';
import { runCertify, formatCertify, runEngine, formatEngine } from './cert-runner.js';
import { probeRoleMatrix } from './role-matrix-prober.js';
import type { RoleProfile } from './role-matrix-prober.js';
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
import {
  initJourneys,
  getBriefing as getAuditBriefing,
  consolidateMatrix as consolidateAuditMatrix,
  coverageCheck as auditCoverageCheck,
} from './journey-audit.js';
import type { PluginManifest, CheckerResult } from './types.js';
import { resetIdCounter } from './shared-utils.js';

export class WpPluginQaServer {
  private server: Server;

  /**
   * Per-request manifest cache. Cleared at the start of every tool
   * call so a single tool run can reuse one scan across helpers without
   * leaking stale data into the next call. This eliminates the double-
   * scan when init_journeys + coverage_check (or any pair of tools)
   * are called back-to-back on the same plugin.
   */
  private manifestCache = new Map<string, PluginManifest>();

  private getCachedManifest(pluginPath: string): PluginManifest {
    const cached = this.manifestCache.get(pluginPath);
    if (cached) {
      return cached;
    }
    const fresh = scanPlugin(pluginPath);
    this.manifestCache.set(pluginPath, fresh);
    return fresh;
  }

  constructor() {
    this.server = new Server(
      {
        name: 'wp-plugin-qa-mcp-server',
        version: '3.1.0',
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
      this.manifestCache.clear();

      try {
        switch (name) {
          // 1. Discovery
          case 'wppqa_scan_plugin':
            return this.handleScanPlugin(toolArgs.plugin_path as string);

          // 2-4. Code Quality
          case 'wppqa_setup_quality':
            return this.handleSetupQuality(toolArgs.plugin_path as string, toolArgs.site_url as string | undefined);
          case 'wppqa_run_code_checks':
            return this.handleRunCodeChecks(toolArgs.plugin_path as string);
          case 'wppqa_check_code_quality':
            return this.handleCheckCodeQuality(toolArgs.plugin_path as string, toolArgs.check as string);

          // 5. Accessibility
          case 'wppqa_check_a11y':
            return this.handleCheckA11y(toolArgs.plugin_path as string);

          // 6. Product Evaluation (merged admin+frontend+marketing)
          case 'wppqa_evaluate_product':
            return this.handleEvaluateProduct(toolArgs.plugin_path as string, toolArgs.focus as string | undefined);

          // 7-8. Static checks
          case 'wppqa_check_ux':
            return this.handleCheckUx(toolArgs.plugin_path as string);
          case 'wppqa_check_templates':
            return this.handleCheckTemplates(toolArgs.plugin_path as string);
          case 'wppqa_check_template_contract':
            return this.handleCheckTemplateContract(toolArgs.plugin_path as string);
          case 'wppqa_readiness':
            return this.handleReadiness(toolArgs.plugin_path as string);
          case 'wppqa_readiness_portfolio':
            return this.handleReadinessPortfolio(toolArgs.plugins_root as string | undefined, toolArgs.plugin_paths as string[] | undefined);

          // 9-11. Live site checks
          case 'wppqa_check_api':
            return await this.handleCheckApi(toolArgs.plugin_path as string, toolArgs.site_url as string);
          case 'wppqa_check_database':
            return await this.handleCheckDatabase(toolArgs.plugin_path as string, toolArgs.site_url as string);
          case 'wppqa_check_browser':
            return this.handleCheckBrowser(toolArgs.plugin_path as string, toolArgs.site_url as string, toolArgs.mode as string | undefined);

          // 12. Market Analysis (merged gaps + competitive)
          case 'wppqa_analyze_market':
            return await this.handleAnalyzeMarket(toolArgs.plugin_path as string, toolArgs.search_keywords as string | undefined);

          // 13. Role-matrix prober
          case 'wppqa_probe_roles':
            return await this.handleProbeRoles(
              toolArgs.plugin_path as string,
              toolArgs.site_url as string,
              toolArgs.roles as RoleProfile[] | undefined,
            );

          // 14. Write↔Read data cross-reference
          case 'wppqa_cross_reference_data':
            return this.handleCrossReferenceData(toolArgs.plugin_path as string);

          // 15. Plan bootstrap
          case 'wppqa_bootstrap_plan':
            return await this.handleBootstrapPlan(
              toolArgs.plugin_path as string,
              toolArgs.overwrite as boolean | undefined,
            );

          // 16. Basecamp ledger
          case 'wppqa_learn_from_basecamp':
            return await this.handleLearnFromBasecamp(toolArgs);

          // 17-18. Systemic Misalignment Checks (from Learnomy v1.3.0 lessons)
          case 'wppqa_check_wiring_completeness':
            return this.handleCheckWiringCompleteness(toolArgs.plugin_path as string);
          case 'wppqa_check_ux_guidelines':
            return this.handleCheckUxGuidelines(toolArgs.plugin_path as string);
          case 'wppqa_check_plugin_dev_rules':
            return this.handleCheckPluginDevRules(toolArgs.plugin_path as string);
          case 'wppqa_security_quality_audit':
            return this.handleSecurityQualityAudit(
              toolArgs.plugin_path as string,
              toolArgs.severity as string | undefined,
              toolArgs.strict as boolean | undefined,
            );
          case 'wppqa_check_qa_coverage':
            return this.handleCheckQaCoverage(
              toolArgs.plugin_path as string,
              toolArgs.strict as boolean | undefined,
              toolArgs.dry_run as boolean | undefined,
            );
          case 'wppqa_check_visual_regression':
            return this.handleCheckVisualRegression(
              toolArgs.plugin_path as string,
              toolArgs.site_url as string | undefined,
              toolArgs.autologin_param as string | undefined,
              toolArgs.admin_urls as string[] | undefined,
            );
          case 'wppqa_check_enum_consistency':
            return this.handleCheckEnumConsistency(toolArgs.plugin_path as string);
          case 'wppqa_check_rest_js_contract':
            return this.handleCheckRestJsContract(toolArgs.plugin_path as string);
          case 'wppqa_check_editor_layout_bias':
            return this.handleCheckEditorLayoutBias(toolArgs.plugin_path as string);
          case 'wppqa_check_scale':
            return this.handleCheckScale(toolArgs.plugin_path as string);

          // 20. Full Audit (master tool)
          case 'wppqa_audit_plugin':
            return await this.handleAuditPlugin(toolArgs.plugin_path as string, toolArgs.site_url as string | undefined, toolArgs.format as string | undefined);

          // 21-24. Journey-by-journey customer-experience audit
          case 'wppqa_audit_init_journeys':
            return this.handleAuditInitJourneys(
              toolArgs.plugin_path as string,
              toolArgs.force as boolean | undefined,
              toolArgs.starter_only as boolean | undefined,
            );
          case 'wppqa_audit_coverage_check':
            return this.handleAuditCoverageCheck(
              toolArgs.plugin_path as string,
            );
          case 'wppqa_audit_get_briefing':
            return this.handleAuditGetBriefing(
              toolArgs.plugin_path as string,
              toolArgs.site_url as string | undefined,
              toolArgs.output_dir as string | undefined,
            );
          case 'wppqa_audit_consolidate_matrix':
            return this.handleAuditConsolidateMatrix(
              toolArgs.plugin_path as string,
              toolArgs.report_paths as string[],
              toolArgs.output_path as string,
            );

          case 'wppqa_certify':
            return this.handleCertify(
              toolArgs.wp_root as string,
              toolArgs.cli_namespace as string,
              toolArgs.check as string | undefined,
            );

          case 'wppqa_audit':
            return this.handleAudit(
              toolArgs.wp_root as string,
              toolArgs.plugin_path as string,
              toolArgs.oracles_path as string | undefined,
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
    const manifest = this.getCachedManifest(pluginPath);
    return this.successResult(JSON.stringify(manifest, null, 2));
  }

  private handleCertify(wpRoot: string, cliNamespace: string, check?: string): CallToolResult {
    if (!wpRoot) return this.errorResult('wp_root is required');
    if (!cliNamespace) return this.errorResult('cli_namespace is required (e.g. "buddynext")');
    const result = runCertify({ wpRoot, cliNamespace, check });
    return this.successResult(formatCertify(result));
  }

  private handleAudit(wpRoot: string, pluginPath: string, oraclesPath?: string): CallToolResult {
    if (!wpRoot) return this.errorResult('wp_root is required');
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = runEngine({ wpRoot, pluginPath, oraclesPath });
    return this.successResult(formatEngine(result));
  }

  private async handleCheckApi(pluginPath: string, siteUrl: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    if (!siteUrl) return this.errorResult('site_url is required');
    const manifest = this.getCachedManifest(pluginPath);
    const result = await checkApi(manifest, siteUrl);
    return this.formatCheckerResult(result);
  }

  private async handleCheckDatabase(pluginPath: string, siteUrl: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    if (!siteUrl) return this.errorResult('site_url is required');
    const manifest = this.getCachedManifest(pluginPath);
    const result = await checkDatabase(manifest, siteUrl);
    return this.formatCheckerResult(result);
  }

  private handleCheckBrowser(pluginPath: string, siteUrl: string, mode?: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    if (!siteUrl) return this.errorResult('site_url is required');
    const manifest = this.getCachedManifest(pluginPath);
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

  private handleCheckTemplateContract(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkTemplateContracts(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleReadiness(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = scanPlugin(pluginPath);
    const sc = assessReadiness(pluginPath, manifest);
    return this.successResult(formatReadiness(sc, manifest.header?.name ?? 'plugin'));
  }

  private handleReadinessPortfolio(root: string | undefined, paths: string[] | undefined): CallToolResult {
    const list = Array.isArray(paths) && paths.length ? paths : (root ? discoverPlugins(root) : []);
    if (!list.length) return this.errorResult('Provide plugins_root (a directory to scan) or plugin_paths (an explicit list).');
    return this.successResult(formatPortfolio(assessReadinessPortfolio(list)));
  }

  private handleCheckWiringCompleteness(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkWiringCompleteness(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleCheckUxGuidelines(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkUxGuidelines(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleCheckPluginDevRules(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkPluginDevRules(pluginPath);
    return this.formatCheckerResult(result);
  }

  /**
   * Manifest-driven QA coverage gate. Reads audit/manifest.json + test source,
   * writes audit/qa-coverage.json, returns a CheckerResult that fails when
   * uncovered_total regressed (or any uncovered with strict=true).
   */
  private handleCheckQaCoverage(
    pluginPath: string,
    strict?: boolean,
    dryRun?: boolean,
  ): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkQaCoverage(pluginPath, { strict, dryRun });
    return this.formatCheckerResult(result);
  }

  /**
   * Focused security + code quality audit. Composes the high-signal trust-list
   * checks (plugin_dev_rules + plugin-check + composer-audit) and optionally
   * phpcs + phpstan. Filters out noisy heuristics like rest_js_contract and
   * wiring_completeness. Returns a concise report keyed on severity.
   */
  private handleSecurityQualityAudit(
    pluginPath: string,
    severity?: string,
    strict?: boolean,
  ): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');

    const sevFloor = severity === 'all' ? 'low' : severity === 'medium' ? 'medium' : 'high';
    const sevRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const minRank = sevRank[sevFloor] ?? 3;

    // Run the trust-list subset.
    const results: CheckerResult[] = [];
    results.push(checkPluginDevRules(pluginPath));
    results.push(runSingleCheck(pluginPath, 'plugin-check'));
    results.push(runSingleCheck(pluginPath, 'composer-audit'));
    if (strict) {
      results.push(runSingleCheck(pluginPath, 'phpcs'));
      results.push(runSingleCheck(pluginPath, 'phpstan'));
    }

    // Apply severity floor and tally.
    let totalErrors = 0;
    let totalWarnings = 0;
    const filtered = results.map((r) => {
      const issues = r.issues.filter((i) => {
        // Always keep errors regardless of severity floor — they're actionable.
        if (i.type === 'error') {
          totalErrors++;
          return true;
        }
        const rank = sevRank[i.severity] ?? 0;
        if (rank >= minRank) {
          if (i.type === 'warning') totalWarnings++;
          return true;
        }
        return false;
      });
      return { ...r, issues };
    });

    // Render concise output.
    let output = `SECURITY + CODE QUALITY AUDIT\n${'='.repeat(60)}\n\n`;
    output += `Severity floor: ${sevFloor}${strict ? ' (strict: phpcs + phpstan included)' : ''}\n`;
    output += `Total: ${totalErrors} error${totalErrors === 1 ? '' : 's'}, ${totalWarnings} warning${totalWarnings === 1 ? '' : 's'} above floor\n\n`;

    for (const r of filtered) {
      const errCount = r.issues.filter((i) => i.type === 'error').length;
      const warnCount = r.issues.filter((i) => i.type === 'warning').length;
      const status = errCount === 0 && warnCount === 0 ? 'PASS' : errCount > 0 ? 'FAIL' : 'WARN';
      output += `[${status}] ${r.category.toUpperCase().padEnd(20)} ${errCount} errors, ${warnCount} warnings\n`;
    }

    output += '\n';

    for (const r of filtered) {
      if (r.issues.length === 0) continue;
      output += `${r.category.toUpperCase()} (${r.issues.length})\n${'-'.repeat(40)}\n`;
      for (const issue of r.issues) {
        output += `[${issue.type}/${issue.severity}] ${issue.title}\n`;
        output += `  ${issue.message}\n`;
        if (issue.file) output += `  File: ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
        if (issue.fix) output += `  Fix: ${issue.fix}\n`;
        output += '\n';
      }
    }

    // Verdict line — release-readiness check.
    const verdict = totalErrors === 0
      ? totalWarnings === 0
        ? '✅ CLEAN — no findings above severity floor'
        : `⚠ ${totalWarnings} warning${totalWarnings === 1 ? '' : 's'} above floor — review before shipping`
      : `❌ ${totalErrors} error${totalErrors === 1 ? '' : 's'} — release blocked`;
    output += `${'='.repeat(60)}\n${verdict}\n`;

    return this.successResult(output);
  }

  private handleCheckVisualRegression(
    pluginPath: string,
    siteUrl?: string,
    autologinParam?: string,
    adminUrls?: string[],
  ): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkVisualRegression({
      pluginPath,
      siteUrl,
      autologinParam,
      adminUrls,
    });
    return this.formatCheckerResult(result);
  }

  private handleCheckEnumConsistency(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkEnumConsistency(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleCheckRestJsContract(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkRestJsContract(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleCheckScale(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkScale(this.getCachedManifest(pluginPath));
    return this.formatCheckerResult(result);
  }

  private handleCheckEditorLayoutBias(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkEditorLayoutBias(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleCheckA11y(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    // Run both static a11y analysis AND grep-based checks
    const staticResult = checkAccessibility(pluginPath);
    const grepResult = runSingleCheck(pluginPath, 'a11y-grep');

    // Merge issues from both
    const mergedIssues = [...staticResult.issues, ...grepResult.issues];
    const mergedResult: CheckerResult = {
      category: 'a11y',
      issues: mergedIssues,
      passed: staticResult.passed + grepResult.passed,
      failed: staticResult.failed + grepResult.failed,
      skipped: staticResult.skipped + grepResult.skipped,
      duration: staticResult.duration + grepResult.duration,
    };
    return this.formatCheckerResult(mergedResult);
  }

  private handleEvaluateProduct(pluginPath: string, focus?: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = this.getCachedManifest(pluginPath);
    const results: CheckerResult[] = [];
    const area = focus || 'all';

    if (area === 'all' || area === 'admin') results.push(evaluateAdmin(manifest, pluginPath));
    if (area === 'all' || area === 'frontend') results.push(evaluateFrontend(manifest, pluginPath));
    if (area === 'all' || area === 'marketing') results.push(evaluateMarketing(manifest, pluginPath));

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
      if (issue.file) msg += `  ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
      if (issue.fix) msg += `  Fix: ${issue.fix}\n`;
      msg += '\n';
    }
    if (allIssues.length > 30) msg += `... and ${allIssues.length - 30} more\n`;

    return this.successResult(msg);
  }

  private async handleAnalyzeMarket(pluginPath: string, searchKeywords?: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = this.getCachedManifest(pluginPath);

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
    } catch {
      output += '\n\nCompetitive analysis: skipped (network error or no results)';
    }

    return this.successResult(output);
  }

  private async handleAuditPlugin(pluginPath: string, siteUrl?: string, format?: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');

    // Step 1: Scan plugin
    const manifest = this.getCachedManifest(pluginPath);

    // Step 2: Code quality checks (14 checks)
    const codeResults = runAllCodeChecks(pluginPath);

    // Step 3: Product evaluation checks
    const productResults: CheckerResult[] = [];
    productResults.push(checkUx(pluginPath));
    productResults.push(checkTemplates(pluginPath));
    productResults.push(checkAccessibility(pluginPath));
    productResults.push(evaluateAdmin(manifest, pluginPath));
    productResults.push(evaluateFrontend(manifest, pluginPath));
    productResults.push(evaluateMarketing(manifest, pluginPath));

    // Step 3.5: Systemic misalignment checks
    // These are the cross-layer gates that catch the bugs WPCS/PHPStan miss —
    // half-wired settings, enum drift between PHP/JS, REST envelope mismatches,
    // editor sidebar cram, missing focus rings, qa coverage gaps. Each one
    // dispatches a real implementation that grep/AST-scans the plugin tree;
    // none require a live site.
    const systemicResults: CheckerResult[] = [];
    systemicResults.push(checkWiringCompleteness(pluginPath));
    systemicResults.push(checkEnumConsistency(pluginPath));
    systemicResults.push(checkRestJsContract(pluginPath));
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

    // Step 5: Gap analysis
    const gapResult = analyzeGaps(manifest);
    const categoryResult = analyzeExpectations(manifest);

    // Step 6: Build unified report
    const allResults = [...codeResults, ...productResults, ...systemicResults];
    const qaReport = buildReport(
      manifest.header.name || manifest.header.slug,
      manifest.header.version,
      allResults,
    );
    const auditReport = buildAuditReport(gapResult, qaReport);

    // Step 7: Format output
    if (format === 'json') {
      // Compact by default: the full per-issue `code` snippets + double-emitted
      // codeResults made this ~600KB and blew caller token limits. Emit counts +
      // top-N for the code checks; keep the newer product/systemic summaries.
      const slimChecks = codeResults.map((r: any) => ({
        category: r.category, passed: r.passed, failed: r.failed, skipped: r.skipped,
        errors: r.issues.filter((i: any) => i.type === 'error').length,
        warnings: r.issues.filter((i: any) => i.type === 'warning').length,
        topIssues: r.issues.filter((i: any) => i.type === 'error').slice(0, 5)
          .map(({ id, severity, title, file, line, fix }: any) => ({ id, severity, title, file, line, fix })),
      }));
      const cq: any = auditReport.codeQuality;
      const slimAudit: any = {
        ...auditReport,
        codeQuality: cq && { grade: cq.grade, score: cq.score, summary: cq.summary, categories: cq.categories, bugs: (cq.bugs || []).slice(0, 20) },
        gapAnalysis: ((auditReport as any).gapAnalysis || []).slice(0, 30),
      };
      return this.successResult(JSON.stringify({
        audit: slimAudit,
        customerExpectations: categoryResult,
        codeQuality: slimChecks,
        productQuality: productResults,
        systemicMisalignment: systemicResults,
      }, null, 2));
    }
    if (format === 'sarif' || format === 'junit') {
      // Build a QaReport over every code-quality issue, then export it
      // in the requested format. SARIF targets GitHub Code Scanning and
      // VS Code's SARIF viewer; JUnit targets CI consumption.
      const qaReport = buildReport(
        manifest.header.name,
        manifest.header.version,
        codeResults,
      );
      return this.successResult(
        format === 'sarif' ? exportSarif(qaReport) : exportJunit(qaReport),
      );
    }

    let output = `FULL PLUGIN AUDIT\n${'='.repeat(60)}\n\n`;

    const renderGroup = (title: string, results: CheckerResult[]): string => {
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

    output += renderGroup('CODE QUALITY', codeResults);
    output += renderGroup('PRODUCT QUALITY', productResults);
    output += renderGroup('SYSTEMIC MISALIGNMENT', systemicResults);

    // Audit report + category analysis
    output += formatAuditReport(auditReport);
    output += '\n\n' + formatCategoryAnalysis(categoryResult);

    return this.successResult(output);
  }

  // ─── Role / Data / Plan Handlers ────────────────────────────

  private async handleProbeRoles(
    pluginPath: string,
    siteUrl: string,
    roles?: RoleProfile[],
  ): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    if (!siteUrl) return this.errorResult('site_url is required');
    const report = await probeRoleMatrix({ pluginPath, siteUrl, roles });
    return this.successResult(JSON.stringify(report, null, 2));
  }

  private handleCrossReferenceData(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    // Pass the cached manifest so crossReferenceData does not re-scan
    // the plugin tree (it accepts a `scanManifestCache` param that was
    // previously dead code because no caller supplied it).
    const report = crossReferenceData({
      pluginPath,
      scanManifestCache: this.getCachedManifest(pluginPath),
    });
    return this.successResult(JSON.stringify(report, null, 2));
  }

  private async handleBootstrapPlan(
    pluginPath: string,
    overwrite?: boolean,
  ): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const report = await bootstrapPlan({ pluginPath, overwrite: overwrite === true });
    return this.successResult(JSON.stringify(report, null, 2));
  }

  private async handleLearnFromBasecamp(args: Record<string, unknown>): Promise<CallToolResult> {
    const pluginPath = args.plugin_path as string | undefined;
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const fetchedColumns = args.fetched_columns as
      | Record<string, import('./basecamp-learner.js').CompactCard[]>
      | undefined;
    if (!fetchedColumns || typeof fetchedColumns !== 'object' || Array.isArray(fetchedColumns)) {
      return this.errorResult(
        'fetched_columns is required (Record<column_name, CompactCard[]>). Call basecamp_list_card_ids per column first.',
      );
    }
    try {
      const result = await learnFromBasecamp({
        pluginPath,
        fetchedColumns,
        fetchedFullCards: args.fetched_full_cards as
          | Record<string, import('./basecamp-learner.js').FetchedCard>
          | undefined,
        fetchedComments: args.fetched_comments as
          | Record<string, import('./basecamp-learner.js').FetchedComment[]>
          | undefined,
        projectId: typeof args.project_id === 'string' ? (args.project_id as string) : undefined,
        projectUrl: typeof args.project_url === 'string' ? (args.project_url as string) : undefined,
        forceFull: typeof args.force_full === 'boolean' ? (args.force_full as boolean) : undefined,
        writeLedger: typeof args.write_ledger === 'boolean' ? (args.write_ledger as boolean) : undefined,
      });
      return this.successResult(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.errorResult(`wppqa_learn_from_basecamp: ${msg}`);
    }
  }

  // ─── Code Quality Handlers ──────────────────────────────────

  private handleSetupQuality(pluginPath: string, siteUrl?: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');

    const result = scaffoldQualityConfigs(pluginPath, siteUrl);

    let msg = `QUALITY CONFIG SETUP\n${'='.repeat(50)}\n\n`;

    if (result.created.length > 0) {
      msg += `CREATED (${result.created.length}):\n`;
      for (const f of result.created) msg += `  + ${f}\n`;
      msg += '\n';
    }

    if (result.updated.length > 0) {
      msg += `UPDATED (${result.updated.length}):\n`;
      for (const f of result.updated) msg += `  ~ ${f}\n`;
      msg += '\n';
    }

    if (result.skipped.length > 0) {
      msg += `SKIPPED (already exist) (${result.skipped.length}):\n`;
      for (const f of result.skipped) msg += `  - ${f}\n`;
      msg += '\n';
    }

    if (result.errors.length > 0) {
      msg += `ERRORS (${result.errors.length}):\n`;
      for (const f of result.errors) msg += `  ! ${f}\n`;
      msg += '\n';
    }

    msg += `\nNext steps:\n`;
    msg += `  1. composer install     (install phpstan)\n`;
    msg += `  2. npm install --include=dev  (install stylelint if in package.json)\n`;
    msg += `  3. Run: wppqa_run_code_checks to see all issues\n`;

    return this.successResult(msg);
  }

  private handleRunCodeChecks(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');

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
      if (infos > 0 && r.skipped > 0) msg += ` (${r.issues[0]?.message || ''})`;
      msg += ` [${r.duration}ms]\n`;
    }

    msg += `${'-'.repeat(40)}\n`;
    msg += `  TOTAL: ${totalErrors} errors, ${totalWarnings} warnings\n\n`;

    // Detailed issues per tool
    for (const r of results) {
      const issues = r.issues.filter(i => i.type !== 'info');
      if (issues.length === 0) continue;

      msg += `\n${r.category.toUpperCase()} DETAILS (${issues.length} issues)\n${'-'.repeat(40)}\n`;
      for (const issue of issues.slice(0, 20)) {
        msg += `  [${issue.type}] ${issue.file}:${issue.line} — ${issue.title}\n`;
        if (issue.code) msg += `    Code: ${issue.code}\n`;
      }
      if (issues.length > 20) {
        msg += `  ... and ${issues.length - 20} more\n`;
      }
    }

    msg += `\n${'='.repeat(50)}\n`;

    return {
      content: [{ type: 'text', text: msg } as TextContent],
      isError: totalErrors > 0,
    };
  }

  private handleCheckCodeQuality(pluginPath: string, check: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    if (!check) {
      return this.errorResult(
        'check is required (one of: phpcs, phpstan, eslint, stylelint, phpcompat, a11y-grep, php-lint, composer-audit, i18n, plugin-check, bundle-size, security-scan, performance-scan, pcp-deep)',
      );
    }

    // Keep this list in lockstep with CodeCheckType in code-quality-checker.ts
    // and the `check` enum in tools.ts. The previous version was stale and
    // rejected 8 of the 14 advertised checks.
    const validChecks = [
      'phpcs',
      'phpstan',
      'eslint',
      'stylelint',
      'phpcompat',
      'a11y-grep',
      'php-lint',
      'composer-audit',
      'i18n',
      'plugin-check',
      'bundle-size',
      'security-scan',
      'performance-scan',
      'pcp-deep',
    ] as const;
    if (!validChecks.includes(check as (typeof validChecks)[number])) {
      return this.errorResult(
        `Invalid check: ${check}. Must be one of: ${validChecks.join(', ')}`,
      );
    }

    const result = runSingleCheck(pluginPath, check as (typeof validChecks)[number]);
    return this.formatCheckerResult(result);
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

  /* ─── Journey audit handlers ───────────────────────────── */

  private handleAuditInitJourneys(
    pluginPath: string,
    force: boolean | undefined,
    starterOnly: boolean | undefined,
  ): CallToolResult {
    const result = initJourneys({
      plugin_path: pluginPath,
      force: force ?? false,
      starter_only: starterOnly ?? false,
    });
    const lines: string[] = [];
    lines.push(
      result.created
        ? `Created journeys.json at ${result.path} (source: ${result.source}${
            typeof result.surfaces_discovered === 'number'
              ? `, ${result.surfaces_discovered} surfaces`
              : ''
          }).`
        : `journeys.json already exists at ${result.path} (source: ${result.source}).`,
    );
    lines.push('');
    lines.push(result.preview);
    lines.push('');
    lines.push(`JSON: ${JSON.stringify(result)}`);
    return this.successResult(lines.join('\n'));
  }

  private handleAuditCoverageCheck(pluginPath: string): CallToolResult {
    const result = auditCoverageCheck({ plugin_path: pluginPath });
    const lines: string[] = [];
    lines.push(
      `Coverage: ${result.covered}/${result.total_manifest_surfaces} (${result.coverage_percent}%)`,
    );
    lines.push('');
    if (result.missing.length === 0) {
      lines.push(
        'Every surface in the plugin manifest is referenced in journeys.json. 100% coverage.',
      );
    } else {
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

  private handleAuditGetBriefing(
    pluginPath: string,
    siteUrl: string | undefined,
    outputDir: string | undefined,
  ): CallToolResult {
    const result = getAuditBriefing({
      plugin_path: pluginPath,
      site_url: siteUrl,
      output_dir: outputDir,
    });
    const lines: string[] = [];
    lines.push(`Product: ${result.product_name}`);
    lines.push(
      `Generated ${result.briefings.length} per-journey briefing prompts.`,
    );
    lines.push('');
    lines.push(
      'Dispatch each prompt to a parallel Sonnet sub-agent (Claude Agent tool with model: "sonnet"). Each sub-agent writes its findings to the output_path. After all complete, call wppqa_audit_consolidate_matrix with the list of output_paths.',
    );
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

  private handleAuditConsolidateMatrix(
    pluginPath: string,
    reportPaths: string[],
    outputPath: string,
  ): CallToolResult {
    const result = consolidateAuditMatrix({
      plugin_path: pluginPath,
      report_paths: reportPaths,
      output_path: outputPath,
    });
    const lines: string[] = [];
    lines.push(`Consolidated matrix written to ${result.output_path}`);
    lines.push('');
    lines.push(
      `Severity totals: 🔴 ${result.totals.red} | 🟡 ${result.totals.yellow} | 🟢 ${result.totals.green} | ⚪ ${result.totals.skipped} (out of ${result.totals.total} surfaces)`,
    );
    lines.push('');
    if (result.reds.length > 0) {
      lines.push('Reds:');
      for (const r of result.reds) {
        lines.push(`- ${r}`);
      }
    } else {
      lines.push(
        'No 🔴 findings: plugin matches customer expectation across every audited journey.',
      );
    }
    lines.push('');
    lines.push(`JSON: ${JSON.stringify(result)}`);
    return this.successResult(lines.join('\n'));
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('WP Plugin QA MCP Server v3.1.0 running on stdio');
  }
}
