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
    private handleRunChecks;
    private handleCertify;
    private handleAudit;
    private handleCheckApi;
    private handleCheckDatabase;
    private handleCheckBrowser;
    private handleCheckUx;
    private handleCheckTemplates;
    private handleCheckTemplateContract;
    private handleCheckCssContract;
    private handleReadiness;
    private handleReadinessPortfolio;
    private handleCheckWiringCompleteness;
    private handleCheckUxGuidelines;
    private handleCheckPluginDevRules;
    /**
     * Manifest-driven QA coverage gate. Reads audit/manifest.json + test source,
     * writes audit/qa-coverage.json, returns a CheckerResult that fails when
     * uncovered_total regressed (or any uncovered with strict=true).
     */
    private handleCheckQaCoverage;
    private handleCheckVisualRegression;
    private handleCheckEnumConsistency;
    private handleCheckRestJsContract;
    private handleCheckScale;
    private handleCheckEditorLayoutBias;
    private handleCheckA11y;
    private handleEvaluateProduct;
    private handleAuditPlugin;
    private handleProbeRoles;
    private handleCrossReferenceData;
    private handleBootstrapPlan;
    private handleLearnFromBasecamp;
    private formatCheckerResult;
    private successResult;
    private errorResult;
    private handleAuditInitJourneys;
    private handleAuditCoverageCheck;
    private handleAuditGetBriefing;
    private handleAuditConsolidateMatrix;
    run(): Promise<void>;
}
