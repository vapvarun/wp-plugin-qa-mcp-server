/**
 * WP Plugin QA MCP Server - Wiring Completeness Checker
 *
 * Catches settings that save to DB (admin form + handler + model + REST) but
 * are never read by any student/frontend template. Class of bug proven by the
 * Learnomy v1.3.0 sprint — 24 of 43 tracked fields were in this state.
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
} from './shared-utils.js';

interface SettingKey {
  key: string;
  adminRefs: Array<{ file: string; line: number }>;
  persistenceRefs: Array<{ file: string; line: number }>;
  templateRefs: Array<{ file: string; line: number }>;
}

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
      if (['action', 'nonce', 'submit', '_wpnonce', 'page', 'paged', 's', 'per_page'].includes(key))
        continue;
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
