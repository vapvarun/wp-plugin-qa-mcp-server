/**
 * WP Plugin QA MCP Server - Accessibility Checker
 *
 * Static analysis for accessibility issues based on WCAG 2.1 AA.
 *
 * Design principle: parse HTML tags as whole units (across line breaks)
 * and consider surrounding context — not line-by-line grep. A line-only
 * grep produced a high false-positive rate on plugins that use the
 * common WP multi-line formatting pattern, e.g.:
 *
 *   <input
 *       type="number"
 *       id="x"
 *       aria-label="…"
 *   />
 *
 * where a line-level regex sees only `<input` on line 1 and declares
 * there is no aria-label.
 */

import type { CheckerResult, CheckerIssue } from './types.js';
import { generateTestId, findPhpFiles, findJsFiles, findFilesByExt, relativePath, safeReadFile } from './shared-utils.js';

export function checkAccessibility(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(pluginPath);
  const jsFiles = findJsFiles(pluginPath);
  const cssFiles = findFilesByExt(pluginPath, '.css');

  issues.push(...checkFormLabels(pluginPath, phpFiles));
  issues.push(...checkImageAlts(pluginPath, phpFiles));
  issues.push(...checkAriaUsage(pluginPath, phpFiles));
  issues.push(...checkFocusManagement(pluginPath, jsFiles));
  issues.push(...checkColorContrast(pluginPath, cssFiles));
  issues.push(...checkKeyboardNav(pluginPath, phpFiles, jsFiles));
  issues.push(...checkScreenReaderText(pluginPath, phpFiles));

  const errors = issues.filter(i => i.type === 'error').length;
  const totalChecks = 7;

  return {
    category: 'a11y',
    issues,
    passed: Math.max(0, totalChecks - errors),
    failed: errors,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

// ─── HTML tag extraction ──────────────────────────────────────────
//
// extractTags walks a file's content and emits every occurrence of the
// named tag as the complete <tag … > text (attributes included, across
// line breaks). All subsequent checks operate on these whole tags
// instead of single lines so multi-line formatting does not produce
// false positives.

interface Tag {
  name: string;
  /** Full tag text from `<name` through the matching `>` (attributes included, line breaks preserved). */
  full: string;
  /** Content between this opening tag and its closing </name> — only populated for container tags. */
  inner: string;
  /** 1-based line number of the opening `<`. */
  line: number;
  /** Character offset inside the source file where the tag starts. */
  offset: number;
  /** True when the opening tag self-closes (`<img … />`) or is a known void element. */
  selfClosing: boolean;
}

const VOID_ELEMENTS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'track', 'area', 'col', 'embed', 'param', 'wbr']);

function extractTags(content: string, tagNames: string[]): Tag[] {
  const tags: Tag[] = [];
  const namePattern = tagNames.map(escapeRegex).join('|');
  const openRe = new RegExp(`<(${namePattern})\\b`, 'gi');

  for (const match of content.matchAll(openRe)) {
    const name = match[1].toLowerCase();
    const startIdx = match.index ?? 0;
    const afterOpen = startIdx + match[0].length;

    // Walk forward to find the matching `>`, respecting quoted attribute values.
    let i = afterOpen;
    let inDouble = false;
    let inSingle = false;
    while (i < content.length) {
      const ch = content[i];
      if (inDouble) {
        if (ch === '"') inDouble = false;
      } else if (inSingle) {
        if (ch === "'") inSingle = false;
      } else {
        if (ch === '"') inDouble = true;
        else if (ch === "'") inSingle = true;
        else if (ch === '>') break;
      }
      i++;
    }
    if (i >= content.length) break; // Malformed — skip.

    const openEndIdx = i;
    const full = content.slice(startIdx, openEndIdx + 1);
    const selfClosing = VOID_ELEMENTS.has(name) || /\/\s*>$/.test(full);

    let inner = '';
    if (!selfClosing) {
      const closeRe = new RegExp(`</${escapeRegex(name)}\\s*>`, 'i');
      const rest = content.slice(openEndIdx + 1);
      const closeMatch = rest.match(closeRe);
      if (closeMatch && closeMatch.index !== undefined) {
        inner = rest.slice(0, closeMatch.index);
      }
    }

    tags.push({
      name,
      full,
      inner,
      line: lineOf(content, startIdx),
      offset: startIdx,
      selfClosing,
    });
  }

  return tags;
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`\\b${escapeRegex(attr)}\\s*=`, 'i').test(tag);
}

