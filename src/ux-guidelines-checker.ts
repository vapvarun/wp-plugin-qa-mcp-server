/**
 * WP Plugin QA MCP Server - UX Guidelines Enforcement Checker
 *
 * Machine-checks rules from docs/UX-GUIDELINES.md (or equivalent). Rules fired:
 *   1. CSS token compliance — no raw hex/px outside var(--prefix-*, fallback)
 *   2. Icon policy — no Dashicons, no emoji in UI
 *   3. Human labels — label text with underscore-joined words flagged as jargon
 *   4. Raw focus outline — `outline: none` without a matching :focus-visible
 *   5. Page header consistency — admin edit views should include .prefix-page-header
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { CheckerResult, CheckerIssue } from './types.js';
import {
  findPhpFiles,
  findFilesByExt,
  getLineNumber,
  relativePath,
  generateTestId,
  dirExists,
} from './shared-utils.js';

export function checkUxGuidelines(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];

  const prefix = detectCssPrefix(pluginPath);
  const cssFiles = findCssFiles(pluginPath);
  const phpFiles = findPhpFiles(pluginPath).filter(
    (f) =>
      f.includes('/admin/views/') ||
      f.includes('/templates/') ||
      f.includes('/partials/'),
  );

  issues.push(...checkCssTokenCompliance(cssFiles, pluginPath, prefix));
  issues.push(...checkIconPolicy(phpFiles, pluginPath));
  issues.push(...checkFocusOutline(cssFiles, pluginPath));
  issues.push(...checkHumanLabels(phpFiles, pluginPath));
  issues.push(...checkPageHeader(phpFiles, pluginPath, prefix));

  const errorCount = issues.filter((i) => i.type === 'error').length;
  return {
    category: 'ux-guidelines',
    issues,
    passed: Math.max(0, 5 - errorCount),
    failed: errorCount,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function detectCssPrefix(pluginPath: string): string {
  const cssFiles = findCssFiles(pluginPath);
  const counter = new Map<string, number>();
  for (const file of cssFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const matches = content.matchAll(/--([a-z]+)-[a-z0-9-]+/g);
    for (const match of matches) {
      const pre = match[1];
      if (pre.length < 2 || pre.length > 6) continue;
      counter.set(pre, (counter.get(pre) || 0) + 1);
    }
  }
  let best = 'lrn';
  let bestCount = 0;
  for (const [pre, count] of counter.entries()) {
    if (count > bestCount) {
      best = pre;
      bestCount = count;
    }
  }
  return best;
}

function findCssFiles(pluginPath: string): string[] {
  const assetsDir = join(pluginPath, 'assets');
  if (!dirExists(assetsDir)) return [];
  return findFilesByExt(assetsDir, '.css');
}

function checkCssTokenCompliance(
  cssFiles: string[],
  pluginPath: string,
  prefix: string,
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of cssFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);

    // Strip :root / :host / token-source rule blocks.
    const withoutRoots = content.replace(
      /(?::root|:host|\.[a-z-]+)\s*\{[^}]*--[^}]+\}/g,
      '',
    );

    const hexMatches = withoutRoots.matchAll(/(?<!\()#[0-9a-fA-F]{3,8}\b/g);
    const hexFlagged = new Set<number>();
    for (const match of hexMatches) {
      const lineNum = getLineNumber(content, match.index ?? 0);
      const line = content.split('\n')[lineNum - 1] || '';
      if (/var\s*\(--/.test(line)) continue;
      if (hexFlagged.has(lineNum)) continue;
      hexFlagged.add(lineNum);
      issues.push({
        id: generateTestId('ux-guidelines'),
        category: 'ux-guidelines',
        severity: 'medium',
        type: 'warning',
        title: 'Raw hex color outside token',
        message: `Hex color used without var(--${prefix}-*) wrapper. Every color should flow through a token.`,
        file: rel,
        line: lineNum,
        code: 'raw-hex',
        fix: `Move this color into a --${prefix}-* custom property, or wrap as a fallback: var(--${prefix}-name, #hex).`,
      });
    }

    const pxMatches = withoutRoots.matchAll(/(?<![\w(])\d+px\b/g);
    const pxFlagged = new Set<number>();
    for (const match of pxMatches) {
      const lineNum = getLineNumber(content, match.index ?? 0);
      const line = content.split('\n')[lineNum - 1] || '';
      if (/var\s*\(--/.test(line)) continue;
      if (/^\s*0px\b/.test(line)) continue;
      if (/\btranslate[XY]?\s*\(/.test(line)) continue;
      if (/\bbox-shadow/.test(line)) continue;
      if (/\bborder\s*:.*1px/.test(line)) continue;
      if (pxFlagged.has(lineNum)) continue;
      pxFlagged.add(lineNum);
      issues.push({
        id: generateTestId('ux-guidelines'),
        category: 'ux-guidelines',
        severity: 'low',
        type: 'warning',
        title: 'Raw px value outside token',
        message: `Hardcoded px value. The spec expects spacing/sizes to flow through --${prefix}-sp-* tokens.`,
        file: rel,
        line: lineNum,
        code: 'raw-px',
        fix: `Use var(--${prefix}-sp-*) (or a dedicated token) with a fallback: var(--${prefix}-sp-4, 16px).`,
      });
    }
  }

  return issues;
}

function checkIconPolicy(
  phpFiles: string[],
  pluginPath: string,
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const file of phpFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);

    const dashMatches = content.matchAll(
      /class\s*=\s*["'][^"']*\bdashicons-[a-z-]+/g,
    );
    for (const match of dashMatches) {
      issues.push({
        id: generateTestId('ux-guidelines'),
        category: 'ux-guidelines',
        severity: 'high',
        type: 'error',
        title: 'Dashicon detected in view',
        message:
          'Design spec mandates Lucide SVG icons. Dashicons are visual debt — replace with a Lucide SVG inline.',
        file: rel,
        line: getLineNumber(content, match.index ?? 0),
        code: 'icon-dashicons',
        fix: 'Replace with Lucide SVG. See lucide.dev for the icon catalog.',
      });
    }

    const emojiMatches = content.matchAll(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,
    );
    const emojiFlagged = new Set<number>();
    for (const match of emojiMatches) {
      const lineNum = getLineNumber(content, match.index ?? 0);
      if (emojiFlagged.has(lineNum)) continue;
      emojiFlagged.add(lineNum);
      const lineText = content.split('\n')[lineNum - 1] || '';
      if (/^\s*(\/\/|\/\*|\*)/.test(lineText)) continue;
      issues.push({
        id: generateTestId('ux-guidelines'),
        category: 'ux-guidelines',
        severity: 'medium',
        type: 'warning',
        title: 'Emoji in user-facing string',
        message:
          'Emoji can break in admin themes + fail WCAG. Spec prefers Lucide SVG icons for visual cues.',
        file: rel,
        line: lineNum,
        code: 'icon-emoji',
      });
    }
  }
  return issues;
}

function checkFocusOutline(
  cssFiles: string[],
  pluginPath: string,
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const file of cssFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);

    const hasFocusVisible = /:focus-visible/.test(content);
    const outlineMatches = content.matchAll(/outline\s*:\s*none\b/g);
    for (const match of outlineMatches) {
      if (hasFocusVisible) continue;
      issues.push({
        id: generateTestId('ux-guidelines'),
        category: 'ux-guidelines',
        severity: 'high',
        type: 'error',
        title: 'outline:none without :focus-visible',
        message:
          'Removing outline without providing a :focus-visible replacement fails WCAG keyboard navigation.',
        file: rel,
        line: getLineNumber(content, match.index ?? 0),
        code: 'a11y-focus-removed',
        fix: 'Keep outline:none for mouse but add `element:focus-visible { outline: 2px solid var(--prefix-accent); }`.',
      });
    }
  }
  return issues;
}

function checkHumanLabels(
  phpFiles: string[],
  pluginPath: string,
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const file of phpFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);

    const labelMatches = content.matchAll(/<label[^>]*>([^<]+)<\/label>/gi);
    for (const match of labelMatches) {
      const text = match[1].trim();
      if (/<\?php/.test(match[0])) continue;
      if (!/[a-z]_[a-z]/.test(text)) continue;
      if (/esc_html/.test(match[0])) continue;
      issues.push({
        id: generateTestId('ux-guidelines'),
        category: 'ux-guidelines',
        severity: 'low',
        type: 'warning',
        title: 'Likely jargon label',
        message: `Label "${text}" contains underscore-joined words. Labels should read as human phrases ("Grading method" not "grading_method").`,
        file: rel,
        line: getLineNumber(content, match.index ?? 0),
        code: 'label-jargon',
      });
    }
  }
  return issues;
}

function checkPageHeader(
  phpFiles: string[],
  pluginPath: string,
  prefix: string,
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const headerClass = `${prefix}-page-header`;
  for (const file of phpFiles) {
    const base = file.split('/').pop() || '';
    if (!/(editor|form)\.php$/.test(base)) continue;

    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    if (!content.includes(headerClass)) {
      issues.push({
        id: generateTestId('ux-guidelines'),
        category: 'ux-guidelines',
        severity: 'medium',
        type: 'warning',
        title: `Missing .${headerClass}`,
        message: `Admin edit view lacks the .${headerClass} wrapper that every edit screen should use for consistency.`,
        file: relativePath(file, pluginPath),
        line: 1,
        code: 'missing-page-header',
        fix: `Wrap the top of the view in <div class="${headerClass}"><h1>…</h1>…</div>. See the plugin's reference course-form.php or similar for the pattern.`,
      });
    }
  }
  return issues;
}
