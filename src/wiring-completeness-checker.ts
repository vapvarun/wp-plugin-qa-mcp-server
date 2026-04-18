/**
 * WP Plugin QA MCP Server - Wiring Completeness Checker
 *
 * Catches settings that save to DB (admin form + handler + model + REST) but
 * are never read by any student/frontend template. Class of bug proven by the
 * Learnomy v1.3.0 sprint — 24 of 43 tracked fields were in this state.
 *
 * Tuning (2026-04-18):
 *  - Broader blocklist of generic field names (shared across dozens of forms).
 *  - REST `args` maps in includes/api/ count as persistence-layer awareness.
 *  - apply_filters('..._defaults', [...]) arrays count as admin-aware.
 *  - Optional .wppqa.yml override declares per-plugin exclusions.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { CheckerResult, CheckerIssue } from './types.js';
import {
  findPhpFiles,
  getLineNumber,
  relativePath,
  generateTestId,
  dirExists,
  fileExists,
} from './shared-utils.js';

interface SettingKey {
  key: string;
  adminRefs: Array<{ file: string; line: number }>;
  persistenceRefs: Array<{ file: string; line: number }>;
  templateRefs: Array<{ file: string; line: number }>;
}

/**
 * Field names too generic to diagnose as "half-wired" in isolation —
 * they turn up in coupon forms, webhook forms, CSV importers, login
 * forms, pagination, etc. Having one in an admin view tells us nothing
 * about whether a student-facing template reads it.
 */
const GENERIC_KEYS = new Set<string>([
  // Previously blocked:
  'action',
  'nonce',
  'submit',
  '_wpnonce',
  'page',
  'paged',
  's',
  'per_page',
  // New — data primitives / list controls / auth:
  'code',
  'value',
  'amount',
  'type',
  'status',
  'name',
  'title',
  'content',
  'description',
  'slug',
  'id',
  'ids',
  'order',
  'orderby',
  'search',
  'q',
  'email',
  'url',
  'password',
  'confirm_password',
  'tab',
  'view',
  'mode',
  'limit',
  'offset',
  'page_size',
  'sort',
  'direction',
  // Obviously upload/control noise:
  'csv_file',
  'file',
  'upload',
]);

