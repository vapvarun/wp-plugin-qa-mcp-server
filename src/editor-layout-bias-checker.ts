/**
 * WP Plugin QA MCP Server - Editor Layout Bias Checker
 *
 * Catches the "Gutenberg-narrative layout but plugin is metadata-heavy" bug:
 * the admin edit view crams 4+ cards into a 280px sidebar while the main
 * content area has only title + empty body. The pattern is fine for posts;
 * catastrophic for plugins where the metadata IS the authoring work.
 *
 * Learnomy example (before Wave A3): lesson-editor.php had 6 cards squeezed
 * into the sidebar (Publish, Placement, Settings, Completion Rules, Resources,
 * Release) while main had only Title + empty Content.
 *
 * Static implementation: regex on raw template source to count region usage.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { CheckerResult, CheckerIssue } from './types.js';
import {
  findPhpFiles,
  relativePath,
  generateTestId,
  dirExists,
} from './shared-utils.js';
import { scanPlugin } from './scanner.js';

interface RegionStats {
  cards: number;
  inputs: number;
  charStart: number;
  charEnd: number;
}

interface TagPosition {
  index: number;
  isOpen: boolean;
  length: number;
}

export function checkEditorLayoutBias(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];

  const viewsDir = join(pluginPath, 'includes', 'admin', 'views');
  if (!dirExists(viewsDir)) {
    return {
      category: 'editor-layout-bias',
      issues: [],
      passed: 0,
      failed: 0,
      skipped: 1,
      duration: Date.now() - startTime,
    };
  }

  const prefix = detectCssPrefix(pluginPath);
  const phpFiles = findPhpFiles(viewsDir).filter((f) => {
    const base = f.split('/').pop() || '';
    return /(editor|form)\.php$/.test(base);
  });

  for (const file of phpFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);

    const sidebar = extractRegionStats(content, 'sidebar', prefix);
    const main = extractRegionStats(content, 'main', prefix);

    if (sidebar.cards >= 4 && main.inputs < 3) {
      issues.push({
        id: generateTestId('editor-layout-bias'),
        category: 'editor-layout-bias',
        severity: 'medium',
        type: 'warning',
        title: 'Inverted layout priority — metadata > content',
        message: `${rel} places ${sidebar.cards} cards in the sidebar region while the main region has only ${main.inputs} inputs. For metadata-heavy editors the important authoring controls should live in the main region, not a 280px sidebar.`,
        file: rel,
        line: 1,
        code: 'layout-inverted-bias',
        fix: `Move 2-3 of the sidebar cards into the main region (or switch to a single-column layout with accordion sections). Reference: course-form.php uses .${prefix}-page-content with in-page sections.`,
      });
    }

    if (main.inputs > 0 && sidebar.inputs > main.inputs * 2) {
      issues.push({
        id: generateTestId('editor-layout-bias'),
        category: 'editor-layout-bias',
        severity: 'medium',
        type: 'warning',
        title: 'Sidebar input count dominates main region',
        message: `${rel} has ${sidebar.inputs} inputs in the sidebar vs ${main.inputs} in the main region (>${Math.round(
          (sidebar.inputs / Math.max(1, main.inputs)) * 10,
        ) / 10}x). Fields competing for the narrow side panel should be promoted to the main region.`,
        file: rel,
        line: 1,
        code: 'layout-inverted-bias',
        fix: `Promote high-priority inputs (title/summary/content/settings) into the main region. Reserve the sidebar for truly secondary metadata (publish date, taxonomy, feature image).`,
      });
    }
  }

  return {
    category: 'editor-layout-bias',
    issues,
    passed: Math.max(0, phpFiles.length - issues.length),
    failed: issues.length,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function extractRegionStats(
  content: string,
  regionKind: 'sidebar' | 'main',
  prefix: string,
): RegionStats {
  const stats: RegionStats = { cards: 0, inputs: 0, charStart: -1, charEnd: -1 };
  const matcher =
    regionKind === 'sidebar'
      ? /sidebar|aside|secondary/i
      : /\bmain\b|\bcontent\b|primary/i;

  const tagRe = /<(aside|div|section|nav|main)\b([^>]*)>/gi;
  for (const m of Array.from(content.matchAll(tagRe))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    const isImplicitTag =
      (regionKind === 'sidebar' && tag === 'aside') ||
      (regionKind === 'main' && tag === 'main');
    const classMatch = attrs.match(/class\s*=\s*['"]([^'"]+)['"]/i);
    const roleMatch = attrs.match(/role\s*=\s*['"]([^'"]+)['"]/i);
    const classes = classMatch ? classMatch[1] : '';
    const role = roleMatch ? roleMatch[1].toLowerCase() : '';

    let matches = isImplicitTag;
    if (!matches && matcher.test(classes)) matches = true;
    if (!matches && regionKind === 'sidebar' && role === 'complementary') {
      matches = true;
    }
    if (!matches && regionKind === 'main' && role === 'main') {
      matches = true;
    }
    if (!matches) continue;

    const openIdx = m.index ?? 0;
    const closeIdx = findMatchingTagEnd(content, openIdx, tag);
    if (closeIdx < 0) continue;

    const body = content.slice(openIdx, closeIdx);
    stats.cards += countCards(body, prefix);
    stats.inputs += countInputs(body);
    if (stats.charStart < 0) stats.charStart = openIdx;
    stats.charEnd = closeIdx;
  }

  return stats;
}

/**
 * Same-depth tag matcher. Builds a list of all open/close positions with
 * matchAll (no stateful .exec calls), then walks them in order to find the
 * position that returns depth to 0.
 */
