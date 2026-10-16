/**
 * Journey-audit module — customer-experience matrix per release, plugin-agnostic.
 *
 * The MCP owns the *method* (three lenses, severity rubric, briefing prompt
 * shape, matrix consolidation). Each plugin owns its *journeys* — they live
 * in the plugin tree at:
 *
 *   <plugin_path>/docs/audit/journeys.json
 *
 * That file is the source of truth for which customer surfaces matter and
 * what the customer expects from each. A new plugin scaffolds a starter
 * via wppqa_audit_init_journeys and then edits the file to fit its product.
 *
 * Three exported functions, three new MCP tools:
 *
 *   wppqa_audit_init_journeys      -> initJourneys()
 *   wppqa_audit_get_briefing       -> getBriefing()
 *   wppqa_audit_consolidate_matrix -> consolidateMatrix()
 *
 * Dispatching the per-journey audits is the caller's job (Claude's Agent
 * tool), not the MCP's. The MCP returns the briefing prompts; Claude runs
 * them in parallel; Claude calls back to consolidateMatrix when done.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanPlugin } from './scanner.js';
const JOURNEYS_RELPATH = 'docs/audit/journeys.json';
const DEFAULT_LENSES = [
    {
        id: 'customer_expectation',
        label: 'Customer expectation',
        prompt: 'What would a typical site owner / member expect when they need this?',
    },
    {
        id: 'current_reality',
        label: 'Current reality',
        prompt: 'What actually happens on a fresh install when they try?',
    },
    {
        id: 'long_term_fix',
        label: 'Long-term fix',
        prompt: 'What change closes the gap (UX / default / missing feature / doc / nothing)?',
    },
];
const DEFAULT_SEVERITY_RUBRIC = [
    { emoji: '🟢', label: 'matches expectation' },
    {
        emoji: '🟡',
        label: 'works with friction (workarounds exist, but the user has to learn them)',
    },
    {
        emoji: '🔴',
        label: 'breaks expectation / sends user to support / forces wp-admin trip for a daily-life task (auto-red, even if it works)',
    },
    { emoji: '⚪', label: 'skipped (third-party dependency not active)' },
];
/* ─────────────────────────────────────────────────────────────── */
/* Tool 1: scaffold a starter journeys.json in the plugin           */
/* ─────────────────────────────────────────────────────────────── */
const STARTER_JOURNEYS = {
    product_name: 'Replace with your plugin name',
    description: 'Replace this description. Edit the journeys list below to reflect the customer-facing surfaces of your plugin. Each journey is one customer perspective; each feature is one surface that customer touches. The audit method is plugin-agnostic - the journeys are your contract.',
    lenses: DEFAULT_LENSES,
    severity_rubric: DEFAULT_SEVERITY_RUBRIC,
    journeys: [
        {
            id: 'first-run-setup',
            name: 'First-run + setup',
            perspective: 'Site owner who just activated the plugin',
            features: [
                {
                    id: 'plugin-activation',
                    name: 'Plugin activation',
                    expectation: 'Activate the plugin, see a clear "what now?" prompt within 30 seconds',
                },
                {
                    id: 'setup-wizard',
                    name: 'Setup wizard or first-run flow',
                    expectation: 'Produce a working plugin state in <5 minutes; what is still empty after?',
                },
                {
                    id: 'first-task',
                    name: 'First real task (replace with your domain - first space, first product, first form, etc.)',
                    expectation: 'Site owner accomplishes the headline task without a wp-admin trip when reasonable',
                },
            ],
        },
        {
            id: 'daily-use',
            name: 'Daily use',
            perspective: 'A typical user actually using the plugin day-to-day',
            features: [
                {
                    id: 'core-action',
                    name: 'Core action (replace with your domain - post, purchase, vote, etc.)',
                    expectation: 'The headline action works at extreme scale, on mobile, with real customer content',
                },
            ],
        },
        {
            id: 'admin',
            name: 'Admin / moderation',
            perspective: 'Running the plugin for a community / store / business',
            features: [
                {
                    id: 'admin-list',
                    name: 'Admin list and bulk actions',
                    expectation: 'Discover, filter, edit, delete with bulk select and inline edit',
                },
            ],
        },
        {
            id: 'integrations',
            name: 'Integrations + extensions',
            perspective: 'Site owner enabling third-party integrations',
            features: [
                {
                    id: 'sample-integration',
                    name: 'Sample integration (replace with your real integration list)',
                    expectation: 'Auto-detection works, default config is sane, customer doc matches reality',
                },
            ],
        },
    ],
};
/* ─── Auto-discovery from PluginManifest ──────────────────── */
const SETUP_PAGE_RE = /setup|wizard|onboard/i;
function safeId(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
function autoDiscoverJourneys(manifest) {
    const journeys = [];
    const features = manifest.features;
    /* Journey 1: First-run + setup */
    const firstRun = {
        id: 'first-run-setup',
        name: 'First-run + setup',
        perspective: 'Site owner who just activated the plugin',
        features: [
            {
                id: 'plugin-activation',
                name: 'Plugin activation',
                expectation: 'Activate the plugin, see a clear "what now?" prompt within 30 seconds',
            },
        ],
    };
    if (features.activationHooks.length > 0) {
        firstRun.features.push({
            id: 'activation-hooks',
            name: `Activation hooks (${features.activationHooks.length})`,
            expectation: 'All activation hooks complete cleanly; plugin is in a working state on the next page load',
        });
    }
    const setupPage = features.adminPages.find((p) => SETUP_PAGE_RE.test(p.slug) || SETUP_PAGE_RE.test(p.title));
    if (setupPage) {
        firstRun.features.push({
            id: 'setup-wizard',
            name: `Setup wizard (${setupPage.title})`,
            expectation: 'Wizard produces a working plugin state in <5 minutes; what is still empty after?',
        });
    }
    if (features.dbTables.length > 0) {
        firstRun.features.push({
            id: 'db-tables-created',
            name: `Database tables (${features.dbTables.length})`,
            expectation: 'All custom tables exist after activation; dbDelta migrations run cleanly on upgrade',
        });
    }
    if (features.customRoles.length > 0) {
        firstRun.features.push({
            id: 'custom-roles',
            name: `Custom roles / capabilities (${features.customRoles.length})`,
            expectation: 'Custom roles and capabilities register on activate; cleaned up on uninstall',
        });
    }
    journeys.push(firstRun);
    /* Journey 2: Daily use (frontend) */
    const dailyUse = {
        id: 'daily-use',
        name: 'Daily use (frontend)',
        perspective: 'A typical site visitor / member using the plugin day-to-day',
        features: [],
    };
    for (const cpt of features.cpts) {
        dailyUse.features.push({
            id: `cpt-frontend-${safeId(cpt.postType)}`,
            name: `${cpt.label} (${cpt.postType}) - frontend`,
            expectation: `Browse, view, and interact with ${cpt.label} entries on the frontend at extreme scale`,
        });
    }
    for (const tax of features.taxonomies) {
        dailyUse.features.push({
            id: `taxonomy-${safeId(tax.taxonomy)}`,
            name: `Taxonomy: ${tax.label} (${tax.taxonomy})`,
            expectation: `Term archive renders cleanly, term filter on CPT listing works, term assignment in editor saves`,
        });
    }
    for (const sc of features.shortcodes) {
        dailyUse.features.push({
            id: `shortcode-${safeId(sc.tag)}`,
            name: `Shortcode [${sc.tag}]`,
            expectation: 'Renders cleanly on a page, handles empty / large data gracefully, mobile-correct',
        });
    }
    for (const blk of features.blocks) {
        dailyUse.features.push({
            id: `block-frontend-${safeId(blk.name)}`,
            name: `Block (frontend): ${blk.title}`,
            expectation: 'Renders cleanly on a page; matches editor preview; handles attribute combinations',
        });
    }
    if (dailyUse.features.length > 0) {
        journeys.push(dailyUse);
    }
    /* Journey 3: Admin / management */
    const admin = {
        id: 'admin',
        name: 'Admin / management',
        perspective: 'Site owner managing the plugin from wp-admin',
        features: [],
    };
    for (const page of features.adminPages) {
        if (page === setupPage) {
            continue;
        }
        admin.features.push({
            id: `admin-page-${safeId(page.slug)}`,
            name: `Admin page: ${page.title}`,
            expectation: 'Page loads without errors; controls are clear; bulk actions where appropriate; help / empty states present',
        });
    }
    for (const cpt of features.cpts) {
        admin.features.push({
            id: `cpt-admin-${safeId(cpt.postType)}`,
            name: `CPT admin: ${cpt.label} (${cpt.postType})`,
            expectation: 'List, create, edit, delete; bulk actions; inline edit; filters; quick search',
        });
    }
    for (const blk of features.blocks) {
        admin.features.push({
            id: `block-editor-${safeId(blk.name)}`,
            name: `Block (editor): ${blk.title}`,
            expectation: 'Inserts cleanly; attributes save; preview matches frontend; sidebar controls work',
        });
    }
    if (features.cronJobs.length > 0) {
        admin.features.push({
            id: 'cron-jobs',
            name: `Cron / scheduled tasks (${features.cronJobs.length})`,
            expectation: 'Tasks register; admin can see what runs and when; failures are surfaced',
        });
    }
    if (features.cliCommands.length > 0) {
        admin.features.push({
            id: 'cli-commands',
            name: `WP-CLI commands (${features.cliCommands.length})`,
            expectation: 'Commands self-document via `wp help`; primary flows reachable from CLI',
        });
    }
    if (features.widgets.length > 0) {
        admin.features.push({
            id: 'widgets',
            name: `Widgets (${features.widgets.length})`,
            expectation: 'Each widget has clear settings, sane defaults, and renders without errors',
        });
    }
    if (features.metaBoxes.length > 0) {
        admin.features.push({
            id: 'meta-boxes',
            name: `Meta boxes (${features.metaBoxes.length})`,
            expectation: 'Meta boxes save, validate, and round-trip; visible only on intended screens',
        });
    }
    if (features.settings.length > 0) {
        admin.features.push({
            id: 'settings',
            name: `Settings (${features.settings.length} options)`,
            expectation: 'Each option has clear copy, sane default, sanitisation callback, and a working "settings saved" round-trip',
        });
    }
    if (features.customRoles.length > 0) {
        admin.features.push({
            id: 'custom-roles',
            name: `Custom roles (${features.customRoles.length})`,
            expectation: 'Roles register on activation, capabilities gate the right surfaces, removal on uninstall is clean',
        });
    }
    if (features.imageSizes.length > 0) {
        dailyUse.features.push({
            id: 'image-sizes',
            name: `Image sizes (${features.imageSizes.length})`,
            expectation: 'Each registered size renders cleanly in the attachment picker and on the customer-visible surfaces that use it',
        });
    }
    if (admin.features.length > 0) {
        journeys.push(admin);
    }
    /* Journey 4: API contract (for app / integration consumers) */
    const apiNamespaces = new Map();
    for (const route of features.restRoutes) {
        apiNamespaces.set(route.namespace, (apiNamespaces.get(route.namespace) ?? 0) + 1);
    }
    if (apiNamespaces.size > 0 || features.ajaxHandlers.length > 0) {
        const api = {
            id: 'api-contract',
            name: 'API contract (app / integration consumers)',
            perspective: 'External app, mobile client, or third-party tool calling the plugin via REST',
            features: [],
        };
        for (const [ns, count] of apiNamespaces) {
            api.features.push({
                id: `rest-${safeId(ns)}`,
                name: `REST namespace ${ns} (${count} routes)`,
                expectation: 'Full CRUD coverage where appropriate; documented payload + response shapes; sane permission_callback per route',
            });
        }
        if (features.ajaxHandlers.length > 0) {
            api.features.push({
                id: 'ajax-handlers',
                name: `AJAX handlers (${features.ajaxHandlers.length})`,
                expectation: 'Frontend AJAX should be migrated to REST per the frontend-REST-only rule. Admin-only AJAX may stay.',
            });
        }
        journeys.push(api);
    }
    /* Journey 5: Integrations */
    if (features.integrations.length > 0) {
        const integ = {
            id: 'integrations',
            name: 'Integrations',
            perspective: 'Site owner enabling third-party integrations',
            features: features.integrations.map((i) => ({
                id: `integration-${safeId(i.type)}`,
                name: `${i.type} integration`,
                expectation: `Auto-detects ${i.type} via class_exists / function_exists; sane defaults; customer doc matches code; no fatal when third-party is deactivated`,
            })),
        };
        journeys.push(integ);
    }
    /* Cross-cutting: data integrity */
    if (features.dbTables.length > 0) {
        journeys.push({
            id: 'data-integrity',
            name: 'Data integrity',
            perspective: 'Plugin data at extreme scale, on schema upgrade, and on uninstall',
            features: [
                {
                    id: 'extreme-scale-reads',
                    name: `Extreme-scale reads on ${features.dbTables.length} custom tables`,
                    expectation: 'Every list query has LIMIT or cursor pagination; no all-rows reads on the customer path',
                },
                {
                    id: 'uninstall-cleanup',
                    name: 'Uninstall cleanup',
                    expectation: 'uninstall.php removes all custom tables, options, capabilities, cron events',
                },
                {
                    id: 'schema-migrations',
                    name: 'Schema migrations',
                    expectation: 'dbDelta migrations are idempotent; version bump triggers them; failures surface to admin',
                },
            ],
        });
    }
    return {
        product_name: manifest.header.name || path.basename(manifest.pluginPath),
        description: `Auto-discovered from plugin manifest scanned at ${manifest.scannedAt}. Review the journey list below: rename product_name, refine feature expectations to match your customer language, drop any surface that is not customer-facing, add anything the scanner missed. The audit method is plugin-agnostic; this list is the contract.`,
        lenses: DEFAULT_LENSES,
        severity_rubric: DEFAULT_SEVERITY_RUBRIC,
        journeys,
    };
}
export function initJourneys(args) {
    const target = path.join(args.plugin_path, JOURNEYS_RELPATH);
    const dir = path.dirname(target);
    if (fs.existsSync(target) && !args.force) {
        return {
            created: false,
            path: target,
            source: 'preserved',
            preview: 'File already exists. Pass `force: true` to overwrite, or edit the existing file directly. Use wppqa_audit_coverage_check to compare the existing journeys against the current code manifest.',
        };
    }
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    let payload;
    let source;
    let surfacesDiscovered;
    let scanError;
    if (args.starter_only) {
        payload = STARTER_JOURNEYS;
        source = 'starter';
    }
    else {
        try {
            const manifest = scanPlugin(args.plugin_path);
            payload = autoDiscoverJourneys(manifest);
            surfacesDiscovered = payload.journeys.reduce((acc, j) => acc + j.features.length, 0);
            source = 'auto-discovery';
        }
        catch (e) {
            // Scanner failed - the path is probably not a WP plugin or a
            // file is unreadable. Surface the error message so the user
            // knows auto-discovery did not silently produce the starter.
            scanError = e instanceof Error ? e.message : String(e);
            payload = STARTER_JOURNEYS;
            source = 'starter';
        }
    }
    const json = JSON.stringify(payload, null, 2) + '\n';
    fs.writeFileSync(target, json, 'utf8');
    const preview = source === 'auto-discovery'
        ? `Auto-discovered ${surfacesDiscovered} customer-facing surfaces from the plugin manifest, organised into ${payload.journeys.length} customer journeys. Review the file: rename product_name, refine feature expectations in your customer language, drop any non-customer-facing surface, add anything the scanner missed (the wppqa_audit_coverage_check tool surfaces gaps). Then call wppqa_audit_get_briefing to dispatch the per-journey audit.`
        : scanError
            ? `Auto-discovery failed (${scanError}); falling back to the generic starter skeleton. Edit journeys.json to match your plugin, or fix the scanner error and re-run with force: true.`
            : `Starter journeys.json scaffolded. Edit it to match your plugin: rename product_name, replace placeholder features with real customer-facing surfaces, add or remove journeys as needed. Then call wppqa_audit_get_briefing to dispatch the per-journey audit.`;
    return {
        created: true,
        path: target,
        source,
        surfaces_discovered: surfacesDiscovered,
        preview,
    };
}
/* ─────────────────────────────────────────────────────────────── */
/* Tool 2: build per-journey briefings                              */
/* ─────────────────────────────────────────────────────────────── */
function loadJourneys(pluginPath) {
    const file = path.join(pluginPath, JOURNEYS_RELPATH);
    if (!fs.existsSync(file)) {
        throw new Error(`No ${JOURNEYS_RELPATH} found in plugin path "${pluginPath}". ` +
            `Run wppqa_audit_init_journeys first to scaffold a starter, then edit it to match your plugin.`);
    }
    const raw = fs.readFileSync(file, 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (e) {
        throw new Error(`${file} is not valid JSON: ${e.message}`);
    }
    if (!parsed.product_name || !Array.isArray(parsed.journeys)) {
        throw new Error(`${file} is missing required fields. Expected at minimum: { product_name, journeys: [...] }.`);
    }
    return parsed;
}
function renderSeverityRubric(rubric) {
    return rubric.map((r) => `${r.emoji} ${r.label}`).join('\n- ');
}
function renderLenses(lenses) {
    return lenses.map((l) => `- **${l.label}:** ${l.prompt}`).join('\n');
}
function renderFeatureList(journey) {
    return journey.features
        .map((f, i) => `${i + 1}. **${f.name}** (\`${f.id}\`) — ${f.expectation}`)
        .join('\n');
}
function buildBriefing(product, journey, pluginPath, siteUrl, outputPath) {
    const lenses = product.lenses ?? DEFAULT_LENSES;
    const rubric = product.severity_rubric ?? DEFAULT_SEVERITY_RUBRIC;
    return `You are auditing a WordPress plugin for the customer-experience matrix. This is QA, not coding. Do NOT fix anything; produce findings only.

## Product

${product.product_name}${product.description ? ` — ${product.description}` : ''}

## Your scope: ${journey.name}

Perspective: ${journey.perspective}

Audit these ${journey.features.length} feature units. Each is one customer-facing surface, not a code module:

${renderFeatureList(journey)}

## Method

Three lenses per feature:
${renderLenses(lenses)}

Severity:
- ${renderSeverityRubric(rubric)}

A wp-admin trip for a daily-life task is automatically 🔴, even if it works. Cite file:line / DOM evidence; no speculation.

## Environment

- Plugin path: \`${pluginPath}\`
- Site: ${siteUrl}
- Auto-login: append \`?autologin=1\` to any URL for admin (member logins use \`?autologin=<login>\` if the plugin supports it).
- Tools available: Read, Bash (wp-cli + grep + ls), Grep, Glob, mcp__plugin_playwright_playwright__* for browser walks at 1280px and 390px, mcp__mcp-local-wp__* for DB queries.

## Output

Write a single Markdown file at \`${outputPath}\` with this structure:

\`\`\`markdown
# ${journey.name} audit

Run date: <ISO 8601>
Plugin: ${product.product_name}

## Summary

| Feature | Severity | One-line gap |
|---|---|---|
| <feature name> | 🟢/🟡/🔴/⚪ | ... |
| ... | | |

## 1. <Feature 1 name>

### Customer expectation
<one or two sentences>

### Current reality
<observed behaviour with file:line / DOM evidence>

### Long-term fix
<what closes the gap; tag if current-cycle / next-cycle / docs-only / wontfix>

### Severity: 🟢/🟡/🔴/⚪
\`\`\`

In your final message back, give an executive summary under 250 words: severity counts, list each 🔴 + 🟡 with one-line description, absolute path to the saved file.

## Important rules

- No em-dashes in your output. Use colons, commas, or " - ".
- No "likely / probably / should be" diagnoses. Observations only with file:line or DOM evidence.
- A wp-admin trip for a daily-life task is automatically 🔴.
- A default that surprises a typical site owner is 🟡 minimum.
- Audit the STATE OF TODAY. If a planned release fixes a gap, note that in the long-term-fix recommendation.

Report when done.`;
}
export function getBriefing(args) {
    const product = loadJourneys(args.plugin_path);
    const siteUrl = args.site_url ?? 'http://localhost';
    const outputDir = args.output_dir ??
        `/tmp/${path.basename(args.plugin_path)}-audit-${Date.now()}`;
    const briefings = product.journeys.map((j) => ({
        journey_id: j.id,
        journey_name: j.name,
        prompt: buildBriefing(product, j, args.plugin_path, siteUrl, `${outputDir}/${j.id}.md`),
        output_path: `${outputDir}/${j.id}.md`,
    }));
    return {
        product_name: product.product_name,
        briefings,
        consolidate_hint: `After all sub-agents finish, call wppqa_audit_consolidate_matrix with the list of paths returned in briefings[].output_path to get the final customer-experience matrix.`,
    };
}
export function coverageCheck(args) {
    const product = loadJourneys(args.plugin_path);
    const manifest = scanPlugin(args.plugin_path);
    // Build a haystack of every identifier the journeys.json mentions
    // (feature.id + feature.name lowercased). The check is a substring
    // match against the manifest identifier so the human-edited file does
    // not have to use the same exact ids the auto-discoverer would have.
    const haystack = product.journeys
        .flatMap((j) => j.features.flatMap((f) => [f.id.toLowerCase(), f.name.toLowerCase()]))
        .join('\n');
    // Group-level coverage: if the journeys file has a feature with a
    // name like "AJAX handlers (36)" or "Cron / scheduled tasks", that
    // feature blanket-covers every individual surface of that kind. This
    // lets a journeys.json keep one summary feature per kind instead of
    // enumerating dozens of internal handler names.
    const blanketKinds = new Set();
    if (/ajax\s*handler/i.test(haystack))
        blanketKinds.add('ajax');
    if (/cron|scheduled\s*task/i.test(haystack))
        blanketKinds.add('cron');
    if (/cli\s*command|wp-cli/i.test(haystack))
        blanketKinds.add('cli');
    if (/db\s*table|database\s*table|custom\s*table/i.test(haystack))
        blanketKinds.add('db');
    const matches = (needle) => haystack.includes(needle.toLowerCase());
    const missing = [];
    let total = 0;
    for (const cpt of manifest.features.cpts) {
        total++;
        if (!matches(cpt.postType) && !matches(cpt.label)) {
            missing.push({
                surface_kind: 'CPT',
                identifier: `${cpt.postType} (${cpt.label})`,
                suggestion: `Add a feature to the daily-use or admin journey covering "${cpt.label}" interactions`,
            });
        }
    }
    for (const sc of manifest.features.shortcodes) {
        total++;
        if (!matches(sc.tag)) {
            missing.push({
                surface_kind: 'shortcode',
                identifier: `[${sc.tag}]`,
                suggestion: `Add a feature to the daily-use journey covering the [${sc.tag}] shortcode`,
            });
        }
    }
    for (const blk of manifest.features.blocks) {
        total++;
        if (!matches(blk.name) && !matches(blk.title)) {
            missing.push({
                surface_kind: 'block',
                identifier: `${blk.title} (${blk.name})`,
                suggestion: `Add features to daily-use (frontend render) and admin (editor insert) journeys for the "${blk.title}" block`,
            });
        }
    }
    // REST routes are checked at namespace level: a plugin can have 50
    // routes in one namespace and the journeys file should mention the
    // namespace once. Counting per-route would deflate coverage_percent
    // for REST-heavy plugins for no useful reason.
    const restNamespaces = Array.from(new Set(manifest.features.restRoutes.map((r) => r.namespace)));
    for (const ns of restNamespaces) {
        total++;
        if (!matches(ns)) {
            missing.push({
                surface_kind: 'REST namespace',
                identifier: ns,
                suggestion: `Add a feature to the api-contract journey covering the ${ns} REST namespace`,
            });
        }
    }
    // Taxonomies are first-class customer-facing surfaces (term archives,
    // taxonomy filters); they must be covered by a journey feature when
    // the plugin registers them.
    for (const tax of manifest.features.taxonomies) {
        total++;
        if (!matches(tax.taxonomy) && !matches(tax.label)) {
            missing.push({
                surface_kind: 'taxonomy',
                identifier: `${tax.taxonomy} (${tax.label})`,
                suggestion: `Add a feature to the daily-use or admin journey covering "${tax.label}" terms (browse, filter, edit)`,
            });
        }
    }
    for (const ajax of manifest.features.ajaxHandlers) {
        total++;
        if (!matches(ajax.action) && !blanketKinds.has('ajax')) {
            missing.push({
                surface_kind: 'AJAX handler',
                identifier: ajax.action,
                suggestion: `Document this AJAX action in the api-contract journey, and flag it for migration to REST if frontend-callable`,
            });
        }
    }
    for (const page of manifest.features.adminPages) {
        total++;
        if (!matches(page.slug) && !matches(page.title)) {
            missing.push({
                surface_kind: 'admin page',
                identifier: `${page.slug} (${page.title})`,
                suggestion: `Add a feature to the admin journey covering the "${page.title}" admin page`,
            });
        }
    }
    for (const cron of manifest.features.cronJobs) {
        total++;
        if (!matches(cron.hook) && !blanketKinds.has('cron')) {
            missing.push({
                surface_kind: 'cron job',
                identifier: cron.hook,
                suggestion: `Document the ${cron.hook} cron event in the admin journey`,
            });
        }
    }
    for (const cli of manifest.features.cliCommands) {
        total++;
        if (!matches(cli.command) && !blanketKinds.has('cli')) {
            missing.push({
                surface_kind: 'CLI command',
                identifier: cli.command,
                suggestion: `Document the wp ${cli.command} CLI command in the admin journey`,
            });
        }
    }
    for (const tbl of manifest.features.dbTables) {
        total++;
        if (!matches(tbl.tableSuffix) && !blanketKinds.has('db')) {
            missing.push({
                surface_kind: 'DB table',
                identifier: tbl.tableSuffix,
                suggestion: `Add the ${tbl.tableSuffix} custom table to the data-integrity journey (extreme-scale reads + uninstall cleanup)`,
            });
        }
    }
    for (const integ of manifest.features.integrations) {
        total++;
        if (!matches(integ.type)) {
            missing.push({
                surface_kind: 'integration',
                identifier: integ.type,
                suggestion: `Add the ${integ.type} integration to the integrations journey`,
            });
        }
    }
    // Settings: customer-facing admin configuration surface.
    // Blanket-coverage word: "settings" (matches "Plugin settings",
    // "Settings page", "Admin settings", etc.).
    const hasSettingsBlanket = /\bsettings\b/i.test(haystack);
    for (const setting of manifest.features.settings) {
        total++;
        if (!matches(setting.optionName) && !hasSettingsBlanket) {
            missing.push({
                surface_kind: 'setting',
                identifier: setting.optionName,
                suggestion: `Document the ${setting.optionName} option in the admin journey (or add a "Settings" feature to blanket-cover all options)`,
            });
        }
    }
    // Custom roles + capabilities: customer-facing because they show up
    // in the Users admin and gate every admin-page capability check.
    for (const role of manifest.features.customRoles) {
        total++;
        if (!matches(role.role)) {
            missing.push({
                surface_kind: 'custom role',
                identifier: role.role,
                suggestion: `Document the ${role.role} role in the admin journey (capabilities, who gets it, what it gates)`,
            });
        }
    }
    // Meta boxes: user-facing on the post editor screen.
    for (const meta of manifest.features.metaBoxes) {
        total++;
        if (!matches(meta.id) && !matches(meta.title)) {
            missing.push({
                surface_kind: 'meta box',
                identifier: `${meta.id} (${meta.title})`,
                suggestion: `Document the "${meta.title}" meta box in the admin journey (which screens, what fields, save round-trip)`,
            });
        }
    }
    // Image sizes: appear in attachment picker; affect every image
    // upload flow.
    for (const size of manifest.features.imageSizes) {
        total++;
        if (!matches(size.name)) {
            missing.push({
                surface_kind: 'image size',
                identifier: size.name,
                suggestion: `Document the ${size.name} image size in the daily-use journey (where it renders, what dimensions / crop)`,
            });
        }
    }
    const covered = total - missing.length;
    const coverage_percent = total > 0 ? Math.round((covered * 100) / total) : 100;
    return {
        total_manifest_surfaces: total,
        covered,
        coverage_percent,
        missing,
    };
}
/** Identify a severity cell - emoji or word, case-insensitive. */
function severityFromCell(cell) {
    const c = cell.trim();
    if (c === '🔴' || c.toUpperCase() === 'RED')
        return 'red';
    if (c === '🟡' || c.toUpperCase() === 'YELLOW')
        return 'yellow';
    if (c === '🟢' || c.toUpperCase() === 'GREEN')
        return 'green';
    if (c === '⚪' || c.toUpperCase() === 'SKIPPED')
        return 'skipped';
    return null;
}
/** Find the column index whose value matches the severity column header. */
function findSeverityColumn(headerCells) {
    for (let i = 0; i < headerCells.length; i++) {
        if (headerCells[i].trim().toLowerCase() === 'severity') {
            return i;
        }
    }
    return -1;
}
function parseReport(filePath) {
    const journeyId = path.basename(filePath, '.md');
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    }
    catch (e) {
        // Sub-agent did not produce the report (most often: it crashed before
        // writing or the path was wrong). Return a sentinel record so the
        // consolidation step continues and surfaces the gap rather than
        // crashing the whole tool with an opaque ENOENT.
        return {
            journey_id: journeyId,
            journey_name: `MISSING: ${filePath} (${e.message})`,
            red: [],
            yellow: [],
            green: [],
            skipped: [],
        };
    }
    const journeyName = text.match(/^#\s+(.+)\s+audit/im)?.[1]?.trim() ?? journeyId;
    const red = [];
    const yellow = [];
    const green = [];
    const skipped = [];
    // Walk the file line by line. Find table blocks (consecutive `|`-rows),
    // identify the severity column from the header, then extract feature +
    // severity + gap from each data row. This handles 3-col tables (Feature |
    // Severity | Gap) and 4-col tables (# | Feature | Severity | Gap) and
    // anything else with a "Severity" column header.
    const lines = text.split(/\r?\n/);
    let inTable = false;
    let severityCol = -1;
    let featureCol = -1;
    let gapCol = -1;
    const splitRow = (line) => line
        .split('|')
        .slice(1, -1) // drop empty cells from leading and trailing `|`
        .map((c) => c.trim());
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isTableRow = /^\|.*\|/.test(line);
        if (!isTableRow) {
            inTable = false;
            severityCol = -1;
            featureCol = -1;
            gapCol = -1;
            continue;
        }
        // Start of a table: the header row. Next row should be a separator
        // (`|---|---|...`) followed by data rows.
        if (!inTable) {
            const headerCells = splitRow(line);
            severityCol = findSeverityColumn(headerCells);
            if (severityCol === -1) {
                // Not a severity-shaped table; skip.
                continue;
            }
            // Default convention: feature is the column immediately before
            // severity, gap is the column immediately after. Falls through if
            // either is out of range.
            featureCol = severityCol - 1;
            gapCol = severityCol + 1;
            // If the column before severity is "#" or numeric-looking, push
            // featureCol to severityCol - 2.
            if (featureCol >= 0) {
                const before = headerCells[featureCol].trim().toLowerCase();
                if (before === '#' || before === 'index') {
                    featureCol = severityCol - 2;
                }
            }
            inTable = true;
            continue;
        }
        // Separator row between header and data: `|---|---|...`
        if (/^\|[\s|:-]+\|$/.test(line) || /^\|\s*-+/.test(line)) {
            continue;
        }
        // Data row.
        const cells = splitRow(line);
        if (severityCol < 0 ||
            severityCol >= cells.length ||
            featureCol < 0 ||
            featureCol >= cells.length) {
            continue;
        }
        const sev = severityFromCell(cells[severityCol]);
        if (!sev) {
            continue;
        }
        const feature = cells[featureCol];
        const gap = gapCol >= 0 && gapCol < cells.length ? cells[gapCol] : '';
        if (!feature || feature.startsWith('---')) {
            continue;
        }
        const entry = { feature, gap };
        if (sev === 'red')
            red.push(entry);
        else if (sev === 'yellow')
            yellow.push(entry);
        else if (sev === 'green')
            green.push(entry);
        else if (sev === 'skipped')
            skipped.push(entry);
    }
    return {
        journey_id: journeyId,
        journey_name: journeyName,
        red,
        yellow,
        green,
        skipped,
    };
}
function renderMatrix(productName, reports, pluginPath, reportPaths) {
    const totals = reports.reduce((acc, r) => ({
        red: acc.red + r.red.length,
        yellow: acc.yellow + r.yellow.length,
        green: acc.green + r.green.length,
        skipped: acc.skipped + r.skipped.length,
    }), { red: 0, yellow: 0, green: 0, skipped: 0 });
    const sum = totals.red + totals.yellow + totals.green + totals.skipped;
    const pct = (n) => sum > 0 ? `${Math.round((n * 100) / sum)}%` : '0%';
    const today = new Date().toISOString().slice(0, 10);
    const lines = [];
    lines.push(`# Customer-experience matrix: ${productName}`);
    lines.push('');
    lines.push(`**Audit date:** ${today}`);
    lines.push(`**Plugin path:** \`${pluginPath}\``);
    lines.push(`**Method:** parallel Sonnet sub-agents per customer journey, three lenses (customer expectation / current reality / long-term fix), severity rubric (🟢 matches expectation, 🟡 friction, 🔴 broken, ⚪ skipped — third-party not active). Journeys defined in \`${JOURNEYS_RELPATH}\`.`);
    lines.push('**Per-journey reports:**');
    for (const p of reportPaths) {
        lines.push(`- \`${p}\``);
    }
    lines.push('');
    lines.push('## Severity counts');
    lines.push('');
    lines.push('| Slice | 🔴 | 🟡 | 🟢 | ⚪ | Total |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of reports) {
        const t = r.red.length + r.yellow.length + r.green.length + r.skipped.length;
        lines.push(`| ${r.journey_name} | ${r.red.length} | ${r.yellow.length} | ${r.green.length} | ${r.skipped.length} | ${t} |`);
    }
    lines.push(`| **Total** | **${totals.red}** | **${totals.yellow}** | **${totals.green}** | **${totals.skipped}** | **${sum}** |`);
    lines.push('');
    lines.push(`${totals.red} of ${sum} audited surfaces (${pct(totals.red)}) break customer expectation. ${totals.yellow} (${pct(totals.yellow)}) work with friction.`);
    lines.push('');
    lines.push('## Reds (sorted by journey)');
    lines.push('');
    if (totals.red === 0) {
        lines.push('_No 🔴 findings. Plugin matches customer expectation across every audited journey._');
    }
    else {
        lines.push('| Journey | Surface | Today |');
        lines.push('|---|---|---|');
        for (const r of reports) {
            for (const f of r.red) {
                lines.push(`| ${r.journey_name} | ${f.feature} | ${f.gap} |`);
            }
        }
    }
    lines.push('');
    lines.push('## Yellows by journey');
    lines.push('');
    let anyYellow = false;
    for (const r of reports) {
        if (r.yellow.length === 0) {
            continue;
        }
        anyYellow = true;
        lines.push(`### ${r.journey_name}`);
        for (const f of r.yellow) {
            lines.push(`- **${f.feature}** — ${f.gap}`);
        }
        lines.push('');
    }
    if (!anyYellow) {
        lines.push('_No 🟡 findings._');
        lines.push('');
    }
    lines.push('## Greens');
    lines.push('');
    let anyGreen = false;
    for (const r of reports) {
        if (r.green.length === 0) {
            continue;
        }
        anyGreen = true;
        const names = r.green.map((f) => f.feature).join(', ');
        lines.push(`- **${r.journey_name}:** ${names}`);
    }
    if (!anyGreen) {
        lines.push('_No 🟢 findings._');
    }
    lines.push('');
    if (totals.skipped > 0) {
        lines.push('## Skipped (third-party dependency not active)');
        lines.push('');
        for (const r of reports) {
            for (const f of r.skipped) {
                lines.push(`- **${r.journey_name} / ${f.feature}** — ${f.gap}`);
            }
        }
        lines.push('');
    }
    lines.push('## Living-doc rule');
    lines.push('');
    lines.push('Regenerate this matrix per release using the same five-journey audit. Re-running the audit after the next release should show 🔴 shrinking, 🟢 growing. Track deferred items here with their target version.');
    return lines.join('\n');
}
export function consolidateMatrix(args) {
    // Best-effort: load product name from the plugin's journeys.json if present.
    let productName = path.basename(args.plugin_path);
    const journeysFile = path.join(args.plugin_path, JOURNEYS_RELPATH);
    if (fs.existsSync(journeysFile)) {
        try {
            const j = JSON.parse(fs.readFileSync(journeysFile, 'utf8'));
            if (j.product_name) {
                productName = j.product_name;
            }
        }
        catch {
            // fall through with directory basename
        }
    }
    const reports = args.report_paths.map(parseReport);
    const matrix = renderMatrix(productName, reports, args.plugin_path, args.report_paths);
    const dir = path.dirname(args.output_path);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(args.output_path, matrix, 'utf8');
    const totals = reports.reduce((acc, r) => ({
        red: acc.red + r.red.length,
        yellow: acc.yellow + r.yellow.length,
        green: acc.green + r.green.length,
        skipped: acc.skipped + r.skipped.length,
    }), { red: 0, yellow: 0, green: 0, skipped: 0 });
    const sum = totals.red + totals.yellow + totals.green + totals.skipped;
    const reds = [];
    for (const r of reports) {
        for (const f of r.red) {
            reds.push(`${r.journey_name} / ${f.feature}: ${f.gap}`);
        }
    }
    return {
        output_path: args.output_path,
        totals: { ...totals, total: sum },
        reds,
    };
}
//# sourceMappingURL=journey-audit.js.map