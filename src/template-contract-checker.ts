/**
 * WP Plugin QA MCP Server - Template Contract Checker
 *
 * Loader <-> template contract drift. Catches the silent-bug class where a
 * template reads a variable the loader never supplies, so it renders blank /
 * a notice and nothing else detects it. WPCS/PHPStan/Plugin Check analyze
 * files in isolation and cannot see the loader<->template contract.
 *
 * Two loader conventions are auto-detected (v3 generalization):
 *
 *   1. WooCommerce-style template helper:
 *        wc_get_template( 'foo.php', array( 'a' => … ) )
 *        {prefix}_get_template( 'foo.php', array( … ) )
 *      The args-array keys are the variables the template may read.
 *
 *   2. View-data resolver registry (e.g. Learnomy's Template_Loader):
 *        $view_data_resolvers = array( 'course' => 'X\\Single_Course_View_Data', … );
 *        $template_map        = array( 'course' => 'course/classic.php', … );
 *      A per-route resolver class exposes `resolve(): array`; the loader
 *      extract()s that array into the template. The resolver's returned keys
 *      are the variables the template may read.
 *
 * Optional per-plugin override: `audit/template-contracts.json`
 *   { "whitelisted_vars": ["slug","route", …],          // loader/route vars
 *     "contracts": [ { "template": "x.php", "resolver": "includes/.../class-x.php",
 *                      "also_supplies": ["k"] } ] }       // explicit pairs
 *
 * Conservative by design: PHP/WordPress globals, $this, loop variables,
 * locally assigned variables, and (for resolvers) the over-approximated set
 * of every literal array key in the resolver file are all treated as
 * supplied — the check biases to false-negatives over false-positives so the
 * manifest layer stays clean.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { CheckerResult, CheckerIssue } from './types.js';
import {
  findPhpFiles,
  relativePath,
  generateTestId,
  dirExists,
  fileExists,
} from './shared-utils.js';

// Variables a template may reference without any loader passing them:
// PHP/WordPress globals, superglobals, and the loader self-reference.
const TEMPLATE_IMPLICIT_VARS = new Set<string>([
  'this', 'wpdb', 'wp', 'post', 'posts', 'authordata', 'wp_query', 'wp_the_query',
  'GLOBALS', '_GET', '_POST', '_REQUEST', '_SERVER', '_COOKIE', '_SESSION', '_FILES',
  'view_data',
]);

export type TemplateContractMode = 'wc-loader' | 'resolver' | 'config' | 'mixed' | 'none';

interface Contract {
  /** Keys the loader/resolver supplies to this template. */
  keys: Set<string>;
  /** Detection source(s) for reporting. */
  sources: Set<TemplateContractMode>;
  /** Where the contract was declared (loader call / resolver file). */
  origins: string[];
}

export interface TemplateContractAnalysis {
  mode: TemplateContractMode;
  /** Templates that had a resolvable contract and were checked. */
  checked: number;
  result: CheckerResult;
}

/** Public tool entry — returns the CheckerResult only (back-compat). */
export function checkTemplateContracts(pluginPath: string): CheckerResult {
  return analyzeTemplateContracts(pluginPath).result;
}

