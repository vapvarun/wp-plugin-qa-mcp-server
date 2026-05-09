/**
 * WP Plugin QA MCP Server - Type Definitions
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type IssueSeverity = 'error' | 'warning' | 'info';
export interface PluginHeader {
    name: string;
    slug: string;
    version: string;
    textDomain: string;
    domainPath: string;
    requiresWP: string;
    requiresPHP: string;
    description: string;
    author: string;
    pluginURI: string;
    network: boolean;
}
export interface CptInfo {
    postType: string;
    label: string;
    supports: string[];
    hasRest: boolean;
    taxonomies: string[];
    file: string;
    line: number;
}
export interface TaxonomyInfo {
    taxonomy: string;
    label: string;
    hierarchical: boolean;
    postTypes: string[];
    file: string;
    line: number;
}
export interface ShortcodeInfo {
    tag: string;
    callback: string;
    file: string;
    line: number;
}
export interface BlockInfo {
    name: string;
    title: string;
    category: string;
    attributes: string[];
    file: string;
    line: number;
}
export interface RestRouteInfo {
    namespace: string;
    route: string;
    methods: string[];
    permissionCallback: string;
    file: string;
    line: number;
}
export interface AjaxHandlerInfo {
    action: string;
    callback: string;
    loggedIn: boolean;
    loggedOut: boolean;
    hasNonceCheck: boolean;
    file: string;
    line: number;
}
export interface AdminPageInfo {
    slug: string;
    title: string;
    capability: string;
    callback: string;
    parentSlug?: string;
    file: string;
    line: number;
}
export interface SettingInfo {
    optionName: string;
    group: string;
    sanitizeCallback: string;
    file: string;
    line: number;
}
export interface WidgetInfo {
    className: string;
    idBase: string;
    file: string;
    line: number;
}
export interface MetaBoxInfo {
    id: string;
    title: string;
    postType: string;
    callback: string;
    file: string;
    line: number;
}
export interface CronJobInfo {
    hook: string;
    recurrence: string;
    callback: string;
    file: string;
    line: number;
}
export interface CliCommandInfo {
    command: string;
    file: string;
    line: number;
}
export interface DbTableInfo {
    tableSuffix: string;
    file: string;
    line: number;
}
export interface TemplateFileInfo {
    file: string;
    overridePath: string;
    hooksInTemplate: string[];
}
export interface HookInfo {
    type: 'action' | 'filter';
    hookName: string;
    callback: string;
    file: string;
    line: number;
    priority: number;
    acceptedArgs: number;
}
export interface ProvidedHook {
    type: 'action' | 'filter';
    hookName: string;
    file: string;
    line: number;
}
export interface ActivationHookInfo {
    type: 'activation' | 'deactivation' | 'uninstall';
    callback: string;
    file: string;
    line: number;
}
export interface CustomRoleInfo {
    role: string;
    displayName: string;
    file: string;
    line: number;
}
export interface ImageSizeInfo {
    name: string;
    width: number;
    height: number;
    crop: boolean;
    file: string;
    line: number;
}
export interface BlockPatternInfo {
    name: string;
    title: string;
    file: string;
    line: number;
}
export interface IntegrationInfo {
    type: 'woocommerce' | 'buddypress' | 'elementor' | 'bbpress' | 'learndash';
    hooks: string[];
    file: string;
    line: number;
}
export interface JsAjaxCall {
    action: string;
    nonceKey: string;
    file: string;
    line: number;
}
export interface JsEventHandler {
    selector: string;
    event: string;
    file: string;
    line: number;
}
export interface LocalizeScriptInfo {
    handle: string;
    objectName: string;
    data: Record<string, string>;
    file: string;
    line: number;
}
export interface TemplateSelector {
    selector: string;
    element: string;
    hasDataAction: boolean;
    dataAction?: string;
    nonceField?: string;
    file: string;
    line: number;
}
export interface WiringIssue {
    type: 'broken-ajax' | 'dead-handler' | 'nonce-mismatch' | 'orphaned-selector' | 'missing-localize' | 'nonce-inconsistency';
    severity: Severity;
    source: string;
    target: string;
    details: string;
    file: string;
    line: number;
}
export interface PluginManifest {
    header: PluginHeader;
    pluginPath: string;
    scannedAt: string;
    /** CSS prefix used by the plugin's design tokens, e.g. `lrn` for Learnomy or `jt` for Jetonomy.
     * Detected from the most-frequent `--<token>-*` custom property prefix in `assets/**\/*.css`,
     * with fallback to `header.slug.split('-')[0]` when no CSS files exist. Consumers should
     * prefer this over re-scanning the assets dir. */
    cssPrefix: string;
    /** True if any PHP file in the plugin contains a `wp_enqueue_script` or `wp_enqueue_style` call. */
    hasEnqueueCalls: boolean;
    /** True if any PHP file contains a `class_exists`, `function_exists`, or `defined` guard
     * that gates third-party integration code. */
    hasIntegrationConditionals: boolean;
    features: {
        cpts: CptInfo[];
        taxonomies: TaxonomyInfo[];
        shortcodes: ShortcodeInfo[];
        blocks: BlockInfo[];
        restRoutes: RestRouteInfo[];
        ajaxHandlers: AjaxHandlerInfo[];
        adminPages: AdminPageInfo[];
        settings: SettingInfo[];
        widgets: WidgetInfo[];
        metaBoxes: MetaBoxInfo[];
        cronJobs: CronJobInfo[];
        cliCommands: CliCommandInfo[];
        dbTables: DbTableInfo[];
        templates: TemplateFileInfo[];
        hooks: {
            provided: ProvidedHook[];
            consumed: HookInfo[];
        };
        activationHooks: ActivationHookInfo[];
        customRoles: CustomRoleInfo[];
        imageSizes: ImageSizeInfo[];
        blockPatterns: BlockPatternInfo[];
        integrations: IntegrationInfo[];
    };
    wiring: {
        jsAjaxCalls: JsAjaxCall[];
        jsEventHandlers: JsEventHandler[];
        localizeScripts: LocalizeScriptInfo[];
        issues: WiringIssue[];
    };
    stats: {
        phpFiles: number;
        jsFiles: number;
        cssFiles: number;
        totalLines: number;
    };
}
export type TestCategory = 'smoke' | 'functionality' | 'api' | 'database' | 'browser' | 'ux' | 'templates' | 'a11y' | 'admin-eval' | 'frontend-eval' | 'marketing' | 'phpcs' | 'phpstan' | 'eslint' | 'stylelint' | 'phpcompat' | 'a11y-grep' | 'php-lint' | 'composer-audit' | 'i18n' | 'plugin-check' | 'bundle-size' | 'security-scan' | 'performance-scan' | 'pcp-deep' | 'wiring' | 'ux-guidelines' | 'plugin-dev-rules' | 'visual-regression' | 'enum-consistency' | 'rest-js-contract' | 'editor-layout-bias' | 'template-contract' | 'qa-coverage';
export interface TestItem {
    id: string;
    category: TestCategory;
    title: string;
    description: string;
    priority: Severity;
    automated: boolean;
    featureRef?: string;
    steps?: string[];
    expected?: string;
    status: 'pending' | 'pass' | 'fail' | 'skip' | 'error';
    result?: TestResult;
}
export interface TestResult {
    status: 'pass' | 'fail' | 'skip' | 'error';
    message: string;
    details?: string;
    duration?: number;
    file?: string;
    line?: number;
}
export interface TestPlan {
    pluginName: string;
    pluginVersion: string;
    generatedAt: string;
    totalItems: number;
    byCategory: Record<TestCategory, number>;
    byPriority: Record<Severity, number>;
    items: TestItem[];
}
export interface CheckerIssue {
    id: string;
    category: TestCategory;
    severity: Severity;
    type: IssueSeverity;
    title: string;
    message: string;
    file: string;
    line: number;
    code: string;
    fix?: string;
}
export interface CheckerResult {
    category: TestCategory;
    issues: CheckerIssue[];
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
}
export interface BugReport {
    id: string;
    severity: Severity;
    category: TestCategory;
    title: string;
    file: string;
    line: number;
    steps: string;
    expected: string;
    actual: string;
    fix?: string;
}
export interface CategoryScore {
    category: TestCategory;
    total: number;
    pass: number;
    fail: number;
    skip: number;
    score: number;
}
export interface QaReport {
    pluginName: string;
    pluginVersion: string;
    grade: string;
    score: number;
    testedAt: string;
    categories: CategoryScore[];
    bugs: BugReport[];
    summary: {
        totalTests: number;
        passed: number;
        failed: number;
        skipped: number;
        criticalBugs: number;
        highBugs: number;
        mediumBugs: number;
        lowBugs: number;
    };
}
export type MaturityLevel = 'missing' | 'stub' | 'basic' | 'complete' | 'excellent';
export type GapPriority = 'critical' | 'important' | 'recommended' | 'nice-to-have';
export type GapRuleType = 'conditional' | 'unconditional';
export interface GapFinding {
    id: string;
    rule: string;
    priority: GapPriority;
    type: GapRuleType;
    trigger: string;
    finding: string;
    recommendation: string;
    effort: 'small' | 'medium' | 'large';
}
export interface FeatureMaturity {
    area: string;
    level: MaturityLevel;
    score: number;
    details: string;
    items: string[];
}
export interface PluginInventory {
    cpts: number;
    taxonomies: number;
    restRoutes: number;
    ajaxHandlers: number;
    blocks: number;
    shortcodes: number;
    adminPages: number;
    settings: number;
    widgets: number;
    metaBoxes: number;
    cronJobs: number;
    cliCommands: number;
    dbTables: number;
    templates: number;
    hooksProvided: number;
    hooksConsumed: number;
    activationHooks: number;
    customRoles: number;
    integrations: number;
}
export interface GapAnalysisResult {
    pluginName: string;
    pluginVersion: string;
    analyzedAt: string;
    inventory: PluginInventory;
    maturity: FeatureMaturity[];
    gaps: GapFinding[];
    overallMaturity: MaturityLevel;
    overallMaturityScore: number;
    summary: {
        totalGaps: number;
        critical: number;
        important: number;
        recommended: number;
        niceToHave: number;
    };
}
export interface AuditReport {
    pluginName: string;
    pluginVersion: string;
    auditedAt: string;
    inventory: PluginInventory;
    maturity: FeatureMaturity[];
    overallMaturity: MaturityLevel;
    overallMaturityScore: number;
    gapAnalysis: GapFinding[];
    codeQuality: {
        grade: string;
        score: number;
        categories: CategoryScore[];
        bugs: BugReport[];
        summary: {
            totalTests: number;
            passed: number;
            failed: number;
            skipped: number;
            criticalBugs: number;
            highBugs: number;
            mediumBugs: number;
            lowBugs: number;
        };
    };
    actionItems: {
        critical: string[];
        important: string[];
        recommended: string[];
    };
}
export interface TestTemplate {
    category: TestCategory;
    featureType: string;
    tests: Array<{
        titleTemplate: string;
        descriptionTemplate: string;
        priority: Severity;
        automated: boolean;
        steps?: string[];
        expectedTemplate?: string;
    }>;
}
export interface WpOrgPluginInfo {
    name: string;
    slug: string;
    version: string;
    author: string;
    short_description: string;
    active_installs: number;
    rating: number;
    num_ratings: number;
    tested: string;
    requires_php: string;
    last_updated: string;
    tags: Record<string, string>;
    sections: {
        description?: string;
        faq?: string;
    };
}
export type FeatureCategory = 'cpt' | 'taxonomy' | 'rest-api' | 'block' | 'shortcode' | 'widget' | 'admin-page' | 'cron' | 'cli' | 'integration' | 'import-export' | 'notification' | 'multisite' | 'user-role' | 'template' | 'frontend' | 'reporting' | 'general';
export interface ExtractedFeature {
    name: string;
    normalizedName: string;
    category: FeatureCategory;
    source: 'manifest' | 'description' | 'tag' | 'codecanyon' | 'web';
}
export interface CompetitorInfo {
    slug: string;
    name: string;
    version: string;
    author: string;
    active_installs: number;
    rating: number;
    num_ratings: number;
    tested: string;
    requires_php: string;
    last_updated: string;
    tags: string[];
    features: ExtractedFeature[];
    hasPremiumVersion: boolean;
    premiumIndicators: string[];
    marketplace: 'wordpress.org' | 'codecanyon' | 'web';
    price?: string;
    url?: string;
}
export interface FeatureMatrixEntry {
    feature: string;
    category: FeatureCategory;
    userPlugin: boolean;
    competitors: Record<string, boolean>;
    frequency: number;
    frequencyPercent: number;
}
export interface MarketGap {
    feature: string;
    category: FeatureCategory;
    competitorCount: number;
    competitorPercent: number;
    topCompetitors: string[];
    priority: 'critical' | 'high' | 'medium' | 'low';
    rationale: string;
}
export interface RoadmapItem {
    rank: number;
    feature: string;
    category: FeatureCategory;
    priority: 'critical' | 'high' | 'medium' | 'low';
    effort: 'small' | 'medium' | 'large';
    rationale: string;
    competitorExamples: string[];
}
export interface CompetitiveReport {
    userPlugin: {
        name: string;
        slug: string;
        version: string;
        featureCount: number;
        features: ExtractedFeature[];
    };
    market: {
        totalCompetitorsFound: number;
        totalCompetitorsAnalyzed: number;
        searchTermsUsed: string[];
        averageInstalls: number;
        medianInstalls: number;
        averageRating: number;
        installDistribution: {
            range: string;
            count: number;
        }[];
        sourcesSearched: {
            source: string;
            found: number;
            status: string;
        }[];
    };
    competitors: CompetitorInfo[];
    featureMatrix: FeatureMatrixEntry[];
    gaps: MarketGap[];
    uniqueSellingPoints: string[];
    essentialFeatures: string[];
    monetizationOpportunities: {
        feature: string;
        premiumCompetitors: string[];
    }[];
    roadmap: RoadmapItem[];
    suggestedSearchUrls: {
        source: string;
        url: string;
    }[];
    generatedAt: string;
}