export function checkWiringCompleteness(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];

  const adminDir = join(pluginPath, 'includes', 'admin');
  const viewsDir = join(pluginPath, 'includes', 'admin', 'views');
  const templatesDir = join(pluginPath, 'templates');

  if (!dirExists(viewsDir) && !dirExists(adminDir)) {
    return {
      category: 'wiring',
      issues: [],
      passed: 0,
      failed: 0,
      skipped: 1,
      duration: Date.now() - startTime,
    };
  }
  if (!dirExists(templatesDir)) {
    return {
      category: 'wiring',
      issues: [
        {
          id: generateTestId('wiring'),
          category: 'wiring',
          severity: 'low',
          type: 'info',
          title: 'No templates directory found',
          message:
            'Wiring-completeness check needs a templates/ directory to audit student-facing reads against.',
          code: 'no-templates-dir',
          file: '.',
          line: 1,
        },
      ],
      passed: 0,
      failed: 0,
      skipped: 1,
      duration: Date.now() - startTime,
    };
  }

  const userExcluded = readUserExclusions(pluginPath);
  const restArgKeys = collectRestArgKeys(pluginPath);
  const filterDefaultKeys = collectFilterDefaultKeys(pluginPath);
  const keys = discoverKeys(pluginPath);

  const templateFiles = findPhpFiles(templatesDir);
  const templateContents = new Map<string, string>();
  for (const file of templateFiles) {
    try {
      templateContents.set(file, readFileSync(file, 'utf-8'));
    } catch {
      /* skip */
    }
  }

  for (const key of keys.values()) {
    for (const [file, content] of templateContents.entries()) {
      if (templateReadsKey(content, key.key)) {
        const idx = content.search(new RegExp(escapeRegex(key.key)));
        key.templateRefs.push({
          file: relativePath(file, pluginPath),
          line: idx >= 0 ? getLineNumber(content, idx) : 1,
        });
      }
    }
  }

  for (const key of keys.values()) {
    if (key.adminRefs.length === 0) continue;
    if (key.templateRefs.length > 0) continue;
    if (userExcluded.has(key.key)) continue;
    // REST args and filter-defaults registration both count as "the setting
    // is wired to a backend surface" — skip the flag, it's not a dead flag.
    if (restArgKeys.has(key.key)) continue;
    if (filterDefaultKeys.has(key.key)) continue;

    const adminRef = key.adminRefs[0];
    issues.push({
      id: generateTestId('wiring'),
      category: 'wiring',
      severity: 'high',
      type: 'error',
      title: `Half-wired setting: ${key.key}`,
      message: `Setting '${key.key}' is posted by admin form(s) but no template in templates/ reads it. This is the "saves to DB but never affects the user" bug class.`,
      file: adminRef.file,
      line: adminRef.line,
      code: 'wiring-half',
      fix: `Add a read in the relevant student-facing template, e.g. \`<?php if ( $settings['${key.key}'] ) : ?>…<?php endif; ?>\`. If the setting truly has no frontend effect, remove the admin field to stop users enabling a dead flag.`,
    });
  }

  const errorCount = issues.filter((i) => i.type === 'error').length;
  return {
    category: 'wiring',
    issues,
    passed: Math.max(0, keys.size - errorCount),
    failed: errorCount,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function discoverKeys(pluginPath: string): Map<string, SettingKey> {
  const keys = new Map<string, SettingKey>();
  const adminDir = join(pluginPath, 'includes', 'admin');

  if (!dirExists(adminDir)) return keys;

  const adminFiles = findPhpFiles(adminDir);
  for (const file of adminFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);

    const nameRe = /\bname\s*=\s*["']([a-z_][a-z0-9_]*)["']/g;
    let result: RegExpExecArray | null;
    while ((result = nameRe.exec(content)) !== null) {
      const key = result[1];
      if (GENERIC_KEYS.has(key)) continue;
      if (!keys.has(key)) {
        keys.set(key, { key, adminRefs: [], persistenceRefs: [], templateRefs: [] });
      }
      keys.get(key)!.adminRefs.push({ file: rel, line: getLineNumber(content, result.index) });
    }

    const setSettingRe = /set_setting\s*\(\s*[^,]+,\s*['"]([a-z_][a-z0-9_]*)['"]/g;
    while ((result = setSettingRe.exec(content)) !== null) {
      const key = result[1];
      if (!keys.has(key)) {
        keys.set(key, { key, adminRefs: [], persistenceRefs: [], templateRefs: [] });
      }
      keys
        .get(key)!
        .persistenceRefs.push({ file: rel, line: getLineNumber(content, result.index) });
    }
  }

  return keys;
}

/**
 * Walk includes/api/ and collect every key that appears under an `'args' =>`
 * map inside a `register_rest_route(...)` call. These are REST-validated
 * parameters — a setting shipped to the backend through REST counts as
 * wired even if no template reads it (it may be consumed by a JS client).
 */
function collectRestArgKeys(pluginPath: string): Set<string> {
  const keys = new Set<string>();
  const apiDir = join(pluginPath, 'includes', 'api');
  if (!dirExists(apiDir)) return keys;

  for (const file of findPhpFiles(apiDir)) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    // Match both `'args' => array(` and `'args' => [`.
    const argBlockRe = /['"]args['"]\s*=>\s*(?:array\s*\(|\[)/g;
    let start: RegExpExecArray | null;
    while ((start = argBlockRe.exec(content)) !== null) {
      const openIdx = start.index + start[0].length;
      const open = content[openIdx - 1];
      const close = open === '(' ? ')' : ']';
      const endIdx = findMatchingCloser(content, openIdx - 1, open, close);
      if (endIdx < 0) continue;
      const block = content.slice(openIdx, endIdx);

      // Top-level keys only — shallow walk.
      const keyRe = /['"]([a-z_][a-z0-9_]*)['"]\s*=>\s*(?:array\s*\(|\[)/g;
      let keyMatch: RegExpExecArray | null;
      while ((keyMatch = keyRe.exec(block)) !== null) {
        keys.add(keyMatch[1]);
      }
    }
  }

  return keys;
}

/**
 * apply_filters('..._defaults', [ 'key' => 'default' ]) is a widely used
 * pattern for plugin settings registration. If a key appears there, the
 * plugin is clearly aware of it — suppress the half-wired flag.
 */
function collectFilterDefaultKeys(pluginPath: string): Set<string> {
  const keys = new Set<string>();
  for (const file of findPhpFiles(pluginPath)) {
    if (file.includes('/vendor/') || file.includes('/node_modules/')) continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    // Match apply_filters('..._defaults'|'..._settings', array(...) | [...])
    const filterRe =
      /apply_filters\s*\(\s*['"][a-z0-9_]*(?:_defaults|_settings)['"]\s*,\s*(array\s*\(|\[)/g;
    let start: RegExpExecArray | null;
    while ((start = filterRe.exec(content)) !== null) {
      const openIdx = start.index + start[0].length - 1;
      const open = content[openIdx];
      const close = open === '(' ? ')' : ']';
      const endIdx = findMatchingCloser(content, openIdx, open, close);
      if (endIdx < 0) continue;
      const block = content.slice(openIdx + 1, endIdx);

      const keyRe = /['"]([a-z_][a-z0-9_]*)['"]\s*=>/g;
      let keyMatch: RegExpExecArray | null;
      while ((keyMatch = keyRe.exec(block)) !== null) {
        keys.add(keyMatch[1]);
      }
    }
  }
  return keys;
}

/**
 * Read `.wppqa.yml` at the plugin root (or in docs/) for a hand-maintained
 * allowlist. Supports only a flat `wiring.exclude` list to avoid adding a
 * YAML parser dependency.
 */
function readUserExclusions(pluginPath: string): Set<string> {
  const out = new Set<string>();
  const candidates = [
    join(pluginPath, '.wppqa.yml'),
    join(pluginPath, 'docs', '.wppqa.yml'),
  ];
  for (const path of candidates) {
    if (!fileExists(path)) continue;
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
    // Very small YAML subset: find `wiring:` block, then `exclude:` list.
    const wiringBlock = content.match(/wiring\s*:\s*\n([\s\S]*?)(?=\n[a-z]|$)/);
    if (!wiringBlock) continue;
    const excludeMatch = wiringBlock[1].match(/exclude\s*:\s*\[([^\]]*)\]/);
    if (excludeMatch) {
      for (const raw of excludeMatch[1].split(',')) {
        const k = raw.trim().replace(/^['"]|['"]$/g, '');
        if (k) out.add(k);
      }
      continue;
    }
    // Fallback: YAML block list under `exclude:`.
    const blockMatch = wiringBlock[1].match(/exclude\s*:\s*\n([\s\S]*)/);
    if (blockMatch) {
      for (const line of blockMatch[1].split('\n')) {
        const m = line.match(/^\s*-\s*['"]?([a-z_][a-z0-9_]*)['"]?\s*$/);
        if (m) out.add(m[1]);
        else if (line.trim() && !line.startsWith(' ')) break;
      }
    }
  }
  return out;
}

function findMatchingCloser(
  content: string,
  start: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function templateReadsKey(content: string, key: string): boolean {
  const patterns = [
    new RegExp(`\\[['"]${escapeRegex(key)}['"]\\]`),
    new RegExp(`get_setting\\s*\\([^,]*,?\\s*['"]${escapeRegex(key)}['"]`),
    new RegExp(`->${escapeRegex(key)}\\b`),
  ];
  return patterns.some((p) => p.test(content));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