function getAttr(tag: string, attr: string): string | null {
  const m = tag.match(new RegExp(`\\b${escapeRegex(attr)}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return m ? m[2] : null;
}

// PHP short-echoes and text-output helpers that put visible content in a node.
const PHP_TEXT_OUTPUT_RE =
  /<\?(?:=|php\s+(?:echo|print|esc_html_e|esc_html__|esc_attr_e|esc_attr__|_e|__|_ex|_x|esc_html|esc_attr|wp_kses|translate|the_title|the_content)\b)/i;

function hasVisibleTextContent(inner: string): boolean {
  if (!inner) return false;

  // Strip nested HTML but keep PHP tags intact.
  const stripped = inner.replace(/<(?!\?)[^>]+>/g, ' ');
  if (stripped.trim().length > 0 && !/^\s*<\?/.test(stripped.trim())) return true;

  // PHP-emitted text counts as accessible content.
  return PHP_TEXT_OUTPUT_RE.test(inner);
}

// ─── Checks ────────────────────────────────────────────────────────

/**
 * Form inputs without an associated label.
 *
 * Acceptable associations:
 *   1. aria-label / aria-labelledby / title on the input itself
 *   2. A <label for="X"> somewhere in the file whose `for` matches the
 *      input's `id` attribute
 *   3. The input is wrapped in a <label> (nearest enclosing `<label`
 *      before the input's offset, without a closing </label> between)
 *   4. Hidden inputs — never labelled
 */
function checkFormLabels(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  let unlabeled = 0;
  const samples: Array<{ file: string; line: number }> = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);

    // Collect every <label for="X"> target in this file. The captured
    // value may contain embedded PHP (`<?php echo esc_attr( $id ); ?>`)
    // with single quotes inside — the regex uses a back-referenced outer
    // quote so the whole PHP expression is captured verbatim and later
    // compared verbatim against the matching input's `id` attribute.
    const labelForIds = new Set<string>();
    const labelForRe = /<label\b[^>]*?\bfor\s*=\s*(["'])([\s\S]*?)\1/gi;
    for (const lf of content.matchAll(labelForRe)) {
      labelForIds.add(lf[2]);
    }

    const inputs = extractTags(content, ['input', 'select', 'textarea']);
    for (const tag of inputs) {
      if (tag.name === 'input' && /type\s*=\s*["']hidden["']/i.test(tag.full)) continue;

      if (hasAttr(tag.full, 'aria-label') || hasAttr(tag.full, 'aria-labelledby') || hasAttr(tag.full, 'title')) continue;

      const id = getAttr(tag.full, 'id');
      if (id && labelForIds.has(id)) continue;

      if (isWrappedInLabel(content, tag.offset)) continue;

      // WP form-table pattern: <tr><th scope="row">…</th><td><input/></td></tr>
      // is a universally recognised label-by-proximity association. WCAG
      // 3.3.2 accepts this when the th contains descriptive text — not a
      // hard requirement, but widely treated as correct by screen readers.
      if (isInFormTableRowWithScopeHeader(content, tag.offset)) continue;

      unlabeled++;
      if (samples.length < 5) samples.push({ file: rel, line: tag.line });
    }
  }

  if (unlabeled > 0) {
    issues.push({
      id: generateTestId('a11y'),
      category: 'a11y',
      severity: 'high',
      type: 'error',
      title: `${unlabeled} form inputs without labels`,
      message: `Found ${unlabeled} <input>/<select>/<textarea> elements without an associated <label for>, aria-label, or aria-labelledby. Samples: ${samples.map(s => `${s.file}:${s.line}`).join(', ')}`,
      file: samples[0]?.file || '',
      line: samples[0]?.line || 0,
      code: 'missing-form-labels',
      fix: 'Add <label for="id"> with matching input id, aria-label="…", or aria-labelledby="…"',
    });
  }

  return issues;
}

function isWrappedInLabel(content: string, offset: number): boolean {
  const before = content.slice(0, offset);
  const lastOpen = before.lastIndexOf('<label');
  if (lastOpen < 0) return false;
  const between = before.slice(lastOpen);
  return !/<\/label\s*>/i.test(between);
}

/**
 * True when the input lives inside a `<tr>` that also contains a
 * `<th scope="row">` with non-whitespace content. This is the
 * WordPress-core settings-page pattern and is widely accepted as a
 * valid form-row label association by screen readers.
 */
function isInFormTableRowWithScopeHeader(content: string, offset: number): boolean {
  const before = content.slice(0, offset);
  const lastTrOpen = before.lastIndexOf('<tr');
  if (lastTrOpen < 0) return false;
  // Ensure the <tr> has not been closed before the input offset.
  const betweenTrAndInput = before.slice(lastTrOpen);
  if (/<\/tr\s*>/i.test(betweenTrAndInput)) return false;

  // Look at the tr opening plus some content after (till </tr> OR next tr).
  const after = content.slice(offset);
  const closeIdx = after.search(/<\/tr\s*>/i);
  const rowEnd = closeIdx >= 0 ? offset + closeIdx : content.length;
  const rowBlock = content.slice(lastTrOpen, rowEnd);

  const scopedTh = rowBlock.match(/<th\b[^>]*\bscope\s*=\s*["']row["'][^>]*>([\s\S]*?)<\/th\s*>/i);
  if (!scopedTh) return false;

  // The <th> must have non-whitespace content (literal text or PHP output).
  const inner = scopedTh[1].trim();
  return inner.length > 0;
}

/**
 * <img> without an `alt` attribute. Empty alt="" is acceptable for
 * decorative images and is NOT flagged.
 */
function checkImageAlts(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  let missing = 0;
  const samples: Array<{ file: string; line: number }> = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);

    const imgs = extractTags(content, ['img']);
    for (const tag of imgs) {
      if (hasAttr(tag.full, 'alt')) continue;
      // Interactivity API binds alt at runtime — don't flag those.
      if (/data-wp-bind--alt\s*=/.test(tag.full)) continue;
      missing++;
      if (samples.length < 5) samples.push({ file: rel, line: tag.line });
    }
  }

  if (missing > 0) {
    issues.push({
      id: generateTestId('a11y'),
      category: 'a11y',
      severity: 'high',
      type: 'error',
      title: `${missing} images without alt attribute`,
      message: 'Found <img> tags without an alt attribute. Use alt="" for decorative images and descriptive text otherwise.',
      file: samples[0]?.file || '',
      line: samples[0]?.line || 0,
      code: 'missing-img-alt',
      fix: 'Add alt attribute to all <img> tags. Use alt="" for decorative images.',
    });
  }

  return issues;
}

/**
 * ARIA usage mistakes:
 *   - aria-hidden="true" on a natively-focusable element UNLESS paired with tabindex="-1"
 *   - role="button" on <div>/<span> without tabindex
 *   - Empty aria-label
 *   - Redundant role="button" on <button>
 */
function checkAriaUsage(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);

    const focusables = extractTags(content, ['a', 'button', 'input', 'select', 'textarea']);
    for (const tag of focusables) {
      if (!/\baria-hidden\s*=\s*["']true["']/i.test(tag.full)) continue;
      if (/\btabindex\s*=\s*["']-1["']/i.test(tag.full)) continue;
      if (/\bdisabled\b/i.test(tag.full)) continue;

      issues.push({
        id: generateTestId('a11y'),
        category: 'a11y',
        severity: 'high',
        type: 'error',
        title: 'aria-hidden="true" on focusable element',
        message: 'Focusable elements marked aria-hidden="true" are invisible to screen readers but still reachable via keyboard.',
        file: rel,
        line: tag.line,
        code: 'aria-hidden-focusable',
        fix: 'Add tabindex="-1" to remove the element from the tab order, or drop aria-hidden="true".',
      });
    }

    const divSpans = extractTags(content, ['div', 'span']);
    for (const tag of divSpans) {
      if (!/\brole\s*=\s*["']button["']/i.test(tag.full)) continue;
      if (/\btabindex\s*=/i.test(tag.full)) continue;
      issues.push({
        id: generateTestId('a11y'),
        category: 'a11y',
        severity: 'medium',
        type: 'warning',
        title: 'role="button" without tabindex',
        message: 'A non-interactive element with role="button" needs tabindex="0" for keyboard access.',
        file: rel,
        line: tag.line,
        code: 'aria-button-no-tabindex',
        fix: 'Add tabindex="0" or switch to a <button> element.',
      });
    }

    const buttons = extractTags(content, ['button']);
    for (const tag of buttons) {
      if (/\brole\s*=\s*["']button["']/i.test(tag.full)) {
        issues.push({
          id: generateTestId('a11y'),
          category: 'a11y',
          severity: 'low',
          type: 'info',
          title: 'Redundant role="button" on <button>',
          message: '<button> already has the implicit role of button — adding role="button" is redundant.',
          file: rel,
          line: tag.line,
          code: 'redundant-aria-role',
        });
      }
    }

    const emptyAriaRe = /\baria-label\s*=\s*(['"])\s*\1/gi;
    for (const em of content.matchAll(emptyAriaRe)) {
      issues.push({
        id: generateTestId('a11y'),
        category: 'a11y',
        severity: 'medium',
        type: 'warning',
        title: 'Empty aria-label attribute',
        message: 'aria-label="" provides no accessible name. Either add descriptive text or remove the attribute.',
        file: rel,
        line: lineOf(content, em.index ?? 0),
        code: 'empty-aria-label',
        fix: 'Add descriptive text to aria-label or remove the empty attribute.',
      });
    }
  }

  return issues;
}

function checkFocusManagement(pluginPath: string, jsFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const file of jsFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);

    // The check is intentionally conservative: most `click` handlers in
    // well-formed WP plugins target a <button>, <a>, <input>, or are
    // delegated via `.closest()` onto a focusable selector. We only flag
    // the handler when BOTH of the following are true:
    //   (a) no key* handler exists anywhere in the file, AND
    //   (b) the handler body does not reference a focusable element
    //       (button / a / input / select / textarea / tabindex / role=button).
    const addListenerRe = /addEventListener\s*\(\s*['"]click['"]/g;
    const hasKeyHandlerAnywhere = /addEventListener\s*\(\s*['"]key(?:down|press|up)['"]/.test(content);
    if (!hasKeyHandlerAnywhere) {
      for (const m of content.matchAll(addListenerRe)) {
        const idx = m.index ?? 0;
        const window = content.slice(Math.max(0, idx - 300), idx + 800);
        const targetsFocusable =
          /['"]button['"]|['"]a\[|\[role=button\]|closest\(['"](?:button|a\[href\]|input|select|textarea)|\.(?:button|btn|submit-btn)\b|tabindex\s*=/.test(
            window,
          );
        if (targetsFocusable) continue;

        issues.push({
          id: generateTestId('a11y'),
          category: 'a11y',
          severity: 'medium',
          type: 'warning',
          title: 'Click handler without keyboard alternative',
          message:
            'A click handler was registered without a key handler in this file, and the handler body does not obviously target a <button>/<a>/<input>. Non-button targets need Enter/Space support.',
          file: rel,
          line: lineOf(content, idx),
          code: 'click-only-handler',
          fix: 'Add a keydown handler for Enter/Space, or delegate via closest(\'button\').',
        });
        break; // One sample per file is enough.
      }
    }
  }
  return issues;
}

/**
 * Flags `outline: none` on :focus / :focus-visible rules that have no
 * later replacement rule.
 */
function checkColorContrast(pluginPath: string, cssFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const file of cssFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);

    const focusBlockRe = /([^\n{]*:focus(?:-visible)?[^\n{]*)\{([^}]*)\}/g;
    for (const m of content.matchAll(focusBlockRe)) {
      const selector = m[1].trim();
      const body = m[2];
      if (!/outline\s*:\s*(?:none|0)/i.test(body)) continue;

      const idx = m.index ?? 0;
      const baseSelector = selector.replace(/:focus(?:-visible)?/g, '').trim();
      const afterThisRule = content.slice(idx + m[0].length);
      const hasReplacement = new RegExp(
        `${escapeRegex(baseSelector)}:focus-visible[^\\{]*\\{[^}]*outline\\s*:\\s*(?!none|0)`,
        'i',
      ).test(afterThisRule);
      if (hasReplacement) continue;

      issues.push({
        id: generateTestId('a11y'),
        category: 'a11y',
        severity: 'high',
        type: 'error',
        title: 'outline:none without :focus-visible replacement',
        message: `Selector "${selector}" removes the focus outline but no later rule adds a replacement.`,
        file: rel,
        line: lineOf(content, idx),
        code: 'a11y-outline-none',
        fix: 'Add a matching :focus-visible rule with outline: 2px solid <brand>; outline-offset: 2px;',
      });
    }
  }
  return issues;
}

function checkKeyboardNav(pluginPath: string, phpFiles: string[], _jsFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);

    const tabRe = /\btabindex\s*=\s*["'](\d+)["']/gi;
    for (const m of content.matchAll(tabRe)) {
      const value = parseInt(m[1], 10);
      if (value > 0) {
        issues.push({
          id: generateTestId('a11y'),
          category: 'a11y',
          severity: 'medium',
          type: 'warning',
          title: `Positive tabindex (${value})`,
          message: 'Positive tabindex values break natural tab order. Use 0 or -1 only.',
          file: rel,
          line: lineOf(content, m.index ?? 0),
          code: 'positive-tabindex',
          fix: 'Change to tabindex="0" (natural order) or tabindex="-1" (not in tab order).',
        });
      }
    }
  }
  return issues;
}

/**
 * Icon-only buttons/links need an accessible name. Buttons with visible
 * text — including PHP-emitted text — are not icon-only.
 *
 * Icon class matching is conservative: require a class that starts with
 * `dashicons-<letter>`, `fa-<letter>`, or `wp-menu-image`, or a Lucide
 * `data-lucide=` attribute. `icon-picker__toggle` no longer false
 * positives because `icon-picker__toggle` is a component class, not an
 * icon glyph class.
 */
function checkScreenReaderText(pluginPath: string, phpFiles: string[]): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  let iconOnly = 0;
  const samples: Array<{ file: string; line: number }> = [];

  const iconClassRe = /class\s*=\s*(['"])[^"']*\b(?:dashicons-[a-z]|fa-[a-z]|wp-menu-image)\b[^"']*\1/i;
  const lucideAttrRe = /data-lucide\s*=/i;

  for (const file of phpFiles) {
    const content = safeReadFile(file);
    if (!content) continue;
    const rel = relativePath(file, pluginPath);

    const tags = extractTags(content, ['button', 'a']);
    for (const tag of tags) {
      const usesIconClass = iconClassRe.test(tag.full);
      const hasLucide = lucideAttrRe.test(tag.full) || lucideAttrRe.test(tag.inner);
      if (!usesIconClass && !hasLucide) continue;

      if (hasAttr(tag.full, 'aria-label') || hasAttr(tag.full, 'aria-labelledby') || hasAttr(tag.full, 'title')) continue;

      if (/screen-reader-text|sr-only|visually-hidden/.test(tag.inner)) continue;

      if (hasVisibleTextContent(tag.inner)) continue;

      iconOnly++;
      if (samples.length < 5) samples.push({ file: rel, line: tag.line });
    }
  }

  if (iconOnly > 0) {
    issues.push({
      id: generateTestId('a11y'),
      category: 'a11y',
      severity: 'high',
      type: 'error',
      title: `${iconOnly} icon-only buttons/links without accessible names`,
      message: `Icon-only buttons need aria-label, a screen-reader-text span, or visible text (including PHP-emitted text). Samples: ${samples.map(s => `${s.file}:${s.line}`).join(', ')}`,
      file: samples[0]?.file || '',
      line: samples[0]?.line || 0,
      code: 'icon-only-no-label',
      fix: 'Add aria-label="Description" or <span class="screen-reader-text">Description</span> inside the element.',
    });
  }

  return issues;
}
