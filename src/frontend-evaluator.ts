/**
 * WP Plugin QA MCP Server - Frontend Output Evaluator (v2.0.0)
 * Evaluates what users actually SEE — shortcodes, blocks, templates, CSS, JS.
 * Note: Pure static analysis, no shell commands used.
 */

import { readFileSync } from 'fs';
import type { CheckerResult, CheckerIssue, PluginManifest } from './types.js';
import { findPhpFiles, findJsFiles, findFilesByExt, getLineNumber, relativePath, generateTestId } from './shared-utils.js';

export function evaluateFrontend(manifest: PluginManifest, pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];
  const phpFiles = findPhpFiles(pluginPath);
  const jsFiles = findJsFiles(pluginPath);
  const cssFiles = findFilesByExt(pluginPath, '.css').filter(f => !f.endsWith('.min.css') && !f.includes('/build/') && !f.includes('/dist/'));

  const phpContents = new Map<string, string>();
  for (const file of phpFiles) {
    try { phpContents.set(file, readFileSync(file, 'utf-8')); } catch { /* skip */ }
  }

  const jsContents = new Map<string, string>();
  for (const file of jsFiles) {
    try { jsContents.set(file, readFileSync(file, 'utf-8')); } catch { /* skip */ }
  }

  const cssContents = new Map<string, string>();
  for (const file of cssFiles) {
    try { cssContents.set(file, readFileSync(file, 'utf-8')); } catch { /* skip */ }
  }

  issues.push(...checkShortcodeOutput(manifest, phpContents, pluginPath));
  issues.push(...checkBlockRendering(manifest, phpContents, pluginPath));
  issues.push(...checkCssScoping(manifest, cssContents, pluginPath));
  issues.push(...checkJsBehavior(jsContents, pluginPath));
  issues.push(...checkResponsiveAwareness(cssContents));
  issues.push(...checkWidgetOutput(manifest, phpContents, pluginPath));
  issues.push(...checkTemplateStructure(manifest, phpContents, pluginPath));
  issues.push(...checkModalPopupQuality(jsContents, pluginPath));
  issues.push(...checkFormCroQuality(phpContents, pluginPath));
  issues.push(...checkEmptyStateQuality(phpContents, pluginPath));

  const errors = issues.filter(i => i.type === 'error').length;
  const checks = 10;

  return {
    category: 'frontend-eval',
    issues,
    passed: Math.max(0, checks - errors),
    failed: errors,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

function checkShortcodeOutput(manifest: PluginManifest, contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  if (manifest.features.shortcodes.length === 0) return issues;

  for (const sc of manifest.features.shortcodes) {
    const callbackName = sc.callback;

    for (const [file, content] of contents) {
      const rel = relativePath(file, pluginPath);
      const funcPattern = new RegExp(`function\\s+${escapeRegex(callbackName)}\\s*\\(`);
      const funcMatch = funcPattern.exec(content);
      if (!funcMatch) continue;

      const funcEnd = findFunctionEnd(content, funcMatch.index);
      const funcBody = content.substring(funcMatch.index, funcEnd);

      if (!/\breturn\b/.test(funcBody)) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'high', type: 'error',
          title: `Shortcode [${sc.tag}] callback doesn't return`,
          message: `Shortcode callback "${callbackName}" appears to echo output instead of returning it. Shortcodes must return their output.`,
          file: rel, line: getLineNumber(content, funcMatch.index), code: 'shortcode-no-return',
          fix: 'Use ob_start()/ob_get_clean() or build a string and return it',
        });
      }

      if (!/empty|no\s*results?|nothing|not\s*found/i.test(funcBody)) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'low', type: 'info',
          title: `Shortcode [${sc.tag}] may lack empty state`,
          message: `No empty/no-results message found in shortcode callback. Users may see blank output.`,
          file: rel, line: getLineNumber(content, funcMatch.index), code: 'shortcode-no-empty-state',
          fix: 'Add a fallback message when the shortcode has nothing to display',
        });
      }
    }
  }

  return issues;
}

