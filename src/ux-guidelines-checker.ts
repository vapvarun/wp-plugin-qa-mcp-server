/**
 * WP Plugin QA MCP Server - UX Guidelines Enforcement Checker
 *
 * Machine-checks rules from docs/UX-GUIDELINES.md (or equivalent). Rules fired:
 *   1. CSS token compliance — no raw hex/px outside var(--prefix-*, fallback)
 *   2. Icon policy — no Dashicons, no emoji in UI
 *   3. Human labels — label text with underscore-joined words flagged as jargon
 *   4. Raw focus outline — `outline: none` without a matching :focus-visible
 *   5. Page header consistency — admin edit views should include .prefix-page-header
 *
 * Tuning (2026-04-18):
 *  - Block-aware parser replaces the single-pass :root/:host/.class regex.
 *    Any rule block that contains at least one `--prefix-*:` declaration is
 *    treated as a token-source block and skipped — including `:root, .class`
 *    combined selectors with comma-separated lists.
 *  - Same-line var() fallback detection is per-match: track paren depth
 *    along the line and determine whether the match sits inside `var(...)`.
 *    `padding: var(--lrn-sp-4, 16px) 20px` now correctly flags the `20px`
 *    while leaving the `16px` fallback alone.
 *  - Broader safelist: translate()/calc()/hairline-borders/inset/
 *    line-height/@media breakpoints, plus @keyframes frame positions.
 *  - Prefix auto-detection tie-breaks by presence in `{prefix}.css` /
 *    `{prefix}-NAME.css` filenames.
 */

import { readFileSync } from 'fs';
import { join, basename } from 'path';
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
  const filenameHits = new Map<string, number>();
  for (const file of cssFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const base = basename(file, '.css');
    const matches = content.matchAll(/--([a-z]+)-[a-z0-9-]+/g);
    for (const match of matches) {
      const pre = match[1];
      if (pre.length < 2 || pre.length > 6) continue;
      counter.set(pre, (counter.get(pre) || 0) + 1);
      if (base === pre || base.startsWith(`${pre}-`)) {
        filenameHits.set(pre, (filenameHits.get(pre) || 0) + 1);
      }
    }
  }
  let best = 'lrn';
  let bestCount = 0;
  let bestFilenameHits = 0;
  for (const [pre, count] of counter.entries()) {
    const fHits = filenameHits.get(pre) || 0;
    if (
      count > bestCount ||
      (count === bestCount && fHits > bestFilenameHits)
    ) {
      best = pre;
      bestCount = count;
      bestFilenameHits = fHits;
    }
  }
  return best;
}

function findCssFiles(pluginPath: string): string[] {
  const assetsDir = join(pluginPath, 'assets');
  if (!dirExists(assetsDir)) return [];
  return findFilesByExt(assetsDir, '.css');
}

/**
 * Strip any CSS rule block that defines at least one `--prefix-*: …;`
 * declaration — those are token-source blocks where raw hex/px values are
 * legitimate. Also blank out CSS comments so their prose (e.g. "768px
 * breakpoint") doesn't false-positive.
 *
 * Returns the input with stripped ranges replaced by spaces so byte offsets
 * line up with the original for downstream line-number lookups.
 */
