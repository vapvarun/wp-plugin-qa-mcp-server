/**
 * WP Plugin QA MCP Server - Main Server (v3.1.0)
 * 15 tools focused on product evaluation.
 * Code quality checks are handled by WPCS MCP + Plugin Check PCP.
 * Note: No shell commands used. All checks are static analysis or HTTP-based.
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
