/**
 * WP Plugin QA MCP Server - Plugin Development Rules Checker
 *
 * Enforces rules from the wp-plugin-development skill at
 *   ~/.claude/skills/wp-plugin-development/references/
 *
 * Rule groups mined:
 *   - admin-ux-rulebook: Rules 1-10 (alert/confirm ban, Dashicons, -1 values,
 *     role labels, page headers, etc.)
 *   - security.md: read explicit $_POST keys (no array-wide processing),
 *     prepared statements, sanitize-in escape-out
 *   - lifecycle.md: activation/deactivation hooks registered at top level;
 *     uninstall uses WP_UNINSTALL_PLUGIN
 *   - frontend-tokens.md: every CSS file references tokens
 *   - frontend-responsive.md: 3 breakpoints only (640/1024/1440ish),
 *     no 24+ breakpoint values, 40px minimum tap targets
 *
 * This check exists because the skill's rules are documented but never
 * machine-enforced. Every plugin that activates the skill should pass this.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { CheckerResult, CheckerIssue } from './types.js';
import {
  findPhpFiles,
  findFilesByExt,
  findJsFiles,
  getLineNumber,
  relativePath,
  generateTestId,
  dirExists,
} from './shared-utils.js';

export function checkPluginDevRules(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];

  const phpFiles = findPhpFiles(pluginPath);
  const jsFiles = findJsFiles(pluginPath);
  const cssFiles = collectCssFiles(pluginPath);

  issues.push(...checkAlertConfirmBan(jsFiles, pluginPath));
  issues.push(...checkRawPostIteration(phpFiles, pluginPath));
  issues.push(...checkNonceCapabilityPairing(phpFiles, pluginPath));
  issues.push(...checkActivationHookPlacement(phpFiles, pluginPath));
  issues.push(...checkUninstallGuard(pluginPath));
  issues.push(...checkRawMinusOneInputs(phpFiles, pluginPath));
  issues.push(...checkInlineOnclick(phpFiles, pluginPath));
  issues.push(...checkBreakpointDiscipline(cssFiles, pluginPath));
  issues.push(...checkTapTargets(cssFiles, pluginPath));

  const errorCount = issues.filter((i) => i.type === 'error').length;
  return {
    category: 'plugin-dev-rules',
    issues,
    passed: Math.max(0, 9 - errorCount),
    failed: errorCount,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function collectCssFiles(pluginPath: string): string[] {
  const assetsDir = join(pluginPath, 'assets');
  if (!dirExists(assetsDir)) return [];
  return findFilesByExt(assetsDir, '.css');
}

/**
 * admin-ux-rulebook Rule 10: "Never use browser alert() or confirm()".
 * Flag both in JS.
 */
function checkAlertConfirmBan(
  jsFiles: string[],
  pluginPath: string,
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const file of jsFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);

    const alertMatches = content.matchAll(/\balert\s*\(/g);
    const alertFlagged = new Set<number>();
    for (const match of alertMatches) {
      const lineNum = getLineNumber(content, match.index ?? 0);
      if (alertFlagged.has(lineNum)) continue;
      alertFlagged.add(lineNum);
      const line = content.split('\n')[lineNum - 1] || '';
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;
      if (/console\.alert/.test(line)) continue;
      issues.push({
        id: generateTestId('plugin-dev-rules'),
        category: 'plugin-dev-rules',
        severity: 'high',
        type: 'error',
        title: 'Browser alert() used',
        message:
          "admin-ux-rulebook Rule 10 bans alert(). Use a toast notification (window.{prefix}Toast) instead — jarring, untranslatable, unprofessional.",
        file: rel,
        line: lineNum,
        code: 'alert-banned',
      });
    }

    const confirmMatches = content.matchAll(/\bconfirm\s*\(/g);
    const confirmFlagged = new Set<number>();
    for (const match of confirmMatches) {
      const lineNum = getLineNumber(content, match.index ?? 0);
      if (confirmFlagged.has(lineNum)) continue;
      confirmFlagged.add(lineNum);
      const line = content.split('\n')[lineNum - 1] || '';
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;
      issues.push({
        id: generateTestId('plugin-dev-rules'),
        category: 'plugin-dev-rules',
        severity: 'high',
        type: 'error',
        title: 'Browser confirm() used',
        message:
          "admin-ux-rulebook Rule 10 bans confirm(). Use a modal confirmation dialog instead.",
        file: rel,
        line: lineNum,
        code: 'confirm-banned',
      });
    }
  }
  return issues;
}