function stripTokenBlocks(content: string, prefix: string): string {
  const out = content.split('');
  const tokenRe = new RegExp(`--${escapeRegex(prefix)}-[a-z0-9-]+\\s*:`);
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) break;
      // Blank the comment range so its prose doesn't hit downstream regexes.
      for (let j = i; j < end + 2; j++) {
        if (out[j] !== '\n') out[j] = ' ';
      }
      i = end + 2;
      continue;
    }
    if (ch === '{') {
      const close = findMatchingBrace(content, i);
      if (close === -1) break;
      const body = content.slice(i + 1, close);
      if (tokenRe.test(body)) {
        // Blank out the block body (keep braces to preserve structure).
        for (let j = i + 1; j < close; j++) {
          if (out[j] !== '\n') out[j] = ' ';
        }
      }
      i = close + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

function findMatchingBrace(content: string, start: number): number {
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (ch === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Returns true when the character at `col` on `line` sits inside a
 * `var(...)` call. Walks the line left-to-right tracking paren depth
 * and remembering whether the most recent opening paren was preceded
 * by `var`.
 */
function isInsideVarCall(line: string, col: number): boolean {
  const stack: boolean[] = []; // true = this level is a var(...)
  for (let i = 0; i < col; i++) {
    const ch = line[i];
    if (ch === '(') {
      const before = line.slice(Math.max(0, i - 4), i);
      const isVar = /(?:^|[\s:,+*/()-])var\s*$/.test(before);
      stack.push(isVar);
    } else if (ch === ')') {
      stack.pop();
    }
  }
  return stack.some((v) => v);
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

    const stripped = stripTokenBlocks(content, prefix);
    const lines = stripped.split('\n');

    const hexFlagged = new Set<number>();
    const hexMatches = stripped.matchAll(/(?<!\()#[0-9a-fA-F]{3,8}\b/g);
    for (const match of hexMatches) {
      const idx = match.index ?? 0;
      const lineNum = getLineNumber(stripped, idx);
      const line = lines[lineNum - 1] || '';
      const col = columnFor(stripped, idx);
      if (isInsideVarCall(line, col)) continue;
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

    const pxFlagged = new Set<number>();
    const pxMatches = stripped.matchAll(/(?<![\w(])(\d+)px\b/g);
    for (const match of pxMatches) {
      const idx = match.index ?? 0;
      const lineNum = getLineNumber(stripped, idx);
      const line = lines[lineNum - 1] || '';
      const col = columnFor(stripped, idx);

      // Per-match var() containment check — fixes the multi-var line bug.
      if (isInsideVarCall(line, col)) continue;
      if (isInsideCalc(line, col)) continue;
      if (isInsideTranslate(line, col)) continue;

      // Safelist contexts resolved line-wide.
      if (pxFlagged.has(lineNum)) continue;
      if (/^\s*0px\b/.test(line)) continue;
      if (/\bbox-shadow/.test(line)) continue;

      const trimmedLine = line.trim();

      // Hairline borders / outlines: `border…: Npx solid …` where N ≤ 4.
      if (/\bborder(?:-(?:top|bottom|left|right|inline|block))?\s*:/.test(line)) {
        const pxVal = parseInt(match[1], 10);
        if (pxVal <= 4) continue;
      }
      // Focus ring: outline: Npx solid …, outline-offset: Npx (N ≤ 4).
      if (/\boutline(?:-offset)?\s*:/.test(line)) {
        const pxVal = parseInt(match[1], 10);
        if (pxVal <= 4) continue;
      }

      // `inset: 0`, `top: 0`, etc. already hit by 0px guard; allow small anchors.
      if (/^(?:inset|top|right|bottom|left)\s*:/i.test(trimmedLine)) {
        const pxVal = parseInt(match[1], 10);
        if (pxVal === 0) continue;
      }

      // line-height: 24px etc. — acceptable, typographic leading.
      if (/^line-height\s*:/i.test(trimmedLine)) continue;

      // @media (min-width: 640px) / (max-width: 1024px) — a separate checker
      // handles breakpoint discipline; don't double-fire here.
      if (/^@media\b/.test(trimmedLine)) continue;

      // @keyframes `0%` / `100%` use their own grammar — not px; skip noise.
      if (/^@keyframes\b|^\s*(?:from|to|\d+%)\s*\{/.test(trimmedLine)) continue;

      // Transform translate(Npx) — already handled by isInsideTranslate above.
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

function columnFor(content: string, idx: number): number {
  const prevNewline = content.lastIndexOf('\n', idx - 1);
  return idx - (prevNewline + 1);
}

function isInsideCalc(line: string, col: number): boolean {
  return isInsideNamedCall(line, col, /(?:^|[\s:,+*/()-])calc\s*$/);
}

function isInsideTranslate(line: string, col: number): boolean {
  return isInsideNamedCall(
    line,
    col,
    /(?:^|[\s:,+*/()-])(?:translate|translate[XYZ]|translate3d|matrix|matrix3d|scale|rotate)\s*$/,
  );
}

function isInsideNamedCall(line: string, col: number, namePattern: RegExp): boolean {
  const stack: boolean[] = [];
  for (let i = 0; i < col; i++) {
    const ch = line[i];
    if (ch === '(') {
      const before = line.slice(0, i);
      stack.push(namePattern.test(before));
    } else if (ch === ')') {
      stack.pop();
    }
  }
  return stack.some((v) => v);
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
