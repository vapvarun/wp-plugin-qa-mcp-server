/**
 * WP Plugin QA MCP Server - CSS Contract Checker
 *
 * Markup <-> stylesheet contract drift. Catches the silent-bug class where the
 * markup names a class or a custom property that no stylesheet defines, so CSS
 * resolves it to nothing (or to a hardcoded fallback literal) and the host
 * theme decides what the control looks like.
 *
 * Nothing else sees this. It is valid CSS, valid HTML and valid PHP; WPCS,
 * PHPStan, stylelint and Plugin Check all analyze files in isolation and none
 * of them cross the markup<->stylesheet boundary. It does not throw, it does
 * not warn, and it reaches customers.
 *
 * Every one of these shipped in wp-sell-services 1.7.1 and was found by hand,
 * one support card at a time:
 *
 *   .wpss-btn--link        defined only in vendor-dashboard.css, which the
 *                          member dashboard does not load. The Remove control
 *                          under the profile photo had no rule at all and fell
 *                          through to the theme: pure black on a dark card,
 *                          measured 1.18:1. (Basecamp 10300330443)
 *   --wpss-muted           never a token. wpss-tour.css asked for it and
 *                          silently got its LIGHT literal on a dark dashboard.
 *   --wpss-surface-hover   same; the pair rendered white-on-white at 1.13:1.
 *   .wpss-toast            defined only in admin.css, so every frontend toast
 *                          rendered unstyled at position:static, ~3100px down
 *                          the page. The member never saw a save confirmation.
 *   .wpss-dispute-detail__actions
 *                          in the template from day one, in no stylesheet ever,
 *                          so the theme set the spacing: 0px between buttons.
 *
 * Two findings, deliberately separated by confidence:
 *
 *   UNDEFINED  the name is defined in no stylesheet at all. High confidence.
 *              A custom property here is worse than a missing class, because
 *              var() silently falls back to the literal the author typed --
 *              which is almost always the light-mode value, so the bug only
 *              appears in dark mode.
 *
 *   NARROW     the name IS defined, but only in a stylesheet outside the set
 *              this plugin loads everywhere. That is exactly the .wpss-btn--link
 *              shape. Reported as a warning, because proving which sheet loads
 *              on which surface needs runtime and this check is static.
 *
 * Conservative by design. Dynamically built class names (string concatenation,
 * template interpolation, JS joins) are skipped rather than guessed at, so the
 * check biases to false-negatives. A name that cannot be resolved statically is
 * not a finding.
 *
 * Optional per-plugin override: `audit/css-contract.json`
 *   { "universal_sheets": ["design-system.css", "frontend.css"],
 *     "ignore": ["prefix-", "some-exact-class"] }
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import type { CheckerResult, CheckerIssue } from './types.js';
import {
  findPhpFiles,
  findJsFiles,
  findFilesByExt,
  getLineNumber,
  relativePath,
  generateTestId,
  fileExists,
} from './shared-utils.js';

/** Marker companion meaning "the element is styled by something we do not own". */
const PLATFORM_STYLED = '\u0000platform';

interface CssContractConfig {
  universal_sheets?: string[];
  ignore?: string[];
  /** Override when a plugin's CSS prefix cannot be inferred (rare). */
  prefix?: string;
  /**
   * A plugin whose stylesheets this one relies on at runtime, relative to the
   * plugin directory. Auto-detected for a `-pro` plugin sitting beside its free
   * sibling; set it when the pair is named some other way.
   */
  extends?: string;
}

/**
 * The prefix this plugin actually uses, read off its own stylesheets.
 *
 * Counts every `--x-` custom property and `.x-` class prefix and takes the most
 * common. Deriving it from the slug does not work across a portfolio:
 * "wp-sell-services" gives "wss" by initials and "wp" by first word, and the
 * real answer is "wpss". A prefix used fewer than 5 times is treated as noise
 * (a vendored library, a theme compatibility shim) rather than the plugin's own.
 */
