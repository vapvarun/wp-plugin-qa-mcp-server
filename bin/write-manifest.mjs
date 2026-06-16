#!/usr/bin/env node
/**
 * Deterministically generate a plugin's manifest v3 and write it to
 * <pluginPath>/audit/manifest.json. This is the onboard step — the scanner is the
 * single deterministic generator for every plugin (no agent prose).
 *
 *   node bin/write-manifest.mjs /abs/path/to/plugin
 *
 * Volatile fields (timestamp, absolute path) are stripped so the committed manifest
 * is churn-free and machine-independent.
 */

import { scanPlugin } from '../build/scanner.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const pluginPath = process.argv[2];
if (!pluginPath) {
  process.stderr.write('usage: node bin/write-manifest.mjs <pluginPath>\n');
  process.exit(1);
}

const m = scanPlugin(pluginPath);
delete m.scannedAt;                                  // timestamp → churn
m.pluginPath = m.header?.slug || 'plugin';           // absolute path → machine-specific
m.generated = { generator: 'wp-plugin-qa scanner', schema: 'v3-functional' };

// ── Back-compat: also emit the legacy top-level keys the onboard ecosystem
// (graph.html, derivation checks, summaries) and older consumers read, derived
// from the same deterministic scan. One file satisfies both worlds.
const f = m.features || {};
const fullRoute = (r) => '/' + String(r.namespace || '').replace(/^\/+|\/+$/g, '') + '/' + String(r.route || '').replace(/^\/+/, '');
m.rest = {
  namespace: f.restRoutes?.[0]?.namespace || '',
  endpoints: (f.restRoutes || []).map((r) => ({
    route: fullRoute(r), methods: r.methods || [], permission: r.permissionCallback || 'unknown',
    gated_by: r.gatedBy || null, file: `${r.file}:${r.line}`,
  })),
};
m.ajax = f.ajaxHandlers || [];
m.admin_pages = (f.adminPages || []).map((a) => ({
  page: a.slug, type: a.parentSlug ? 'submenu' : 'menu', capability: a.capability,
  title: a.title, file: `${a.file}:${a.line}`,
}));
m.tables = (f.dbTables || []).map((t) => t.tableSuffix);
m.hooks_fired = (f.hooks?.provided || []).map((h) => ({ hook: h.hookName, type: h.type, file: `${h.file}:${h.line}` }));
m.cron = (f.cronJobs || []).map((c) => c.hook);
m.blocks = (f.blocks || []).map((b) => b.name);
m.shortcodes = (f.shortcodes || []).map((s) => s.tag);
m.frontend_assets = { js: (f.frontendJs || []).map((j) => j.module), css: [] };

const outDir = join(pluginPath, 'audit');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'manifest.json');
const json = JSON.stringify(m, null, 2) + '\n';
writeFileSync(outFile, json);
process.stdout.write(`wrote ${(json.length / 1024).toFixed(0)}KB → ${outFile}\n`);
