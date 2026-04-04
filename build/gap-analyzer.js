/**
 * WP Plugin QA MCP Server - Gap Analyzer
 * Rules engine that evaluates a PluginManifest to find what's missing.
 * Conditional rules: "if you have X, you should also have Y"
 * Unconditional rules: "every plugin should have Z"
 * Returns structured gap findings + maturity scoring per feature area.
 */
import { join } from 'path';
import { findPhpFiles, safeReadFile, fileExists } from './shared-utils.js';
// ─── Conditional Rules (~35 rules) ────────────────────────────────
const CONDITIONAL_RULES = [
    // CPT rules
    {
        id: 'CPT-REST',
        trigger: (m) => m.features.cpts.length > 0,
        check: (m) => m.features.cpts.every(cpt => cpt.hasRest),
        triggerLabel: 'Has Custom Post Types',
        finding: 'Some CPTs lack REST API support',
        recommendation: 'Add show_in_rest => true to all register_post_type calls for block editor and API compatibility',
        priority: 'critical',
        effort: 'small',
    },
    {
        id: 'CPT-TAXONOMY',
        trigger: (m) => m.features.cpts.length > 0,
        check: (m) => m.features.cpts.some(cpt => cpt.taxonomies.length > 0),
        triggerLabel: 'Has Custom Post Types',
        finding: 'No taxonomies registered for CPTs',
        recommendation: 'Add at least one taxonomy (category or tag equivalent) for content organization',
        priority: 'recommended',
        effort: 'medium',
    },
    {
        id: 'CPT-SUPPORTS',
        trigger: (m) => m.features.cpts.length > 0,
        check: (m) => m.features.cpts.every(cpt => cpt.supports.length >= 3),
        triggerLabel: 'Has Custom Post Types',
        finding: 'CPTs have minimal supports (less than 3 features)',
        recommendation: 'Add appropriate supports: title, editor, thumbnail, excerpt, custom-fields, revisions',
        priority: 'recommended',
        effort: 'small',
    },
    {
        id: 'CPT-METABOX',
        trigger: (m) => m.features.cpts.length > 0,
        check: (m) => m.features.metaBoxes.length > 0,
        triggerLabel: 'Has Custom Post Types',
        finding: 'No meta boxes registered for CPTs',
        recommendation: 'Consider adding meta boxes for additional CPT-specific data entry',
        priority: 'nice-to-have',
        effort: 'medium',
    },
    // REST API rules
    {
        id: 'REST-AUTH',
        trigger: (m) => m.features.restRoutes.length > 0,
        check: (m) => m.features.restRoutes.every(r => r.permissionCallback && r.permissionCallback !== '__return_true'),
        triggerLabel: 'Has REST API routes',
        finding: 'Some REST routes lack proper permission callbacks',
        recommendation: 'Add permission_callback with current_user_can() checks to all REST routes',
        priority: 'critical',
        effort: 'small',
    },
    {
        id: 'REST-NAMESPACE',
        trigger: (m) => m.features.restRoutes.length > 0,
        check: (m) => {
            const namespaces = new Set(m.features.restRoutes.map(r => r.namespace));
            return namespaces.size <= 2; // plugin should use consistent namespace
        },
        triggerLabel: 'Has REST API routes',
        finding: 'REST routes use inconsistent namespaces',
        recommendation: 'Use a single versioned namespace (e.g., plugin-slug/v1) for all REST routes',
        priority: 'important',
        effort: 'small',
    },
    // AJAX rules
    {
        id: 'AJAX-NONCE',
        trigger: (m) => m.features.ajaxHandlers.length > 0,
        check: (m) => m.features.ajaxHandlers.every(h => h.hasNonceCheck),
        triggerLabel: 'Has AJAX handlers',
        finding: 'Some AJAX handlers lack nonce verification',
        recommendation: 'Add check_ajax_referer() or wp_verify_nonce() to every AJAX handler',
        priority: 'critical',
        effort: 'small',
    },
    {
        id: 'AJAX-LOGGED-OUT',
        trigger: (m) => m.features.ajaxHandlers.length > 0,
        check: (m) => !m.features.ajaxHandlers.some(h => h.loggedOut && !h.hasNonceCheck),
        triggerLabel: 'Has AJAX handlers',
        finding: 'AJAX handlers exposed to logged-out users without nonce verification',
        recommendation: 'Ensure all wp_ajax_nopriv_ handlers have proper nonce and capability checks',
        priority: 'critical',
        effort: 'small',
    },
    {
        id: 'AJAX-LOCALIZE',
        trigger: (m) => m.features.ajaxHandlers.length > 0,
        check: (m) => m.wiring.localizeScripts.length > 0,
        triggerLabel: 'Has AJAX handlers',
        finding: 'No wp_localize_script() found for passing AJAX URL and nonces to JS',
        recommendation: 'Use wp_localize_script() to pass ajaxurl and nonce to frontend scripts',
        priority: 'important',
        effort: 'small',
    },
    // Admin pages rules
    {
        id: 'ADMIN-SETTINGS',
        trigger: (m) => m.features.adminPages.length > 0,
        check: (m) => m.features.settings.length > 0,
        triggerLabel: 'Has admin pages',
        finding: 'Admin pages exist but no settings registered via Settings API',
        recommendation: 'Use register_setting() and add_settings_field() for proper WP settings management',
        priority: 'important',
        effort: 'medium',
    },
    {
        id: 'ADMIN-CAPABILITY',
        trigger: (m) => m.features.adminPages.length > 0,
        check: (m) => m.features.adminPages.every(p => p.capability && p.capability !== 'read'),
        triggerLabel: 'Has admin pages',
        finding: 'Some admin pages use overly permissive capabilities',
        recommendation: 'Use appropriate capabilities (manage_options for settings, edit_posts for content management)',
        priority: 'important',
        effort: 'small',
    },
    // Block rules
    {
        id: 'BLOCK-JSON',
        trigger: (m) => m.features.blocks.length > 0,
        check: (m) => m.features.blocks.every(b => b.file.endsWith('block.json') || b.file.includes('block.json')),
        triggerLabel: 'Has Gutenberg blocks',
        finding: 'Blocks not using block.json metadata (server-side only registration)',
        recommendation: 'Use block.json for block registration — required for block directory and improves performance',
        priority: 'important',
        effort: 'medium',
    },
    {
        id: 'BLOCK-PATTERN',
        trigger: (m) => m.features.blocks.length > 0,
        check: (m) => m.features.blockPatterns.length > 0,
        triggerLabel: 'Has Gutenberg blocks',
        finding: 'No block patterns provided',
        recommendation: 'Add block patterns to give users pre-built layouts using your blocks',
        priority: 'recommended',
        effort: 'medium',
    },
    // Shortcode rules
    {
        id: 'SHORTCODE-BLOCK',
        trigger: (m) => m.features.shortcodes.length > 0,
        check: (m) => m.features.blocks.length > 0,
        triggerLabel: 'Has shortcodes',
        finding: 'Plugin has shortcodes but no Gutenberg blocks',
        recommendation: 'Add block equivalents for shortcodes — block editor is the default editing experience',
        priority: 'important',
        effort: 'large',
    },
    // Database rules
    {
        id: 'DB-UNINSTALL',
        trigger: (m) => m.features.dbTables.length > 0,
        check: (m) => m.features.activationHooks.some(h => h.type === 'uninstall'),
        triggerLabel: 'Has custom database tables',
        finding: 'Custom tables exist but no uninstall hook to clean them up',
        recommendation: 'Add uninstall.php or register_uninstall_hook to drop custom tables on plugin deletion',
        priority: 'critical',
        effort: 'small',
    },
    {
        id: 'DB-ACTIVATION',
        trigger: (m) => m.features.dbTables.length > 0,
        check: (m) => m.features.activationHooks.some(h => h.type === 'activation'),
        triggerLabel: 'Has custom database tables',
        finding: 'Custom tables exist but no activation hook to create them',
        recommendation: 'Add register_activation_hook to create tables via dbDelta() on plugin activation',
        priority: 'critical',
        effort: 'small',
    },
    // Settings rules
    {
        id: 'SETTINGS-SANITIZE',
        trigger: (m) => m.features.settings.length > 0,
        check: (m) => m.features.settings.every(s => s.sanitizeCallback && s.sanitizeCallback !== ''),
        triggerLabel: 'Has registered settings',
        finding: 'Some settings lack sanitize callbacks',
        recommendation: 'Add sanitize_callback to every register_setting() call for input validation',
        priority: 'critical',
        effort: 'small',
    },
    {
        id: 'SETTINGS-UNINSTALL',
        trigger: (m) => m.features.settings.length > 0,
        check: (m) => m.features.activationHooks.some(h => h.type === 'uninstall'),
        triggerLabel: 'Has registered settings',
        finding: 'Settings stored in wp_options but no uninstall cleanup',
        recommendation: 'Add uninstall.php to delete_option() all plugin settings on removal',
        priority: 'important',
        effort: 'small',
    },
    // Cron rules
    {
        id: 'CRON-DEACTIVATION',
        trigger: (m) => m.features.cronJobs.length > 0,
        check: (m) => m.features.activationHooks.some(h => h.type === 'deactivation'),
        triggerLabel: 'Has cron jobs',
        finding: 'Cron jobs scheduled but no deactivation hook to clear them',
        recommendation: 'Add register_deactivation_hook to wp_clear_scheduled_hook() all plugin cron events',
        priority: 'critical',
        effort: 'small',
    },
    // Template rules
    {
        id: 'TEMPLATE-HOOKS',
        trigger: (m) => m.features.templates.length > 0,
        check: (m) => m.features.templates.some(t => t.hooksInTemplate.length > 0),
        triggerLabel: 'Has template files',
        finding: 'Templates lack action/filter hooks for theme customization',
        recommendation: 'Add do_action() and apply_filters() hooks in templates for extensibility',
        priority: 'important',
        effort: 'medium',
    },
    {
        id: 'TEMPLATE-OVERRIDE',
        trigger: (m) => m.features.templates.length > 0,
        check: (m) => m.features.templates.some(t => t.overridePath !== ''),
        triggerLabel: 'Has template files',
        finding: 'No template override support for themes',
        recommendation: 'Allow themes to override templates by checking theme directory first (like WooCommerce pattern)',
        priority: 'important',
        effort: 'medium',
    },
    // Hooks rules
    {
        id: 'HOOKS-LIFECYCLE',
        trigger: (m) => m.features.hooks.provided.length > 0,
        check: (m) => {
            const hookNames = m.features.hooks.provided.map(h => h.hookName);
            const hasInit = hookNames.some(h => h.includes('_init') || h.includes('_loaded') || h.includes('_ready'));
            return hasInit;
        },
        triggerLabel: 'Provides custom hooks',
        finding: 'No lifecycle hooks (init/loaded/ready) for third-party integration',
        recommendation: 'Add lifecycle hooks so other plugins can extend at the right time (e.g., plugin_slug_init)',
        priority: 'recommended',
        effort: 'small',
    },
    // Widget rules
    {
        id: 'WIDGET-BLOCK',
        trigger: (m) => m.features.widgets.length > 0,
        check: (m) => m.features.blocks.length > 0,
        triggerLabel: 'Has widgets',
        finding: 'Has legacy widgets but no block equivalents',
        recommendation: 'Create block versions of widgets — widgets are deprecated in block themes',
        priority: 'recommended',
        effort: 'large',
    },
    // Integration rules
    {
        id: 'INTEGRATION-CONDITIONALS',
        trigger: (m) => m.features.integrations.length > 0,
        check: (m) => {
            const phpFiles = findPhpFiles(m.pluginPath);
            for (const file of phpFiles) {
                const content = safeReadFile(file);
                if (/class_exists|function_exists|defined\s*\(/.test(content))
                    return true;
            }
            return false;
        },
        triggerLabel: 'Has third-party integrations',
        finding: 'Integrations may not check if dependencies exist before loading',
        recommendation: 'Wrap integration code in class_exists()/function_exists() checks to prevent fatal errors',
        priority: 'critical',
        effort: 'small',
    },
    // Wiring rules
    {
        id: 'WIRING-ISSUES',
        trigger: (m) => m.wiring.jsAjaxCalls.length > 0 || m.features.ajaxHandlers.length > 0,
        check: (m) => m.wiring.issues.length === 0,
        triggerLabel: 'Has JS-PHP wiring (AJAX calls)',
        finding: `Cross-layer wiring issues detected between JS and PHP`,
        recommendation: 'Fix broken AJAX calls, dead handlers, nonce mismatches, and orphaned selectors',
        priority: 'important',
        effort: 'medium',
    },
    // Custom roles rules
    {
        id: 'ROLE-UNINSTALL',
        trigger: (m) => m.features.customRoles.length > 0,
        check: (m) => m.features.activationHooks.some(h => h.type === 'uninstall'),
        triggerLabel: 'Has custom roles',
        finding: 'Custom roles added but no uninstall cleanup to remove them',
        recommendation: 'Add remove_role() calls in uninstall.php for all custom roles',
        priority: 'important',
        effort: 'small',
    },
    // Meta box rules
    {
        id: 'METABOX-NONCE',
        trigger: (m) => m.features.metaBoxes.length > 0,
        check: (m) => {
            // Check if save_post handlers verify nonces
            const saveHooks = m.features.hooks.consumed.filter(h => h.hookName === 'save_post' || h.hookName.startsWith('save_post_'));
            return saveHooks.length > 0;
        },
        triggerLabel: 'Has meta boxes',
        finding: 'Meta boxes may lack proper save_post hook for saving data',
        recommendation: 'Add save_post handler with nonce verification and capability check for each meta box',
        priority: 'critical',
        effort: 'small',
    },
];
// ─── Unconditional Rules (~12 rules) ──────────────────────────────
const UNCONDITIONAL_RULES = [
    {
        id: 'UNCON-README',
        check: (m, pluginPath) => fileExists(join(pluginPath, 'readme.txt')) || fileExists(join(pluginPath, 'README.txt')),
        finding: 'No readme.txt file found',
        recommendation: 'Add a readme.txt with plugin description, installation steps, FAQ, and changelog',
        priority: 'important',
        effort: 'small',
    },
    {
        id: 'UNCON-CHANGELOG',
        check: (m, pluginPath) => fileExists(join(pluginPath, 'changelog.txt')) ||
            fileExists(join(pluginPath, 'CHANGELOG.md')) ||
            (() => {
                const readme = safeReadFile(join(pluginPath, 'readme.txt'));
                return /== Changelog ==/i.test(readme);
            })(),
        finding: 'No changelog found',
        recommendation: 'Maintain a changelog (in readme.txt or CHANGELOG.md) documenting changes per version',
        priority: 'important',
        effort: 'small',
    },
    {
        id: 'UNCON-ACTIVATION',
        check: (m) => m.features.activationHooks.some(h => h.type === 'activation'),
        finding: 'No activation hook registered',
        recommendation: 'Add register_activation_hook() for initial setup (version check, default options, flush rewrite rules)',
        priority: 'recommended',
        effort: 'small',
    },
    {
        id: 'UNCON-DEACTIVATION',
        check: (m) => m.features.activationHooks.some(h => h.type === 'deactivation'),
        finding: 'No deactivation hook registered',
        recommendation: 'Add register_deactivation_hook() for cleanup (clear cron, flush rewrite rules)',
        priority: 'recommended',
        effort: 'small',
    },
    {
        id: 'UNCON-UNINSTALL',
        check: (m, pluginPath) => fileExists(join(pluginPath, 'uninstall.php')) ||
            m.features.activationHooks.some(h => h.type === 'uninstall'),
        finding: 'No uninstall handler (uninstall.php or register_uninstall_hook)',
        recommendation: 'Add uninstall.php to clean up all plugin data (options, transients, tables, roles, caps) on deletion',
        priority: 'important',
        effort: 'small',
    },
    {
        id: 'UNCON-TEXTDOMAIN',
        check: (m) => m.header.textDomain !== '',
        finding: 'No text domain defined in plugin header',
        recommendation: 'Add "Text Domain: your-plugin-slug" to the plugin header for i18n support',
        priority: 'important',
        effort: 'small',
    },
    {
        id: 'UNCON-VERSION',
        check: (m) => m.header.version !== '' && m.header.version !== '0.0.0',
        finding: 'Plugin version not properly set',
        recommendation: 'Set a semantic version (e.g., 1.0.0) in the plugin header',
        priority: 'important',
        effort: 'small',
    },
    {
        id: 'UNCON-REQUIRES-WP',
        check: (m) => m.header.requiresWP !== '',
        finding: 'No "Requires at least" WP version specified',
        recommendation: 'Add "Requires at least: 6.0" (or your minimum) to the plugin header',
        priority: 'recommended',
        effort: 'small',
    },
    {
        id: 'UNCON-REQUIRES-PHP',
        check: (m) => m.header.requiresPHP !== '',
        finding: 'No "Requires PHP" version specified',
        recommendation: 'Add "Requires PHP: 7.4" (or your minimum) to the plugin header',
        priority: 'recommended',
        effort: 'small',
    },
    {
        id: 'UNCON-HOOKS-PROVIDED',
        check: (m) => m.features.hooks.provided.length > 0,
        finding: 'Plugin provides no custom hooks (do_action/apply_filters)',
        recommendation: 'Add custom hooks so other developers can extend your plugin functionality',
        priority: 'recommended',
        effort: 'medium',
    },
    {
        id: 'UNCON-ASSETS-ENQUEUE',
        check: (m) => {
            const phpFiles = findPhpFiles(m.pluginPath);
            for (const file of phpFiles) {
                const content = safeReadFile(file);
                if (/wp_enqueue_script|wp_enqueue_style/.test(content))
                    return true;
            }
            return false;
        },
        finding: 'No wp_enqueue_script/wp_enqueue_style calls found',
        recommendation: 'Use WordPress enqueue system for all scripts and styles (never direct <script>/<link> tags)',
        priority: 'important',
        effort: 'small',
    },
    {
        id: 'UNCON-DESCRIPTION',
        check: (m) => m.header.description !== '' && m.header.description.length >= 10,
        finding: 'Plugin description is missing or too short',
        recommendation: 'Add a meaningful description in the plugin header explaining what the plugin does',
        priority: 'recommended',
        effort: 'small',
    },
];
// ─── Maturity Scoring ─────────────────────────────────────────────
function assessMaturity(manifest) {
    const areas = [];
    // 1. Data Model maturity
    const hasCpts = manifest.features.cpts.length > 0;
    const hasTaxonomies = manifest.features.taxonomies.length > 0;
    const hasDb = manifest.features.dbTables.length > 0;
    const hasSettings = manifest.features.settings.length > 0;
    const items = [];
    if (hasCpts)
        items.push(`${manifest.features.cpts.length} CPTs`);
    if (hasTaxonomies)
        items.push(`${manifest.features.taxonomies.length} taxonomies`);
    if (hasDb)
        items.push(`${manifest.features.dbTables.length} custom tables`);
    if (hasSettings)
        items.push(`${manifest.features.settings.length} settings`);
    if (!hasCpts && !hasDb && !hasSettings) {
        areas.push({ area: 'Data Model', level: 'missing', score: 0, details: 'No data storage defined', items: [] });
    }
    else {
        const cptRest = hasCpts ? manifest.features.cpts.filter(c => c.hasRest).length / manifest.features.cpts.length : 1;
        const settingSanitized = hasSettings ? manifest.features.settings.filter(s => s.sanitizeCallback).length / manifest.features.settings.length : 1;
        const score = Math.round(((hasCpts ? 25 : 0) + (hasTaxonomies ? 15 : 0) + (hasDb ? 20 : 0) + (hasSettings ? 20 : 0) + (cptRest * 10) + (settingSanitized * 10)));
        areas.push({
            area: 'Data Model',
            level: scoreToMaturity(score),
            score,
            details: `Data storage via ${items.join(', ')}`,
            items,
        });
    }
    // 2. API Layer maturity
    const hasRest = manifest.features.restRoutes.length > 0;
    const hasAjax = manifest.features.ajaxHandlers.length > 0;
    const apiItems = [];
    if (hasRest)
        apiItems.push(`${manifest.features.restRoutes.length} REST routes`);
    if (hasAjax)
        apiItems.push(`${manifest.features.ajaxHandlers.length} AJAX handlers`);
    if (!hasRest && !hasAjax) {
        areas.push({ area: 'API Layer', level: 'missing', score: 0, details: 'No API endpoints', items: [] });
    }
    else {
        const restAuth = hasRest ? manifest.features.restRoutes.filter(r => r.permissionCallback && r.permissionCallback !== '__return_true').length / manifest.features.restRoutes.length : 0;
        const ajaxNonce = hasAjax ? manifest.features.ajaxHandlers.filter(h => h.hasNonceCheck).length / manifest.features.ajaxHandlers.length : 0;
        const score = Math.round(((hasRest ? 40 : 0) + (hasAjax ? 20 : 0) + (restAuth * 20) + (ajaxNonce * 20)));
        areas.push({
            area: 'API Layer',
            level: scoreToMaturity(score),
            score,
            details: `API via ${apiItems.join(', ')}`,
            items: apiItems,
        });
    }
    // 3. Admin UI maturity
    const hasAdmin = manifest.features.adminPages.length > 0;
    const hasMetaBoxes = manifest.features.metaBoxes.length > 0;
    const hasWidgets = manifest.features.widgets.length > 0;
    const uiItems = [];
    if (hasAdmin)
        uiItems.push(`${manifest.features.adminPages.length} admin pages`);
    if (hasMetaBoxes)
        uiItems.push(`${manifest.features.metaBoxes.length} meta boxes`);
    if (hasWidgets)
        uiItems.push(`${manifest.features.widgets.length} widgets`);
    if (!hasAdmin && !hasMetaBoxes && !hasWidgets) {
        areas.push({ area: 'Admin UI', level: 'missing', score: 0, details: 'No admin interface', items: [] });
    }
    else {
        const score = Math.round(((hasAdmin ? 40 : 0) + (hasMetaBoxes ? 20 : 0) + (hasWidgets ? 15 : 0) + (hasSettings ? 25 : 0)));
        areas.push({
            area: 'Admin UI',
            level: scoreToMaturity(score),
            score,
            details: `UI via ${uiItems.join(', ')}`,
            items: uiItems,
        });
    }
    // 4. Block Editor maturity
    const hasBlocks = manifest.features.blocks.length > 0;
    const hasPatterns = manifest.features.blockPatterns.length > 0;
    const blockItems = [];
    if (hasBlocks)
        blockItems.push(`${manifest.features.blocks.length} blocks`);
    if (hasPatterns)
        blockItems.push(`${manifest.features.blockPatterns.length} patterns`);
    if (!hasBlocks && !hasPatterns) {
        areas.push({ area: 'Block Editor', level: 'missing', score: 0, details: 'No block editor integration', items: [] });
    }
    else {
        const score = Math.round(((hasBlocks ? 60 : 0) + (hasPatterns ? 20 : 0) + (manifest.features.shortcodes.length > 0 && hasBlocks ? 20 : 0)));
        areas.push({
            area: 'Block Editor',
            level: scoreToMaturity(score),
            score,
            details: `Editor via ${blockItems.join(', ')}`,
            items: blockItems,
        });
    }
    // 5. Lifecycle Management maturity
    const hasActivation = manifest.features.activationHooks.some(h => h.type === 'activation');
    const hasDeactivation = manifest.features.activationHooks.some(h => h.type === 'deactivation');
    const hasUninstall = manifest.features.activationHooks.some(h => h.type === 'uninstall');
    const lcItems = [];
    if (hasActivation)
        lcItems.push('activation');
    if (hasDeactivation)
        lcItems.push('deactivation');
    if (hasUninstall)
        lcItems.push('uninstall');
    const lcScore = (hasActivation ? 35 : 0) + (hasDeactivation ? 30 : 0) + (hasUninstall ? 35 : 0);
    areas.push({
        area: 'Lifecycle',
        level: scoreToMaturity(lcScore),
        score: lcScore,
        details: lcItems.length > 0 ? `Hooks: ${lcItems.join(', ')}` : 'No lifecycle hooks',
        items: lcItems,
    });
    // 6. Extensibility maturity
    const providedHooks = manifest.features.hooks.provided.length;
    const hasTemplates = manifest.features.templates.length > 0;
    const extItems = [];
    if (providedHooks > 0)
        extItems.push(`${providedHooks} custom hooks`);
    if (hasTemplates)
        extItems.push(`${manifest.features.templates.length} templates`);
    if (providedHooks === 0 && !hasTemplates) {
        areas.push({ area: 'Extensibility', level: 'missing', score: 0, details: 'No extension points for developers', items: [] });
    }
    else {
        const hookScore = Math.min(providedHooks * 5, 50);
        const templateScore = hasTemplates ? 30 : 0;
        const overrideScore = hasTemplates && manifest.features.templates.some(t => t.overridePath !== '') ? 20 : 0;
        const score = Math.min(hookScore + templateScore + overrideScore, 100);
        areas.push({
            area: 'Extensibility',
            level: scoreToMaturity(score),
            score,
            details: `Extension via ${extItems.join(', ')}`,
            items: extItems,
        });
    }
    // 7. Integrations maturity
    const hasIntegrations = manifest.features.integrations.length > 0;
    const hasCli = manifest.features.cliCommands.length > 0;
    const intItems = [];
    if (hasIntegrations)
        intItems.push(`${manifest.features.integrations.length} integrations`);
    if (hasCli)
        intItems.push(`${manifest.features.cliCommands.length} CLI commands`);
    if (!hasIntegrations && !hasCli) {
        areas.push({ area: 'Integrations', level: 'missing', score: 0, details: 'No third-party integrations', items: [] });
    }
    else {
        const score = Math.round(((hasIntegrations ? 60 : 0) + (hasCli ? 40 : 0)));
        areas.push({
            area: 'Integrations',
            level: scoreToMaturity(score),
            score,
            details: `Integrates via ${intItems.join(', ')}`,
            items: intItems,
        });
    }
    // 8. Automation maturity (cron, scheduled tasks)
    const hasCron = manifest.features.cronJobs.length > 0;
    if (!hasCron) {
        areas.push({ area: 'Automation', level: 'missing', score: 0, details: 'No scheduled tasks', items: [] });
    }
    else {
        const cronItems = [`${manifest.features.cronJobs.length} cron jobs`];
        areas.push({
            area: 'Automation',
            level: hasCron && hasDeactivation ? 'complete' : 'basic',
            score: hasCron && hasDeactivation ? 80 : 50,
            details: `Automation via ${cronItems.join(', ')}`,
            items: cronItems,
        });
    }
    return areas;
}
function scoreToMaturity(score) {
    if (score >= 90)
        return 'excellent';
    if (score >= 70)
        return 'complete';
    if (score >= 40)
        return 'basic';
    if (score > 0)
        return 'stub';
    return 'missing';
}
// ─── Build Inventory ──────────────────────────────────────────────
function buildInventory(manifest) {
    return {
        cpts: manifest.features.cpts.length,
        taxonomies: manifest.features.taxonomies.length,
        restRoutes: manifest.features.restRoutes.length,
        ajaxHandlers: manifest.features.ajaxHandlers.length,
        blocks: manifest.features.blocks.length,
        shortcodes: manifest.features.shortcodes.length,
        adminPages: manifest.features.adminPages.length,
        settings: manifest.features.settings.length,
        widgets: manifest.features.widgets.length,
        metaBoxes: manifest.features.metaBoxes.length,
        cronJobs: manifest.features.cronJobs.length,
        cliCommands: manifest.features.cliCommands.length,
        dbTables: manifest.features.dbTables.length,
        templates: manifest.features.templates.length,
        hooksProvided: manifest.features.hooks.provided.length,
        hooksConsumed: manifest.features.hooks.consumed.length,
        activationHooks: manifest.features.activationHooks.length,
        customRoles: manifest.features.customRoles.length,
        integrations: manifest.features.integrations.length,
    };
}
// ─── Main Analyzer ────────────────────────────────────────────────
export function analyzeGaps(manifest) {
    const gaps = [];
    let gapIndex = 1;
    // Evaluate conditional rules
    for (const rule of CONDITIONAL_RULES) {
        if (rule.trigger(manifest) && !rule.check(manifest)) {
            gaps.push({
                id: `GAP-${String(gapIndex++).padStart(3, '0')}`,
                rule: rule.id,
                priority: rule.priority,
                type: 'conditional',
                trigger: rule.triggerLabel,
                finding: rule.finding,
                recommendation: rule.recommendation,
                effort: rule.effort,
            });
        }
    }
    // Evaluate unconditional rules
    for (const rule of UNCONDITIONAL_RULES) {
        if (!rule.check(manifest, manifest.pluginPath)) {
            gaps.push({
                id: `GAP-${String(gapIndex++).padStart(3, '0')}`,
                rule: rule.id,
                priority: rule.priority,
                type: 'unconditional',
                trigger: 'Every plugin',
                finding: rule.finding,
                recommendation: rule.recommendation,
                effort: rule.effort,
            });
        }
    }
    // Sort by priority
    const priorityOrder = { critical: 0, important: 1, recommended: 2, 'nice-to-have': 3 };
    gaps.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    const inventory = buildInventory(manifest);
    const maturity = assessMaturity(manifest);
    // Overall maturity = weighted average of area scores
    const maturityScores = maturity.filter(m => m.score > 0);
    const overallMaturityScore = maturityScores.length > 0
        ? Math.round(maturityScores.reduce((sum, m) => sum + m.score, 0) / maturityScores.length)
        : 0;
    return {
        pluginName: manifest.header.name || manifest.header.slug,
        pluginVersion: manifest.header.version,
        analyzedAt: new Date().toISOString(),
        inventory,
        maturity,
        gaps,
        overallMaturity: scoreToMaturity(overallMaturityScore),
        overallMaturityScore,
        summary: {
            totalGaps: gaps.length,
            critical: gaps.filter(g => g.priority === 'critical').length,
            important: gaps.filter(g => g.priority === 'important').length,
            recommended: gaps.filter(g => g.priority === 'recommended').length,
            niceToHave: gaps.filter(g => g.priority === 'nice-to-have').length,
        },
    };
}
// ─── Format Gap Analysis Report ───────────────────────────────────
export function formatGapAnalysis(result) {
    const lines = [];
    lines.push(`# Gap Analysis: ${result.pluginName} v${result.pluginVersion}`);
    lines.push(`Analyzed: ${result.analyzedAt.split('T')[0]}  |  Overall Maturity: ${result.overallMaturity.toUpperCase()} (${result.overallMaturityScore}/100)`);
    lines.push('');
    // Inventory
    lines.push('## Plugin Inventory');
    const inv = result.inventory;
    const inventoryItems = [
        inv.cpts > 0 ? `${inv.cpts} CPTs` : null,
        inv.taxonomies > 0 ? `${inv.taxonomies} Taxonomies` : null,
        inv.restRoutes > 0 ? `${inv.restRoutes} REST Routes` : null,
        inv.ajaxHandlers > 0 ? `${inv.ajaxHandlers} AJAX Handlers` : null,
        inv.blocks > 0 ? `${inv.blocks} Blocks` : null,
        inv.shortcodes > 0 ? `${inv.shortcodes} Shortcodes` : null,
        inv.adminPages > 0 ? `${inv.adminPages} Admin Pages` : null,
        inv.settings > 0 ? `${inv.settings} Settings` : null,
        inv.widgets > 0 ? `${inv.widgets} Widgets` : null,
        inv.metaBoxes > 0 ? `${inv.metaBoxes} Meta Boxes` : null,
        inv.cronJobs > 0 ? `${inv.cronJobs} Cron Jobs` : null,
        inv.cliCommands > 0 ? `${inv.cliCommands} CLI Commands` : null,
        inv.dbTables > 0 ? `${inv.dbTables} DB Tables` : null,
        inv.templates > 0 ? `${inv.templates} Templates` : null,
        inv.hooksProvided > 0 ? `${inv.hooksProvided} Hooks Provided` : null,
        inv.customRoles > 0 ? `${inv.customRoles} Custom Roles` : null,
        inv.integrations > 0 ? `${inv.integrations} Integrations` : null,
    ].filter(Boolean);
    lines.push(inventoryItems.join(' | '));
    lines.push('');
    // Maturity Assessment
    lines.push('## Feature Maturity');
    lines.push('| Area | Level | Score | Details |');
    lines.push('|------|-------|-------|---------|');
    for (const m of result.maturity) {
        const levelIcon = maturityIcon(m.level);
        lines.push(`| ${m.area} | ${levelIcon} ${m.level} | ${m.score}/100 | ${m.details} |`);
    }
    lines.push('');
    // Gaps by priority
    if (result.summary.totalGaps === 0) {
        lines.push('## No Gaps Found');
        lines.push('Plugin covers all expected features based on its architecture.');
        return lines.join('\n');
    }
    lines.push(`## Gaps Found: ${result.summary.totalGaps}`);
    lines.push(`Critical: ${result.summary.critical} | Important: ${result.summary.important} | Recommended: ${result.summary.recommended} | Nice-to-have: ${result.summary.niceToHave}`);
    lines.push('');
    const critical = result.gaps.filter(g => g.priority === 'critical');
    const important = result.gaps.filter(g => g.priority === 'important');
    const recommended = result.gaps.filter(g => g.priority === 'recommended');
    const niceToHave = result.gaps.filter(g => g.priority === 'nice-to-have');
    if (critical.length > 0) {
        lines.push('### CRITICAL (fix before release)');
        for (const gap of critical) {
            lines.push(`- **${gap.finding}** [${gap.effort} effort]`);
            lines.push(`  Trigger: ${gap.trigger}`);
            lines.push(`  Fix: ${gap.recommendation}`);
        }
        lines.push('');
    }
    if (important.length > 0) {
        lines.push('### IMPORTANT (should fix)');
        for (const gap of important) {
            lines.push(`- **${gap.finding}** [${gap.effort} effort]`);
            lines.push(`  Trigger: ${gap.trigger}`);
            lines.push(`  Fix: ${gap.recommendation}`);
        }
        lines.push('');
    }
    if (recommended.length > 0) {
        lines.push('### RECOMMENDED (good practice)');
        for (const gap of recommended) {
            lines.push(`- **${gap.finding}** [${gap.effort} effort]`);
            lines.push(`  Fix: ${gap.recommendation}`);
        }
        lines.push('');
    }
    if (niceToHave.length > 0) {
        lines.push('### NICE-TO-HAVE (polish)');
        for (const gap of niceToHave) {
            lines.push(`- ${gap.finding} [${gap.effort} effort]`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
function maturityIcon(level) {
    switch (level) {
        case 'excellent': return '[*****]';
        case 'complete': return '[****-]';
        case 'basic': return '[**---]';
        case 'stub': return '[*----]';
        case 'missing': return '[-----]';
    }
}
//# sourceMappingURL=gap-analyzer.js.map