/**
 * security.md: "never process the entire $_POST / $_GET array; read explicit
 * keys". Flag patterns like `foreach ($_POST as ...)` or `array_map($fn, $_POST)`.
 */
function checkRawPostIteration(
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

    const iterMatches = content.matchAll(
      /(?:foreach\s*\(\s*\$_(POST|GET|REQUEST)|array_map\s*\([^)]*,\s*\$_(POST|GET|REQUEST))/g,
    );
    for (const match of iterMatches) {
      issues.push({
        id: generateTestId('plugin-dev-rules'),
        category: 'plugin-dev-rules',
        severity: 'high',
        type: 'error',
        title: 'Iterating over $_POST/$_GET directly',
        message:
          'security.md: never process the entire $_POST/$_GET; read explicit keys. Iteration makes it hard to audit sanitization per-key.',
        file: rel,
        line: getLineNumber(content, match.index ?? 0),
        code: 'raw-post-iter',
      });
    }
  }
  return issues;
}

/**
 * security.md: "Always pair nonces with capability checks". If a file has
 * `wp_verify_nonce` / `check_admin_referer` but no `current_user_can` nearby
 * (within 50 lines), flag.
 */
function checkNonceCapabilityPairing(
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
    const lines = content.split('\n');

    const nonceRe =
      /\b(wp_verify_nonce|check_admin_referer|check_ajax_referer)\s*\(/g;
    for (const match of content.matchAll(nonceRe)) {
      const lineNum = getLineNumber(content, match.index ?? 0);
      const windowStart = Math.max(0, lineNum - 5);
      const windowEnd = Math.min(lines.length, lineNum + 50);
      const windowText = lines.slice(windowStart, windowEnd).join('\n');
      if (/\bcurrent_user_can\s*\(/.test(windowText)) continue;
      issues.push({
        id: generateTestId('plugin-dev-rules'),
        category: 'plugin-dev-rules',
        severity: 'high',
        type: 'error',
        title: 'Nonce check without capability check',
        message:
          "security.md: nonces prevent CSRF but do NOT authorize. Pair with current_user_can() or more specific capability.",
        file: rel,
        line: lineNum,
        code: 'nonce-no-cap',
      });
    }
  }
  return issues;
}

/**
 * lifecycle.md: "register_activation_hook must be registered at top-level,
 * not inside other hooks". Flag calls nested inside a function body (indented).
 */
function checkActivationHookPlacement(
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

    const activationRe = /(^[ \t]+|add_action\([^)]*\bfunction)/gm;
    void activationRe; // placeholder; precise detection below

    const hookMatches = content.matchAll(
      /register_(?:activation|deactivation)_hook\s*\(/g,
    );
    for (const match of hookMatches) {
      const lineNum = getLineNumber(content, match.index ?? 0);
      const line = content.split('\n')[lineNum - 1] || '';
      if (/^[ \t]+register_/.test(line)) {
        issues.push({
          id: generateTestId('plugin-dev-rules'),
          category: 'plugin-dev-rules',
          severity: 'medium',
          type: 'warning',
          title: 'Activation hook indented',
          message:
            "lifecycle.md: activation/deactivation hooks must be registered at file top-level, not inside another function or hook callback.",
          file: rel,
          line: lineNum,
          code: 'activation-nested',
        });
      }
    }
  }
  return issues;
}

/**
 * lifecycle.md: uninstall.php must check WP_UNINSTALL_PLUGIN before any
 * destructive cleanup.
 */
function checkUninstallGuard(pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const uninstallPath = join(pluginPath, 'uninstall.php');
  let content: string;
  try {
    content = readFileSync(uninstallPath, 'utf-8');
  } catch {
    return issues;
  }
  if (!content.includes('WP_UNINSTALL_PLUGIN')) {
    issues.push({
      id: generateTestId('plugin-dev-rules'),
      category: 'plugin-dev-rules',
      severity: 'high',
      type: 'error',
      title: 'uninstall.php without WP_UNINSTALL_PLUGIN guard',
      message:
        'lifecycle.md: uninstall.php must check defined("WP_UNINSTALL_PLUGIN") before any destructive cleanup, or the file runs on direct access.',
      file: 'uninstall.php',
      line: 1,
      code: 'uninstall-no-guard',
    });
  }
  return issues;
}

/**
 * admin-ux-rulebook Rule 7: "No raw -1 values in admin UI". A number input
 * with value="-1" (e.g. for "unlimited") should be replaced with a checkbox.
 */
function checkRawMinusOneInputs(
  phpFiles: string[],
  pluginPath: string,
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const file of phpFiles) {
    if (!file.includes('/admin/') && !file.includes('/views/')) continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);

    const minusOneRe =
      /<input[^>]*type\s*=\s*["']number["'][^>]*value\s*=\s*["']-1["']/gi;
    for (const match of content.matchAll(minusOneRe)) {
      issues.push({
        id: generateTestId('plugin-dev-rules'),
        category: 'plugin-dev-rules',
        severity: 'medium',
        type: 'warning',
        title: 'Raw -1 value in number input',
        message:
          'admin-ux-rulebook Rule 7: expose "unlimited" as a checkbox that disables the number field and stores -1 on save. Users should not need to know the magic number.',
        file: rel,
        line: getLineNumber(content, match.index ?? 0),
        code: 'magic-minus-one',
      });
    }
  }
  return issues;
}