function detectPrefix(cssFiles: string[]): string | null {
  const counts = new Map<string, number>();
  const re = /(?:--|\.)([a-z][a-z0-9]{1,11})-[a-z0-9-]/g;

  for (const file of cssFiles) {
    const base = file.split('/').pop() ?? file;
    if (!isAuthoredSheet(base)) continue;
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    src = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(re)) {
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestN = 4;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best ? `${best}-` : null;
}

interface NameUse {
  file: string;
  line: number;
}

/**
 * Generated siblings. Reading them would double-count every rule and, worse,
 * make a class look defined because a stale .min still carries it.
 */
function isAuthoredSheet(name: string): boolean {
  return name.endsWith('.css') && !name.endsWith('.min.css') && !/-rtl\.css$/.test(name);
}

function loadConfig(pluginPath: string): CssContractConfig {
  const configPath = join(pluginPath, 'audit', 'css-contract.json');
  if (!fileExists(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as CssContractConfig;
  } catch {
    return {};
  }
}

/**
 * Class names and custom properties each stylesheet defines.
 * Comments are stripped first so a name merely discussed in prose does not
 * count as defined -- this file is full of such prose itself.
 */
function collectDefinitions(
  cssFiles: string[],
  prefix: string,
  markupFiles: string[] = []
): { classes: Map<string, Set<string>>; tokens: Set<string> } {
  const classes = new Map<string, Set<string>>();
  const tokens = new Set<string>();
  const classRe = new RegExp(`\\.(${prefix}[A-Za-z0-9_-]+)`, 'g');
  const tokenRe = new RegExp(`(--${prefix}[A-Za-z0-9-]+)\\s*:`, 'g');

  // A rule inside a template's own <style> block is as real as one in a
  // stylesheet, and it ships on exactly the surface that uses it. Reading only
  // assets/css reported a class defined six lines above its own markup.
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const file of markupFiles) {
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const base = file.split('/').pop() ?? file;

    // A custom property set on the element itself is a definition, and it is
    // the normal way to pass a per-row value into CSS: a category colour, a
    // progress width, a computed column count. Only assets/css was read, so
    // every one of these looked undefined.
    for (const attr of src.matchAll(/style\s*=\s*["']([^"']*)["']/g)) {
      for (const m of attr[1].matchAll(tokenRe)) tokens.add(m[1]);
    }
    for (const m of src.matchAll(
      new RegExp(`setProperty\\(\\s*['"\`](--${prefix}[A-Za-z0-9-]+)`, 'g')
    )) {
      tokens.add(m[1]);
    }

    if (!/<style\b/i.test(src)) continue;
    for (const block of src.matchAll(styleRe)) {
      const css = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(classRe)) {
        if (!classes.has(m[1])) classes.set(m[1], new Set());
        classes.get(m[1])!.add(base);
      }
      for (const m of css.matchAll(tokenRe)) tokens.add(m[1]);
    }
  }

  for (const file of cssFiles) {
    const base = file.split('/').pop() ?? file;
    if (!isAuthoredSheet(base)) continue;
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    src = src.replace(/\/\*[\s\S]*?\*\//g, '');

    for (const m of src.matchAll(classRe)) {
      if (!classes.has(m[1])) classes.set(m[1], new Set());
      classes.get(m[1])!.add(base);
    }
    for (const m of src.matchAll(tokenRe)) {
      tokens.add(m[1]);
    }
  }
  return { classes, tokens };
}

/**
 * Class names and custom properties the markup asks for.
 *
 * Only statically resolvable names count. A class attribute containing any of
 * `<?php`, `${`, `{{` or a concatenation operator is skipped entirely: the real
 * name is computed at runtime and guessing produces noise, which is how a
 * checker earns the right to be ignored.
 */
function collectUsage(
  files: string[],
  projectPath: string,
  prefix: string
): {
  classes: Map<string, NameUse[]>;
  tokens: Map<string, NameUse[]>;
  companions: Map<string, Set<string>>;
} {
  const classes = new Map<string, NameUse[]>();
  const tokens = new Map<string, NameUse[]>();
  // Every other prefixed class sharing a class attribute with this one.
  const companions = new Map<string, Set<string>>();

  const attrRe = /(?:class\s*=\s*["']|className\s*=\s*["']|classList\.add\(\s*["'])([^"']+)/g;
  // Classes the host platform styles. An element carrying one of these is not
  // unstyled - WordPress draws it - and the prefixed class beside it is a hook.
  const platform = new Set([
    'button',
    'button-primary',
    'button-secondary',
    'button-link',
    'notice',
    'widefat',
    'striped',
    'regular-text',
    'dashicons',
    'components-button',
    'form-table',
    // WooCommerce admin draws these.
    'form-field',
    'form-field-wide',
    'woocommerce',
  ]);
  const varRe = new RegExp(`var\\(\\s*(--${prefix}[A-Za-z0-9-]+)`, 'g');
  const dynamic = /<\?php|\$\{|\{\{|\.\s*\$|\$\w+\s*\./;

  for (const file of files) {
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, projectPath);

    for (const m of src.matchAll(attrRe)) {
      const value = m[1];
      if (dynamic.test(value)) continue;
      const named = value.split(/\s+/).filter((c) => c.startsWith(prefix));
      // Does the element itself carry its look - a platform class, or a style
      // attribute on the same tag? Either way the prefixed class is not what
      // stands between this element and the theme.
      const at = m.index ?? 0;
      const tagStart = src.lastIndexOf('<', at);
      const tagEnd = src.indexOf('>', at);
      const tag = tagStart >= 0 && tagEnd > tagStart ? src.slice(tagStart, tagEnd) : '';
      const selfStyled =
        /\sstyle\s*=/.test(tag) || value.split(/\s+/).some((c) => platform.has(c));
      if (selfStyled) {
        for (const cls of named) {
          if (!companions.has(cls)) companions.set(cls, new Set());
          companions.get(cls)!.add(PLATFORM_STYLED);
        }
      }
      for (const cls of named) {
        for (const other of named) {
          if (other === cls) continue;
          if (!companions.has(cls)) companions.set(cls, new Set());
          companions.get(cls)!.add(other);
        }
      }
      for (const cls of value.split(/\s+/)) {
        if (!cls.startsWith(prefix)) continue;
        // `'x-toast x-toast--' + type` and `'x-badge--' . $status` both leave a
        // stub ending in a hyphen once the quote closes. The name is completed
        // at runtime, so reporting the stub is reporting a class nobody wrote.
        if (cls.endsWith('-')) continue;
        if (!classes.has(cls)) classes.set(cls, []);
        classes.get(cls)!.push({ file: rel, line: getLineNumber(src, m.index ?? 0) });
      }
    }
    for (const m of src.matchAll(varRe)) {
      if (!tokens.has(m[1])) tokens.set(m[1], []);
      tokens.get(m[1])!.push({ file: rel, line: getLineNumber(src, m.index ?? 0) });
    }
  }
  return { classes, tokens, companions };
}

/**
 * Classes used as behaviour hooks rather than styling.
 *
 * A large share of any plugin's classes are JS selectors and data attributes -
 * .prefix-accept-proposal, .prefix-add-faq - bound with querySelector or
 * jQuery and deliberately carrying no rule. Reporting those buries the real
 * findings: on wp-sell-services the raw class check produced 563 hits, of which
 * the overwhelming majority were hooks. A checker that is wrong 500 times gets
 * switched off, which is worse than not having it.
 */
function collectBehaviourHooks(jsFiles: string[], phpFiles: string[], prefix: string): Set<string> {
  const hooks = new Set<string>();
  // Any dot-prefixed name inside a string literal in JS is, in practice, a
  // selector. Narrowing to querySelector/$() misses event delegation, closest(),
  // matches(), template strings and every wrapper a codebase invents.
  const selectorRe = new RegExp(`['\"\`][^'\"\`]{0,200}\\.(${prefix}[A-Za-z0-9_-]+)`, 'g');

  for (const file of jsFiles) {
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(selectorRe)) hooks.add(m[1]);
  }

  // PHP hooks are narrower: only a genuine selector call, since PHP strings are
  // full of markup where a dotted name means nothing.
  const phpSelectorRe = new RegExp(
    `(?:querySelector(?:All)?\\(|closest\\(|\\$\\()\\s*['\"\`][^'\"\`]{0,120}\\.(${prefix}[A-Za-z0-9_-]+)`,
    'g'
  );
  for (const file of phpFiles) {
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(phpSelectorRe)) hooks.add(m[1]);
  }

  return hooks;
}

/**
 * Does this class name a control the user acts on?
 *
 * All five real bugs this checker exists for were controls or text - a Remove
 * link, a Replay Tour button, a toast, a timestamp, an actions row - never a
 * layout wrapper. An unstyled wrapper inherits the theme and usually looks
 * fine; an unstyled BUTTON inherits the theme's link colour and disappears
 * against a dark card. Grading on that keeps the error list worth reading:
 * wp-sell-services has ~460 undefined classes and only a fraction are controls.
 */
function looksLikeControl(cls: string): boolean {
  return /(?:^|-)(?:btn|button|link|toggle|action|cta|submit|remove|delete|close|dismiss|tab|input|field|select|checkbox|badge|notice|toast|alert|tooltip|menu-item)(?:-|--|$)/.test(
    cls
  );
}

export function checkCssContract(pluginPath: string): CheckerResult {
  const start = Date.now();
  const issues: CheckerIssue[] = [];

  const config = loadConfig(pluginPath);
  const cssFiles = findFilesByExt(pluginPath, '.css');

  // A Pro add-on does not carry its own design tokens: the free plugin is a hard
  // dependency and its design-system.css is already on the page. Checking Pro in
  // isolation reported every shared token as undefined - 57 of them on one
  // plugin, all of them fine - which is how a checker teaches people to ignore it.
  const base = pluginPath.replace(/\/+$/, '');
  const inherited: string[] = [];
  const sibling = config.extends
    ? resolve(base, config.extends)
    : /-pro$/.test(base)
      ? base.replace(/-pro$/, '')
      : null;
  if (sibling && sibling !== base && existsSync(sibling)) {
    inherited.push(...findFilesByExt(sibling, '.css'));
  }

  if (cssFiles.length === 0) {
    return {
      category: 'stylelint',
      issues: [],
      passed: 0,
      failed: 0,
      skipped: 1,
      duration: Date.now() - start,
    };
  }

  // Derive the prefix from the stylesheets rather than guessing it from the
  // slug: "wp-sell-services" yields "wss" by initials but the real prefix is
  // "wpss", and every product in the portfolio picks its own. The CSS is the
  // authority on what this plugin actually calls its things.
  const prefix = config.prefix ?? detectPrefix(cssFiles);

  if (!prefix) {
    return {
      category: 'stylelint',
      issues: [],
      passed: 0,
      failed: 0,
      skipped: 1,
      duration: Date.now() - start,
    };
  }

  const phpFiles = findPhpFiles(pluginPath);
  const jsFiles = findJsFiles(pluginPath).filter((f) => !f.endsWith('.min.js'));
  const markupFiles = [...phpFiles, ...jsFiles];

  const { classes: defined, tokens: definedTokens } = collectDefinitions([...cssFiles, ...inherited], prefix, markupFiles);

  // A prefix that matches nothing is a wrong guess, not a plugin with no CSS.
  if (defined.size === 0 && definedTokens.size === 0) {
    return {
      category: 'stylelint',
      issues: [],
      passed: 0,
      failed: 0,
      skipped: 1,
      duration: Date.now() - start,
    };
  }

  const { classes: used, tokens: usedTokens, companions } = collectUsage(markupFiles, pluginPath, prefix);
  const behaviourHooks = collectBehaviourHooks(jsFiles, phpFiles, prefix);

  // Stylesheets ask for tokens too, and that is where the dark-mode bugs live.
  for (const file of cssFiles) {
    const base = file.split('/').pop() ?? file;
    if (!isAuthoredSheet(base)) continue;
    let src: string;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    // Prose naming a token is not a request for it. frontend.css documents the
    // old `var(--x-x, #fff)` form in a comment; unstripped, the checker reported
    // `--x-x` as an undefined token against the very comment warning about it.
    src = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    const varRe = new RegExp(`var\\(\\s*(--${prefix}[A-Za-z0-9-]+)`, 'g');
    for (const m of src.matchAll(varRe)) {
      if (!usedTokens.has(m[1])) usedTokens.set(m[1], []);
      usedTokens.get(m[1])!.push({
        file: relativePath(file, pluginPath),
        line: getLineNumber(src, m.index ?? 0),
      });
    }
  }

  const ignore = config.ignore ?? [];
  const ignored = (name: string): boolean =>
    ignore.some((i) => name === i || (i.endsWith('-') && name.startsWith(i)));

  // Tokens first: a missing one is silent AND mode-dependent, so it is the
  // finding most likely to reach a customer.
  for (const [token, uses] of [...usedTokens].sort()) {
    if (definedTokens.has(token) || ignored(token)) continue;
    const first = uses[0];
    issues.push({
      id: generateTestId('css-contract'),
      category: 'stylelint',
      severity: 'high',
      type: 'error',
      title: `Undefined custom property: ${token}`,
      message:
        `${token} is used in ${uses.length} place(s) and defined in no stylesheet, so ` +
        `var() silently resolves to the hardcoded fallback the author typed. That fallback is ` +
        `almost always the light-mode value, which is why this class of bug usually only ` +
        `appears in dark mode and only after a customer reports it.`,
      file: first.file,
      line: first.line,
      code: `var(${token}, …)`,
      fix:
        `Define ${token} alongside the rest of the design tokens (including its dark-mode ` +
        `value), or change the call site to a token that exists. Do not rely on the fallback: ` +
        `it cannot follow the theme.`,
    });
  }

  const universal = new Set(config.universal_sheets ?? []);
  for (const [cls, uses] of [...used].sort()) {
    if (ignored(cls) || behaviourHooks.has(cls)) continue;
    const where = defined.get(cls);
    const first = uses[0];

    if (!where) {
      // A class sharing its element with a class that IS styled is not bare: the
      // base carries the look and this one adds a modifier or a JS hook. The
      // element still renders, so it is not the theme-decides defect - but a
      // modifier with no rule means the distinction it exists to draw (a LATE
      // badge against an ordinary one) is not being drawn, so it is not nothing.
      const withCls = companions.get(cls) ?? new Set<string>();
      const base = [...withCls].filter((c) => defined.has(c));
      const platformStyled = withCls.has(PLATFORM_STYLED);
      const isControl = looksLikeControl(cls) && base.length === 0 && !platformStyled;
      issues.push({
        id: generateTestId('css-contract'),
        category: 'stylelint',
        severity: isControl ? 'high' : 'low',
        // Only a control is an error. A wrapper with no rule inherits the theme
        // and is usually harmless; a button with no rule is the bug that ships.
        type: isControl ? 'error' : 'warning',
        title: `Undefined ${isControl ? 'control' : 'class'}: .${cls}`,
        message:
          `.${cls} is used in ${uses.length} place(s) in the markup and has no rule in any ` +
          `stylesheet` +
          (platformStyled
            ? `. Its element is styled by the platform (a WordPress class, or an inline style), ` +
              `so this class is a hook rather than the thing holding the element up`
            : base.length
            ? `. It shares its element with .${base[0]}, which is styled, so the element still ` +
              `renders - but whatever this class was added to change, it does not change.`
            : `, so the host theme decides how it renders`) +
          `. This is invisible in a diff and passes every linter.`,
        file: first.file,
        line: first.line,
        code: `class="${cls}"`,
        fix:
          `Add a rule for .${cls}, or drop the class if it was left behind by a refactor. ` +
          `If it is styled only by a parent selector, add it to audit/css-contract.json → ignore.`,
      });
      continue;
    }

    if (universal.size > 0 && ![...where].some((s) => universal.has(s))) {
      issues.push({
        id: generateTestId('css-contract'),
        category: 'stylelint',
        severity: 'medium',
        type: 'warning',
        title: `Narrowly defined class: .${cls}`,
        message:
          `.${cls} is defined only in ${[...where].join(', ')}, which is not one of this ` +
          `plugin's universally loaded stylesheets. If that sheet does not load on the ` +
          `surface using the class, the control renders unstyled and inherits the theme.`,
        file: first.file,
        line: first.line,
        code: `class="${cls}"`,
        fix:
          `Confirm ${[...where].join(', ')} is enqueued on this surface. If not, move the rule ` +
          `into a shared stylesheet — the same fix .wpss-btn--link needed.`,
      });
    }
  }

  const failed = issues.filter((i) => i.type === 'error').length;

  return {
    category: 'stylelint',
    issues,
    passed: used.size + usedTokens.size - issues.length,
    failed,
    skipped: 0,
    duration: Date.now() - start,
  };
}
