/**
 * WP Plugin QA MCP Server - Type Definitions
 */

// ─── Severity & Priority ────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type IssueSeverity = 'error' | 'warning' | 'info';

// ─── Scanner Output Types ───────────────────────────────────────

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

// ─── Additional Scanner Types ───────────────────────────────────

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

// ─── Cross-Layer Wiring ─────────────────────────────────────────

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

export interface WiringIssue {
  type: 'broken-ajax' | 'dead-handler' | 'nonce-mismatch' | 'orphaned-selector' | 'missing-localize';
  severity: Severity;
  source: string;
  target: string;
  details: string;
  file: string;
  line: number;
}

// ─── Plugin Manifest ────────────────────────────────────────────

export interface PluginManifest {
  header: PluginHeader;
  pluginPath: string;
  scannedAt: string;
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

// ─── Test Plan Types ────────────────────────────────────────────

export type TestCategory =
  | 'smoke'
  | 'functionality'
  | 'code-quality'
  | 'security'
  | 'api'
  | 'database'
  | 'browser'
  | 'ux'
  | 'templates'
  | 'action-audit'
  | 'compatibility'
  | 'i18n'
  | 'performance';

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

// ─── Checker Result Types ───────────────────────────────────────

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

// ─── Bug Report ─────────────────────────────────────────────────

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

// ─── QA Report ──────────────────────────────────────────────────

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

// ─── Template Types (for test plan generation) ──────────────────

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
