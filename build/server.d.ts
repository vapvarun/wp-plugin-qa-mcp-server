/**
 * WP Plugin QA MCP Server - Main Server (v2.1.0)
 * 15 tools focused on product evaluation.
 * Code quality checks are handled by WPCS MCP + Plugin Check PCP.
 * Note: No shell commands used. All checks are static analysis or HTTP-based.
 */
export declare class WpPluginQaServer {
    private server;
    constructor();
    private setupToolHandlers;
    private handleScanPlugin;
    private handleCheckApi;
    private handleCheckDatabase;
    private handleCheckBrowser;
    private handleCheckUx;
    private handleCheckTemplates;
    private handleCheckWiringCompleteness;
    private handleCheckUxGuidelines;
    private handleCheckPluginDevRules;
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
    run(): Promise<void>;
}
