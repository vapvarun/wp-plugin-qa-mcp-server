/**
 * WP Plugin QA MCP Server - Plan Bootstrap
 * Scans a plugin and scaffolds `plan/` (role matrix, fresh-install fixture,
 * per-feature flow stubs, regression README, coverage checklist). Output is
 * schema-compatible with `wppqa_probe_roles` and `wppqa_run_flow`. Every
 * scaffolded value is derived from the live scanner manifest.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { scanPlugin } from './scanner.js';
import { dirExists, fileExists } from './shared-utils.js';
import type {
  PluginManifest, RestRouteInfo, ShortcodeInfo, AdminPageInfo, CptInfo,
} from './types.js';

// ─── Public Types ──────────────────────────────────────────────────

export interface BootstrapPlanOptions {
  pluginPath: string;
  overwrite?: boolean;
  scanManifestCache?: PluginManifest;
}

export interface BootstrapReport {
  pluginSlug: string;
  pluginName: string;
  planDir: string;
  created: string[];
  skipped: { path: string; reason: string }[];
  stats: {
    restRoutes: number;
    ajaxActions: number;
    shortcodes: number;
    cpts: number;
    adminPages: number;
    cronEvents: number;
    flowsSeeded: number;
    fixturesSeeded: number;
  };
  nextSteps: string[];
}

const CONSUMER_TOOLS: Array<{ name: string; purpose: string }> = [
  { name: 'wppqa_probe_roles', purpose: 'reads `role-matrix.yml` to decide the expected REST/AJAX status per role.' },
  { name: 'wppqa_run_flow', purpose: 'runs one flow under Playwright with the named fixture applied first.' },
  { name: 'wppqa_run_all_flows', purpose: 'walks `flows/` and produces one merged pass/fail report.' },
  { name: 'wppqa_cross_reference_data', purpose: 'surfaces stale-read stores that reader flows depend on.' },
];

// ─── Entry ─────────────────────────────────────────────────────────

export async function bootstrapPlan(opts: BootstrapPlanOptions): Promise<BootstrapReport> {
  const { pluginPath, overwrite = false } = opts;
  const manifest = opts.scanManifestCache ?? scanPlugin(pluginPath);

  const pluginSlug = deriveSlug(manifest, pluginPath);
  const pluginName = manifest.header.name || pluginSlug;
  const prefix = derivePrefix(manifest.header.textDomain || pluginSlug);

  const planDir = join(pluginPath, 'plan');
  const created: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  ensureDir(planDir);
  ensureDir(join(planDir, 'fixtures'));
  ensureDir(join(planDir, 'flows'));
  ensureDir(join(planDir, 'regression'));

  const write = (rel: string, content: string) =>
    writeIfAllowed(join(planDir, rel), content, overwrite, created, skipped, planDir);

  write('README.md', renderReadme(pluginName, pluginSlug));
  write('role-matrix.yml', renderRoleMatrix(manifest, prefix));
  write('fixtures/fresh-install.md', renderFreshInstall(manifest, pluginName, prefix));
  write('regression/README.md', renderRegressionReadme());
  write('coverage.md', renderCoverage(manifest));
  let flowsSeeded = 0;
  for (const sc of uniqueByKey(manifest.features.shortcodes, (s) => s.tag)) {
    if (write(`flows/shortcode-${kebab(sc.tag)}.yml`, renderShortcodeFlow(sc, pluginName))) flowsSeeded++;
  }
  for (const page of uniqueByKey(manifest.features.adminPages, (p) => p.slug)) {
    if (!isPortalTabLike(page)) continue;
    if (write(`flows/admin-${kebab(page.slug)}.yml`, renderAdminFlow(page, pluginName))) flowsSeeded++;
  }
  for (const cpt of uniqueByKey(manifest.features.cpts, (c) => c.postType)) {
    if (write(`flows/cpt-${kebab(cpt.postType)}-crud.yml`, renderCptFlow(cpt, pluginName))) flowsSeeded++;
  }

  const stats = {
    restRoutes: manifest.features.restRoutes.length,
    ajaxActions: manifest.features.ajaxHandlers.length,
    shortcodes: manifest.features.shortcodes.length,
    cpts: manifest.features.cpts.length,
    adminPages: manifest.features.adminPages.length,
    cronEvents: manifest.features.cronJobs.length,
    flowsSeeded,
    fixturesSeeded: 1,
  };

  const nextSteps: string[] = [];
  if (overwrite) nextSteps.push('WARNING: overwrite=true was used — hand-edited files may have been replaced. Review git diff before committing.');
  nextSteps.push('Fill in TODO markers in each `flows/*.yml` — preconditions + observe blocks are stubs.');
  nextSteps.push('Review `role-matrix.yml` — route patterns are heuristic, tighten per real permission callbacks.');
  nextSteps.push('Add fixtures under `fixtures/` for non-fresh states (populated-data, cancelled, past-due).');
  nextSteps.push('When closing a Basecamp bug card, add `regression/<card-id>-<slug>.yml` before moving to Ready for Testing.');
  nextSteps.push('Keep `coverage.md` honest — check a box only when the referenced flow is green locally.');

  return { pluginSlug, pluginName, planDir, created, skipped, stats, nextSteps };
}

// ─── Helpers ───────────────────────────────────────────────────────

function deriveSlug(manifest: PluginManifest, pluginPath: string): string {
  const td = (manifest.header.textDomain || '').trim();
  return td || basename(pluginPath);
}

function derivePrefix(textDomain: string): string {
  const token = (textDomain || 'plugin').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return token.split('_')[0] || 'plugin';
}

function kebab(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

function ensureDir(path: string): void {
  if (!dirExists(path)) mkdirSync(path, { recursive: true });
}

function writeIfAllowed(
  fullPath: string,
  content: string,
  overwrite: boolean,
  created: string[],
  skipped: { path: string; reason: string }[],
  planRoot: string,
): boolean {
  const rel = fullPath.startsWith(planRoot + '/') ? `plan/${fullPath.slice(planRoot.length + 1)}` : fullPath;
  if (fileExists(fullPath) && !overwrite) {
    skipped.push({ path: rel, reason: 'already exists' });
    return false;
  }
  ensureDir(dirname(fullPath));
  writeFileSync(fullPath, content, 'utf-8');
  created.push(rel);
  return true;
}

function uniqueByKey<T>(items: T[], keyFn: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function isPortalTabLike(page: AdminPageInfo): boolean {
  const slug = (page.slug || '').toLowerCase();
  const title = (page.title || '').toLowerCase();
  return /tab/.test(slug) || /portal/.test(slug) || /tab/.test(title) || /dashboard/.test(slug);
}

// ─── README ────────────────────────────────────────────────────────

function renderReadme(pluginName: string, pluginSlug: string): string {
  const toolLines = CONSUMER_TOOLS.map((t) => `- \`${t.name}\` ${t.purpose}`).join('\n');
  return `# QA Plan — ${pluginName}

This folder is the source of truth for the plugin's manual and automated QA.
Every user-facing feature maps to exactly one thing in here, and every
resolved Basecamp bug card graduates into a permanent regression fixture.
Nothing gets tested from memory.

Plugin slug: \`${pluginSlug}\`

Consumed by the \`wp-plugin-qa-mcp-server\` tools:
${toolLines}

## Folder layout

\`\`\`
plan/
  README.md                  # this file
  coverage.md                # feature x layer x state grid — what's covered
  role-matrix.yml            # expected capability + status per role per route
  fixtures/                  # named DB seed states — composable preconditions
    fresh-install.md
  flows/                     # executable end-user journeys
    shortcode-*.yml
    admin-*.yml
    cpt-*-crud.yml
  regression/                # one file per closed bug card — never deleted
    README.md
\`\`\`

## Flow file anatomy

\`\`\`yaml
flow: <unique-slug>
title: <human title>
role: <role id from role-matrix.yml>
fixture: <fixture id from fixtures/>
preconditions:
  - <human-readable assertion the fixture must satisfy>
steps:
  - id: 1
    action: navigate | click | type | submit
    url: <relative URL>
    selector: <CSS selector>
    value: <string>
    observe:
      - selector: .foo
        count: 3
      - selector: .bar
        text_contains: 'Ready for'
      - console_errors: 0
    screenshot: 01-first-load.png
\`\`\`

## Rules

1. **Every step requires an observation.** No bare "click Next" with no assertion.
2. **Every bug that hits \`Ready for Testing\` gets a \`regression/<card-id>-slug.yml\`** before the card moves.
3. **Flow + role pairing is mandatory.** Running a flow as the wrong role does not count as coverage.
4. **The role-matrix is the expected-state baseline.** When a REST permission changes, update \`role-matrix.yml\` in the same commit.
5. **Fixtures are composable and idempotent.** Running a fixture twice must produce the same DB state.

## Coverage gate

\`coverage.md\` is a checklist of every shortcode, admin page, CPT, and REST route family.
A checkbox is only marked when a flow in \`flows/\` exercises it under the role declared
in \`role-matrix.yml\`. Uncovered rows are technical debt.
`;
}

// ─── Role matrix ───────────────────────────────────────────────────

interface RouteFamily {
  pattern: string;
  adminOnly: boolean;
  selfScoped: boolean;
}

function renderRoleMatrix(manifest: PluginManifest, prefix: string): string {
  const out: string[] = [
    '# Role matrix — expected REST/AJAX status per role.',
    '# Consumed by `wppqa_probe_roles`. Update in the same commit as any permission_callback change.',
    '',
    'roles:',
    '  guest:',
    '    label: Not logged in',
    '    auth: none',
    '    cookie: ~',
    '',
  ];
  for (const role of ['subscriber', 'editor', 'admin']) {
    out.push(
      `  ${role}:`,
      `    label: ${role.charAt(0).toUpperCase() + role.slice(1)}`,
      '    auth: cookie',
      '    cookie:',
      `      name: ${prefix}_dev_as`,
      `      value: ${role}`,
      '',
    );
  }
  out.push(
    '# One entry per route family. Patterns support trailing `*` for sub-paths.',
    '# Order of lookup: longest pattern wins.',
    'routes:',
    '',
  );
  const families = buildRouteFamilies(manifest.features.restRoutes);
  if (families.length === 0) out.push('  # No REST routes discovered. Add entries manually if the plugin ships any.', '');
  for (const f of families) {
    const rows = f.adminOnly
      ? ['      guest: 401', '      subscriber: 403', '      editor: 403', '      admin: 200']
      : ['      guest: 401', '      subscriber: 200', '      editor: 200', '      admin: 200'];
    out.push(`  - match: ${f.pattern}`, '    expected:', ...rows, '');
  }
  for (const ajax of uniqueByKey(manifest.features.ajaxHandlers, (a) => a.action)) {
    out.push(
      `  - match: ajax:${ajax.action}`,
      '    expected:',
      `      guest: ${ajax.loggedOut ? 200 : 401}`,
      '      subscriber: 200',
      '      editor: 200',
      '      admin: 200',
      '',
    );
  }
  return out.join('\n');
}

function buildRouteFamilies(routes: RestRouteInfo[]): RouteFamily[] {
  const patterns = new Map<string, RouteFamily>();
  for (const route of routes) {
    const ns = (route.namespace || '').replace(/^\/+|\/+$/g, '');
    const path = (route.route || '').replace(/^\/+/, '');
    if (!ns) continue;
    const f = classifyRoute(route, ns, path);
    const existing = patterns.get(f.pattern);
    if (!existing) {
      patterns.set(f.pattern, f);
    } else {
      existing.adminOnly = existing.adminOnly || f.adminOnly;
      existing.selfScoped = existing.selfScoped || f.selfScoped;
    }
  }
  return Array.from(patterns.values()).sort((a, b) => b.pattern.length - a.pattern.length);
}

function classifyRoute(route: RestRouteInfo, ns: string, path: string): RouteFamily {
  const full = `/${ns}/${path}`.replace(/\/+/g, '/').replace(/\/$/, '');
  const lower = full.toLowerCase();
  const cb = (route.permissionCallback || '').toLowerCase();
  const adminOnly =
    /\/admin(\/|$)/.test(lower) ||
    /\/export(\/|$)/.test(lower) ||
    cb.includes('manage_options');
  const selfScoped =
    /\/users\/me(\/|$)/.test(lower) ||
    /\/account(\/|$)/.test(lower) ||
    /\/my[-_][a-z0-9]+/.test(lower) ||
    /\/me(\/|$)/.test(lower);
  const segs = path.split('/').filter(Boolean);
  let familyPath: string;
  if (adminOnly && /\/export(\/|$)/.test(lower)) {
    familyPath = `/${ns}/${segs.join('/')}`;
  } else if (segs.length === 0) {
    familyPath = `/${ns}/*`;
  } else {
    familyPath = `/${ns}/${segs[0]}/*`;
  }
  return { pattern: familyPath.replace(/\/+/g, '/'), adminOnly, selfScoped };
}

// ─── Fresh-install fixture ─────────────────────────────────────────

function renderFreshInstall(manifest: PluginManifest, pluginName: string, prefix: string): string {
  const tables = uniqueByKey(manifest.features.dbTables, (t) => t.tableSuffix);
  const options = uniqueByKey(manifest.features.settings, (s) => s.optionName);

  const tableAssertions = tables.length
    ? tables.map((t) => `- Table \`{$wpdb->prefix}${t.tableSuffix}\` exists and is empty.`).join('\n')
    : '- No custom DB tables registered by this plugin.';
  const optionAssertions = options.length
    ? options.map((o) => `- Option \`${o.optionName}\` is seeded with defaults.`).join('\n')
    : '- No named options registered via `register_setting` (plugin may use direct `update_option`).';
  const cptAssertions = manifest.features.cpts.length
    ? manifest.features.cpts.map((c) => `- Zero posts of type \`${c.postType}\`.`).join('\n')
    : '- No CPTs to pre-populate.';
  const truncateSql = tables.length
    ? tables.map((t) => `$wpdb->query("TRUNCATE TABLE {$wpdb->prefix}${t.tableSuffix}");`).join('\n')
    : '// no plugin tables to truncate';

  return `# Fixture: fresh-install

The state a brand-new install of **${pluginName}** lands in. Assumes the
activation routine has run (tables created, default options seeded) but no
user-generated content exists yet.

## Precondition assertions

${tableAssertions}

### Options
${optionAssertions}

### Post types
${cptAssertions}

- Default admin user (id=1) exists, no other plugin-owned users.

## Seed script

\`\`\`bash
wp eval-file plan/fixtures/_scripts/fresh-install.php
\`\`\`

The idempotent seeder truncates plugin tables, deletes plugin-owned posts,
clears user meta \`${prefix}_*\`, removes options \`${prefix}_%\`, and
re-runs the activation routine so defaults land.

### Reference \`_scripts/fresh-install.php\`

\`\`\`php
<?php
global $wpdb;
${truncateSql}
$wpdb->query(
    $wpdb->prepare(
        "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
        $wpdb->esc_like( '${prefix}_' ) . '%'
    )
);
$wpdb->query(
    $wpdb->prepare(
        "DELETE FROM {$wpdb->usermeta} WHERE meta_key LIKE %s",
        $wpdb->esc_like( '${prefix}_' ) . '%'
    )
);
// Re-trigger activation — replace with the plugin's real activation hook path.
// do_action( 'activate_' . plugin_basename( WP_PLUGIN_DIR . '/${prefix}/${prefix}.php' ) );
\`\`\`

## Used by

- Any flow whose title starts with "First-time ...".
- \`coverage.md\` onboarding rows.
`;
}

// ─── Flow stubs ────────────────────────────────────────────────────

function renderShortcodeFlow(sc: ShortcodeInfo, pluginName: string): string {
  const slug = kebab(sc.tag);
  return `# TODO: incomplete — fill in preconditions, selectors, observations.
flow: shortcode-${slug}
title: Render [${sc.tag}] shortcode (${pluginName})
role: guest
fixture: fresh-install
preconditions:
  # TODO: DB / content state required to render this shortcode.
  - TODO
steps:
  - id: 1
    action: navigate
    url: /?shortcode_preview=${sc.tag}
    observe:
      # TODO: add assertions — selector presence, text contains, console_errors: 0.
      - console_errors: 0
    screenshot: 01-${slug}-initial.png
`;
}

function renderAdminFlow(page: AdminPageInfo, pluginName: string): string {
  const slug = kebab(page.slug);
  const adminUrl = page.slug.includes('.php')
    ? `/wp-admin/${page.slug}`
    : `/wp-admin/admin.php?page=${page.slug}`;
  return `# TODO: incomplete — fill in preconditions, selectors, observations.
flow: admin-${slug}
title: Admin page — ${page.title || page.slug} (${pluginName})
role: admin
fixture: fresh-install
preconditions:
  # TODO: capability, feature toggle, seeded data.
  - TODO
steps:
  - id: 1
    action: navigate
    url: ${adminUrl}
    observe:
      # TODO: add assertions.
      - console_errors: 0
    screenshot: 01-admin-${slug}.png
`;
}

function renderCptFlow(cpt: CptInfo, pluginName: string): string {
  const slug = kebab(cpt.postType);
  const label = cpt.label || cpt.postType;
  return `# TODO: incomplete — fill in preconditions, selectors, observations.
flow: cpt-${slug}-crud
title: ${label} CPT CRUD cycle (${pluginName})
role: admin
fixture: fresh-install
preconditions:
  # TODO: starting state (counts, owners, capability).
  - TODO
steps:
  - id: 1
    action: navigate
    url: /wp-admin/edit.php?post_type=${cpt.postType}
    observe:
      # TODO: list table renders + empty-state message for fresh install.
      - console_errors: 0
    screenshot: 01-${slug}-list.png
  - id: 2
    action: navigate
    url: /wp-admin/post-new.php?post_type=${cpt.postType}
    observe:
      # TODO: editor loads, required fields present.
      - console_errors: 0
    screenshot: 02-${slug}-new.png
  - id: 3
    action: navigate
    url: /wp-admin/edit.php?post_type=${cpt.postType}
    observe:
      # TODO: row exists, title matches, status as expected.
      - console_errors: 0
    screenshot: 03-${slug}-after-create.png
  - id: 4
    action: navigate
    url: /wp-admin/edit.php?post_type=${cpt.postType}
    observe:
      # TODO: after delete — zero rows, empty-state message returns.
      - console_errors: 0
    screenshot: 04-${slug}-after-delete.png
`;
}

// ─── Regression README ─────────────────────────────────────────────

function renderRegressionReadme(): string {
  return `# Regression fixtures

Every resolved Basecamp bug card graduates into a permanent file here
**before** the card is allowed to move to \`Ready for Testing\`. Never
delete, never rewrite, never re-scope. If a bug regresses six months later,
the existing YAML is the canonical repro.

## Filename convention

\`\`\`
<basecamp-card-id>-<slug>.yml
\`\`\`

## Schema

\`\`\`yaml
regression: <basecamp-card-id>
title: <short human title>
card_url: https://3.basecamp.com/.../cards/<card-id>
commit: <sha that fixed it>
role: <role id from ../role-matrix.yml>
fixture: <fixture id from ../fixtures/>
broken_state:
  - <human assertion of the broken behaviour>
steps:
  - id: 1
    action: navigate | click | type | submit
    url: <relative URL>
    selector: <css>
    observe:
      - selector: .foo
        visible: true
      - console_errors: 0
    screenshot: 01-<slug>.png
\`\`\`

## Rules

1. **Never delete.** If retired, add \`retired: true\` at the top; keep steps.
2. **Reference the commit SHA** that fixed the bug in the preamble.
3. **Reuse fixtures where possible.** Only add a new fixture if none reproduces the broken state.
4. **Screenshots required** — commit under \`regression/screenshots/<card-id>/\`.
`;
}

// ─── Coverage ──────────────────────────────────────────────────────

function renderCoverage(manifest: PluginManifest): string {
  const shortcodes = uniqueByKey(manifest.features.shortcodes, (s) => s.tag);
  const pages = uniqueByKey(manifest.features.adminPages, (p) => p.slug);
  const cpts = uniqueByKey(manifest.features.cpts, (c) => c.postType);
  const namespaces = Array.from(new Set(manifest.features.restRoutes.map((r) => r.namespace).filter(Boolean)));
  const ajaxActions = uniqueByKey(manifest.features.ajaxHandlers, (a) => a.action);
  const cron = uniqueByKey(manifest.features.cronJobs, (c) => c.hook);

  const rows: string[] = [];
  for (const sc of shortcodes) rows.push(`| shortcode \`[${sc.tag}]\` | ${sc.file || '—'} | guest | [ ] flows/shortcode-${kebab(sc.tag)}.yml | [ ] |`);
  for (const page of pages) {
    const flowRef = isPortalTabLike(page) ? `[ ] flows/admin-${kebab(page.slug)}.yml` : '[ ] (no stub — add if needed)';
    rows.push(`| admin page \`${page.slug}\` | ${page.file || '—'} | admin | ${flowRef} | [ ] |`);
  }
  for (const cpt of cpts) rows.push(`| cpt \`${cpt.postType}\` | ${cpt.file || '—'} | admin | [ ] flows/cpt-${kebab(cpt.postType)}-crud.yml | [ ] |`);
  for (const ns of namespaces) rows.push(`| rest namespace \`${ns}\` | — | role-matrix | [ ] role-matrix.yml | [ ] |`);
  for (const ajax of ajaxActions) rows.push(`| ajax \`${ajax.action}\` | ${ajax.file || '—'} | ${ajax.loggedOut ? 'guest' : 'subscriber'} | [ ] role-matrix.yml | [ ] |`);
  for (const job of cron) rows.push(`| cron \`${job.hook}\` | ${job.file || '—'} | system | [ ] (manual trigger flow) | [ ] |`);

  return `# Coverage

Unchecked rows are technical debt. Flip a box only once a matching file exists
in \`flows/\` (for has-flow) or \`regression/\` (for has-regression) AND runs green
against the declared fixture + role.

| feature | file | role | has-flow? | has-regression? |
|---------|------|------|-----------|-----------------|
${rows.join('\n')}

## Summary

- Shortcodes: 0/${shortcodes.length} covered
- Admin pages: 0/${pages.filter(isPortalTabLike).length} covered (portal-tab-like only)
- CPTs: 0/${cpts.length} covered
- REST namespaces: 0/${namespaces.length} covered
- AJAX actions: 0/${ajaxActions.length} covered
- Cron events: 0/${cron.length} covered

> Regenerate via \`wppqa_bootstrap_plan\` with \`overwrite:true\` after adding coverage — counts recompute each run.
`;
}
