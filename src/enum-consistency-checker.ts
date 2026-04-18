/**
 * WP Plugin QA MCP Server - Enum Consistency Checker
 *
 * Catches the "enum drift" bug class: the same logical value (question type,
 * grading method, feedback timing, content type) is hardcoded as a list in
 * 3-5 places, and those places disagree — admin says `last`, service reads
 * `latest`; admin whitelist is 3 values, REST whitelist is 5, service
 * implements 2.
 *
 * Static-only: scans PHP for 3 patterns, groups by LHS variable + nearest
 * setting/column context, flags when 2+ files disagree on the set.
 */

import { readFileSync } from 'fs';
import type { CheckerResult, CheckerIssue } from './types.js';
import {
  findPhpFiles,
  getLineNumber,
  relativePath,
  generateTestId,
} from './shared-utils.js';

interface EnumObservation {
  values: string[];
  file: string;
  line: number;
  pattern: 'in_array' | 'rest-enum' | 'switch-case';
}

export function checkEnumConsistency(pluginPath: string): CheckerResult {
  const startTime = Date.now();
  const issues: CheckerIssue[] = [];

  const phpFiles = findPhpFiles(pluginPath);
  const groups = new Map<string, EnumObservation[]>();

  for (const file of phpFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const rel = relativePath(file, pluginPath);

    collectInArrayEnums(content, rel, groups);
    collectRestEnumArrays(content, rel, groups);
    collectSwitchEnums(content, rel, groups);
  }

  for (const [key, observations] of groups.entries()) {
    if (observations.length < 2) continue;

    // Deduplicate by file — two observations in the same file count as one
    // layer's opinion (union their values).
    const byFile = new Map<string, EnumObservation>();
    for (const obs of observations) {
      const existing = byFile.get(obs.file);
      if (!existing) {
        byFile.set(obs.file, obs);
        continue;
      }
      const merged = Array.from(new Set([...existing.values, ...obs.values])).sort();
      byFile.set(obs.file, { ...existing, values: merged });
    }

    if (byFile.size < 2) continue;

    const fileEntries = Array.from(byFile.values());
    const firstSet = new Set(fileEntries[0].values);
    let divergent = false;
    for (let i = 1; i < fileEntries.length; i++) {
      const other = new Set(fileEntries[i].values);
      if (!setsEqual(firstSet, other)) {
        divergent = true;
        break;
      }
    }
    if (!divergent) continue;

    const sample = fileEntries[0];
    const filesSummary = fileEntries
      .map((f) => `${f.file}:${f.line} allows [${f.values.join(', ')}]`)
      .join(' | ');

    issues.push({
      id: generateTestId('enum-consistency'),
      category: 'enum-consistency',
      severity: 'high',
      type: 'error',
      title: `Enum drift on "${key}"`,
      message: `Multiple files disagree on allowed values for "${key}". ${filesSummary}`,
      file: sample.file,
      line: sample.line,
      code: 'enum-drift',
      fix: `Extract the canonical list to one place (a class constant or Enums helper) and have admin/REST/service all call it. Run SELECT DISTINCT ${key} FROM <table> to find rows written with now-dead values.`,
    });
  }

  const errorCount = issues.filter((i) => i.type === 'error').length;
  return {
    category: 'enum-consistency',
    issues,
    passed: Math.max(0, groups.size - errorCount),
    failed: errorCount,
    skipped: 0,
    duration: Date.now() - startTime,
  };
}

/**
 * Pattern 1: `in_array( $var, [ 'a', 'b', 'c' ], true )` / array() form.
 * Grouping key = LHS var name + nearest setting/column context.
 */
function collectInArrayEnums(
  content: string,
  relFile: string,
  groups: Map<string, EnumObservation[]>,
): void {
  const re =
    /in_array\s*\(\s*\$([a-z_][a-z0-9_]*)\s*,\s*(?:\[([^\]]+)\]|array\s*\(([^)]+)\))/gi;
  let result: RegExpExecArray | null;
  while ((result = re.exec(content)) !== null) {
    const varName = result[1];
    const listBody = result[2] || result[3] || '';
    const values = extractStringLiterals(listBody);
    if (values.length < 2) continue;
    if (isBoringVariable(varName)) continue;

    const line = getLineNumber(content, result.index);
    const key = resolveContextKey(content, result.index, varName);

    pushObservation(groups, key, {
      values: values.slice().sort(),
      file: relFile,
      line,
      pattern: 'in_array',
    });
  }
}

/**
 * Pattern 2: `'enum' => [ 'a', 'b', 'c' ]` inside REST route args.
 * Grouping key = nearest preceding arg key within the REST args block.
 */