/** Richer entry used by the v3 manifest layer: also reports the detected mode. */
export function analyzeTemplateContracts(pluginPath: string): TemplateContractAnalysis {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];

  const config = loadConfig(pluginPath);
  const extraImplicit = new Set<string>([...TEMPLATE_IMPLICIT_VARS, ...(config?.whitelisted_vars ?? [])]);

  // Build the contract map from every available source.
  const contracts = new Map<string, Contract>();
  const merge = (name: string, keys: Set<string>, source: TemplateContractMode, origin: string) => {
    const c = contracts.get(name) ?? { keys: new Set<string>(), sources: new Set<TemplateContractMode>(), origins: [] };
    for (const k of keys) c.keys.add(k);
    c.sources.add(source);
    c.origins.push(origin);
    contracts.set(name, c);
  };

  // Source 1 — WooCommerce-style loader calls.
  for (const call of findLoaderCalls(pluginPath)) {
    merge(call.templateName, call.passedKeys, 'wc-loader', `${call.callerFile}:${call.callerLine}`);
  }

  // Source 2 — view-data resolver registry (auto-detected).
  const classIndex = buildClassFileIndex(pluginPath);
  for (const rc of findResolverContracts(pluginPath, classIndex)) {
    merge(rc.templateName, rc.keys, 'resolver', rc.resolverFile);
  }

  // Source 3 — explicit per-plugin config (highest trust).
  for (const pair of config?.contracts ?? []) {
    if (!pair.template || !pair.resolver) continue;
    const resAbs = join(pluginPath, pair.resolver);
    if (!fileExists(resAbs)) continue;
    const keys = resolverReturnKeys(resAbs);
    for (const k of pair.also_supplies ?? []) keys.add(k);
    merge(pair.template, keys, 'config', pair.resolver);
  }

  // Nothing to verify (no known loader convention detected anywhere): skip.
  // Templates need not live in a root templates/ dir — Pro extensions register
  // their own views/ dirs via filters, and the contract map already captured them.
  if (contracts.size === 0) {
    return {
      mode: 'none',
      checked: 0,
      result: { category: 'template-contract', issues: [], passed: 0, failed: 0, skipped: 1, duration: Date.now() - startTime },
    };
  }

  let checked = 0;
  for (const [templateName, meta] of contracts.entries()) {
    const templatePath = resolveTemplatePath(pluginPath, templateName);
    if (!templatePath) continue;

    let content: string;
    try {
      content = readFileSync(templatePath, 'utf-8');
    } catch {
      continue;
    }
    checked++;

    // Strip comments first: `$var` inside a docblock (@param) or a
    // contract-listing comment is NOT a read, and counting it produces
    // false positives. String contents are preserved ("Hello $name" IS a read).
    const code = stripPhpComments(blankNonPhp(content));
    const consumed = collectConsumedVars(code);
    const locallyAssigned = collectLocallyAssignedVars(code);

    for (const [varName, firstLine] of consumed.entries()) {
      if (extraImplicit.has(varName)) continue;
      if (locallyAssigned.has(varName)) continue;
      if (meta.keys.has(varName)) continue;

      issues.push({
        id: generateTestId('template-contract'),
        category: 'template-contract',
        severity: 'high',
        type: 'error',
        title: `Template reads $${varName} but no loader/resolver supplies it`,
        message:
          `Template ${templateName} consumes $${varName} at line ${firstLine}, but the contract ` +
          `(${[...meta.sources].join('+')}: ${meta.origins.slice(0, 3).join(', ')}) does not supply that key.`,
        file: relativePath(templatePath, pluginPath),
        line: firstLine,
        code: 'template-contract-drift',
        fix:
          `Supply '${varName}' from the resolver/loader, add it to audit/template-contracts.json ` +
          `whitelisted_vars if it is a loader/route var, or remove it from the template if dead.`,
      });
    }
  }

  const failed = issues.length;
  const modes = new Set<TemplateContractMode>();
  for (const c of contracts.values()) for (const s of c.sources) modes.add(s);
  const mode: TemplateContractMode = modes.size === 0 ? 'none' : modes.size === 1 ? [...modes][0] : 'mixed';

  return {
    mode,
    checked,
    result: {
      category: 'template-contract',
      issues,
      passed: Math.max(0, checked - failed),
      failed,
      skipped: 0,
      duration: Date.now() - startTime,
    },
  };
}

interface LoaderCall {
  templateName: string;
  passedKeys: Set<string>;
  callerFile: string;
  callerLine: number;
}