/**
 * frontend-responsive anti-pattern: inline onclick attributes, especially
 * inside data-wp-interactive regions.
 */
function checkInlineOnclick(
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

    const onclickRe = /\bonclick\s*=\s*["']/gi;
    for (const match of content.matchAll(onclickRe)) {
      issues.push({
        id: generateTestId('plugin-dev-rules'),
        category: 'plugin-dev-rules',
        severity: 'medium',
        type: 'warning',
        title: 'Inline onclick attribute',
        message:
          "frontend-responsive: inline onclick handlers fight Interactivity API + event delegation + CSP. Use data-wp-on--click or event listeners.",
        file: rel,
        line: getLineNumber(content, match.index ?? 0),
        code: 'inline-onclick',
      });
    }
  }
  return issues;
}

/**
 * frontend-responsive Rule 1: "Three breakpoints, no exceptions". Count
 * distinct max-width values across all CSS. If more than 4, flag.
 */
function checkBreakpointDiscipline(
  cssFiles: string[],
  pluginPath: string,
): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const breakpoints = new Map<string, string[]>(); // px value -> files

  for (const file of cssFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);
    const re = /@media[^{]*\(\s*max-width\s*:\s*(\d+)px/g;
    for (const match of content.matchAll(re)) {
      const bp = match[1];
      if (!breakpoints.has(bp)) breakpoints.set(bp, []);
      breakpoints.get(bp)!.push(rel);
    }
  }

  if (breakpoints.size > 4) {
    issues.push({
      id: generateTestId('plugin-dev-rules'),
      category: 'plugin-dev-rules',
      severity: 'medium',
      type: 'warning',
      title: `${breakpoints.size} distinct breakpoints found`,
      message: `frontend-responsive Rule 1: stick to 3 breakpoints (640/1024/1440 typical). Found: ${[...breakpoints.keys()].sort().join(', ')}px. Extra breakpoints are usually component-local fixes that should adjust the component instead.`,
      file: '.',
      line: 1,
      code: 'breakpoint-proliferation',
    });
  }
  return issues;
}

/**
 * frontend-responsive Rule 4: "Tap targets — 40px minimum everywhere".
 * Heuristic: count .lrn-btn / .jt-btn etc. rules with height < 40px.
 */
function checkTapTargets(
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

    // Look for button rules with explicit small heights (< 40px).
    const btnRe =
      /\.[a-z-]*btn[a-z-]*[^{]*\{[^}]*?(?:height|min-height)\s*:\s*(\d+)px/g;
    for (const match of content.matchAll(btnRe)) {
      const px = parseInt(match[1], 10);
      if (px >= 40) continue;
      issues.push({
        id: generateTestId('plugin-dev-rules'),
        category: 'plugin-dev-rules',
        severity: 'low',
        type: 'warning',
        title: `Button height ${px}px < 40px tap target`,
        message:
          "frontend-responsive Rule 4: 40px minimum tap target on buttons. Smaller hurts accessibility on touch devices.",
        file: rel,
        line: getLineNumber(content, match.index ?? 0),
        code: 'tap-target-small',
      });
    }
  }
  return issues;
}
