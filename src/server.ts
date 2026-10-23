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
import { checkCssContract } from './css-contract-checker.js';
import { assessReadiness, formatReadiness, discoverPlugins, assessReadinessPortfolio, formatPortfolio } from './readiness-checklist.js';
import { checkAccessibility } from './a11y-checker.js';
import { evaluateAdmin } from './admin-evaluator.js';
import { evaluateFrontend } from './frontend-evaluator.js';
import { buildReport, exportSarif, exportJunit } from './report-builder.js';
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
        version: '3.2.0',
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
          case 'wppqa_check_css_contract':
            return this.handleCheckCssContract(toolArgs.plugin_path as string);
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

          case 'wppqa_run_checks':
            return this.handleRunChecks(toolArgs);

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

  private async handleRunChecks(a: Record<string, unknown>): Promise<CallToolResult> {
    if (!a.plugin_path) return this.errorResult('plugin_path is required');
    const ledger = await runChecks({
      pluginPath: a.plugin_path as string,
      wp: { bin: (a.wp_cli as string) || 'wp', root: a.wp_root as string | undefined },
      mode: a.mode === 'full' ? 'full' : 'fast',
      only: a.only as string[] | undefined,
      freshSiteUrl: a.fresh_site_url as string | undefined,
      artifactsDir: a.artifacts_dir as string | undefined,
    });
    return this.successResult(formatLedger(ledger));
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

  private handleCheckCssContract(pluginPath: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const result = checkCssContract(pluginPath);
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
    // Static WCAG analysis only. The former "a11y-grep" merge lived in
    // code-quality-checker (now owned by the wpcs MCP) and was removed.
    const result = checkAccessibility(pluginPath);
    return this.formatCheckerResult(result);
  }

  private handleEvaluateProduct(pluginPath: string, focus?: string): CallToolResult {
    if (!pluginPath) return this.errorResult('plugin_path is required');
    const manifest = this.getCachedManifest(pluginPath);
    const results: CheckerResult[] = [];
    const area = focus || 'all';

    if (area === 'all' || area === 'admin') results.push(evaluateAdmin(manifest, pluginPath));
    if (area === 'all' || area === 'frontend') results.push(evaluateFrontend(manifest, pluginPath));
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
      if (issue.file) msg += `  ${issue.file}${issue.line > 0 ? ':' + issue.line : ''}\n`;
      if (issue.fix) msg += `  Fix: ${issue.fix}\n`;
      msg += '\n';
    }
    if (allIssues.length > 30) msg += `... and ${allIssues.length - 30} more\n`;

    return this.successResult(msg);
  }

  private async handleAuditPlugin(pluginPath: string, siteUrl?: string, format?: string): Promise<CallToolResult> {
    if (!pluginPath) return this.errorResult('plugin_path is required');

    // Step 1: Scan plugin
    const manifest = this.getCachedManifest(pluginPath);

    // Ownership boundary: static code standards (php-lint, PHPCompatibility,
    // WPCS/phpcs, PHPStan) are owned by the wpcs MCP, and market/strategy
    // analysis (gaps, category expectations, competitors) by the
    // product-strategy skill. Neither is run here — this audit covers runtime
    // product quality, cross-layer systemic misalignment, and live-site behaviour.
    const STANDARDS_NOTE =
      'Standards (php-lint, PHPCompatibility, WPCS/phpcs, PHPStan) are covered by the wpcs MCP. ' +
      'Market/strategy analysis (gaps, category expectations, competitors) is covered by the product-strategy skill. ' +
      'Neither is run by this audit.';

    // Step 2: Product evaluation checks
    const productResults: CheckerResult[] = [];
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
    const systemicResults: CheckerResult[] = [];
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
    const qaReport = buildReport(
      manifest.header.name || manifest.header.slug,
      manifest.header.version,
      allResults,
    );

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
      return this.successResult(
        format === 'sarif' ? exportSarif(qaReport) : exportJunit(qaReport),
      );
    }

    let output = `FULL PLUGIN AUDIT\n${'='.repeat(60)}\n\n`;
    output += `${STANDARDS_NOTE}\n\n`;

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

    output += renderGroup('PRODUCT QUALITY', productResults);
    output += renderGroup('SYSTEMIC MISALIGNMENT', systemicResults);

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
    console.error('WP Plugin QA MCP Server v3.2.0 running on stdio');
  }
}