/** WooCommerce-style `*_get_template( 'tpl.php', array(...) )` calls. */
function findLoaderCalls(pluginPath: string): LoaderCall[] {
  const calls: LoaderCall[] = [];
  const callRe = /\b([a-z_]+_get_template(?:_html)?)\s*\(\s*(['"])([^'"]+)\2\s*,\s*(array\s*\(|\[)/gi;

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
      const keyRe = /['"]([a-z_][a-z0-9_]*)['"]\s*=>/gi;
      for (const k of argsBlock.matchAll(keyRe)) passed.add(k[1]);

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

interface ResolverContract {
  templateName: string;
  keys: Set<string>;
  resolverFile: string;
}

/**
 * Auto-detect the view-data resolver convention. Collect, across all PHP
 * files, the two map shapes:
 *   'routeKey' => 'Some\\Namespace\\Foo_View_Data'   (resolver registry)
 *   'routeKey' => 'path/to/template.php'             (template map)
 * Pair by routeKey; the resolver class's returned array keys are the
 * variables its template may read.
 */
interface TemplateEntry {
  rawPath: string;
  /** true when the value was `__DIR__ . '/…'` — resolve against the declaring file. */
  fromDir: boolean;
  declaringDir: string;
}

function findResolverContracts(pluginPath: string, classIndex: Map<string, string>): ResolverContract[] {
  const resolverMap = new Map<string, string>(); // routeKey -> resolver class short name
  const templateMap = new Map<string, TemplateEntry>(); // routeKey -> template entry

  // Match BOTH arrow literals (`'k' => 'V'`) and array-append assignments
  // (`$x['k'] = 'V'`) — Pro registers via filter callbacks that append.
  const keyPrefix = `(?:'([A-Za-z0-9_-]+)'\\s*=>|\\$[A-Za-z_]\\w*\\[\\s*'([A-Za-z0-9_-]+)'\\s*\\]\\s*=)`;
  const resolverRe = new RegExp(`${keyPrefix}\\s*'(\\\\?[A-Za-z0-9_\\\\]*(?:View_Data|Loader))'`, 'g');
  const templateRe = new RegExp(`${keyPrefix}\\s*(__DIR__\\s*\\.\\s*)?'([^']+\\.php)'`, 'g');

  for (const file of findPhpFiles(pluginPath)) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const m of content.matchAll(resolverRe)) {
      const key = m[1] ?? m[2];
      const short = (m[3] ?? '').split('\\').filter(Boolean).pop();
      if (key && short && !resolverMap.has(key)) resolverMap.set(key, short);
    }
    for (const m of content.matchAll(templateRe)) {
      const key = m[1] ?? m[2];
      if (!key || templateMap.has(key)) continue;
      templateMap.set(key, { rawPath: m[4], fromDir: !!m[3], declaringDir: dirname(file) });
    }
  }

  const out: ResolverContract[] = [];
  const seen = new Set<string>();
  for (const [key, shortName] of resolverMap.entries()) {
    const tpl = templateMap.get(key);
    if (!tpl) continue;
    const tplPath = resolveTemplateEntry(pluginPath, tpl);
    if (!tplPath) continue;
    const resolverFile = classIndex.get(shortName);
    if (!resolverFile) continue;
    const keys = resolverReturnKeys(resolverFile);
    if (keys.size === 0) continue;
    const rel = relativePath(tplPath, pluginPath);
    const dedupe = `${rel}::${shortName}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ templateName: rel, keys, resolverFile: relativePath(resolverFile, pluginPath) });
  }
  return out;
}

/** Resolve a template-map value to a file: __DIR__-relative, templates/, or plugin-relative. */
function resolveTemplateEntry(pluginPath: string, e: TemplateEntry): string | null {
  const p = e.rawPath.replace(/^\/+/, '');
  const candidates = [
    join(e.declaringDir, p),
    join(pluginPath, 'templates', p),
    join(pluginPath, p),
  ];
  for (const c of candidates) if (fileExists(c)) return c;
  return null;
}

/** Index `class Foo` declarations → absolute file path (first match wins). */
function buildClassFileIndex(pluginPath: string): Map<string, string> {
  const index = new Map<string, string>();
  const classRe = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const file of findPhpFiles(pluginPath)) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const m of content.matchAll(classRe)) {
      if (!index.has(m[1])) index.set(m[1], file);
    }
  }
  return index;
}

/**
 * Over-approximate the keys a resolver supplies: every literal `'key' =>` and
 * `$x['key'] =` in the resolver file. Over-approximation keeps the check
 * conservative (no false positives from keys built in a branch we missed).
 */
function resolverReturnKeys(file: string): Set<string> {
  const keys = new Set<string>();
  let content: string;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    return keys;
  }
  for (const m of content.matchAll(/'([a-z_][a-z0-9_]*)'\s*=>/gi)) keys.add(m[1]);
  for (const m of content.matchAll(/\$[a-z_][a-z0-9_]*\[\s*'([a-z_][a-z0-9_]*)'\s*\]\s*=(?!=)/gi)) keys.add(m[1]);
  return keys;
}

interface ContractConfig {
  whitelisted_vars?: string[];
  contracts?: Array<{ template: string; resolver: string; also_supplies?: string[] }>;
  zero_logic?: { template_dirs?: string[]; deny?: string[]; allow_files?: string[] };
  components?: { rules?: Array<{ name: string; scope_dirs: string[]; pattern: string; canonical?: string; hint?: string; allow_files?: string[] }> };
}

// TC1 — data-fetch signals that must NOT appear in a template (a template
// receives pre-resolved data). Conservative defaults; a plugin extends them
// via audit/template-contracts.json zero_logic.deny.
const DEFAULT_ZERO_LOGIC_DENY = [
  '\\$wpdb\\b',
  '\\b[A-Z][A-Za-z0-9_]*::(find|find_in|where|query|create|update|delete|insert)\\s*\\(',
];

export interface HygieneFinding { file: string; line: number; rule: string; snippet: string; hint: string; }
export interface TemplateHygiene {
  zeroLogic: { checkedFiles: number; findings: HygieneFinding[] };
  components: { checkedFiles: number; findings: HygieneFinding[] };
}

function readSafe(file: string): string {
  try { return readFileSync(file, 'utf-8'); } catch { return ''; }
}

/**
 * TC1 (zero-logic templates) + TC3 (shared-component usage). Both are config-
 * refined and emitted as v3 manifest layers. Deterministic; findings sorted by
 * the caller. TC1 strips comments/HTML so a $wpdb in a comment isn't flagged;
 * TC3 matches raw lines because markup is what matters.
 */
export function analyzeTemplateHygiene(pluginPath: string): TemplateHygiene {
  const config = loadConfig(pluginPath);

  // TC1 — zero-logic.
  const z = config?.zero_logic ?? {};
  const zDirs = z.template_dirs ?? ['templates'];
  const zAllow = new Set(z.allow_files ?? []);
  const zRes = [...DEFAULT_ZERO_LOGIC_DENY, ...(z.deny ?? [])].map((p) => new RegExp(p));
  const zFindings: HygieneFinding[] = [];
  let zFiles = 0;
  for (const dir of zDirs) {
    for (const file of findPhpFiles(join(pluginPath, dir))) {
      const rel = relativePath(file, pluginPath);
      if (zAllow.has(rel)) continue;
      zFiles++;
      const code = stripPhpComments(blankNonPhp(readSafe(file)));
      code.split('\n').forEach((ln, i) => {
        for (const re of zRes) {
          if (re.test(ln)) {
            zFindings.push({ file: rel, line: i + 1, rule: 'zero-logic', snippet: ln.trim().slice(0, 120), hint: 'fetch data in a view-data resolver, not the template' });
            break;
          }
        }
      });
    }
  }

  // TC3 — shared-component usage.
  const cFindings: HygieneFinding[] = [];
  const cFiles = new Set<string>();
  for (const rule of config?.components?.rules ?? []) {
    let re: RegExp;
    try { re = new RegExp(rule.pattern); } catch { continue; }
    const allow = new Set(rule.allow_files ?? []);
    for (const dir of rule.scope_dirs ?? []) {
      for (const file of findPhpFiles(join(pluginPath, dir))) {
        const rel = relativePath(file, pluginPath);
        if (rel === rule.canonical || allow.has(rel)) continue;
        cFiles.add(rel);
        readSafe(file).split('\n').forEach((ln, i) => {
          if (re.test(ln)) cFindings.push({ file: rel, line: i + 1, rule: rule.name, snippet: ln.trim().slice(0, 120), hint: rule.hint ?? '' });
        });
      }
    }
  }

  return { zeroLogic: { checkedFiles: zFiles, findings: zFindings }, components: { checkedFiles: cFiles.size, findings: cFindings } };
}

function loadConfig(pluginPath: string): ContractConfig | null {
  const p = join(pluginPath, 'audit', 'template-contracts.json');
  if (!fileExists(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as ContractConfig) : null;
  } catch {
    return null;
  }
}

function resolveTemplatePath(pluginPath: string, templateName: string): string | null {
  const candidates = [
    join(pluginPath, 'templates', templateName),
    join(pluginPath, 'templates', templateName.replace(/^\/+/, '')),
    join(pluginPath, templateName),
  ];
  for (const c of candidates) if (fileExists(c)) return c;
  return null;
}

function collectConsumedVars(content: string): Map<string, number> {
  const vars = new Map<string, number>();
  const varRe = /\$([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  for (const m of content.matchAll(varRe)) {
    const name = m[1];
    if (vars.has(name)) continue;
    const idx = m.index ?? 0;
    // Skip printf positional placeholders (%1$s, %2$d, and the escaped
    // double-quoted form %1\$s) — these are NOT genuine variable reads.
    if (/%\d+\\?$/.test(content.slice(Math.max(0, idx - 6), idx))) continue;
    vars.set(name, lineOf(content, idx));
  }
  return vars;
}

function collectLocallyAssignedVars(content: string): Set<string> {
  const locals = new Set<string>();
  const patterns: RegExp[] = [
    /\$([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)/g,
    /foreach\s*\([^)]*\bas\s+\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=>\s*\$([a-zA-Z_][a-zA-Z0-9_]*))?/g,
    /\bfor\s*\(\s*\$([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g,
    /\bcatch\s*\(\s*[^\s)]+\s+\$([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g,
    /\bglobal\s+\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
    // list()/[] destructuring targets
    /\[\s*\$([a-zA-Z_][a-zA-Z0-9_]*)\s*[,\]]/g,
    // foreach/as bindings — matched on `as $x` directly so a nested-paren
    // iterable (foreach ( array_filter(...) as $x )) can't break detection.
    /\bas\s+\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=>\s*\$([a-zA-Z_][a-zA-Z0-9_]*))?/g,
  ];
  for (const pattern of patterns) {
    for (const m of content.matchAll(pattern)) {
      if (m[1]) locals.add(m[1]);
      if (m[2]) locals.add(m[2]);
    }
  }
  // Closure / arrow-function parameters and `use (...)` imports are locals —
  // e.g. `static fn( string $v ): bool => …` or `function ( $a ) use ( $b )`.
  const fnHeadRe = /\b(?:fn|function)\b\s*\(([^)]*)\)(?:\s*:\s*[^={]+)?(?:\s*use\s*\(([^)]*)\))?/g;
  for (const m of content.matchAll(fnHeadRe)) {
    for (const group of [m[1], m[2]]) {
      if (!group) continue;
      for (const pm of group.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g)) locals.add(pm[1]);
    }
  }
  return locals;
}

/**
 * Blank everything OUTSIDE `<?php … ?>` regions. Templates are mixed HTML+PHP:
 * a `$var` in HTML text is literal (not a read), and HTML attribute quotes /
 * `//` inside a URL would otherwise desync the PHP comment/string scanner.
 * Newlines and byte offsets are preserved so line numbers stay accurate.
 */
function blankNonPhp(content: string): string {
  const out = content.split('');
  const n = content.length;
  const blankAt = (k: number) => { if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  let inPhp = false;
  while (i < n) {
    if (!inPhp) {
      if (content.startsWith('<?php', i) || content.startsWith('<?=', i)) {
        const tagLen = content.startsWith('<?php', i) ? 5 : 3;
        for (let k = i; k < i + tagLen; k++) blankAt(k);
        i += tagLen;
        inPhp = true;
        continue;
      }
      blankAt(i);
      i++;
      continue;
    }
    if (content.startsWith('?>', i)) {
      blankAt(i);
      blankAt(i + 1);
      i += 2;
      inPhp = false;
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * Blank out PHP comments (// , # , block comments, docblocks) while preserving
 * every newline and the byte length, so line numbers stay accurate. Double-
 * quoted strings are preserved (a `$var` inside "…" is a genuine read);
 * single-quoted strings are blanked (no interpolation).
 */
function stripPhpComments(content: string): string {
  const out = content.split('');
  let i = 0;
  const n = content.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < n) {
    const ch = content[i];
    const next = content[i + 1];
    if (ch === "'") {
      // Single-quoted strings never interpolate — blank their interior so
      // printf placeholders ('%1$s', '%2$d') and any literal $x are not
      // mistaken for variable reads.
      i++;
      while (i < n) {
        if (content[i] === '\\') { i += 2; continue; }
        if (content[i] === "'") { i++; break; }
        if (content[i] !== '\n') out[i] = ' ';
        i++;
      }
      continue;
    }
    if (ch === '"') {
      // Double-quoted strings DO interpolate — preserve them ("Hello $name"
      // is a genuine read).
      i++;
      while (i < n) {
        if (content[i] === '\\') { i += 2; continue; }
        if (content[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      let j = i;
      while (j < n && content[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '#') {
      let j = i;
      while (j < n && content[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(content[j] === '*' && content[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

function findMatchingCloser(content: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inSingle) { if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '"') inDouble = false; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
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
