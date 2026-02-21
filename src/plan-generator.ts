/**
 * WP Plugin QA MCP Server - Test Plan Generator
 * Converts a PluginManifest into a prioritized TestPlan with 13 categories.
 */

import type {
  PluginManifest, TestPlan, TestItem, TestCategory, Severity,
} from './types.js';
import { generateTestId, resetIdCounter } from './shared-utils.js';

/**
 * Generate a complete test plan from a plugin manifest.
 */
export function generateTestPlan(manifest: PluginManifest): TestPlan {
  resetIdCounter();
  const items: TestItem[] = [];

  // 1. Smoke tests (always)
  items.push(...generateSmokeTests(manifest));

  // 2. Functionality tests (per feature)
  items.push(...generateFunctionalityTests(manifest));

  // 3. Code quality tests
  items.push(...generateCodeQualityTests(manifest));

  // 4. Security tests
  items.push(...generateSecurityTests(manifest));

  // 5. API tests
  items.push(...generateApiTests(manifest));

  // 6. Database tests
  items.push(...generateDatabaseTests(manifest));

  // 7. Browser tests
  items.push(...generateBrowserTests(manifest));

  // 8. UX tests
  items.push(...generateUxTests(manifest));

  // 9. Template tests
  items.push(...generateTemplateTests(manifest));

  // 10. Action audit tests
  items.push(...generateActionAuditTests(manifest));

  // 11. Compatibility tests
  items.push(...generateCompatibilityTests(manifest));

  // 12. i18n tests
  items.push(...generateI18nTests(manifest));

  // 13. Performance tests
  items.push(...generatePerformanceTests(manifest));

  // Sort by priority
  const priorityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Compute stats
  const byCategory = {} as Record<TestCategory, number>;
  const byPriority = {} as Record<Severity, number>;

  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
  }

  return {
    pluginName: manifest.header.name,
    pluginVersion: manifest.header.version,
    generatedAt: new Date().toISOString(),
    totalItems: items.length,
    byCategory,
    byPriority,
    items,
  };
}

// --- 1. Smoke Tests ---

function generateSmokeTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  items.push(makeItem('smoke', 'critical', true, 'Plugin activates without PHP fatal errors',
    'Activate the plugin and check for PHP fatal errors in debug.log'));

  items.push(makeItem('smoke', 'critical', true, 'No PHP warnings/notices after activation',
    'Check debug.log for any PHP warnings or notices generated during activation'));

  items.push(makeItem('smoke', 'critical', true, 'Plugin deactivates cleanly',
    'Deactivate the plugin and verify no errors occur'));

  items.push(makeItem('smoke', 'critical', true, 'Plugin works after deactivate-reactivate cycle',
    'Deactivate then reactivate the plugin. Verify all features still work.'));

  items.push(makeItem('smoke', 'critical', true, 'No undefined function calls at activation',
    'Check for fatal errors caused by undefined functions during activation'));

  for (const page of manifest.features.adminPages) {
    items.push(makeItem('smoke', 'critical', true,
      `Admin page "${page.title}" loads without 500 error`,
      `Navigate to admin page ${page.slug} and verify it loads without HTTP 500`,
      undefined, `admin-page:${page.slug}`));
  }

  return items;
}

// --- 2. Functionality Tests ---

function generateFunctionalityTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  // Per CPT
  for (const cpt of manifest.features.cpts) {
    items.push(makeItem('functionality', 'critical', false,
      `CPT "${cpt.postType}": Create via admin`, `Create a new ${cpt.postType} via WordPress admin`, undefined, `cpt:${cpt.postType}`));
    items.push(makeItem('functionality', 'critical', false,
      `CPT "${cpt.postType}": Edit screen loads`, `Open edit screen for ${cpt.postType} and verify all fields load`, undefined, `cpt:${cpt.postType}`));
    items.push(makeItem('functionality', 'high', false,
      `CPT "${cpt.postType}": Delete works`, `Delete a ${cpt.postType} and verify it is removed`, undefined, `cpt:${cpt.postType}`));
    items.push(makeItem('functionality', 'high', false,
      `CPT "${cpt.postType}": Search works`, `Search for a ${cpt.postType} by title in admin`, undefined, `cpt:${cpt.postType}`));
    if (cpt.hasRest) {
      items.push(makeItem('functionality', 'high', true,
        `CPT "${cpt.postType}": REST API CRUD works`, `Verify CRUD operations via REST API for ${cpt.postType}`, undefined, `cpt:${cpt.postType}`));
    }
  }

  // Per Shortcode
  for (const sc of manifest.features.shortcodes) {
    items.push(makeItem('functionality', 'high', false,
      `Shortcode [${sc.tag}] renders (not raw)`, `Add [${sc.tag}] to a page and verify it renders, not showing raw tag`, undefined, `shortcode:${sc.tag}`));
    items.push(makeItem('functionality', 'high', true,
      `Shortcode [${sc.tag}] callback exists`, `Verify callback function "${sc.callback}" is defined`, undefined, `shortcode:${sc.tag}`));
  }

  // Per Block
  for (const block of manifest.features.blocks) {
    items.push(makeItem('functionality', 'high', false,
      `Block "${block.title}" inserts in editor`, `Insert ${block.name} block in Gutenberg editor`, undefined, `block:${block.name}`));
    items.push(makeItem('functionality', 'high', false,
      `Block "${block.title}" saves without validation error`, `Save a post with ${block.name} block`, undefined, `block:${block.name}`));
    items.push(makeItem('functionality', 'high', false,
      `Block "${block.title}" renders on frontend`, `View post with ${block.name} on frontend and verify render`, undefined, `block:${block.name}`));
  }

  // Per Admin Page
  for (const page of manifest.features.adminPages) {
    items.push(makeItem('functionality', 'high', false,
      `Admin page "${page.title}": Form submits`, `Submit any form on ${page.slug} page`, undefined, `admin-page:${page.slug}`));
    items.push(makeItem('functionality', 'high', false,
      `Admin page "${page.title}": Settings persist on reload`, `Save settings and reload page to verify persistence`, undefined, `admin-page:${page.slug}`));
  }

  // Per Widget
  for (const widget of manifest.features.widgets) {
    items.push(makeItem('functionality', 'medium', false,
      `Widget "${widget.className}" renders in sidebar`, `Add widget to sidebar and verify frontend rendering`, undefined, `widget:${widget.idBase}`));
    items.push(makeItem('functionality', 'medium', false,
      `Widget "${widget.className}" config saves`, `Configure widget settings and verify they persist`, undefined, `widget:${widget.idBase}`));
  }

  // Per Meta Box
  for (const mb of manifest.features.metaBoxes) {
    items.push(makeItem('functionality', 'high', false,
      `Meta box "${mb.title}" displays on ${mb.postType} edit`, `Open ${mb.postType} editor and verify meta box "${mb.id}" is visible`, undefined, `metabox:${mb.id}`));
    items.push(makeItem('functionality', 'high', false,
      `Meta box "${mb.title}" saves on post save`, `Enter data in meta box and save post, verify data persists`, undefined, `metabox:${mb.id}`));
  }

  // Per Cron Job
  for (const cron of manifest.features.cronJobs) {
    items.push(makeItem('functionality', 'medium', true,
      `Cron "${cron.hook}" is scheduled`, `Check wp_next_scheduled for "${cron.hook}" after activation`, undefined, `cron:${cron.hook}`));
  }

  return items;
}

// --- 3. Code Quality Tests ---