function findMatchingTagEnd(content: string, openIdx: number, tag: string): number {
  const positions: TagPosition[] = [];
  const openRe = new RegExp(`<${tag}\\b`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');

  for (const m of Array.from(content.matchAll(openRe))) {
    positions.push({
      index: m.index ?? 0,
      isOpen: true,
      length: m[0].length,
    });
  }
  for (const m of Array.from(content.matchAll(closeRe))) {
    positions.push({
      index: m.index ?? 0,
      isOpen: false,
      length: m[0].length,
    });
  }
  positions.sort((a, b) => a.index - b.index);

  let depth = 0;
  let started = false;
  for (const p of positions) {
    if (p.index < openIdx) continue;
    if (p.isOpen) {
      depth++;
      started = true;
    } else if (started) {
      depth--;
      if (depth === 0) return p.index + p.length;
    }
  }
  return -1;
}

function countCards(body: string, prefix: string): number {
  const patterns = [
    new RegExp(`\\b${prefix}-admin-card\\b`, 'g'),
    new RegExp(`\\b${prefix}-card\\b`, 'g'),
    new RegExp(`\\b${prefix}-settings-section\\b`, 'g'),
    /\bpostbox\b/g,
    /\bmeta-?box\b/gi,
  ];
  let total = 0;
  for (const p of patterns) {
    total += Array.from(body.matchAll(p)).length;
  }
  return total;
}

function countInputs(body: string): number {
  const tagRe = /<(input|select|textarea)\b[^>]*>/gi;
  let count = 0;
  for (const m of Array.from(body.matchAll(tagRe))) {
    const attrs = m[0];
    if (/type\s*=\s*['"]hidden['"]/i.test(attrs)) continue;
    if (/name\s*=\s*['"](_wpnonce|submit|s)['"]/i.test(attrs)) continue;
    count++;
  }
  return count;
}

/**
 * Plugin-agnostic CSS prefix detection. Delegates to the canonical scanner
 * implementation (`scanPlugin().cssPrefix`) which reads asset CSS files
 * and falls back to the plugin slug. Replaces the previous local
 * implementation that hard-coded `'lrn'` as the fallback.
 */
function detectCssPrefix(pluginPath: string): string {
  return scanPlugin(pluginPath).cssPrefix;
}
