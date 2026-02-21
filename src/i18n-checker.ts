/**
 * WP Plugin QA MCP Server - Internationalization (i18n) Checker
 * Text domain, __() wrappers, POT file, concatenated strings.
 * Note: Pure static analysis, no shell commands used.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { CheckerResult, CheckerIssue } from './types.js';
import { findPhpFiles, getLineNumber, relativePath, generateTestId, detectPluginSlug } from './shared-utils.js';

export function checkI18n(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(pluginPath);
  const slug = detectPluginSlug(pluginPath);

  let textDomain = slug;
  for (const file of phpFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const tdMatch = content.match(/^\s*\*?\s*Text Domain:\s*(.+)$/m);
      if (tdMatch) { textDomain = tdMatch[1].trim(); break; }
    } catch { /* skip */ }
  }

  const fileContents = new Map<string, string>();
  for (const file of phpFiles) {
    try { fileContents.set(file, readFileSync(file, 'utf-8')); } catch { /* skip */ }
  }

  issues.push(...checkTextDomainConsistency(phpFiles, fileContents, pluginPath, textDomain));
  issues.push(...checkPotFile(pluginPath, textDomain));
  issues.push(...checkConcatenatedStrings(phpFiles, fileContents, pluginPath));
  issues.push(...checkLoadTextdomain(phpFiles, fileContents, pluginPath, textDomain));
  issues.push(...checkHtmlInTranslations(phpFiles, fileContents, pluginPath));

  return {
    category: 'i18n',
    issues,
    passed: Math.max(0, 7 - issues.filter(i => i.type === 'error').length),
    failed: issues.filter(i => i.type === 'error').length,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function checkTextDomainConsistency(phpFiles: string[], contents: Map<string, string>, pluginPath: string, textDomain: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const i18nPattern = /(?:__|_e|_n|_x|_nx|esc_html__|esc_html_e|esc_attr__|esc_attr_e)\s*\([^)]*['"]([a-z0-9-]+)['"]\s*\)/g;
    let match;
    while ((match = i18nPattern.exec(content)) !== null) {
      const domain = match[1];
      if (domain !== textDomain && domain !== 'default') {
        issues.push({
          id: generateTestId('i18n'), category: 'i18n', severity: 'medium', type: 'warning',
          title: `Wrong text domain: "${domain}" (expected "${textDomain}")`,
          message: `Translation function uses text domain "${domain}" instead of "${textDomain}"`,
          file: rel, line: getLineNumber(content, match.index), code: 'wrong-text-domain',
          fix: `Change text domain to "${textDomain}"`,
        });
      }
    }
  }

  return issues;
}

function checkPotFile(pluginPath: string, textDomain: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const langDir = join(pluginPath, 'languages');

  if (!existsSync(langDir)) {
    issues.push({
      id: generateTestId('i18n'), category: 'i18n', severity: 'medium', type: 'warning',
      title: 'No languages/ directory',
      message: 'Plugin should have a languages/ directory for translation files',
      file: '', line: 0, code: 'no-languages-dir',
      fix: 'Create a languages/ directory with a .pot file',
    });
    return issues;
  }

  try {
    const files = readdirSync(langDir);
    if (!files.some(f => f.endsWith('.pot'))) {
      issues.push({
        id: generateTestId('i18n'), category: 'i18n', severity: 'medium', type: 'warning',
        title: 'No .pot file found',
        message: `Expected ${textDomain}.pot in languages/ directory`,
        file: 'languages/', line: 0, code: 'no-pot-file',
        fix: `Generate: wp i18n make-pot . languages/${textDomain}.pot`,
      });
    }
  } catch { /* skip */ }

  return issues;
}

function checkConcatenatedStrings(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const concatPattern = /(?:__|_e|esc_html__|esc_attr__)\s*\(\s*['"][^'"]*['"]\s*\.\s*\$/g;
    let match;
    while ((match = concatPattern.exec(content)) !== null) {
      issues.push({
        id: generateTestId('i18n'), category: 'i18n', severity: 'medium', type: 'warning',
        title: 'Concatenated translatable string',
        message: 'String concatenation inside translation function. Translators cannot reorder parts.',
        file: rel, line: getLineNumber(content, match.index), code: 'concatenated-translation',
        fix: 'Use sprintf(__("text %s more", "domain"), $var) instead',
      });
    }
  }

  return issues;
}

function checkLoadTextdomain(phpFiles: string[], contents: Map<string, string>, pluginPath: string, textDomain: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  let hasLoadTextdomain = false;
  let hasTranslations = false;

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    if (/load_plugin_textdomain\s*\(/.test(content)) hasLoadTextdomain = true;
    if (/(?:__|_e|_n|_x|esc_html__|esc_attr__)\s*\(/.test(content)) hasTranslations = true;
  }

  if (hasTranslations && !hasLoadTextdomain) {
    issues.push({
      id: generateTestId('i18n'), category: 'i18n', severity: 'medium', type: 'warning',
      title: 'Missing load_plugin_textdomain()',
      message: 'Plugin uses translation functions but never calls load_plugin_textdomain()',
      file: '', line: 0, code: 'no-load-textdomain',
      fix: `Add load_plugin_textdomain('${textDomain}', false, dirname(plugin_basename(__FILE__)) . '/languages/')`,
    });
  }

  return issues;
}

function checkHtmlInTranslations(phpFiles: string[], contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = contents.get(file) || '';
    const rel = relativePath(file, pluginPath);

    const htmlInI18n = /(?:__|_e|esc_html__|esc_attr__)\s*\(\s*['"][^'"]*<(?:a|strong|em|b|i|span|div|p|br|h[1-6])[^'"]*['"]/g;
    let match;
    while ((match = htmlInI18n.exec(content)) !== null) {
      issues.push({
        id: generateTestId('i18n'), category: 'i18n', severity: 'low', type: 'info',
        title: 'HTML in translatable string',
        message: 'HTML tags inside a translatable string make it harder for translators',
        file: rel, line: getLineNumber(content, match.index), code: 'html-in-translation',
        fix: 'Use %s placeholders and wp_kses for HTML, or use separate strings',
      });
    }
  }

  return issues;
}