function generateCodeQualityTests(manifest: PluginManifest): TestItem[] {
  return [
    makeItem('code-quality', 'high', true, 'No duplicate/similar functions', 'Check for functions with near-identical bodies'),
    makeItem('code-quality', 'high', true, 'Consistent function naming (plugin prefix)', 'All functions use consistent plugin prefix'),
    makeItem('code-quality', 'high', true, 'No dead code (defined but never called)', 'Find functions defined but never referenced'),
    makeItem('code-quality', 'critical', true, 'No undefined function calls', 'Find function calls where the function is not defined'),
    makeItem('code-quality', 'medium', true, 'PHP 7.4-8.4 compatibility', 'Check for deprecated/removed PHP features'),
    makeItem('code-quality', 'medium', true, 'Consistent code patterns', 'Same approach used for same type of operation throughout'),
  ];
}

// --- 4. Security Tests ---

function generateSecurityTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  for (const handler of manifest.features.ajaxHandlers) {
    items.push(makeItem('security', 'critical', true,
      `AJAX "${handler.action}" has nonce verification`, `Check for check_ajax_referer or wp_verify_nonce in handler`, undefined, `ajax:${handler.action}`));
  }

  for (const page of manifest.features.adminPages) {
    items.push(makeItem('security', 'critical', true,
      `Admin page "${page.slug}" enforces capability check`, `Verify capability "${page.capability}" is checked`, undefined, `admin-page:${page.slug}`));
  }

  for (const route of manifest.features.restRoutes) {
    if (route.permissionCallback === '__return_true' && route.methods.some(m => ['POST', 'PUT', 'DELETE', 'PATCH'].includes(m))) {
      items.push(makeItem('security', 'critical', true,
        `REST "${route.route}" write endpoint uses __return_true`, `Write endpoint should have proper permission_callback, not __return_true`, undefined, `rest:${route.route}`));
    }
  }

  for (const setting of manifest.features.settings) {
    if (!setting.sanitizeCallback) {
      items.push(makeItem('security', 'high', true,
        `Setting "${setting.optionName}" missing sanitize_callback`, `register_setting should include sanitize_callback`, undefined, `setting:${setting.optionName}`));
    }
  }

  items.push(makeItem('security', 'high', true, 'No direct $_POST/$_GET without sanitization', 'Check for unsanitized superglobal usage'));
  items.push(makeItem('security', 'high', true, 'All output properly escaped', 'Check esc_html, esc_attr, esc_url usage'));
  items.push(makeItem('security', 'high', true, 'No direct $wpdb->query without prepare', 'Check for SQL injection vectors'));

  return items;
}

// --- 5. API Tests ---

function generateApiTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  for (const route of manifest.features.restRoutes) {
    items.push(makeItem('api', 'critical', true,
      `REST ${route.methods.join('/')} ${route.route}: auth returns 200/201`, `Authenticated request to ${route.namespace}${route.route} returns success`, undefined, `rest:${route.route}`));
    items.push(makeItem('api', 'critical', true,
      `REST ${route.methods.join('/')} ${route.route}: unauth returns 401/403`, `Unauthenticated request is properly rejected`, undefined, `rest:${route.route}`));
    items.push(makeItem('api', 'high', true,
      `REST ${route.route}: malformed input returns 400`, `Send invalid data and verify proper error response`, undefined, `rest:${route.route}`));
  }

  for (const handler of manifest.features.ajaxHandlers) {
    items.push(makeItem('api', 'critical', true,
      `AJAX "${handler.action}": valid nonce succeeds`, `POST with correct nonce returns success response`, undefined, `ajax:${handler.action}`));
    items.push(makeItem('api', 'critical', true,
      `AJAX "${handler.action}": invalid nonce rejected`, `POST with wrong/missing nonce is rejected`, undefined, `ajax:${handler.action}`));
    items.push(makeItem('api', 'high', true,
      `AJAX "${handler.action}": response is valid JSON`, `Verify response is proper JSON, not HTML/text mixed`, undefined, `ajax:${handler.action}`));
  }

  return items;
}

// --- 6. Database Tests ---

function generateDatabaseTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  for (const table of manifest.features.dbTables) {
    items.push(makeItem('database', 'high', true,
      `Custom table "${table.tableSuffix}" exists after activation`, `Verify table wp_${table.tableSuffix} is created`, undefined, `table:${table.tableSuffix}`));
  }

  for (const setting of manifest.features.settings) {
    items.push(makeItem('database', 'high', true,
      `Setting "${setting.optionName}" saves and retrieves correctly`, `Save a value via register_setting and verify get_option returns it`, undefined, `setting:${setting.optionName}`));
  }

  for (const cpt of manifest.features.cpts) {
    items.push(makeItem('database', 'high', true,
      `CPT "${cpt.postType}" data persists in wp_posts`, `Create a ${cpt.postType} and verify it exists in wp_posts with correct post_type`, undefined, `cpt:${cpt.postType}`));
  }

  items.push(makeItem('database', 'medium', true, 'Option autoload is appropriate', 'Large data options should NOT have autoload=yes'));
  items.push(makeItem('database', 'medium', true, 'Data cleanup on uninstall', 'Verify uninstall.php or register_uninstall_hook removes plugin data'));

  return items;
}

// --- 7. Browser Tests ---

function generateBrowserTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  for (const page of manifest.features.adminPages) {
    items.push(makeItem('browser', 'high', false,
      `Admin "${page.title}": no JS console errors`, `Load ${page.slug} and check browser console for errors`, undefined, `admin-page:${page.slug}`));
  }

  items.push(makeItem('browser', 'high', false, 'Responsive at 375px (mobile)', 'Check all plugin pages at 375px viewport'));
  items.push(makeItem('browser', 'high', false, 'Responsive at 768px (tablet)', 'Check all plugin pages at 768px viewport'));
  items.push(makeItem('browser', 'medium', false, 'Responsive at 1024px (desktop)', 'Check all plugin pages at 1024px viewport'));
  items.push(makeItem('browser', 'medium', false, 'No layout overflow or broken elements', 'Visual inspection at all viewports'));

  for (const block of manifest.features.blocks) {
    items.push(makeItem('browser', 'high', false,
      `Block "${block.title}" editor interaction works`, `Insert, configure, and save ${block.name} in block editor`, undefined, `block:${block.name}`));
  }

  return items;
}

// --- 8. UX Tests ---

function generateUxTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  items.push(makeItem('ux', 'high', true, 'All settings have description/help text', 'Check add_settings_field calls include description'));
  items.push(makeItem('ux', 'high', true, 'Error messages use user-friendly language', 'No PHP jargon or stack traces in user-facing errors'));
  items.push(makeItem('ux', 'high', true, 'Empty states handled', 'No blank pages when there is no data'));
  items.push(makeItem('ux', 'medium', false, 'First-run experience works', 'Fresh install with no saved options shows sensible defaults'));
  items.push(makeItem('ux', 'medium', true, 'Admin notices are clear and actionable', 'Check admin notice text for clarity'));
  items.push(makeItem('ux', 'medium', false, 'Success feedback visible', 'Save confirmation messages appear after actions'));

  return items;
}

// --- 9. Template Tests ---

function generateTemplateTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  for (const tpl of manifest.features.templates) {
    items.push(makeItem('templates', 'high', true,
      `Template "${tpl.file}" has override support`, `Check for locate_template or plugin filter for theme override`, undefined, `template:${tpl.file}`));
    if (tpl.hooksInTemplate.length === 0) {
      items.push(makeItem('templates', 'medium', true,
        `Template "${tpl.file}" needs do_action hooks`, `Add do_action hooks before/after key sections`, undefined, `template:${tpl.file}`));
    }
  }

  items.push(makeItem('templates', 'high', true, 'Key lifecycle events have action hooks', 'Check for do_action on save, display, delete events'));
  items.push(makeItem('templates', 'medium', true, 'Filters available on important output', 'Check for apply_filters on titles, content, query args'));
  items.push(makeItem('templates', 'medium', true, 'All hooks pass sufficient context', 'Hooks should pass the relevant object/ID, not just booleans'));

  return items;
}

// --- 10. Action Audit Tests ---

function generateActionAuditTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  if (manifest.wiring.issues.length > 0) {
    for (const issue of manifest.wiring.issues) {
      const priority: Severity = issue.severity;
      items.push(makeItem('action-audit', priority, true,
        `Wiring: ${issue.type} - ${issue.target}`, issue.details, undefined, `wiring:${issue.target}`));
    }
  }

  items.push(makeItem('action-audit', 'high', true, 'wp_localize_script passes correct nonce keys', 'Verify nonce keys in localized data match PHP verification'));
  items.push(makeItem('action-audit', 'high', true, 'No orphaned selectors (button/link without JS handler)', 'Template interactive elements have matching JS handlers'));

  return items;
}

// --- 11. Compatibility Tests ---

function generateCompatibilityTests(manifest: PluginManifest): TestItem[] {
  const items: TestItem[] = [];

  items.push(makeItem('compatibility', 'medium', true, 'No PHP deprecated function usage', `Check against min PHP ${manifest.header.requiresPHP || '7.4'}`));
  items.push(makeItem('compatibility', 'medium', true, 'No WordPress deprecated function usage', `Check against min WP ${manifest.header.requiresWP || '5.0'}`));
  items.push(makeItem('compatibility', 'medium', true, 'Enqueued scripts use proper dependencies', 'Check wp_enqueue_script dependency arrays'));

  if (manifest.header.network) {
    items.push(makeItem('compatibility', 'high', false, 'Works on multisite', 'Test activation and functionality on multisite install'));
  }

  return items;
}

// --- 12. i18n Tests ---

function generateI18nTests(manifest: PluginManifest): TestItem[] {
  return [
    makeItem('i18n', 'medium', true, 'All user-facing strings wrapped in __()', 'Check for unwrapped translatable strings'),
    makeItem('i18n', 'medium', true, `Text domain matches "${manifest.header.textDomain}"`, 'Verify consistent text domain usage'),
    makeItem('i18n', 'medium', true, 'No concatenated translatable strings', 'Use sprintf instead of string concatenation'),
    makeItem('i18n', 'medium', true, 'POT file exists in languages/', 'Check for languages/*.pot file'),
    makeItem('i18n', 'medium', true, 'load_plugin_textdomain called on init', 'Verify textdomain loading'),
    makeItem('i18n', 'low', true, 'Plural forms use _n() correctly', 'Check pluralization handling'),
    makeItem('i18n', 'low', true, 'No HTML inside translatable strings', 'Use %s placeholders instead'),
  ];
}

// --- 13. Performance Tests ---

function generatePerformanceTests(manifest: PluginManifest): TestItem[] {
  return [
    makeItem('performance', 'medium', true, 'Scripts/styles enqueued only where needed', 'Not loaded globally on every page'),
    makeItem('performance', 'medium', true, 'No blocking scripts in <head>', 'Scripts should use in_footer: true'),
    makeItem('performance', 'medium', true, 'No N+1 query patterns', 'Check for database queries inside loops'),
    makeItem('performance', 'medium', true, 'Transient/object caching used for expensive ops', 'Expensive queries should be cached'),
    makeItem('performance', 'low', true, 'Total enqueued assets reasonable', 'Less than 5 extra CSS + 5 extra JS files'),
    makeItem('performance', 'low', true, 'Large option values not set to autoload', 'Check wp_options autoload flag'),
    makeItem('performance', 'medium', true, 'No more than 50 extra DB queries per page load', 'Estimated query count from code analysis'),
    makeItem('performance', 'high', false, 'Admin page load time < 3s', 'Measure with browser DevTools'),
  ];
}

// --- Helper ---

function makeItem(
  category: TestCategory,
  priority: Severity,
  automated: boolean,
  title: string,
  description: string,
  steps?: string[],
  featureRef?: string,
): TestItem {
  return {
    id: generateTestId(category),
    category,
    title,
    description,
    priority,
    automated,
    featureRef,
    steps,
    status: 'pending',
  };
}