function checkBlockRendering(manifest: PluginManifest, contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  if (manifest.features.blocks.length === 0) return issues;

  for (const block of manifest.features.blocks) {
    let hasRenderCallback = false;
    for (const [, content] of contents) {
      if (content.includes(block.name) && /render_callback|render\.php/i.test(content)) {
        hasRenderCallback = true;
        break;
      }
    }

    if (!hasRenderCallback) {
      const blockDir = block.file.replace(/\/[^/]+$/, '');
      let hasRenderPhp = false;
      for (const [file] of contents) {
        if (file.startsWith(blockDir) && file.endsWith('render.php')) {
          hasRenderPhp = true;
          break;
        }
      }

      if (!hasRenderPhp) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
          title: `Block "${block.name}" may lack server-side rendering`,
          message: 'No render_callback or render.php found. Dynamic blocks need server-side rendering for non-JS contexts.',
          file: relativePath(block.file, pluginPath), line: block.line, code: 'block-no-ssr',
          fix: 'Add a render_callback or render.php for server-side block output',
        });
      }
    }
  }

  return issues;
}

function checkCssScoping(manifest: PluginManifest, cssContents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const slug = manifest.header.slug || manifest.header.textDomain;

  const genericSelectors = [
    /^\.container\s*\{/m, /^\.wrapper\s*\{/m, /^\.title\s*\{/m,
    /^\.content\s*\{/m, /^\.header\s*\{/m, /^\.footer\s*\{/m,
    /^\.sidebar\s*\{/m, /^\.button\s*\{/m, /^\.modal\s*\{/m,
    /^\.card\s*\{/m, /^\.list\s*\{/m, /^\.item\s*\{/m,
  ];

  for (const [file, content] of cssContents) {
    const rel = relativePath(file, pluginPath);

    for (const pattern of genericSelectors) {
      const match = pattern.exec(content);
      if (match) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
          title: `Generic CSS selector: ${match[0].trim()}`,
          message: `Unprefixed selector will likely conflict with themes and other plugins.`,
          file: rel, line: getLineNumber(content, match.index), code: 'css-generic-selector',
          fix: `Prefix with plugin namespace: .${slug}-container instead of .container`,
        });
      }
    }

    const importantMatches = content.match(/!important/g);
    if (importantMatches && importantMatches.length > 5) {
      issues.push({
        id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
        title: `Excessive !important usage (${importantMatches.length})`,
        message: `${importantMatches.length} uses of !important suggests specificity issues. This makes the plugin hard to customize.`,
        file: rel, line: 0, code: 'css-important-overuse',
        fix: 'Use more specific selectors instead of !important. Plugins should be easy for themes to override.',
      });
    }
  }

  return issues;
}

function checkJsBehavior(jsContents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const [file, content] of jsContents) {
    const rel = relativePath(file, pluginPath);

    // AJAX calls without error handling
    const ajaxPattern = /\$\.ajax\s*\(|\$\.post\s*\(|\$\.get\s*\(/g;
    let match;
    while ((match = ajaxPattern.exec(content)) !== null) {
      const context = content.substring(match.index, Math.min(match.index + 500, content.length));
      if (!/error\s*:|\.fail\s*\(|\.catch\s*\(|error\s*:\s*function/.test(context)) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
          title: 'AJAX call without error handler',
          message: 'jQuery AJAX call has no error callback. Users get no feedback when requests fail.',
          file: rel, line: getLineNumber(content, match.index), code: 'ajax-no-error-handler',
          fix: 'Add an error callback to show a user-friendly message on failure',
        });
      }
    }

    // fetch() without catch
    const fetchPattern = /\bfetch\s*\(/g;
    while ((match = fetchPattern.exec(content)) !== null) {
      const context = content.substring(match.index, Math.min(match.index + 500, content.length));
      if (!/\.catch\s*\(/.test(context)) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
          title: 'fetch() without .catch()',
          message: 'Fetch API call without error handling. Network failures will go unnoticed by users.',
          file: rel, line: getLineNumber(content, match.index), code: 'fetch-no-catch',
          fix: 'Add .catch() to handle network errors gracefully',
        });
      }
    }

    // Global variable pollution
    const globalPattern = /^var\s+\w+\s*=/gm;
    while ((match = globalPattern.exec(content)) !== null) {
      const before = content.substring(0, match.index);
      const openParens = (before.match(/\(function/g) || []).length;
      const iifeClosed = (before.match(/\}\)\s*\(/g) || []).length;
      if (openParens <= iifeClosed) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'low', type: 'info',
          title: 'Potential global variable',
          message: `"${match[0].trim()}" appears to be a global. May conflict with other scripts.`,
          file: rel, line: getLineNumber(content, match.index), code: 'js-global-var',
          fix: 'Wrap in an IIFE or use a namespaced object',
        });
        break; // One per file
      }
    }
  }

  return issues;
}

function checkResponsiveAwareness(cssContents: Map<string, string>): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  let totalCssLines = 0;
  let hasMediaQueries = false;

  for (const [, content] of cssContents) {
    totalCssLines += content.split('\n').length;
    if (/@media\s/.test(content)) {
      hasMediaQueries = true;
    }
  }

  if (totalCssLines > 50 && !hasMediaQueries) {
    issues.push({
      id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
      title: 'No responsive CSS detected',
      message: `${totalCssLines} lines of CSS with no @media queries. Plugin output may break on mobile devices.`,
      file: '', line: 0, code: 'no-responsive-css',
      fix: 'Add media queries or use flexible CSS (flexbox/grid) for responsive layout',
    });
  }

  return issues;
}

function checkWidgetOutput(manifest: PluginManifest, contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  if (manifest.features.widgets.length === 0) return issues;

  for (const widget of manifest.features.widgets) {
    const className = widget.className;

    for (const [file, content] of contents) {
      const rel = relativePath(file, pluginPath);
      const classPattern = new RegExp(`class\\s+${escapeRegex(className)}\\s`);
      if (!classPattern.test(content)) continue;

      // Check form() method
      const formMatch = /function\s+form\s*\(/.exec(content);
      if (formMatch) {
        const formEnd = findFunctionEnd(content, formMatch.index);
        const formBody = content.substring(formMatch.index, formEnd);

        if (!/<label/i.test(formBody)) {
          issues.push({
            id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
            title: `Widget "${className}" form lacks labels`,
            message: 'Widget form inputs without <label> elements hurt accessibility.',
            file: rel, line: getLineNumber(content, formMatch.index), code: 'widget-no-labels',
            fix: 'Add <label> elements associated with form inputs via for/id attributes',
          });
        }
      }

      // Check widget() output uses before_widget/after_widget
      const widgetMatch = /function\s+widget\s*\(/.exec(content);
      if (widgetMatch) {
        const widgetEnd = findFunctionEnd(content, widgetMatch.index);
        const widgetBody = content.substring(widgetMatch.index, widgetEnd);

        if (!/before_widget|after_widget/.test(widgetBody)) {
          issues.push({
            id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
            title: `Widget "${className}" ignores before/after_widget`,
            message: 'Widget output should use $args[before_widget] and $args[after_widget] for proper theme integration.',
            file: rel, line: getLineNumber(content, widgetMatch.index), code: 'widget-no-wrapper',
            fix: 'Echo $args["before_widget"] at start and $args["after_widget"] at end of widget() output',
          });
        }
      }

      break;
    }
  }

  return issues;
}

function checkTemplateStructure(manifest: PluginManifest, contents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const templates = manifest.features.templates;

  if (templates.length === 0) return issues;

  for (const tmpl of templates) {
    const file = tmpl.file.startsWith('/') ? tmpl.file : `${pluginPath}/${tmpl.file}`;
    const content = contents.get(file) || '';
    if (!content) continue;

    const rel = relativePath(file, pluginPath);

    if (!tmpl.hooksInTemplate || tmpl.hooksInTemplate.length === 0) {
      if (/<div|<section|<article/i.test(content) && content.split('\n').length > 10) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'low', type: 'info',
          title: `Template "${rel}" has no hooks`,
          message: 'Template outputs HTML without do_action/apply_filters hooks. Developers can\'t customize output.',
          file: rel, line: 0, code: 'template-no-hooks',
          fix: 'Add do_action hooks before/after major sections for extensibility',
        });
      }
    }
  }

  return issues;
}

function checkModalPopupQuality(jsContents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];
  const modalPattern = /\.modal|\.popup|\.overlay|\bdialog\b|\blightbox\b|\bfancybox\b/gi;

  for (const [file, content] of jsContents) {
    const rel = relativePath(file, pluginPath);
    const modalMatch = modalPattern.exec(content);
    modalPattern.lastIndex = 0;
    if (!modalMatch) continue;

    // Check for close button
    if (!/\.close|\.dismiss|×|✕|&times;|close-button|btn-close/i.test(content)) {
      issues.push({
        id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'high', type: 'error',
        title: 'Modal/popup missing close button',
        message: 'Modal or popup detected without a close/dismiss element. Users may get trapped.',
        file: rel, line: getLineNumber(content, modalMatch.index), code: 'modal-no-close-button',
        fix: 'Add a visible close button (.close, .dismiss, or × character) to the modal',
      });
    }

    // Check for ESC key handler
    if (!/keydown.*(?:27|Escape)|keyup.*(?:27|Escape)|(?:27|Escape).*key(?:down|up)/i.test(content)) {
      issues.push({
        id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
        title: 'Modal/popup missing ESC key handler',
        message: 'No keyboard escape handler found for modal. Users expect ESC to close popups.',
        file: rel, line: getLineNumber(content, modalMatch.index), code: 'modal-no-esc-handler',
        fix: 'Add a keydown listener for key code 27 (Escape) to close the modal',
      });
    }

    // Check for click-outside-to-close
    if (!/click.*overlay|overlay.*click|backdrop.*click|click.*backdrop|mousedown.*outside|click.*outside/i.test(content)) {
      issues.push({
        id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'low', type: 'info',
        title: 'Modal/popup missing click-outside-to-close',
        message: 'No click-outside-to-close behavior detected. Standard UX pattern for modals.',
        file: rel, line: getLineNumber(content, modalMatch.index), code: 'modal-no-click-outside',
        fix: 'Add a click handler on the overlay/backdrop to close the modal',
      });
    }

    // Check for frequency capping near popup/modal code
    const popupContext = content.substring(
      Math.max(0, modalMatch.index - 1000),
      Math.min(content.length, modalMatch.index + 2000)
    );
    if (/popup|pop-up|newsletter|subscribe|signup|sign-up/i.test(popupContext)) {
      if (!/localStorage|sessionStorage|cookie|setCookie|getCookie/i.test(popupContext)) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
          title: 'Popup missing frequency capping',
          message: 'Popup/modal appears to be a promotional popup but has no localStorage/sessionStorage/cookie cooldown after dismiss.',
          file: rel, line: getLineNumber(content, modalMatch.index), code: 'popup-no-frequency-cap',
          fix: 'Store a dismissed flag in localStorage/sessionStorage to avoid re-showing the popup immediately',
        });
      }
    }

    // Check for accessible role="dialog" or aria-label
    if (!/role\s*=\s*["']dialog["']|role\s*=\s*["']alertdialog["']|aria-label|aria-labelledby/i.test(content)) {
      issues.push({
        id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
        title: 'Modal missing ARIA attributes',
        message: 'Modal/popup has no role="dialog" or aria-label. Screen readers won\'t announce it properly.',
        file: rel, line: getLineNumber(content, modalMatch.index), code: 'modal-no-aria',
        fix: 'Add role="dialog" and aria-label (or aria-labelledby) to the modal container element',
      });
    }
  }

  return issues;
}

function checkFormCroQuality(phpContents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const [file, content] of phpContents) {
    const rel = relativePath(file, pluginPath);

    // Only check files that actually output form HTML
    if (!/<form[\s>]/i.test(content) && !/<input[\s>]/i.test(content)) continue;

    // Check for autocomplete attributes on input fields
    const inputPattern = /<input\b[^>]*>/gi;
    let inputMatch;
    let missingAutocomplete = 0;
    while ((inputMatch = inputPattern.exec(content)) !== null) {
      const tag = inputMatch[0];
      // Skip hidden, submit, button, checkbox, radio — autocomplete is for text-like inputs
      if (/type\s*=\s*["'](hidden|submit|button|checkbox|radio|file|image|reset)["']/i.test(tag)) continue;
      if (!/autocomplete\s*=/i.test(tag)) {
        missingAutocomplete++;
      }
    }
    if (missingAutocomplete > 0) {
      issues.push({
        id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'low', type: 'info',
        title: `${missingAutocomplete} input(s) missing autocomplete attribute`,
        message: 'Text inputs without autocomplete attribute miss browser autofill benefits and trigger Lighthouse warnings.',
        file: rel, line: 0, code: 'form-no-autocomplete',
        fix: 'Add autocomplete="name|email|tel|off" to input fields as appropriate',
      });
    }

    // Flag type="text" used for email or phone fields
    const textEmailPattern = /<input\b[^>]*type\s*=\s*["']text["'][^>]*(?:email|e-mail|mail)[^>]*>/gi;
    const textEmailMatch = textEmailPattern.exec(content);
    if (textEmailMatch) {
      issues.push({
        id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
        title: 'Email field using type="text" instead of type="email"',
        message: 'Input appears to be for email but uses type="text". type="email" gives better mobile keyboard and validation.',
        file: rel, line: getLineNumber(content, textEmailMatch.index), code: 'form-text-for-email',
        fix: 'Change type="text" to type="email" for email input fields',
      });
    }

    const textPhonePattern = /<input\b[^>]*type\s*=\s*["']text["'][^>]*(?:phone|tel|mobile|cell)[^>]*>/gi;
    const textPhoneMatch = textPhonePattern.exec(content);
    if (textPhoneMatch) {
      issues.push({
        id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
        title: 'Phone field using type="text" instead of type="tel"',
        message: 'Input appears to be for phone but uses type="text". type="tel" gives numeric keypad on mobile.',
        file: rel, line: getLineNumber(content, textPhoneMatch.index), code: 'form-text-for-phone',
        fix: 'Change type="text" to type="tel" for phone number input fields',
      });
    }

    // Check for placeholder-only labels (input has placeholder but no <label> nearby)
    const placeholderPattern = /<input\b[^>]*placeholder\s*=\s*["'][^"']+["'][^>]*>/gi;
    let phMatch;
    while ((phMatch = placeholderPattern.exec(content)) !== null) {
      const tag = phMatch[0];
      if (/type\s*=\s*["'](hidden|submit|button)["']/i.test(tag)) continue;
      // Check 500 chars before the input for a <label>
      const before = content.substring(Math.max(0, phMatch.index - 500), phMatch.index);
      if (!/<label[\s>]/i.test(before)) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
          title: 'Input uses placeholder without a <label>',
          message: 'Placeholder text is not a substitute for a <label>. Screen readers may not announce the field purpose.',
          file: rel, line: getLineNumber(content, phMatch.index), code: 'form-placeholder-only',
          fix: 'Add a <label> element associated with the input via for/id attributes',
        });
        break; // One per file to avoid noise
      }
    }

    // Look for generic submit button text
    const submitPattern = /<(?:button|input)\b[^>]*(?:type\s*=\s*["']submit["'])[^>]*>/gi;
    let submitMatch;
    while ((submitMatch = submitPattern.exec(content)) !== null) {
      const tag = submitMatch[0];
      // Check value attribute and inner text context
      const genericText = /value\s*=\s*["']\s*(?:Submit|Send|OK|Go)\s*["']/i;
      if (genericText.test(tag)) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'low', type: 'info',
          title: 'Generic submit button text',
          message: 'Submit button uses generic text like "Submit" or "Send". Descriptive labels improve conversion.',
          file: rel, line: getLineNumber(content, submitMatch.index), code: 'form-generic-submit',
          fix: 'Use action-specific text like "Create Account", "Save Settings", "Add to Cart"',
        });
        break; // One per file
      }
    }

    // Check for loading/disabled state on submit buttons (prevent double-submit)
    if (/<form[\s>]/i.test(content)) {
      const hasDoubleSubmitGuard = /disabled|submitting|is-loading|btn-loading|onclick.*disabled|\.prop\(\s*['"]disabled['"]|\.attr\(\s*['"]disabled['"]|preventDefault.*submit/i.test(content);
      if (!hasDoubleSubmitGuard) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'low', type: 'info',
          title: 'Form may lack double-submit protection',
          message: 'No disabled/loading state detected on form submission. Users may accidentally submit twice.',
          file: rel, line: 0, code: 'form-no-double-submit-guard',
          fix: 'Disable the submit button or show a loading state after form submission',
        });
      }
    }
  }

  return issues;
}

function checkEmptyStateQuality(phpContents: Map<string, string>, pluginPath: string): CheckerIssue[] {
  const issues: CheckerIssue[] = [];

  for (const [file, content] of phpContents) {
    const rel = relativePath(file, pluginPath);

    // Skip non-template/non-output files
    if (!/echo|print|<div|<section|<article|<table|<ul|<ol/i.test(content)) continue;

    // Look for loops that output items — these should have empty states
    const loopPattern = /(?:foreach|while|for)\s*\([^)]*\)\s*\{/g;
    let loopMatch;
    while ((loopMatch = loopPattern.exec(content)) !== null) {
      const loopEnd = findFunctionEnd(content, loopMatch.index);
      const loopBody = content.substring(loopMatch.index, loopEnd);

      // Only check loops that output HTML
      if (!/<div|<li|<tr|<article|<section|echo|print/i.test(loopBody)) continue;

      // Check surrounding context (before the loop) for empty state handling
      const before = content.substring(Math.max(0, loopMatch.index - 1000), loopMatch.index);
      const after = content.substring(loopEnd, Math.min(content.length, loopEnd + 500));

      const hasEmptyCheck = /empty\s*\(|count\s*\(.*===?\s*0|!.*\$|->num_rows\s*===?\s*0|have_posts|found_posts|->have_posts/i.test(before);
      const hasElseBranch = /\belse\b/i.test(after.substring(0, 100));
      const hasEmptyMessage = /no\s*items?|no\s*results?|nothing\s*found|empty|get\s*started|no\s*data|not\s*found/i.test(after.substring(0, 300));

      if (!hasEmptyCheck && !hasElseBranch) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
          title: 'Loop output may lack empty state',
          message: 'HTML-outputting loop has no empty/count check before it. Users may see blank content when there are no items.',
          file: rel, line: getLineNumber(content, loopMatch.index), code: 'empty-state-missing',
          fix: 'Add an if/else check before the loop to display a meaningful empty state message',
        });
        break; // One per file to avoid noise
      }

      if ((hasEmptyCheck || hasElseBranch) && hasEmptyMessage) {
        // Has an empty state — check if it includes a CTA
        const emptyContext = after.substring(0, 500);
        if (!/<a\b|<button\b|href\s*=|btn|cta|create|add\s*new|get\s*started/i.test(emptyContext)) {
          issues.push({
            id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'low', type: 'info',
            title: 'Empty state lacks a call-to-action',
            message: 'Empty state message found but has no link or button to help users take action (e.g., "Create your first item").',
            file: rel, line: getLineNumber(content, loopEnd), code: 'empty-state-no-cta',
            fix: 'Add a button or link in the empty state to guide users toward creating their first item',
          });
          break; // One per file
        }
      }
    }

    // Check for silent empty states — templates that conditionally output nothing
    const silentPattern = /if\s*\(\s*(?:empty|!\s*\$|count\s*\([^)]*\)\s*===?\s*0)/g;
    let silentMatch;
    while ((silentMatch = silentPattern.exec(content)) !== null) {
      const blockEnd = findFunctionEnd(content, silentMatch.index);
      const block = content.substring(silentMatch.index, blockEnd);

      // If the "empty" branch contains return with no output or just "return;"
      if (/return\s*;|return\s*''|return\s*""|return\s*null/i.test(block) && block.length < 200) {
        issues.push({
          id: generateTestId('frontend-eval'), category: 'frontend-eval', severity: 'medium', type: 'warning',
          title: 'Silent empty state — returns nothing to user',
          message: 'When data is empty, the template returns blank output. Users see nothing with no explanation.',
          file: rel, line: getLineNumber(content, silentMatch.index), code: 'empty-state-silent',
          fix: 'Return a helpful message instead of empty string, e.g., "No items found. Create your first one."',
        });
        break; // One per file
      }
    }
  }

  return issues;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findFunctionEnd(content: string, startIndex: number): number {
  let braceCount = 0;
  let started = false;
  for (let i = startIndex; i < content.length && i < startIndex + 5000; i++) {
    if (content[i] === '{') { braceCount++; started = true; }
    if (content[i] === '}') { braceCount--; }
    if (started && braceCount === 0) return i + 1;
  }
  return Math.min(startIndex + 5000, content.length);
}
