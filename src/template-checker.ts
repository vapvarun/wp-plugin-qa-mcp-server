/**
 * WP Plugin QA MCP Server - Template & Developer Experience Checker
 * Override mechanism, developer hooks, do_action/apply_filters placement.
 * Note: Pure static analysis, no shell commands used.
 */

import { readFileSync } from 'fs';
import type { CheckerResult, CheckerIssue } from './types.js';
import { findPhpFiles, getLineNumber, relativePath, generateTestId, detectPluginSlug } from './shared-utils.js';

export function checkTemplates(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(pluginPath);
  const slug = detectPluginSlug(pluginPath);

  const fileContents = new Map<string, string>();
  for (const file of phpFiles) {
    try { fileContents.set(file, readFileSync(file, 'utf-8')); } catch { /* skip */ }
  }

  issues.push(...checkOverrideSupport(phpFiles, fileContents, pluginPath, slug));
  issues.push(...checkTemplateHooks(phpFiles, fileContents, pluginPath, slug));
  issues.push(...checkLifecycleHooks(phpFiles, fileContents, pluginPath, slug));
  issues.push(...checkFilterAvailability(phpFiles, fileContents, pluginPath));
  issues.push(...checkHookContext(phpFiles, fileContents, pluginPath));

  return {
    category: 'templates',
    issues,
    passed: Math.max(0, 5 - issues.filter(i => i.type === 'error').length),
    failed: issues.filter(i => i.type === 'error').length,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function checkOverrideSupport(phpFiles: string[], contents: Map<string, string>, pluginPath: string, slug: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const templateDirs = ['templates', 'partials', 'views', 'public/partials', 'includes/templates'];

  let hasOverridePattern = false;
  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    if (/locate_template|get_template_part|wc_get_template|load_template/.test(content)) {
      hasOverridePattern = true;
    }
    if (new RegExp(`${slug}.*template|template.*${slug}`, 'i').test(content) && /get_theme_file|stylesheet_directory/.test(content)) {
      hasOverridePattern = true;
    }
  }

  for (const file of phpFiles) {
    const rel = relativePath(file, pluginPath);
    if (templateDirs.some(d => rel.startsWith(d + '/'))) {
      if (!hasOverridePattern) {
        issues.push({
          id: generateTestId('templates'), category: 'templates', severity: 'high', type: 'warning',
          title: 'Template files have no override support',
          message: 'No locate_template or theme override mechanism found for template files',
          file: rel, line: 1, code: 'no-template-override',
          fix: 'Implement a template loader that checks theme directory before plugin directory',
        });
        break;
      }
    }
  }

  return issues;
}

function checkTemplateHooks(phpFiles: string[], contents: Map<string, string>, pluginPath: string, slug: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const templateDirs = ['templates', 'partials', 'views', 'public/partials'];

  for (const file of phpFiles) {
    const rel = relativePath(file, pluginPath);
    if (!templateDirs.some(d => rel.startsWith(d + '/'))) continue;

    const content = contents.get(file) || '';
    const hasDoAction = /do_action\s*\(/.test(content);
    const hasOutput = /<[a-z]|echo |_e\s*\(/.test(content);

    if (hasOutput && !hasDoAction) {
      issues.push({
        id: generateTestId('templates'), category: 'templates', severity: 'medium', type: 'warning',
        title: `Template "${rel}" has no do_action hooks`,
        message: 'Template renders output but has no action hooks for developer extension',
        file: rel, line: 1, code: 'no-template-actions',
        fix: `Add do_action('${slug}_before_...') and do_action('${slug}_after_...')`,
      });
    }
  }

  return issues;
}

function checkLifecycleHooks(phpFiles: string[], contents: Map<string, string>, pluginPath: string, slug: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const lifecycleEvents = ['save', 'delete', 'create', 'update', 'display', 'render'];

  let hasLifecycleHooks = false;
  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    for (const event of lifecycleEvents) {
      if (new RegExp(`do_action\\s*\\(\\s*['"]${slug}.*${event}`, 'i').test(content)) {
        hasLifecycleHooks = true;
        break;
      }
    }
    if (hasLifecycleHooks) break;
  }

  let hasCrudOps = false;
  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    if (/wp_insert_post|wp_update_post|wp_delete_post|update_option|delete_option/.test(content)) {
      hasCrudOps = true;
      break;
    }
  }

  if (hasCrudOps && !hasLifecycleHooks) {
    issues.push({
      id: generateTestId('templates'), category: 'templates', severity: 'medium', type: 'warning',
      title: 'Missing lifecycle action hooks',
      message: 'Plugin has CRUD operations but no custom do_action hooks for key lifecycle events',
      file: '', line: 0, code: 'no-lifecycle-hooks',
      fix: `Add do_action('${slug}_before_save', $data) and do_action('${slug}_after_save', $id, $data)`,
    });
  }

  return issues;
}

function checkFilterAvailability(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  let totalApplyFilters = 0;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const matches = content.match(/apply_filters\s*\(/g);
    if (matches) totalApplyFilters += matches.length;
  }

  if (phpFiles.length > 5 && totalApplyFilters < 3) {
    issues.push({
      id: generateTestId('templates'), category: 'templates', severity: 'medium', type: 'warning',
      title: 'Few apply_filters hooks available',
      message: `Only ${totalApplyFilters} apply_filters calls found across ${phpFiles.length} PHP files`,
      file: '', line: 0, code: 'few-filters',
      fix: 'Add apply_filters on key output: titles, content, labels, query args, template paths',
    });
  }

  return issues;
}

function checkHookContext(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const hookPattern = /do_action\s*\(\s*['"][^'"]+['"]\s*,\s*(true|false)\s*\)/g;
    let match;
    while ((match = hookPattern.exec(content)) !== null) {
      issues.push({
        id: generateTestId('templates'), category: 'templates', severity: 'low', type: 'info',
        title: 'Hook passes only boolean',
        message: 'Action hook passes only true/false. Pass the relevant object/ID for better developer experience.',
        file: rel, line: getLineNumber(content, match.index), code: 'hook-insufficient-context',
      });
    }
  }

  return issues;
}