function collectRestEnumArrays(
  content: string,
  relFile: string,
  groups: Map<string, EnumObservation[]>,
): void {
  const re = /['"]enum['"]\s*=>\s*(?:\[([^\]]+)\]|array\s*\(([^)]+)\))/g;
  let result: RegExpExecArray | null;
  while ((result = re.exec(content)) !== null) {
    const listBody = result[1] || result[2] || '';
    const values = extractStringLiterals(listBody);
    if (values.length < 2) continue;

    const line = getLineNumber(content, result.index);
    const windowStart = Math.max(0, result.index - 2000);
    const before = content.slice(windowStart, result.index);
    const lines = before.split('\n').slice(-20);
    let argKey = 'unknown';
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(
        /^\s*['"]([a-z_][a-z0-9_]*)['"]\s*=>\s*(?:\[|array\s*\()/i,
      );
      if (m && !['enum', 'default', 'type', 'description'].includes(m[1].toLowerCase())) {
        argKey = m[1];
        break;
      }
    }
    if (argKey === 'unknown') continue;

    pushObservation(groups, argKey, {
      values: values.slice().sort(),
      file: relFile,
      line,
      pattern: 'rest-enum',
    });
  }
}

/**
 * Pattern 3: `switch ( $var ) { case 'a': ... case 'b': ... }`.
 */
function collectSwitchEnums(
  content: string,
  relFile: string,
  groups: Map<string, EnumObservation[]>,
): void {
  const re = /switch\s*\(\s*([^)]+?)\s*\)\s*\{/g;
  let result: RegExpExecArray | null;
  while ((result = re.exec(content)) !== null) {
    const switchedExpr = result[1].trim();
    const varName = extractCanonicalVar(switchedExpr);
    if (!varName || isBoringVariable(varName)) continue;

    const bodyStart = result.index + result[0].length;
    const bodyEnd = findMatchingBrace(content, bodyStart - 1);
    if (bodyEnd < 0) continue;
    const body = content.slice(bodyStart, bodyEnd);

    const caseRe = /\bcase\s+['"]([^'"]+)['"]\s*:/g;
    const values: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = caseRe.exec(body)) !== null) {
      values.push(cm[1]);
    }
    if (values.length < 2) continue;

    const line = getLineNumber(content, result.index);
    const key = resolveContextKey(content, result.index, varName);

    pushObservation(groups, key, {
      values: values.slice().sort(),
      file: relFile,
      line,
      pattern: 'switch-case',
    });
  }
}

/**
 * Look backward up to 20 lines for `->column_name` or `['key_name']` that
 * feeds the switched/tested value. Fall back to the raw var name.
 */
function resolveContextKey(content: string, index: number, varName: string): string {
  const windowStart = Math.max(0, index - 1500);
  const before = content.slice(windowStart, index);
  const lines = before.split('\n').slice(-20);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const arrowMatch = line.match(
      new RegExp(
        '\\$' + varName + '\\s*=\\s*\\$[a-z_][a-z0-9_]*->([a-z_][a-z0-9_]*)',
        'i',
      ),
    );
    if (arrowMatch) return arrowMatch[1];
    const bracketMatch = line.match(
      new RegExp(
        "\\$" +
          varName +
          "\\s*=\\s*\\$[a-z_][a-z0-9_]*\\[\\s*['\"]([a-z_][a-z0-9_]*)['\"]\\s*\\]",
        'i',
      ),
    );
    if (bracketMatch) return bracketMatch[1];
    const fnMatch = line.match(
      new RegExp('set_([a-z_][a-z0-9_]*)\\s*\\(\\s*\\$' + varName + '\\b', 'i'),
    );
    if (fnMatch) return fnMatch[1];
  }

  return varName;
}

function extractStringLiterals(listBody: string): string[] {
  const re = /['"]([a-z0-9_-]{1,40})['"]/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(listBody)) !== null) {
    out.push(m[1]);
  }
  return Array.from(new Set(out));
}

function extractCanonicalVar(expr: string): string | null {
  let m = expr.match(/->([a-z_][a-z0-9_]*)\s*(?:\(\s*\))?$/i);
  if (m) return m[1];
  m = expr.match(/\[\s*['"]([a-z_][a-z0-9_]*)['"]\s*\]\s*$/i);
  if (m) return m[1];
  m = expr.match(/^\$([a-z_][a-z0-9_]*)$/i);
  if (m) return m[1];
  return null;
}

function findMatchingBrace(content: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function pushObservation(
  groups: Map<string, EnumObservation[]>,
  key: string,
  obs: EnumObservation,
): void {
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(obs);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function isBoringVariable(name: string): boolean {
  return [
    'i',
    'j',
    'k',
    'n',
    'x',
    'y',
    'value',
    'val',
    'item',
    'v',
    'tmp',
    'temp',
    'key',
    'result',
    'ret',
    'out',
    'arg',
    'args',
    'param',
    'params',
  ].includes(name.toLowerCase());
}
