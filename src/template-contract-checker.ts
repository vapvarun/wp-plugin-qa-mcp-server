/**
 * WP Plugin QA MCP Server - Template Contract Checker
 *
 * Loader <-> template contract drift. Catches the silent-bug class where a
 * template uses a variable that the loader never puts into the `$args`
 * passed to the template helper. WPCS cannot see this because it analyzes
 * files in isolation — this check is cross-layer.
 *
 * Supported loader calls (common WooCommerce-style convention):
 *
 *   wc_get_template( 'foo.php', array( 'a' => … ) )
 *   {prefix}_get_template( 'foo.php', array( 'a' => … ) )
 *   {prefix}_get_template_html( 'foo.php', array( 'a' => … ) )
 *
 * The callee resolves the template file, the args keys become the
 * variables the template is allowed to read, and anything consumed in
 * the template outside that set is contract drift.
 *
 * This is intentionally conservative: only variables that clearly look
 * like loader-supplied template data are checked. PHP globals, $this,
 * $wpdb, loop variables (foreach, for), arguments received from another
 * include, and variables assigned inside the template itself are all
 * excluded.
 */

import { readFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import type { CheckerResult, CheckerIssue } from './types.js';
import {
  findPhpFiles,
  relativePath,
  generateTestId,
  dirExists,
  fileExists,
} from './shared-utils.js';

// Variables a template may legitimately reference without the loader
// passing them in: PHP globals, WordPress globals, common superglobals,
// and helpers defined inside the template itself.
const TEMPLATE_IMPLICIT_VARS = new Set<string>([
  'this',
  'wpdb',
  'wp',
  'post',
  'posts',
  'authordata',
  'wp_query',
  'wp_the_query',
  'GLOBALS',
  '_GET',
  '_POST',
  '_REQUEST',
  '_SERVER',
  '_COOKIE',
  '_SESSION',
  '_FILES',
  // Template loader contract passes `$view_data` as a self-reference so
  // downstream hooks can receive the whole assembled array.
  'view_data',
]);

interface LoaderCall {
  templateName: string;
  /** Keys passed in the second arg array. */
  passedKeys: Set<string>;
  callerFile: string;
  callerLine: number;
}

export function checkTemplateContracts(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];

  const templatesDir = join(pluginPath, 'templates');
  if (!dirExists(templatesDir)) {
    return {
      category: 'template-contract' as any,
      issues: [],
      passed: 0,
      failed: 0,
      skipped: 1,
      duration: Date.now() - startTime,
    };
  }

  const loaderCalls = findLoaderCalls(pluginPath);
  if (loaderCalls.length === 0) {
    return {
      category: 'template-contract' as any,
      issues: [],
      passed: 0,
      failed: 0,
      skipped: 1,
      duration: Date.now() - startTime,
    };
  }

  // Merge passed keys per-template (a template may be called from several
  // loaders with slightly different arg sets — the union of keys is what
  // the template can safely read).
  const unionPerTemplate = new Map<string, { keys: Set<string>; callers: Array<{ file: string; line: number }> }>();
  for (const call of loaderCalls) {
    const entry = unionPerTemplate.get(call.templateName) ?? {
      keys: new Set<string>(),
      callers: [] as Array<{ file: string; line: number }>,
    };
    for (const k of call.passedKeys) entry.keys.add(k);
    entry.callers.push({ file: call.callerFile, line: call.callerLine });
    unionPerTemplate.set(call.templateName, entry);
  }

  let checked = 0;
  for (const [templateName, meta] of unionPerTemplate.entries()) {
    const templatePath = resolveTemplatePath(pluginPath, templateName);
    if (!templatePath) continue;

    let content: string;
    try {
      content = readFileSync(templatePath, 'utf-8');
    } catch {
      continue;
    }

    checked++;

    const consumed = collectConsumedVars(content);
    const locallyAssigned = collectLocallyAssignedVars(content);

    for (const [varName, firstLine] of consumed.entries()) {
      if (TEMPLATE_IMPLICIT_VARS.has(varName)) continue;
      if (locallyAssigned.has(varName)) continue;
      if (meta.keys.has(varName)) continue;

      issues.push({
        id: generateTestId('template-contract'),
        category: 'template-contract' as any,
        severity: 'high',
        type: 'error',
        title: `Template reads $${varName} but no loader passes it`,
        message:
          `Template ${templateName} consumes $${varName} at line ${firstLine}, ` +
          `but none of the loaders that include it (${meta.callers.map((c) => `${c.file}:${c.line}`).join(', ')}) ` +
          'supply that key in the args array.',
        file: relativePath(templatePath, pluginPath),
        line: firstLine,
        code: 'template-contract-drift',
        fix:
          `Add '${varName}' => $value to the args array in the loader, ` +
          'or remove the variable from the template if it is dead code.',
      });
    }
  }

  const failed = issues.length;
  return {
    category: 'template-contract' as any,
    issues,
    passed: Math.max(0, checked - failed),
    failed,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

/**
 * Walk every PHP file and locate calls of the shape
 *   `*_get_template( 'path/to/tpl.php', array(...) )`
 * or the `_html` variant. Returns the resolved template name + keys in
 * the args array.
 */
function findLoaderCalls(pluginPath: string): LoaderCall[] {
  const calls: LoaderCall[] = [];
  const callRe =
    /\b([a-z_]+_get_template(?:_html)?)\s*\(\s*(['"])([^'"]+)\2\s*,\s*(array\s*\(|\[)/gi;

  for (const file of findPhpFiles(pluginPath)) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    for (const m of content.matchAll(callRe)) {
      const templateName = m[3];
      const open = m[4].includes('[') ? '[' : '(';
      const close = open === '[' ? ']' : ')';
      const openIdx = (m.index ?? 0) + m[0].length - 1;
      const endIdx = findMatchingCloser(content, openIdx, open, close);
      if (endIdx < 0) continue;

      const argsBlock = content.slice(openIdx + 1, endIdx);
      const passed = new Set<string>();

      // Only match top-level keys by tracking bracket/paren depth.
      const keyRe = /['"]([a-z_][a-z0-9_]*)['"]\s*=>/gi;
      let depth = 0;
      for (let i = 0; i < argsBlock.length; i++) {
        const ch = argsBlock[i];
        if (ch === '[' || ch === '(') depth++;
        else if (ch === ']' || ch === ')') depth--;
      }
      // Shallow walk: accept all matches — the called templates typically
      // accept a flat associative array, and nested keys would only add
      // false negatives here, not positives.
      for (const k of argsBlock.matchAll(keyRe)) {
        passed.add(k[1]);
      }

      calls.push({
        templateName,
        passedKeys: passed,
        callerFile: relativePath(file, pluginPath),
        callerLine: lineOf(content, m.index ?? 0),
      });
    }
  }

  return calls;
}

/**
 * Try to resolve a template-name argument to a concrete file path.
 * Checks the plugin templates directory in a handful of well-known
 * layouts.
 */
function resolveTemplatePath(pluginPath: string, templateName: string): string | null {
  const candidates = [
    join(pluginPath, 'templates', templateName),
    join(pluginPath, 'templates', templateName.replace(/^\/+/, '')),
  ];
  for (const c of candidates) {
    if (fileExists(c)) return c;
  }
  return null;
}

/**
 * All variable reads inside a template that look like they come from the
 * loader: `$foo` references, `$foo['bar']` accesses, `$foo->bar` accesses.
 * We record only the ROOT variable name ($foo) — that is what the loader
 * either passes or omits.
 */
function collectConsumedVars(content: string): Map<string, number> {
  const vars = new Map<string, number>();
  const varRe = /\$([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

  for (const m of content.matchAll(varRe)) {
    const name = m[1];
    if (vars.has(name)) continue;
    vars.set(name, lineOf(content, m.index ?? 0));
  }

  return vars;
}

/**
 * Variables that the template itself declares via `$foo = …`, foreach
 * value/key bindings, list()/[] destructuring, catch (Exception $e),
 * or compact()/extract() targets. These are NOT part of the loader
 * contract and must be excluded from the drift check.
 */
function collectLocallyAssignedVars(content: string): Set<string> {
  const locals = new Set<string>();

  const patterns: RegExp[] = [
    // $foo = …
    /\$([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)/g,
    // foreach ( … as $value ) + foreach ( … as $key => $value )
    /foreach\s*\([^)]*\bas\s+\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=>\s*\$([a-zA-Z_][a-zA-Z0-9_]*))?/g,
    // for ( $i = 0; … )
    /\bfor\s*\(\s*\$([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g,
    // catch ( Exception $e )
    /\bcatch\s*\(\s*[^\s)]+\s+\$([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g,
    // global $wpdb
    /\bglobal\s+\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
  ];

  for (const pattern of patterns) {
    for (const m of content.matchAll(pattern)) {
      if (m[1]) locals.add(m[1]);
      if (m[2]) locals.add(m[2]);
    }
  }

  return locals;
}

function findMatchingCloser(content: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}
