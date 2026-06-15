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
export declare class WpPluginQaServer {
    private server;
    /**
     * Per-request manifest cache. Cleared at the start of every tool
     * call so a single tool run can reuse one scan across helpers without
     * leaking stale data into the next call. This eliminates the double-
     * scan when init_journeys + coverage_check (or any pair of tools)
     * are called back-to-back on the same plugin.
     */
    private manifestCache;
    private getCachedManifest;
    constructor();
    private setupToolHandlers;
    private handleScanPlugin;
    private handleCertify;
    private handleCheckApi;
    private handleCheckDatabase;
    private handleCheckBrowser;
    private handleCheckUx;
    private handleCheckTemplates;
    private handleCheckTemplateContract;
    private handleCheckWiringCompleteness;
    private handleCheckUxGuidelines;
    private handleCheckPluginDevRules;
    /**
     * Manifest-driven QA coverage gate. Reads audit/manifest.json + test source,
     * writes audit/qa-coverage.json, returns a CheckerResult that fails when
     * uncovered_total regressed (or any uncovered with strict=true).
     */
    private handleCheckQaCoverage;
    /**
     * Focused security + code quality audit. Composes the high-signal trust-list
     * checks (plugin_dev_rules + plugin-check + composer-audit) and optionally
     * phpcs + phpstan. Filters out noisy heuristics like rest_js_contract and
     * wiring_completeness. Returns a concise report keyed on severity.
     */
    private handleSecurityQualityAudit;
    private handleCheckVisualRegression;
    private handleCheckEnumConsistency;
    private handleCheckRestJsContract;
    private handleCheckEditorLayoutBias;
    private handleCheckA11y;
    private handleEvaluateProduct;
    private handleAnalyzeMarket;
    private handleAuditPlugin;
    private handleProbeRoles;
    private handleCrossReferenceData;
    private handleBootstrapPlan;
    private handleLearnFromBasecamp;
    private handleSetupQuality;
    private handleRunCodeChecks;
    private handleCheckCodeQuality;
    private formatCheckerResult;
    private successResult;
    private errorResult;
    private handleAuditInitJourneys;
    private handleAuditCoverageCheck;
    private handleAuditGetBriefing;
    private handleAuditConsolidateMatrix;
    run(): Promise<void>;
}
